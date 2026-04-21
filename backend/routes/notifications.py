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
                    notify_high_sales TINYINT(1) DEFAULT 1,
                    high_sales_threshold DECIMAL(18,2) DEFAULT 5000.00,
                    notify_low_stock TINYINT(1) DEFAULT 1,
                    check_interval_minutes INT DEFAULT 15,
                    last_check_at DATETIME NULL,
                    updated_at DATETIME NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
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
                SELECT notify_cancellations, notify_high_sales, high_sales_threshold,
                       notify_low_stock, check_interval_minutes, last_check_at
                FROM user_notification_settings WHERE user_id=%s
            """, (user_id,))
            row = await cur.fetchone()
            if not row:
                # Create defaults
                await cur.execute("""
                    INSERT INTO user_notification_settings
                        (user_id, notify_cancellations, notify_high_sales, high_sales_threshold,
                         notify_low_stock, check_interval_minutes, updated_at)
                    VALUES (%s, 1, 1, 5000.00, 1, 15, NOW())
                """, (user_id,))
                await conn.commit()
                return {
                    "ok": True,
                    "settings": {
                        "notify_cancellations": True,
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
            "notify_high_sales": bool(row[1]),
            "high_sales_threshold": float(row[2]) if row[2] is not None else 5000.0,
            "notify_low_stock": bool(row[3]),
            "check_interval_minutes": int(row[4]) if row[4] is not None else 15,
            "last_check_at": row[5].isoformat() if row[5] else None,
        }
    }


@router.post("/settings")
async def set_settings(body: NotificationSettings, current_user: dict = Depends(get_current_user)):
    """Upsert the current user's notification preferences."""
    user_id = current_user["user_id"]
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO user_notification_settings
                    (user_id, notify_cancellations, notify_high_sales, high_sales_threshold,
                     notify_low_stock, check_interval_minutes, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    notify_cancellations=VALUES(notify_cancellations),
                    notify_high_sales=VALUES(notify_high_sales),
                    high_sales_threshold=VALUES(high_sales_threshold),
                    notify_low_stock=VALUES(notify_low_stock),
                    check_interval_minutes=VALUES(check_interval_minutes),
                    updated_at=NOW()
            """, (
                user_id,
                1 if body.notify_cancellations else 0,
                1 if body.notify_high_sales else 0,
                float(body.high_sales_threshold or 0),
                1 if body.notify_low_stock else 0,
                max(1, int(body.check_interval_minutes or 15)),
            ))
            await conn.commit()
    return {"ok": True}
