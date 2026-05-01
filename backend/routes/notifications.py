"""
Push Notification routes.

- Tokens are stored in MySQL table `user_push_tokens` in the patron DB.
- Notifications are delivered via Expo Push API (https://exp.host/--/api/v2/push/send).
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from services import get_patron_pool
from routes.auth import get_current_user
import httpx
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["notifications"])

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def ensure_tokens_table():
    """Create user_push_tokens and user_notification_settings tables if they don't exist."""
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS user_push_tokens (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    token VARCHAR(190) NOT NULL,
                    platform VARCHAR(20) DEFAULT '',
                    device_id VARCHAR(100) DEFAULT '',
                    active TINYINT(1) DEFAULT 1,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    UNIQUE KEY uniq_user_token (user_id, token),
                    INDEX idx_user (user_id),
                    INDEX idx_active (active)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # Per-user notification preferences
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS user_notification_settings (
                    user_id INT PRIMARY KEY,
                    notify_cancellations TINYINT(1) DEFAULT 1,
                    notify_line_cancellations TINYINT(1) DEFAULT 1,
                    notify_high_sales TINYINT(1) DEFAULT 1,
                    high_sales_threshold DECIMAL(18,2) DEFAULT 5000.00,
                    notify_low_stock TINYINT(1) DEFAULT 1,
                    check_interval_minutes INT DEFAULT 15,
                    last_check_at DATETIME NULL,
                    updated_at DATETIME NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # Add column if upgrading from old schema
            try:
                await cur.execute("ALTER TABLE user_notification_settings ADD COLUMN notify_line_cancellations TINYINT(1) DEFAULT 1 AFTER notify_cancellations")
            except Exception:
                pass  # column already exists
            # De-duplication table: remember which (type, key) events we already pushed
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS notification_events_seen (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tenant_id VARCHAR(64) NOT NULL,
                    event_type VARCHAR(32) NOT NULL,
                    event_key VARCHAR(190) NOT NULL,
                    seen_at DATETIME NULL,
                    UNIQUE KEY uniq_event (tenant_id, event_type, event_key),
                    INDEX idx_tenant_type (tenant_id, event_type)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # One-time cleanup: remove obvious fake/test push tokens that were
            # seeded during development. They look like:
            #   ExponentPushToken[test-abc-123]
            #   ExponentPushToken[test-fake-token-123]
            # These will never deliver push and would block real tokens.
            try:
                await cur.execute("""
                    DELETE FROM user_push_tokens
                    WHERE token LIKE '%test-%' OR token LIKE '%fake%'
                       OR token LIKE '%dummy%' OR token LIKE '%abc-123%'
                       OR token LIKE '%placeholder%'
                """)
                if cur.rowcount:
                    logger.info(f"[cleanup] Deleted {cur.rowcount} fake/test push tokens on startup.")
            except Exception as e:
                logger.warning(f"[cleanup] fake-token purge failed: {e}")
            # Reset any `last_check_at` values that are in the future — these are
            # leftovers from the pre-UTC migration where NOW() stored local time.
            try:
                await cur.execute("""
                    UPDATE user_notification_settings
                    SET last_check_at = NULL
                    WHERE last_check_at > UTC_TIMESTAMP()
                """)
                if cur.rowcount:
                    logger.info(f"[cleanup] Reset {cur.rowcount} future-dated last_check_at rows (timezone migration).")
            except Exception as e:
                logger.warning(f"[cleanup] last_check_at reset failed: {e}")
            await conn.commit()
    logger.info("user_push_tokens + notification_settings tables ready")


class RegisterTokenBody(BaseModel):
    token: str
    platform: Optional[str] = ""
    device_id: Optional[str] = ""


class TestNotificationBody(BaseModel):
    title: Optional[str] = "Barkodcu Cepte"
    body: Optional[str] = "Test bildirimi gönderildi"
    data: Optional[dict] = None


@router.post("/register-token")
async def register_token(body: RegisterTokenBody, current_user: dict = Depends(get_current_user)):
    """Save / re-activate a push token for the current user.

    Before inserting, we wipe every other token for this user so stale/fake
    tokens from prior installs or test data cannot remain and pollute delivery.
    """
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token gerekli")

    # Basic sanity check — reject obviously-fake tokens so we never store them.
    # Real Expo tokens look like: ExponentPushToken[xxxxxxxxxxxxx]
    # We only reject clear placeholder patterns to avoid false positives.
    lower = token.lower()
    fake_markers = ("fake", "dummy", "placeholder", "abc-123", "test-fake", "test-abc")
    if any(m in lower for m in fake_markers):
        logger.warning(f"[register-token] Rejecting obviously-fake token: {token!r}")
        raise HTTPException(status_code=400, detail="Geçersiz görünen bir push token — kayıt reddedildi.")

    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Purge any other (stale / fake) tokens for this user so the device
            # only has ONE valid token going forward.
            await cur.execute(
                "DELETE FROM user_push_tokens WHERE user_id=%s AND token<>%s",
                (user_id, token),
            )
            deleted = cur.rowcount or 0
            await cur.execute("""
                INSERT INTO user_push_tokens (user_id, token, platform, device_id, active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE active=1, platform=VALUES(platform),
                    device_id=VALUES(device_id), updated_at=UTC_TIMESTAMP()
            """, (user_id, token, body.platform or "", body.device_id or ""))
            await conn.commit()
    logger.info(f"Push token registered for user {user_id}: {token[:30]}... (purged {deleted} stale tokens)")

    # Reset last_check_at so the watcher scans this user on its next tick
    # instead of waiting for the full interval window.
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE user_notification_settings SET last_check_at=NULL WHERE user_id=%s",
                    (user_id,),
                )
                await conn.commit()
    except Exception as e:
        logger.warning(f"[register-token] failed to reset last_check_at: {e}")

    return {"ok": True, "purged_stale_tokens": deleted}


@router.post("/unregister-token")
async def unregister_token(body: RegisterTokenBody, current_user: dict = Depends(get_current_user)):
    """NO-OP: Keeps token active regardless of client request.

    Historically this used to deactivate the push token when the user toggled
    the "Push Bildirimleri" switch off. That turned out to be fragile: users
    toggled accidentally and were left without notifications. We now keep the
    token active as long as it's registered — the in-app toggle still governs
    whether local notifications are shown, but the backend watcher can still
    reach the device.
    """
    user_id = current_user["user_id"]
    logger.info(f"unregister-token called by user {user_id} - keeping token active (no-op)")
    return {"ok": True, "noop": True}


async def _send_to_expo(tokens: List[str], title: str, body: str, data: dict = None) -> dict:
    """Send a push notification via Expo Push API to a list of expo tokens."""
    if not tokens:
        return {"ok": False, "sent": 0, "reason": "no_tokens"}

    # Build one message per token
    messages = [
        {
            "to": t,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data or {},
            "priority": "high",
            "channelId": "default",
        }
        for t in tokens
    ]

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Accept-encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
            )
            status_code = resp.status_code
            try:
                result = resp.json()
            except Exception:
                result = {"raw": resp.text[:500]}
            logger.info(f"[send-test] Expo HTTP {status_code} response: {result}")

            # Analyse tickets to find delivery errors per token
            ticket_summary = []
            tickets = []
            if isinstance(result, dict):
                tickets = result.get("data") or []
            if isinstance(tickets, list):
                for idx, ticket in enumerate(tickets):
                    tk = tokens[idx] if idx < len(tokens) else "?"
                    if isinstance(ticket, dict):
                        status = ticket.get("status")
                        err_code = (ticket.get("details") or {}).get("error")
                        msg = ticket.get("message") or ""
                        ticket_summary.append({
                            "token_preview": tk[:30] + "..." if len(tk) > 30 else tk,
                            "status": status,
                            "error_code": err_code,
                            "message": msg,
                            "id": ticket.get("id"),
                        })
                        if status == "error":
                            logger.warning(
                                f"[send-test] ❌ Expo ERROR for token {tk[:25]}... "
                                f"code={err_code} msg={msg}"
                            )
                        elif status == "ok":
                            logger.info(
                                f"[send-test] ✅ Expo OK for token {tk[:25]}... "
                                f"ticket_id={ticket.get('id')}"
                            )

            return {
                "ok": status_code < 400,
                "sent": len(tokens),
                "http_status": status_code,
                "expo_response": result,
                "tickets": ticket_summary,
            }
    except Exception as e:
        logger.error(f"[send-test] Expo push error: {e}")
        return {"ok": False, "sent": 0, "error": str(e)}


@router.post("/send-test")
async def send_test(body: TestNotificationBody, current_user: dict = Depends(get_current_user)):
    """Send a test notification to all active devices of the current user."""
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT token FROM user_push_tokens WHERE user_id=%s AND active=1",
                (user_id,),
            )
            tokens = [row[0] for row in await cur.fetchall()]

    if not tokens:
        raise HTTPException(status_code=404, detail="Cihazınız için kayıtlı push token yok. Lütfen bildirimleri açın.")

    result = await _send_to_expo(tokens, body.title, body.body, body.data)
    return result


@router.get("/my-tokens")
async def list_my_tokens(current_user: dict = Depends(get_current_user)):
    """List push tokens for the current user (for debugging / UI)."""
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT token, platform, device_id, active, created_at, updated_at
                FROM user_push_tokens WHERE user_id=%s
                ORDER BY updated_at DESC
            """, (user_id,))
            rows = await cur.fetchall()

    return {
        "ok": True,
        "tokens": [
            {
                "token": r[0], "platform": r[1], "device_id": r[2],
                "active": bool(r[3]),
                "created_at": r[4].isoformat() if r[4] else None,
                "updated_at": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ],
    }


# ===================== NOTIFICATION SETTINGS =====================

class NotificationSettings(BaseModel):
    notify_cancellations: Optional[bool] = True
    notify_line_cancellations: Optional[bool] = True
    notify_high_sales: Optional[bool] = True
    high_sales_threshold: Optional[float] = 5000.0
    notify_low_stock: Optional[bool] = True
    check_interval_minutes: Optional[int] = 15


@router.post("/reset-dedup")
async def reset_dedup(current_user: dict = Depends(get_current_user)):
    """Wipes the notification_events_seen table for this user's tenants.

    Next watcher scan will treat every cancellation (and high sale / low stock)
    as brand-new and re-send push notifications for them — useful for
    debugging whether push delivery itself is working.
    """
    user_id = current_user["user_id"]
    # Collect user's tenants from MySQL + Mongo
    tenants: List[str] = []
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT tenant_id FROM users WHERE user_id=%s", (user_id,))
            r = await cur.fetchone()
            if r and r[0]:
                tenants.append(r[0])

    # Also include extra tenants stored in Mongo
    try:
        from server import db as mongo_db  # type: ignore
        if mongo_db is not None:
            extras = await mongo_db.user_tenants.find({"user_id": user_id}).to_list(50)
            for et in extras or []:
                tid = et.get("tenant_id")
                if tid and tid not in tenants:
                    tenants.append(tid)
    except Exception:
        pass

    if not tenants:
        raise HTTPException(status_code=404, detail="Kullanıcı için tenant bulunamadı.")

    deleted_total = 0
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for tid in tenants:
                await cur.execute(
                    "DELETE FROM notification_events_seen WHERE tenant_id=%s",
                    (tid,),
                )
                deleted_total += cur.rowcount or 0
            # Also reset last_check_at so the next scan happens immediately
            await cur.execute(
                "UPDATE user_notification_settings SET last_check_at=NULL WHERE user_id=%s",
                (user_id,),
            )
            await conn.commit()

    logger.info(f"[reset-dedup] user={user_id} tenants={tenants} deleted={deleted_total}")
    return {
        "ok": True,
        "tenants_cleared": tenants,
        "events_deleted": deleted_total,
        "message": "Dedup temizlendi. Sıradaki taramada tüm iptaller yeniden push olarak gönderilecek.",
    }


@router.get("/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    """Return the current user's notification preferences (creates defaults if missing)."""
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT notify_cancellations, notify_line_cancellations, notify_high_sales,
                       high_sales_threshold, notify_low_stock, check_interval_minutes, last_check_at
                FROM user_notification_settings WHERE user_id=%s
            """, (user_id,))
            row = await cur.fetchone()
            if not row:
                await cur.execute("""
                    INSERT INTO user_notification_settings
                        (user_id, notify_cancellations, notify_line_cancellations, notify_high_sales,
                         high_sales_threshold, notify_low_stock, check_interval_minutes, updated_at)
                    VALUES (%s, 1, 1, 1, 5000.00, 1, 15, UTC_TIMESTAMP())
                """, (user_id,))
                await conn.commit()
                return {
                    "ok": True,
                    "settings": {
                        "notify_cancellations": True,
                        "notify_line_cancellations": True,
                        "notify_high_sales": True,
                        "high_sales_threshold": 5000.0,
                        "notify_low_stock": True,
                        "check_interval_minutes": 15,
                        "last_check_at": None,
                    }
                }
    return {
        "ok": True,
        "settings": {
            "notify_cancellations": bool(row[0]),
            "notify_line_cancellations": bool(row[1]),
            "notify_high_sales": bool(row[2]),
            "high_sales_threshold": float(row[3]) if row[3] is not None else 5000.0,
            "notify_low_stock": bool(row[4]),
            "check_interval_minutes": int(row[5]) if row[5] is not None else 15,
            "last_check_at": row[6].isoformat() if row[6] else None,
        }
    }


# ===================== DEBUG / MANUAL SCAN =====================

class ScanNowBody(BaseModel):
    tenant_id: Optional[str] = None  # if null, scan all user tenants
    days_back: Optional[int] = 2
    reset_dedup: Optional[bool] = False  # clear notification_events_seen for tenant(s) first
    send_push: Optional[bool] = True  # actually deliver push for newly-seen events
    page_size: Optional[int] = 500


@router.post("/scan-now")
async def scan_now(body: ScanNowBody, current_user: dict = Depends(get_current_user)):
    """
    Debug endpoint: Immediately scan POS for the given tenant(s) and return
    a detailed breakdown of what was found, what would trigger a notification,
    and why anything might be skipped.

    Flow:
      1) Optionally reset dedup table for user's tenants.
      2) Fetch rap_fis_kalem_listesi_web for the last `days_back` days.
      3) Return:
         - total_rows
         - cancelled_belges (list with full diagnostic info)
         - line_cancellations (list)
         - high_sales (list)
         - push_sent_count
      4) If send_push=True, de-dup and actually deliver Expo push notifications.
    """
    from datetime import datetime, timedelta
    from services.notification_watcher import _mark_event_seen, _push_many

    user_id = current_user["user_id"]
    pool = await get_patron_pool()

    # --- Load settings + tokens ---
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT notify_cancellations, notify_line_cancellations, notify_high_sales,
                       high_sales_threshold, notify_low_stock
                FROM user_notification_settings WHERE user_id=%s
            """, (user_id,))
            srow = await cur.fetchone()
            if not srow:
                # defaults
                notify_cancellations = True
                notify_line_cancellations = True
                notify_high_sales = True
                high_sales_threshold = 5000.0
            else:
                notify_cancellations = bool(srow[0])
                notify_line_cancellations = bool(srow[1])
                notify_high_sales = bool(srow[2])
                high_sales_threshold = float(srow[3] or 5000.0)

            await cur.execute(
                "SELECT token FROM user_push_tokens WHERE user_id=%s AND active=1",
                (user_id,),
            )
            tokens = [row[0] for row in await cur.fetchall()]

    # --- Resolve tenants ---
    try:
        from server import db as mongo_db  # type: ignore
    except Exception:
        mongo_db = None

    tenant_list: List[dict] = []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT tenant_id FROM users WHERE user_id=%s", (user_id,))
            ur = await cur.fetchone()
            primary_tid = ur[0] if ur else None

    if body.tenant_id:
        tenant_list.append({"tenant_id": body.tenant_id, "name": body.tenant_id})
    else:
        if primary_tid:
            name = "Ana Veri"
            if mongo_db is not None:
                try:
                    doc = await mongo_db.tenant_names.find_one({
                        "user_id": user_id, "tenant_id": primary_tid,
                    })
                    if doc and doc.get("name"):
                        name = doc["name"]
                except Exception:
                    pass
            tenant_list.append({"tenant_id": primary_tid, "name": name})
        if mongo_db is not None:
            try:
                extras = await mongo_db.user_tenants.find({"user_id": user_id}).to_list(20)
                for et in extras or []:
                    tid = et.get("tenant_id")
                    if not tid:
                        continue
                    if any(t["tenant_id"] == tid for t in tenant_list):
                        continue
                    tenant_list.append({
                        "tenant_id": tid,
                        "name": et.get("name") or tid,
                    })
            except Exception:
                pass

    if not tenant_list:
        raise HTTPException(status_code=404, detail="Bu kullanıcı için tenant bulunamadı.")

    # --- Optionally reset dedup ---
    if body.reset_dedup:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                for t in tenant_list:
                    await cur.execute(
                        "DELETE FROM notification_events_seen WHERE tenant_id=%s",
                        (t["tenant_id"],),
                    )
                await conn.commit()

    today_dt = datetime.utcnow()
    today = today_dt.strftime("%Y-%m-%d")
    days_back = max(1, int(body.days_back or 2))
    since_dt = today_dt - timedelta(days=days_back - 1)
    since = since_dt.strftime("%Y-%m-%d")

    # Import the helper used by the watcher so we use the *working* dataset_get path
    from services.notification_watcher import _pos_dataset_get

    total_push_sent = 0
    tenants_report = []

    for t in tenant_list:
        tenant_id = t["tenant_id"]
        tenant_name = t["name"] or "Veri"

        # Fetch iptal_detay for each day within the window
        all_rows: list = []
        pos_error: Optional[str] = None
        try:
            day = since_dt
            while day.date() <= today_dt.date():
                dt_str = day.strftime("%Y-%m-%d")
                day_rows = await _pos_dataset_get(tenant_id, "iptal_detay", {
                    "sdate": f"{dt_str} 00:00:00",
                    "edate": f"{dt_str} 23:59:59",
                    "IPTAL_ID": None,
                })
                all_rows.extend(day_rows)
                day = day + timedelta(days=1)
        except Exception as e:
            pos_error = f"{type(e).__name__}: {e}"

        sample_keys: list = []
        sample_row: dict = {}
        if all_rows:
            sample_row = {k: all_rows[0].get(k) for k in list(all_rows[0].keys())[:40]}
            sample_keys = list(all_rows[0].keys())

        cancelled_belges = []
        line_cancellations = []

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

            is_line_cancel = "satır" in iptal_tipi.lower() or "satir" in iptal_tipi.lower()
            key = str(iptal_id)

            sent = False
            dedup_result = "skipped_disabled"

            if is_line_cancel:
                if notify_line_cancellations and body.send_push:
                    is_new = await _mark_event_seen(tenant_id, "satir_iptal", key)
                    if is_new:
                        title = f"❌ Satır İptali · {tenant_name}"
                        body_msg = f"{personel or 'Personel'} · {lokasyon or ''} · {detay_satir} satır · ₺{tutar:,.2f}"
                        await _push_many(tokens, title, body_msg.strip(), {
                            "type": "line_cancellation", "iptal_id": iptal_id,
                            "tenant": tenant_id, "tenant_name": tenant_name,
                        })
                        sent = True
                        total_push_sent += 1
                        dedup_result = "sent"
                    else:
                        dedup_result = "already_seen"
                elif not notify_line_cancellations:
                    dedup_result = "disabled_by_user"

                line_cancellations.append({
                    "belgeno": fis_no or str(iptal_id),
                    "stok_kod": "",
                    "stok_ad": f"{iptal_tipi} — {detay_satir} satır",
                    "miktar": detay_satir,
                    "satir_toplam": tutar,
                    "iptal_id": iptal_id,
                    "personel": personel,
                    "lokasyon": lokasyon,
                    "result": dedup_result,
                    "push_sent": sent,
                })
            else:
                if notify_cancellations and body.send_push:
                    is_new = await _mark_event_seen(tenant_id, "iptal", key)
                    if is_new:
                        title = f"🚫 Fiş İptali · {tenant_name}"
                        parts = []
                        if personel:
                            parts.append(personel)
                        if lokasyon:
                            parts.append(lokasyon)
                        if fis_no:
                            parts.append(f"#{fis_no}")
                        prefix = " · ".join(parts) if parts else (iptal_tipi or "İptal")
                        body_msg = f"{prefix} · ₺{tutar:,.2f}"
                        await _push_many(tokens, title, body_msg, {
                            "type": "cancellation", "iptal_id": iptal_id,
                            "tenant": tenant_id, "tenant_name": tenant_name,
                        })
                        sent = True
                        total_push_sent += 1
                        dedup_result = "sent"
                    else:
                        dedup_result = "already_seen"
                elif not notify_cancellations:
                    dedup_result = "disabled_by_user"

                cancelled_belges.append({
                    "belgeno": fis_no or str(iptal_id),
                    "fis_turu": iptal_tipi or "Fiş İptal",
                    "fis_durumu": iptal_tipi,
                    "total": tutar,
                    "iptal_flag": None,
                    "iptal_id": iptal_id,
                    "personel": personel,
                    "lokasyon": lokasyon,
                    "result": dedup_result,
                    "push_sent": sent,
                })

        tenants_report.append({
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "date_range": {"from": since, "to": today},
            "total_rows": len(all_rows),
            "unique_belge_count": len({str(r.get("IPTAL_ID")) for r in all_rows if r.get("IPTAL_ID") is not None}),
            "pos_error": pos_error,
            "sample_keys": sample_keys,
            "sample_row": sample_row,
            "cancelled_belges": cancelled_belges,
            "line_cancellations": line_cancellations,
            "high_sales": [],  # iptal_detay has no sales info; see watcher for dedicated path
        })

    return {
        "ok": True,
        "user_id": user_id,
        "active_tokens": len(tokens),
        "settings": {
            "notify_cancellations": notify_cancellations,
            "notify_line_cancellations": notify_line_cancellations,
            "notify_high_sales": notify_high_sales,
            "high_sales_threshold": high_sales_threshold,
        },
        "reset_dedup": bool(body.reset_dedup),
        "send_push": bool(body.send_push),
        "push_sent_total": total_push_sent,
        "tenants": tenants_report,
    }


@router.post("/scan-now-eksi-stok")
async def scan_now_eksi_stok(current_user: dict = Depends(get_current_user)):
    """Manually trigger an eksi-stok (negative stock) summary scan for debugging.

    This bypasses the fixed 13:00/20:00 TR schedule and the per-slot dedup so you
    can immediately see whether a push would be delivered with the current data.
    """
    from datetime import datetime, timedelta
    from services.notification_watcher import (
        _collect_low_stock_subscribers,
        _push_many,
    )
    from services.dataset_cache import get_dataset_items

    user_id = current_user["user_id"]
    subs_all = await _collect_low_stock_subscribers()
    subs = [s for s in subs_all if s["user_id"] == user_id]
    if not subs:
        return {
            "ok": False,
            "reason": "no_subscribers_for_user",
            "hint": "Enable 'Eksi Stok' (notify_low_stock) in settings and ensure push tokens exist.",
            "user_id": user_id,
        }

    tenant_results = []
    for s in subs:
        tid = s["tenant_id"]
        tname = s["tenant_name"]
        items = await get_dataset_items(tid, "stock_list")
        negatives = []
        for it in items:
            try:
                m = float(it.get("MIKTAR") or 0)
            except (TypeError, ValueError):
                m = 0.0
            if m < 0:
                negatives.append({
                    "ad": it.get("AD") or it.get("STOK_AD") or "",
                    "kod": it.get("KOD") or it.get("STOK_KOD") or "",
                    "miktar": m,
                })

        cnt = len(negatives)
        pushed = False
        if cnt > 0 and s["tokens"]:
            total_abs = sum(abs(x["miktar"]) for x in negatives)
            top = sorted(negatives, key=lambda x: x["miktar"])[:3]
            teaser = "; ".join(
                f"{(x['ad'] or x['kod'])[:28]} ({x['miktar']:.0f})"
                for x in top if (x['ad'] or x['kod'])
            )
            body = f"{cnt} ürün eksi stokta (toplam {total_abs:,.0f} adet eksik)"
            if teaser:
                body = f"{body}\n{teaser}"
            await _push_many(
                s["tokens"],
                f"📦 Eksi Stok · {tname}",
                body,
                {
                    "type": "low_stock_summary",
                    "tenant": tid,
                    "tenant_name": tname,
                    "count": cnt,
                    "test": True,
                },
            )
            pushed = True

        tenant_results.append({
            "tenant_id": tid,
            "tenant_name": tname,
            "total_items": len(items),
            "negative_count": cnt,
            "pushed": pushed,
            "sample": negatives[:5],
        })

    return {"ok": True, "tenants": tenant_results}


@router.post("/settings")
async def set_settings(body: NotificationSettings, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO user_notification_settings
                    (user_id, notify_cancellations, notify_line_cancellations, notify_high_sales,
                     high_sales_threshold, notify_low_stock, check_interval_minutes, last_check_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE
                    notify_cancellations=VALUES(notify_cancellations),
                    notify_line_cancellations=VALUES(notify_line_cancellations),
                    notify_high_sales=VALUES(notify_high_sales),
                    high_sales_threshold=VALUES(high_sales_threshold),
                    notify_low_stock=VALUES(notify_low_stock),
                    check_interval_minutes=VALUES(check_interval_minutes),
                    last_check_at=NULL,
                    updated_at=UTC_TIMESTAMP()
            """, (
                user_id,
                1 if body.notify_cancellations else 0,
                1 if body.notify_line_cancellations else 0,
                1 if body.notify_high_sales else 0,
                float(body.high_sales_threshold or 0),
                1 if body.notify_low_stock else 0,
                max(1, int(body.check_interval_minutes or 15)),
            ))
            # Re-activate all push tokens so the watcher can deliver events.
            # Prevents the "user toggled Push off then on, but tokens stayed
            # active=0" situation from blocking notifications.
            await cur.execute(
                "UPDATE user_push_tokens SET active=1, updated_at=UTC_TIMESTAMP() WHERE user_id=%s",
                (user_id,),
            )
            await conn.commit()
    return {"ok": True}
