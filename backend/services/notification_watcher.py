"""
Background notification watcher.

Periodically polls the POS (via proxy) to detect:
  - 🚫 Fiş iptalleri (cancellations)
  - 💰 Yüksek meblağlı satışlar (high-value sales — Perakende fişleri + Satış faturaları)
  - 📦 Eksi stok (negative stock across all locations)

For each detected event, sends a push notification via Expo Push API to all active
tokens of users whose preferences match (tenant + notify_* flag + threshold).

De-duplication via `notification_events_seen` table (tenant_id, event_type, event_key).
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any

import httpx

from services import get_patron_pool
from routes.data import SYNC_URL as POS_API_URL  # shared upstream URL

logger = logging.getLogger(__name__)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Global task handle so we can cancel on shutdown
_watcher_task: asyncio.Task | None = None


async def _pos_run(tenant_id: str, dataset_key: str, params: dict) -> list:
    """Run a dataset on the remote POS and return rows (simple one-page call)."""
    async with httpx.AsyncClient(timeout=60) as client:
        # 1) Create request
        create_body = {
            "tenant_id": tenant_id,
            "action": "request_create",
            "Key": dataset_key,
            **params,
        }
        r = await client.post(POS_API_URL, json=create_body)
        j = r.json()
        req_uid = j.get("request_uid", "") or j.get("requestId", "")
        if not req_uid:
            return []
        # 2) Poll status up to ~30s
        for _ in range(30):
            await asyncio.sleep(1)
            st = await client.post(POS_API_URL, json={
                "tenant_id": tenant_id, "action": "request_status", "RequestUid": req_uid,
            })
            sj = st.json()
            status = (sj.get("status") or "").lower()
            if status in ("done", "completed", "hazir", "ok"):
                data = sj.get("data") or sj.get("Data") or sj.get("result") or []
                return data if isinstance(data, list) else []
            if status in ("error", "fail", "failed"):
                return []
        return []


async def _pos_dataset_get(tenant_id: str, dataset_key: str, params: dict) -> list:
    """Call POS sync.php directly with action=dataset_get (synchronous fast path).

    This is the same approach the working /api/data/iptal-list endpoint uses.
    """
    async with httpx.AsyncClient(timeout=60) as client:
        payload = {
            "tenant_id": tenant_id,
            "action": "dataset_get",
            "dataset_key": dataset_key,
            "params": params,
        }
        try:
            r = await client.post(POS_API_URL, json=payload, headers={
                "Content-Type": "application/json; charset=utf-8",
            })
            j = r.json()
            if r.status_code >= 400:
                logger.warning(f"[pos] dataset_get {dataset_key} HTTP {r.status_code}: {j}")
                return []
            data = j.get("data") or []
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.warning(f"[pos] dataset_get {dataset_key} failed: {e}")
            return []


async def _push_many(tokens: List[str], title: str, body: str, data: dict | None = None) -> None:
    if not tokens:
        logger.warning("[push] _push_many called with 0 tokens")
        return
    msgs = [{
        "to": t, "sound": "default", "title": title, "body": body,
        "data": data or {}, "priority": "high", "channelId": "default",
    } for t in tokens]
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(EXPO_PUSH_URL, json=msgs, headers={
                "Accept": "application/json", "Content-Type": "application/json",
            })
            status_code = resp.status_code
            try:
                body_json = resp.json()
            except Exception:
                body_json = {"raw": resp.text[:500]}
            logger.info(f"[push] Expo response status={status_code} body={body_json}")

            # Parse tickets to detect delivery issues (DeviceNotRegistered etc.)
            if isinstance(body_json, dict):
                tickets = body_json.get("data") or []
                if isinstance(tickets, list):
                    for idx, ticket in enumerate(tickets):
                        tk = tokens[idx] if idx < len(tokens) else "?"
                        if isinstance(ticket, dict):
                            status = ticket.get("status")
                            if status == "error":
                                msg = ticket.get("message") or "unknown"
                                err_code = (ticket.get("details") or {}).get("error")
                                logger.warning(
                                    f"[push] Expo ERROR for token {tk[:25]}... "
                                    f"status={status} code={err_code} msg={msg}"
                                )
                                # NOTE: We used to auto-deactivate invalid tokens here.
                                # Disabled because it was deactivating tokens that the
                                # device would actually re-register minutes later on
                                # app re-open, causing a thrash of active flags.
                                # Just log the error and let the next register-token
                                # call refresh the token naturally.
                            elif status == "ok":
                                logger.info(f"[push] ✅ Ticket OK for token {tk[:25]}... id={ticket.get('id')}")
    except Exception as e:
        logger.warning(f"[push] send failed: {e}")


async def _mark_event_seen(tenant_id: str, event_type: str, event_key: str) -> bool:
    """Returns True if newly marked (was not seen before)."""
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(
                    "INSERT INTO notification_events_seen (tenant_id, event_type, event_key, seen_at) VALUES (%s, %s, %s, NOW())",
                    (tenant_id, event_type, event_key),
                )
                await conn.commit()
                return True
            except Exception:
                await conn.rollback()
                return False


async def _get_users_to_check() -> List[Dict[str, Any]]:
    """
    Return a list of (user, tenant) combinations whose notification settings are due.
    One user with N tenants → N entries. Includes tenant_name for display.
    """
    # Import here to avoid circular imports at module load
    try:
        from server import db as mongo_db  # type: ignore
    except Exception:
        mongo_db = None

    pool = await get_patron_pool()
    users: List[Dict[str, Any]] = []
    now = datetime.now()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT s.user_id, u.tenant_id, s.notify_cancellations, s.notify_high_sales,
                       s.high_sales_threshold, s.notify_low_stock, s.check_interval_minutes, s.last_check_at,
                       s.notify_line_cancellations
                FROM user_notification_settings s
                JOIN users u ON u.user_id = s.user_id
                WHERE u.active = 1
            """)
            rows = await cur.fetchall()
            total_settings = len(rows)
            skipped_interval = 0
            skipped_no_tokens = 0
            skipped_no_tenant = 0
            user_diag = []  # per-user diagnostic
            for r in rows:
                interval_min = int(r[6] or 15)
                last_check = r[7]
                if last_check and (now - last_check).total_seconds() < interval_min * 60:
                    skipped_interval += 1
                    user_diag.append(f"user={r[0]}:interval_wait")
                    continue
                # Get active tokens for this user
                await cur.execute(
                    "SELECT token FROM user_push_tokens WHERE user_id=%s AND active=1",
                    (r[0],),
                )
                tokens = [t[0] for t in await cur.fetchall()]
                if not tokens:
                    # Also count how many inactive tokens exist for extra diagnosis
                    await cur.execute(
                        "SELECT COUNT(*), SUM(active) FROM user_push_tokens WHERE user_id=%s",
                        (r[0],),
                    )
                    cnt_row = await cur.fetchone()
                    total_tok = int(cnt_row[0] or 0)
                    active_tok = int(cnt_row[1] or 0) if cnt_row[1] is not None else 0
                    skipped_no_tokens += 1
                    user_diag.append(f"user={r[0]}:no_active_tokens(total={total_tok},active={active_tok},tenant={r[1]})")
                    continue

                # Gather ALL tenant ids/names for this user
                tenant_list: List[Dict[str, str]] = []
                primary_tid = r[1]
                if primary_tid:
                    name = "Ana Veri"
                    if mongo_db is not None:
                        try:
                            doc = await mongo_db.tenant_names.find_one({
                                "user_id": r[0], "tenant_id": primary_tid,
                            })
                            if doc and doc.get("name"):
                                name = doc["name"]
                        except Exception:
                            pass
                    tenant_list.append({"tenant_id": primary_tid, "name": name})

                if mongo_db is not None:
                    try:
                        extras = await mongo_db.user_tenants.find({"user_id": r[0]}).to_list(20)
                        for et in extras or []:
                            tid = et.get("tenant_id")
                            if not tid:
                                continue
                            # Avoid duplicating primary
                            if any(t["tenant_id"] == tid for t in tenant_list):
                                continue
                            tenant_list.append({
                                "tenant_id": tid,
                                "name": et.get("name") or tid,
                            })
                    except Exception:
                        pass

                if not tenant_list:
                    skipped_no_tenant += 1
                    continue

                # One entry per (user, tenant)
                for t in tenant_list:
                    users.append({
                        "user_id": r[0],
                        "tenant_id": t["tenant_id"],
                        "tenant_name": t["name"],
                        "notify_cancellations": bool(r[2]),
                        "notify_line_cancellations": bool(r[8]) if len(r) > 8 and r[8] is not None else True,
                        "notify_high_sales": bool(r[3]),
                        "high_sales_threshold": float(r[4] or 5000.0),
                        "notify_low_stock": bool(r[5]),
                        "check_interval_minutes": interval_min,
                        "last_check_at": last_check,
                        "tokens": tokens,
                    })

    logger.info(
        f"[_get_users_to_check] settings_rows={total_settings} "
        f"skipped_interval={skipped_interval} skipped_no_tokens={skipped_no_tokens} "
        f"skipped_no_tenant={skipped_no_tenant} -> due_entries={len(users)}"
    )
    if user_diag:
        logger.info(f"[_get_users_to_check] per_user: {' | '.join(user_diag)}")
    return users


async def _update_last_check(user_id: int) -> None:
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE user_notification_settings SET last_check_at=NOW() WHERE user_id=%s",
                (user_id,),
            )
            await conn.commit()


async def _check_tenant_for_user(user: Dict[str, Any]) -> None:
    """Run the event checks for a single (user, tenant) combo.

    Strategy (updated to use the working iptal_detay dataset):
      1) Fiş/Satır İptali → POS /sync.php dataset_get "iptal_detay" for today & yesterday
      2) Eksi Stok → rap_stok_envanter_web (unchanged)
    """
    tenant_id = user["tenant_id"]
    tenant_name = user.get("tenant_name") or "Veri"
    tokens = user["tokens"]
    today = datetime.now()
    yesterday = today - timedelta(days=1)

    logger.info(
        f"[scan] START user={user['user_id']} tenant={tenant_id} ({tenant_name}) "
        f"tokens={len(tokens)} notify_cancel={user['notify_cancellations']} "
        f"notify_line={user.get('notify_line_cancellations')} "
        f"notify_high={user['notify_high_sales']} threshold={user['high_sales_threshold']}"
    )

    # --- 1) Fiş & Satır İptalleri via iptal_detay dataset ---
    if user["notify_cancellations"] or user.get("notify_line_cancellations"):
        try:
            all_rows: list = []
            # Check today + yesterday to catch events near midnight
            for d in (today, yesterday):
                dt_str = d.strftime("%Y-%m-%d")
                day_rows = await _pos_dataset_get(tenant_id, "iptal_detay", {
                    "sdate": f"{dt_str} 00:00:00",
                    "edate": f"{dt_str} 23:59:59",
                    "IPTAL_ID": None,
                })
                logger.info(f"[scan] iptal_detay tenant={tenant_id} date={dt_str} rows={len(day_rows)}")
                all_rows.extend(day_rows)

            # Log a sample row so we know the real field names
            if all_rows:
                sample = all_rows[0]
                logger.info(f"[scan] sample_keys={list(sample.keys())[:30]}")
                logger.info(
                    f"[scan] sample_row IPTAL_ID={sample.get('IPTAL_ID')!r} "
                    f"IPTAL_TIPI={sample.get('IPTAL_TIPI')!r} "
                    f"PERSONEL_AD={sample.get('PERSONEL_AD')!r} "
                    f"LOKASYON={sample.get('LOKASYON')!r} "
                    f"TUTAR={sample.get('TUTAR')!r} "
                    f"FIS_NO={sample.get('FIS_NO')!r} "
                    f"DETAY_SATIR_SAYISI={sample.get('DETAY_SATIR_SAYISI')!r}"
                )
            else:
                logger.info(f"[scan] iptal_detay tenant={tenant_id} no cancellations for today/yesterday")

            cancel_count = 0
            cancel_pushed = 0
            line_count = 0
            line_pushed = 0
            for r in all_rows:
                iptal_id = r.get("IPTAL_ID")
                if iptal_id is None:
                    continue
                iptal_tipi = str(r.get("IPTAL_TIPI") or "").strip()
                personel = str(r.get("PERSONEL_AD") or "").strip()
                lokasyon = str(r.get("LOKASYON") or "").strip()
                fis_no = str(r.get("FIS_NO") or r.get("BELGE_NO") or r.get("BELGENO") or "").strip()
                try:
                    tutar = float(r.get("TUTAR") or 0)
                except (TypeError, ValueError):
                    tutar = 0.0
                detay_satir = r.get("DETAY_SATIR_SAYISI") or 0

                # Distinguish line-level vs receipt-level cancellation
                is_line_cancel = "satır" in iptal_tipi.lower() or "satir" in iptal_tipi.lower()

                key = str(iptal_id)
                if is_line_cancel:
                    if not user.get("notify_line_cancellations"):
                        continue
                    line_count += 1
                    logger.info(
                        f"[scan] ❌ LINE CANCEL FOUND iptal_id={iptal_id} tipi={iptal_tipi!r} "
                        f"lokasyon={lokasyon!r} personel={personel!r} tutar={tutar:.2f}"
                    )
                    if await _mark_event_seen(tenant_id, "satir_iptal", key):
                        title = f"❌ Satır İptali · {tenant_name}"
                        body = f"{personel or 'Personel'} · {lokasyon or ''} · {detay_satir} satır · ₺{tutar:,.2f}"
                        await _push_many(tokens, title, body.strip(), {
                            "type": "line_cancellation", "iptal_id": iptal_id,
                            "tenant": tenant_id, "tenant_name": tenant_name,
                        })
                        line_pushed += 1
                        logger.info(f"[scan] ✅ LINE CANCEL PUSHED iptal_id={iptal_id}")
                    else:
                        logger.info(f"[scan] LINE CANCEL already_seen iptal_id={iptal_id}")
                else:
                    if not user["notify_cancellations"]:
                        continue
                    cancel_count += 1
                    logger.info(
                        f"[scan] 🚫 CANCEL FOUND iptal_id={iptal_id} tipi={iptal_tipi!r} "
                        f"lokasyon={lokasyon!r} personel={personel!r} tutar={tutar:.2f}"
                    )
                    if await _mark_event_seen(tenant_id, "iptal", key):
                        title = f"🚫 Fiş İptali · {tenant_name}"
                        parts = []
                        if personel:
                            parts.append(personel)
                        if lokasyon:
                            parts.append(lokasyon)
                        if fis_no:
                            parts.append(f"#{fis_no}")
                        prefix = " · ".join(parts) if parts else (iptal_tipi or "İptal")
                        body = f"{prefix} · ₺{tutar:,.2f}"
                        await _push_many(tokens, title, body, {
                            "type": "cancellation", "iptal_id": iptal_id,
                            "tenant": tenant_id, "tenant_name": tenant_name,
                        })
                        cancel_pushed += 1
                        logger.info(f"[scan] ✅ CANCEL PUSHED iptal_id={iptal_id}")
                    else:
                        logger.info(f"[scan] CANCEL already_seen iptal_id={iptal_id}")

            logger.info(
                f"[scan] SUMMARY tenant={tenant_id} cancels={cancel_count} pushed={cancel_pushed} "
                f"line_cancels={line_count} pushed={line_pushed}"
            )
        except Exception as e:
            logger.warning(f"[scan] iptal_detay watcher failed (user {user['user_id']}, tenant {tenant_id}): {e}")

    # --- 2) Eksi Stok ---
    if user["notify_low_stock"]:
        try:
            stok_empty = {
                "Stoklar": "", "StokGrup": "", "StokCinsi": "", "StokMarka": "", "StokVergi": "",
                "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "",
                "StokOzelKod5": "", "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
            }
            stok_params = {
                "TARIH": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "Lokasyon": "", "Proje": "", "Dovizler": "",
                "StokAlisFiyat": 1, "StokSatisFiyat": 1, "StokMaliyet": "", "StokStokKart": 1,
                "Page": 1, "PageSize": 500,
                **stok_empty,
            }
            rows = await _pos_run(tenant_id, "rap_stok_envanter_web", stok_params)
            totals: Dict[str, Dict[str, Any]] = {}
            for r in rows:
                kod = str(r.get("STOK_KOD") or r.get("KOD") or "").strip()
                if not kod:
                    continue
                miktar = float(r.get("MIKTAR") or 0)
                if kod not in totals:
                    totals[kod] = {"ad": r.get("STOK_AD") or r.get("AD") or kod, "miktar": 0.0}
                totals[kod]["miktar"] += miktar
            for kod, info in totals.items():
                if info["miktar"] < 0:
                    key = f"{kod}:{datetime.now().strftime('%Y-%m-%d')}"
                    if await _mark_event_seen(tenant_id, "eksi_stok", key):
                        await _push_many(
                            tokens,
                            f"📦 Eksi Stok · {tenant_name}",
                            f"{info['ad']} (Kod: {kod}) — Toplam: {info['miktar']:,.2f}",
                            {"type": "low_stock", "stok_kod": kod, "tenant": tenant_id, "tenant_name": tenant_name},
                        )
        except Exception as e:
            logger.warning(f"stok watcher failed (user {user['user_id']}, tenant {tenant_id}): {e}")

    await _update_last_check(user["user_id"])


async def _watcher_loop():
    """Main watcher loop — runs forever until cancelled."""
    logger.info("🔔 Notification watcher started")
    iteration = 0
    while True:
        iteration += 1
        try:
            users = await _get_users_to_check()
            if users:
                logger.info(f"[watcher] iter={iteration} Checking notifications for {len(users)} user(s)")
                # Group by tenant to avoid redundant POS calls (simple approach: process sequentially)
                for user in users:
                    try:
                        await _check_tenant_for_user(user)
                    except Exception as inner_e:
                        logger.warning(f"[watcher] check failed for user {user.get('user_id')}: {inner_e}")
            else:
                # _get_users_to_check already logs the breakdown every iteration;
                # nothing extra to add here.
                pass
        except Exception as e:
            logger.error(f"[watcher] loop error: {e}")
        await asyncio.sleep(60)  # run every 1 minute; per-user interval is enforced via last_check_at


def start_watcher():
    """Called once at FastAPI startup."""
    global _watcher_task
    if _watcher_task is None or _watcher_task.done():
        loop = asyncio.get_event_loop()
        _watcher_task = loop.create_task(_watcher_loop())


def stop_watcher():
    """Called at FastAPI shutdown."""
    global _watcher_task
    if _watcher_task and not _watcher_task.done():
        _watcher_task.cancel()
