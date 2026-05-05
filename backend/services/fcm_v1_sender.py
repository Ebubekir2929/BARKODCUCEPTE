"""
2026-02 — FCM HTTP v1 API push sender (web push only).

Mobile (iOS/Android) push'lar Expo Push API üzerinden gidiyor (Exponent
servisi push'u FCM/APNs'ye iletiyor). Web push tokens DOĞRUDAN FCM v1 API'ye
gönderilmek zorunda — Expo bu formatı (raw FCM web token) kabul etmiyor.

Bu modül:
  • Firebase Service Account JSON dosyasını yükler (env path: FIREBASE_SERVICE_ACCOUNT_PATH)
  • google-auth ile OAuth2 access token üretir (1h cache)
  • POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send

Service account JSON'u Firebase Console > Project Settings > Service Accounts >
Generate new private key adımıyla indirilir. Dosyayı /app/backend/secrets/firebase-admin.json
yoluna koyup .env'de FIREBASE_SERVICE_ACCOUNT_PATH=/app/backend/secrets/firebase-admin.json olarak set edin.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

# Lazy-loaded singletons
_credentials = None
_project_id: Optional[str] = None
_token_cache: dict = {"access_token": None, "expires_at": 0}

FCM_V1_SCOPE = ["https://www.googleapis.com/auth/firebase.messaging"]


def _load_credentials():
    """Lazy-load Firebase service account credentials.

    Supports TWO sources:
      1. Env var FIREBASE_SERVICE_ACCOUNT_JSON  → JSON content directly (Railway/Heroku friendly)
      2. Env var FIREBASE_SERVICE_ACCOUNT_PATH  → path to JSON file (default: /app/backend/secrets/firebase-admin.json)

    Returns (creds_object, project_id) tuple, or (None, None) if not configured.
    """
    global _credentials, _project_id
    if _credentials is not None and _project_id is not None:
        return _credentials, _project_id

    import json
    sa_data = None

    # Option 1 — JSON content directly from env (preferred for managed platforms)
    sa_json_content = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if sa_json_content:
        try:
            sa_data = json.loads(sa_json_content)
            logger.info("[FCM v1] Loaded service account from FIREBASE_SERVICE_ACCOUNT_JSON env var")
        except Exception as e:
            logger.error(f"[FCM v1] FIREBASE_SERVICE_ACCOUNT_JSON parse error: {e}")
            return None, None

    # Option 2 — File path
    if sa_data is None:
        sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "/app/backend/secrets/firebase-admin.json")
        if not sa_path or not os.path.isfile(sa_path):
            logger.warning(f"[FCM v1] No FIREBASE_SERVICE_ACCOUNT_JSON env, file NOT FOUND at {sa_path} — web push DISABLED")
            return None, None
        try:
            with open(sa_path, "r", encoding="utf-8") as f:
                sa_data = json.load(f)
            logger.info(f"[FCM v1] Loaded service account from file {sa_path}")
        except Exception as e:
            logger.error(f"[FCM v1] Failed to read service account file: {e}")
            return None, None

    try:
        from google.oauth2 import service_account  # type: ignore
        _project_id = sa_data.get("project_id")
        _credentials = service_account.Credentials.from_service_account_info(
            sa_data, scopes=FCM_V1_SCOPE,
        )
        logger.info(f"[FCM v1] Service account loaded for project={_project_id}")
        return _credentials, _project_id
    except Exception as e:
        logger.error(f"[FCM v1] Failed to load service account: {e}")
        return None, None


def _get_access_token() -> Optional[str]:
    """Return a cached or freshly-refreshed OAuth2 access token (1h validity)."""
    creds, _ = _load_credentials()
    if not creds:
        return None

    now = time.time()
    if _token_cache["access_token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]

    try:
        from google.auth.transport.requests import Request  # type: ignore
        creds.refresh(Request())
        _token_cache["access_token"] = creds.token
        _token_cache["expires_at"] = now + 3500  # 1h - 100s safety
        logger.debug("[FCM v1] OAuth2 access token refreshed")
        return creds.token
    except Exception as e:
        logger.error(f"[FCM v1] Token refresh failed: {e}")
        return None


async def send_fcm_web(
    tokens: List[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> dict:
    """Send a notification to a list of FCM Web tokens via FCM HTTP v1 API.

    NOTE: FCM v1 only accepts ONE token per request, so we loop. For high
    volume, consider batching. For our use-case (1-2 web tokens per user),
    sequential is fine.

    Returns: {ok, sent, failed, errors[]}
    """
    if not tokens:
        return {"ok": False, "sent": 0, "reason": "no_tokens"}

    creds, project_id = _load_credentials()
    if not creds or not project_id:
        return {"ok": False, "sent": 0, "reason": "fcm_not_configured"}

    access_token = _get_access_token()
    if not access_token:
        return {"ok": False, "sent": 0, "reason": "oauth_token_unavailable"}

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=utf-8",
    }

    sent = 0
    failed = 0
    errors: list = []

    # FCM v1 sadece string data kabul ediyor — int/dict olanları stringe çevir
    safe_data = {k: str(v) for k, v in (data or {}).items()} if data else {}

    async with httpx.AsyncClient(timeout=20) as client:
        for tk in tokens:
            payload = {
                "message": {
                    "token": tk,
                    "notification": {"title": title, "body": body},
                    "data": safe_data,
                    "webpush": {
                        "headers": {"Urgency": "high", "TTL": "300"},
                        "notification": {
                            "icon": "/favicon.ico",
                            "badge": "/favicon.ico",
                            "requireInteraction": True,
                        },
                        "fcm_options": {
                            "link": safe_data.get("click_url", "/dashboard"),
                        },
                    },
                }
            }
            try:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code == 200:
                    sent += 1
                    logger.info(f"[FCM v1] ✅ Sent to {tk[:25]}... msg_id={resp.json().get('name', '')[-15:]}")
                else:
                    failed += 1
                    err = resp.text[:200]
                    errors.append({"token": tk[:25] + "...", "status": resp.status_code, "error": err})
                    logger.warning(f"[FCM v1] ❌ {resp.status_code} for {tk[:25]}... err={err}")
                    # 404/403 → token invalid, log it for cleanup
                    if resp.status_code in (404, 403):
                        logger.warning(f"[FCM v1] Token possibly invalid (UNREGISTERED): {tk[:25]}...")
            except Exception as e:
                failed += 1
                errors.append({"token": tk[:25] + "...", "error": str(e)})
                logger.error(f"[FCM v1] Exception sending to {tk[:25]}...: {e}")

    return {
        "ok": sent > 0,
        "sent": sent,
        "failed": failed,
        "total": len(tokens),
        "errors": errors,
    }


def is_web_push_token(token: str) -> bool:
    """Heuristic — Expo tokens start with 'ExponentPushToken[' or 'ExpoPushToken['.
    Anything else is treated as an FCM web/native token (sent via FCM v1)."""
    if not token:
        return False
    return not token.startswith("ExponentPushToken") and not token.startswith("ExpoPushToken")
