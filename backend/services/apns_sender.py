"""
2026-05-15 — APNs HTTP/2 direct sender for iOS push notifications.

Why this exists:
  • Frontend uses `expo-notifications.getDevicePushTokenAsync()` which returns
    the raw APNs device token on iOS (64 hex chars).
  • Our backend FCM v1 sender does NOT accept raw APNs tokens — Firebase only
    accepts FCM registration tokens or APNs tokens registered to a Firebase
    iOS app (requires Firebase iOS SDK in the app, which we don't have).
  • Solution: Send directly to Apple's APNs HTTP/2 endpoint using the .p8
    Authentication Key we generated in Apple Developer Portal.

Config (env vars, with sensible defaults):
  APNS_KEY_ID       — Key ID from Apple (e.g. "PWFJ28ZD7A")
  APNS_TEAM_ID      — Team ID (e.g. "K586B5D22R")
  APNS_BUNDLE_ID    — iOS app bundle id (e.g. "com.cakmakebubekir.barkodcucepte")
  APNS_KEY_PATH     — Path to .p8 file (default /app/backend/secrets/AuthKey_PWFJ28ZD7A.p8)
  APNS_PRODUCTION   — "true"|"false" — when "true" uses api.push.apple.com,
                       else uses api.sandbox.push.apple.com (default true)
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

import httpx
import jwt

logger = logging.getLogger(__name__)

_TOKEN_CACHE = {"jwt": None, "exp": 0}


def _is_apns_token(token: str) -> bool:
    """Detect raw APNs device tokens.
    
    APNs tokens are 64-128 hex characters (no colons). FCM tokens contain
    colons (`registration_id:APA91b...`) and are longer.
    """
    if not token:
        return False
    s = token.strip()
    if ":" in s:
        return False  # FCM/Expo token format
    # Must be pure hex (case-insensitive) and reasonable length for APNs
    if not (40 <= len(s) <= 200):
        return False
    try:
        bytes.fromhex(s)
        return True
    except ValueError:
        return False


def _get_provider_jwt() -> Optional[str]:
    """Create or reuse a cached Apple Provider JWT.

    Apple recommends rotating the JWT every ~20-50 minutes (max 60). We refresh
    every 45 minutes for safety.
    """
    now = int(time.time())
    cached = _TOKEN_CACHE.get("jwt")
    if cached and _TOKEN_CACHE["exp"] - now > 60:
        return cached

    key_id = os.getenv("APNS_KEY_ID", "PWFJ28ZD7A").strip()
    team_id = os.getenv("APNS_TEAM_ID", "K586B5D22R").strip()
    key_path = os.getenv("APNS_KEY_PATH", "/app/backend/secrets/AuthKey_PWFJ28ZD7A.p8").strip()

    if not (key_id and team_id and key_path and os.path.exists(key_path)):
        logger.error(f"[APNs] config missing: key_id={key_id!r} team_id={team_id!r} key_exists={os.path.exists(key_path)}")
        return None

    try:
        with open(key_path, "r") as f:
            private_key = f.read()
    except Exception as e:
        logger.error(f"[APNs] failed to read .p8 file: {e}")
        return None

    try:
        # Apple-required ES256 JWT
        token = jwt.encode(
            {"iss": team_id, "iat": now},
            private_key,
            algorithm="ES256",
            headers={"alg": "ES256", "kid": key_id},
        )
        _TOKEN_CACHE["jwt"] = token
        _TOKEN_CACHE["exp"] = now + 45 * 60  # rotate in 45min
        logger.info(f"[APNs] Provider JWT created (kid={key_id}, exp=+45min)")
        return token
    except Exception as e:
        logger.error(f"[APNs] JWT signing failed: {e}")
        return None


async def send_apns_push(
    device_token: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    badge: Optional[int] = None,
    sound: str = "default",
) -> bool:
    """Send a single push notification to one iOS device via APNs HTTP/2.

    Returns True if Apple accepted the push (HTTP 200), False otherwise.
    Failures logged with reason.
    """
    if not _is_apns_token(device_token):
        logger.debug(f"[APNs] skip token={device_token[:20]}... — not APNs format")
        return False

    provider_jwt = _get_provider_jwt()
    if not provider_jwt:
        return False

    bundle_id = os.getenv("APNS_BUNDLE_ID", "com.cakmakebubekir.barkodcucepte").strip()
    production = os.getenv("APNS_PRODUCTION", "true").strip().lower() in ("1", "true", "yes")
    host = "api.push.apple.com" if production else "api.sandbox.push.apple.com"
    url = f"https://{host}/3/device/{device_token}"

    # APNs payload — Apple format
    aps: dict = {
        "alert": {"title": title, "body": body},
        "sound": sound,
        "mutable-content": 1,
    }
    if badge is not None:
        aps["badge"] = int(badge)

    payload: dict = {"aps": aps}
    # Custom data merged at root level for client to access.
    # 2026-05-15 — Stringify all values; expo-notifications iOS bridge maps
    # NSDictionary→JS object and primitive types stay, but Python ints
    # vs strings can confuse downstream consumers. FCM v1 does the same.
    if isinstance(data, dict):
        for k, v in data.items():
            if k == "aps":
                continue
            if v is None:
                continue
            payload[k] = str(v)

    headers = {
        "authorization": f"bearer {provider_jwt}",
        "apns-topic": bundle_id,
        "apns-push-type": "alert",
        "apns-priority": "10",
    }

    try:
        async with httpx.AsyncClient(http2=True, timeout=10.0) as client:
            r = await client.post(url, headers=headers, json=payload)
        if r.status_code == 200:
            logger.info(f"[APNs] ✅ Sent to {device_token[:20]}... (env={'prod' if production else 'sandbox'})")
            return True
        # Try fallback environment on BadDeviceToken — common when token was registered in opposite env
        try:
            err = r.json()
        except Exception:
            err = {"reason": r.text}
        reason = err.get("reason", "?")
        logger.warning(
            f"[APNs] ❌ {r.status_code} reason={reason} token={device_token[:20]}... env={'prod' if production else 'sandbox'}"
        )
        if reason in ("BadDeviceToken", "DeviceTokenNotForTopic"):
            # Try the opposite environment as a fallback (dev builds vs prod)
            alt_host = "api.sandbox.push.apple.com" if production else "api.push.apple.com"
            alt_url = f"https://{alt_host}/3/device/{device_token}"
            try:
                async with httpx.AsyncClient(http2=True, timeout=10.0) as client:
                    r2 = await client.post(alt_url, headers=headers, json=payload)
                if r2.status_code == 200:
                    logger.info(f"[APNs] ✅ Sent (fallback {alt_host}) token={device_token[:20]}...")
                    return True
                try:
                    err2 = r2.json()
                except Exception:
                    err2 = {"reason": r2.text}
                logger.warning(
                    f"[APNs] ❌ fallback {r2.status_code} reason={err2.get('reason', '?')} env={alt_host}"
                )
            except Exception as e2:
                logger.error(f"[APNs] fallback exception: {e2}")
        return False
    except Exception as e:
        logger.error(f"[APNs] send exception: {e}")
        return False


async def send_apns_push_many(
    tokens: List[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
    badge: Optional[int] = None,
    sound: str = "default",
) -> dict:
    """Send a push to a batch of APNs tokens. Returns {sent, failed, total}."""
    sent = 0
    failed = 0
    for t in tokens:
        ok = await send_apns_push(t, title, body, data=data, badge=badge, sound=sound)
        if ok:
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "total": len(tokens)}
