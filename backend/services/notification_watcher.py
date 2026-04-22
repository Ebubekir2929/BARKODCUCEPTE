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


async def _push_many(tokens: List[str], title: str, body: str, data: dict | None = None) -> None:
    if not tokens:
        return
    msgs = [{
        "to": t, "sound": "default", "title": title, "body": body,
        "data": data or {}, "priority": "high", "channelId": "cancellations",
    } for t in tokens]
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            await client.post(EXPO_PUSH_URL, json=msgs, headers={
                "Accept": "application/json", "Content-Type": "application/json",
            })
    except Exception as e:
        logger.warning(f"Push send failed: {e}")


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
            for r in rows:
                interval_min = int(r[6] or 15)
                last_check = r[7]
                if last_check and (now - last_check).total_seconds() < interval_min * 60:
                    skipped_interval += 1
                    continue
                # Get active tokens for this user
                await cur.execute(
                    "SELECT token FROM user_push_tokens WHERE user_id=%s AND active=1",
                    (r[0],),
                )
                tokens = [t[0] for t in await cur.fetchall()]
                if not tokens:
                    skipped_no_tokens += 1
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
    """Run the three event checks for a single (user, tenant) combo."""
    tenant_id = user["tenant_id"]
    tenant_name = user.get("tenant_name") or "Veri"
    tokens = user["tokens"]
    today = datetime.now().strftime("%Y-%m-%d")
    # Look back 2 days to catch recent events
    two_days_ago = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")

    logger.info(
        f"[scan] START user={user['user_id']} tenant={tenant_id} ({tenant_name}) "
        f"tokens={len(tokens)} notify_cancel={user['notify_cancellations']} "
        f"notify_line={user.get('notify_line_cancellations')} "
        f"notify_high={user['notify_high_sales']} threshold={user['high_sales_threshold']}"
    )

    stok_empty = {
        "Stoklar": "", "StokGrup": "", "StokCinsi": "", "StokMarka": "", "StokVergi": "",
        "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "",
        "StokOzelKod5": "", "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
    }

    # --- 1) Fiş İptalleri + Yüksek Satışlar (single query to fis_kalem) ---
    if user["notify_cancellations"] or user["notify_high_sales"] or user.get("notify_line_cancellations"):
        try:
            fis_params = {
                "BASTARIH": two_days_ago, "BITTARIH": today,
                "FisTuru": "", "FisAltTuru": "", "Lokasyon": "", "Proje": "", "BelgeNo": "",
                "Personel": "", "Cariler": "", "CariTur": "", "CariGrup": "", "Adresler": "", "Temsilci": "",
                "CariOzelKod1": "", "CariOzelKod2": "", "CariOzelKod3": "", "CariOzelKod4": "", "CariOzelKod5": "",
                "FisOzelKod1": "", "FisOzelKod2": "", "FisOzelKod3": "", "FisOzelKod4": "", "FisOzelKod5": "",
                "Detayli": 0, "Page": 1, "PageSize": 500,
                **stok_empty,
            }
            rows = await _pos_run(tenant_id, "rap_fis_kalem_listesi_web", fis_params)
            logger.info(f"[scan] tenant={tenant_id} fetched rows={len(rows)} (range {two_days_ago} -> {today})")
            if rows:
                sample_row = rows[0]
                logger.info(
                    f"[scan] sample_keys={list(sample_row.keys())[:30]}"
                )
                logger.info(
                    f"[scan] sample_row FIS_TURU={sample_row.get('FIS_TURU')!r} "
                    f"FIS_DURUMU={sample_row.get('FIS_DURUMU')!r} IPTAL={sample_row.get('IPTAL')!r} "
                    f"SATIR_DURUMU={sample_row.get('SATIR_DURUMU')!r} SATIR_IPTAL={sample_row.get('SATIR_IPTAL')!r} "
                    f"DURUM={sample_row.get('DURUM')!r} BELGENO={sample_row.get('BELGENO')!r}"
                )
            else:
                logger.warning(f"[scan] tenant={tenant_id} NO ROWS returned from POS! Check sync.")

            # --- 1a) SATIR İPTALLERİ — iterate each row and check row-level cancel flag ---
            line_cancel_count = 0
            line_pushed = 0
            if user.get("notify_line_cancellations"):
                for r in rows:
                    row_iptal = (
                        str(r.get("SATIR_DURUMU") or "").lower().find("iptal") >= 0
                        or r.get("SATIR_IPTAL") in (1, "1", True, "E")
                        or r.get("IPTAL") in (1, "1", True, "E")
                        or str(r.get("DURUM") or "").lower() == "iptal"
                    )
                    if not row_iptal:
                        continue
                    line_cancel_count += 1
                    bn = str(r.get("BELGENO") or "").strip()
                    stok_kod = str(r.get("STOK_KOD") or r.get("KOD") or "").strip()
                    stok_ad = str(r.get("STOK_AD") or r.get("AD") or "Stok kalemi")
                    miktar = float(r.get("MIKTAR_FIS") or 0)
                    satir_toplam = float(r.get("SATIR_GENEL_TOPLAM") or r.get("DAHIL_NET_TUTAR") or 0)
                    key = f"{bn}::{stok_kod}::{miktar}"
                    if await _mark_event_seen(tenant_id, "satir_iptal", key):
                        logger.info(f"[scan] ❌ LINE CANCEL NEW: belgeno={bn} stok={stok_kod} miktar={miktar}")
                        await _push_many(
                            tokens,
                            f"❌ Satır İptali · {tenant_name}",
                            f"{bn} · {stok_ad} ({miktar:g}) iptal edildi · ₺{satir_toplam:,.2f}",
                            {"type": "line_cancellation", "belgeno": bn, "stok_kod": stok_kod,
                             "tenant": tenant_id, "tenant_name": tenant_name},
                        )
                        line_pushed += 1
                    else:
                        logger.info(f"[scan] LINE CANCEL already_seen: belgeno={bn} stok={stok_kod}")
            logger.info(f"[scan] line_cancellations found={line_cancel_count} pushed={line_pushed}")

            # --- 1b) Fiş seviyesi iptalleri + Yüksek Satış: aggregate by BELGENO ---
            seen_belge = {}
            for r in rows:
                bn = str(r.get("BELGENO") or "").strip()
                if not bn:
                    continue
                if bn not in seen_belge:
                    seen_belge[bn] = r
                    seen_belge[bn]["__total"] = float(r.get("SATIR_GENEL_TOPLAM") or 0)
                else:
                    seen_belge[bn]["__total"] = seen_belge[bn].get("__total", 0) + float(r.get("SATIR_GENEL_TOPLAM") or 0)

            cancel_count = 0
            cancel_pushed = 0
            high_count = 0
            high_pushed = 0

            for bn, r in seen_belge.items():
                total = float(r.get("__total") or 0)
                fis_turu = str(r.get("FIS_TURU") or "").lower()
                fis_durumu = str(r.get("FIS_DURUMU") or "").lower()

                is_cancelled = ("iptal" in fis_durumu) or (r.get("IPTAL") in (1, "1", True, "E"))
                if is_cancelled:
                    cancel_count += 1
                    logger.info(
                        f"[scan] 🚫 CANCEL FOUND belgeno={bn} fis_turu={r.get('FIS_TURU')!r} "
                        f"fis_durumu={r.get('FIS_DURUMU')!r} iptal_flag={r.get('IPTAL')!r} total={total:.2f}"
                    )
                    if user["notify_cancellations"]:
                        if await _mark_event_seen(tenant_id, "iptal", bn):
                            await _push_many(
                                tokens,
                                f"🚫 Fiş İptali · {tenant_name}",
                                f"{(r.get('FIS_TURU') or 'Fiş')} {bn} iptal edildi · ₺{total:,.2f}",
                                {"type": "cancellation", "belgeno": bn, "tenant": tenant_id, "tenant_name": tenant_name},
                            )
                            cancel_pushed += 1
                            logger.info(f"[scan] ✅ CANCEL PUSHED belgeno={bn}")
                        else:
                            logger.info(f"[scan] CANCEL already_seen belgeno={bn}")
                    else:
                        logger.info(f"[scan] CANCEL disabled_by_user belgeno={bn}")

                is_sale_doc = any(x in fis_turu for x in ("perakende", "satış fatura", "satis fatura"))
                if (
                    user["notify_high_sales"]
                    and is_sale_doc
                    and not is_cancelled
                    and total >= user["high_sales_threshold"]
                ):
                    high_count += 1
                    if await _mark_event_seen(tenant_id, "yuksek_satis", bn):
                        await _push_many(
                            tokens,
                            f"💰 Yüksek Satış · {tenant_name}",
                            f"{(r.get('FIS_TURU') or 'Satış')} {bn}: ₺{total:,.2f}",
                            {"type": "high_sale", "belgeno": bn, "amount": total, "tenant": tenant_id, "tenant_name": tenant_name},
                        )
                        high_pushed += 1
                        logger.info(f"[scan] ✅ HIGH_SALE PUSHED belgeno={bn} total={total:.2f}")
                    else:
                        logger.info(f"[scan] HIGH_SALE already_seen belgeno={bn}")

            logger.info(
                f"[scan] SUMMARY tenant={tenant_id} belge_cancels={cancel_count} pushed={cancel_pushed} "
                f"high_sales={high_count} pushed={high_pushed}"
            )
        except Exception as e:
            logger.warning(f"[scan] fis_kalem watcher failed (user {user['user_id']}, tenant {tenant_id}): {e}")

    # --- 2) Eksi Stok ---
    if user["notify_low_stock"]:
        try:
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
