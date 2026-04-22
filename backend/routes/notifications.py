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
    """Save / re-activate a push token for the current user."""
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token gerekli")

    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO user_push_tokens (user_id, token, platform, device_id, active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 1, NOW(), NOW())
                ON DUPLICATE KEY UPDATE active=1, platform=VALUES(platform),
                    device_id=VALUES(device_id), updated_at=NOW()
            """, (user_id, token, body.platform or "", body.device_id or ""))
            await conn.commit()
    logger.info(f"Push token registered for user {user_id}: {token[:20]}...")
    return {"ok": True}


@router.post("/unregister-token")
async def unregister_token(body: RegisterTokenBody, current_user: dict = Depends(get_current_user)):
    """Mark a push token inactive for the current user."""
    token = (body.token or "").strip()
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if token:
                await cur.execute(
                    "UPDATE user_push_tokens SET active=0 WHERE user_id=%s AND token=%s",
                    (user_id, token),
                )
            else:
                # Deactivate all tokens for this user
                await cur.execute(
                    "UPDATE user_push_tokens SET active=0 WHERE user_id=%s",
                    (user_id,),
                )
            await conn.commit()
    return {"ok": True}


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
            result = resp.json()
            logger.info(f"Expo push response: {result}")
            return {"ok": True, "sent": len(tokens), "expo_response": result}
    except Exception as e:
        logger.error(f"Expo push error: {e}")
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
                    VALUES (%s, 1, 1, 1, 5000.00, 1, 15, NOW())
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
    from services.notification_watcher import (
        _pos_run, _mark_event_seen, _push_many
    )

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

    today = datetime.now().strftime("%Y-%m-%d")
    days_back = max(1, int(body.days_back or 2))
    since = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")

    stok_empty = {
        "Stoklar": "", "StokGrup": "", "StokCinsi": "", "StokMarka": "", "StokVergi": "",
        "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "",
        "StokOzelKod5": "", "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
    }

    total_push_sent = 0
    tenants_report = []

    for t in tenant_list:
        tenant_id = t["tenant_id"]
        tenant_name = t["name"] or "Veri"

        fis_params = {
            "BASTARIH": since, "BITTARIH": today,
            "FisTuru": "", "FisAltTuru": "", "Lokasyon": "", "Proje": "", "BelgeNo": "",
            "Personel": "", "Cariler": "", "CariTur": "", "CariGrup": "", "Adresler": "", "Temsilci": "",
            "CariOzelKod1": "", "CariOzelKod2": "", "CariOzelKod3": "", "CariOzelKod4": "", "CariOzelKod5": "",
            "FisOzelKod1": "", "FisOzelKod2": "", "FisOzelKod3": "", "FisOzelKod4": "", "FisOzelKod5": "",
            "Detayli": 0, "Page": 1, "PageSize": int(body.page_size or 500),
            **stok_empty,
        }

        pos_error: Optional[str] = None
        rows: list = []
        try:
            rows = await _pos_run(tenant_id, "rap_fis_kalem_listesi_web", fis_params)
        except Exception as e:
            pos_error = f"{type(e).__name__}: {e}"

        # --- Sample first row keys to help diagnose field names ---
        sample_keys: list = []
        sample_row: dict = {}
        if rows:
            sample_row = {k: rows[0].get(k) for k in list(rows[0].keys())[:40]}
            sample_keys = list(rows[0].keys())

        # --- Line cancellations ---
        line_cancellations = []
        for r in rows:
            row_iptal = (
                str(r.get("SATIR_DURUMU") or "").lower().find("iptal") >= 0
                or r.get("SATIR_IPTAL") in (1, "1", True, "E")
                or r.get("IPTAL") in (1, "1", True, "E")
                or str(r.get("DURUM") or "").lower() == "iptal"
            )
            if not row_iptal:
                continue
            bn = str(r.get("BELGENO") or "").strip()
            stok_kod = str(r.get("STOK_KOD") or r.get("KOD") or "").strip()
            stok_ad = str(r.get("STOK_AD") or r.get("AD") or "Stok kalemi")
            miktar = float(r.get("MIKTAR_FIS") or 0)
            satir_toplam = float(r.get("SATIR_GENEL_TOPLAM") or r.get("DAHIL_NET_TUTAR") or 0)
            key = f"{bn}::{stok_kod}::{miktar}"

            sent = False
            dedup_result = "skipped_disabled"
            if notify_line_cancellations and body.send_push:
                is_new = await _mark_event_seen(tenant_id, "satir_iptal", key)
                if is_new:
                    await _push_many(
                        tokens,
                        f"❌ Satır İptali · {tenant_name}",
                        f"{bn} · {stok_ad} ({miktar:g}) iptal edildi · ₺{satir_toplam:,.2f}",
                        {"type": "line_cancellation", "belgeno": bn, "stok_kod": stok_kod,
                         "tenant": tenant_id, "tenant_name": tenant_name},
                    )
                    sent = True
                    total_push_sent += 1
                    dedup_result = "sent"
                else:
                    dedup_result = "already_seen"
            elif not notify_line_cancellations:
                dedup_result = "disabled_by_user"

            line_cancellations.append({
                "belgeno": bn, "stok_kod": stok_kod, "stok_ad": stok_ad,
                "miktar": miktar, "satir_toplam": satir_toplam,
                "fields_detected": {
                    "SATIR_DURUMU": r.get("SATIR_DURUMU"),
                    "SATIR_IPTAL": r.get("SATIR_IPTAL"),
                    "IPTAL": r.get("IPTAL"),
                    "DURUM": r.get("DURUM"),
                },
                "result": dedup_result,
                "push_sent": sent,
            })

        # --- Fiş-level cancellations + high sales ---
        seen_belge = {}
        for r in rows:
            bn = str(r.get("BELGENO") or "").strip()
            if not bn:
                continue
            if bn not in seen_belge:
                seen_belge[bn] = {"row": r, "__total": float(r.get("SATIR_GENEL_TOPLAM") or 0)}
            else:
                seen_belge[bn]["__total"] += float(r.get("SATIR_GENEL_TOPLAM") or 0)

        cancelled_belges = []
        high_sales = []
        for bn, agg in seen_belge.items():
            r = agg["row"]
            total = float(agg["__total"] or 0)
            fis_turu_raw = r.get("FIS_TURU") or ""
            fis_durumu_raw = r.get("FIS_DURUMU") or ""
            fis_turu = str(fis_turu_raw).lower()
            fis_durumu = str(fis_durumu_raw).lower()

            is_cancelled = ("iptal" in fis_durumu) or (r.get("IPTAL") in (1, "1", True, "E"))
            if is_cancelled:
                sent = False
                dedup_result = "skipped_disabled"
                if notify_cancellations and body.send_push:
                    is_new = await _mark_event_seen(tenant_id, "iptal", bn)
                    if is_new:
                        await _push_many(
                            tokens,
                            f"🚫 Fiş İptali · {tenant_name}",
                            f"{fis_turu_raw or 'Fiş'} {bn} iptal edildi · ₺{total:,.2f}",
                            {"type": "cancellation", "belgeno": bn,
                             "tenant": tenant_id, "tenant_name": tenant_name},
                        )
                        sent = True
                        total_push_sent += 1
                        dedup_result = "sent"
                    else:
                        dedup_result = "already_seen"
                elif not notify_cancellations:
                    dedup_result = "disabled_by_user"

                cancelled_belges.append({
                    "belgeno": bn,
                    "fis_turu": fis_turu_raw,
                    "fis_durumu": fis_durumu_raw,
                    "total": total,
                    "iptal_flag": r.get("IPTAL"),
                    "result": dedup_result,
                    "push_sent": sent,
                })

            is_sale_doc = any(x in fis_turu for x in ("perakende", "satış fatura", "satis fatura"))
            if is_sale_doc and not is_cancelled and total >= high_sales_threshold:
                sent = False
                dedup_result = "skipped_disabled"
                if notify_high_sales and body.send_push:
                    is_new = await _mark_event_seen(tenant_id, "yuksek_satis", bn)
                    if is_new:
                        await _push_many(
                            tokens,
                            f"💰 Yüksek Satış · {tenant_name}",
                            f"{fis_turu_raw or 'Satış'} {bn}: ₺{total:,.2f}",
                            {"type": "high_sale", "belgeno": bn, "amount": total,
                             "tenant": tenant_id, "tenant_name": tenant_name},
                        )
                        sent = True
                        total_push_sent += 1
                        dedup_result = "sent"
                    else:
                        dedup_result = "already_seen"
                elif not notify_high_sales:
                    dedup_result = "disabled_by_user"

                high_sales.append({
                    "belgeno": bn, "fis_turu": fis_turu_raw,
                    "total": total, "result": dedup_result, "push_sent": sent,
                })

        tenants_report.append({
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "date_range": {"from": since, "to": today},
            "total_rows": len(rows),
            "unique_belge_count": len(seen_belge),
            "pos_error": pos_error,
            "sample_keys": sample_keys,
            "sample_row": sample_row,
            "cancelled_belges": cancelled_belges,
            "line_cancellations": line_cancellations,
            "high_sales": high_sales,
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


@router.post("/settings")
async def set_settings(body: NotificationSettings, current_user: dict = Depends(get_current_user)):
    """Upsert the current user's notification preferences.

    Also resets `last_check_at` so the watcher picks up the new interval
    immediately on the next tick (otherwise users stuck in the old 15-min
    window would have to wait for it to expire).
    """
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO user_notification_settings
                    (user_id, notify_cancellations, notify_line_cancellations, notify_high_sales,
                     high_sales_threshold, notify_low_stock, check_interval_minutes, last_check_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, NOW())
                ON DUPLICATE KEY UPDATE
                    notify_cancellations=VALUES(notify_cancellations),
                    notify_line_cancellations=VALUES(notify_line_cancellations),
                    notify_high_sales=VALUES(notify_high_sales),
                    high_sales_threshold=VALUES(high_sales_threshold),
                    notify_low_stock=VALUES(notify_low_stock),
                    check_interval_minutes=VALUES(check_interval_minutes),
                    last_check_at=NULL,
                    updated_at=NOW()
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
                "UPDATE user_push_tokens SET active=1, updated_at=NOW() WHERE user_id=%s",
                (user_id,),
            )
            await conn.commit()
    return {"ok": True}
