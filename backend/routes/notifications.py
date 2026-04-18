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
    """Create user_push_tokens table if it doesn't exist (called at startup)."""
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
            await conn.commit()
    logger.info("user_push_tokens table ready")


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
