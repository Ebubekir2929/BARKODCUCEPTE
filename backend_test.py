"""
Backend tests for Push Notifications API + regression check for report-run.

Run: python /app/backend_test.py
"""
import requests
import json
import sys
from pathlib import Path

# Resolve backend URL from frontend/.env
FRONTEND_ENV = Path("/app/frontend/.env")
BACKEND_URL = None
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BACKEND_URL = line.split("=", 1)[1].strip().strip('"')
        break
if not BACKEND_URL:
    print("ERROR: EXPO_PUBLIC_BACKEND_URL not set")
    sys.exit(1)

BASE_URL = f"{BACKEND_URL}/api"

# Admin user with tenant_id
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"
TENANT_ID = "d5587c87a7f9476fa82b83f40accd6c7"

TEST_TOKEN = "ExponentPushToken[test-abc-123]"

results = []


def log(name, passed, detail=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} - {name}")
    if detail:
        print(f"        {detail}")
    results.append((name, passed, detail))


def login():
    # Backend login schema uses 'email' (accepts email or username)
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        # try 'identifier'
        r = requests.post(
            f"{BASE_URL}/auth/login",
            json={"identifier": EMAIL, "password": PASSWORD},
            timeout=30,
        )
    r.raise_for_status()
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if not token:
        raise RuntimeError(f"No token in login response: {data}")
    print(f"Logged in as {EMAIL}")
    return token


def test_register_token(headers):
    r = requests.post(
        f"{BASE_URL}/notifications/register-token",
        json={"token": TEST_TOKEN, "platform": "ios", "device_id": "test-device-001"},
        headers=headers,
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    ok = r.status_code == 200 and isinstance(body, dict) and body.get("ok") is True
    log("POST /notifications/register-token (first call)", ok, f"status={r.status_code} body={body}")


def test_register_token_idempotent(headers):
    r = requests.post(
        f"{BASE_URL}/notifications/register-token",
        json={"token": TEST_TOKEN, "platform": "ios", "device_id": "test-device-001"},
        headers=headers,
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    ok = r.status_code == 200 and isinstance(body, dict) and body.get("ok") is True
    log("POST /notifications/register-token (idempotent 2nd call, same token)", ok,
        f"status={r.status_code} body={body}")


def test_my_tokens_active(headers):
    r = requests.get(f"{BASE_URL}/notifications/my-tokens", headers=headers, timeout=30)
    try:
        body = r.json()
    except Exception:
        body = r.text
    ok = r.status_code == 200 and isinstance(body, dict) and body.get("ok") is True
    found = False
    active = False
    if ok:
        for t in body.get("tokens", []):
            if t.get("token") == TEST_TOKEN:
                found = True
                active = bool(t.get("active"))
                break
    ok = ok and found and active
    log("GET /notifications/my-tokens -> test token active=true", ok,
        f"status={r.status_code} found={found} active={active} total={len(body.get('tokens', [])) if isinstance(body, dict) else 'NA'}")


def test_send_test(headers):
    r = requests.post(
        f"{BASE_URL}/notifications/send-test",
        json={"title": "Test", "body": "Merhaba"},
        headers=headers,
        timeout=60,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    ok = (
        r.status_code == 200
        and isinstance(body, dict)
        and body.get("ok") is True
        and body.get("sent", 0) >= 1
        and "expo_response" in body
    )
    log("POST /notifications/send-test", ok,
        f"status={r.status_code} body={json.dumps(body)[:500] if isinstance(body, dict) else body}")


def test_unregister_token(headers):
    r = requests.post(
        f"{BASE_URL}/notifications/unregister-token",
        json={"token": TEST_TOKEN},
        headers=headers,
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    ok = r.status_code == 200 and isinstance(body, dict) and body.get("ok") is True
    log("POST /notifications/unregister-token", ok, f"status={r.status_code} body={body}")


def test_my_tokens_inactive(headers):
    r = requests.get(f"{BASE_URL}/notifications/my-tokens", headers=headers, timeout=30)
    try:
        body = r.json()
    except Exception:
        body = r.text
    ok = r.status_code == 200 and isinstance(body, dict) and body.get("ok") is True
    found_inactive = False
    if ok:
        for t in body.get("tokens", []):
            if t.get("token") == TEST_TOKEN:
                found_inactive = (t.get("active") is False)
                break
    ok = ok and found_inactive
    log("GET /notifications/my-tokens after unregister -> active=false", ok,
        f"status={r.status_code} found_inactive={found_inactive}")


def test_register_no_auth():
    r = requests.post(
        f"{BASE_URL}/notifications/register-token",
        json={"token": TEST_TOKEN, "platform": "ios", "device_id": "test-device-001"},
        timeout=30,
    )
    ok = r.status_code in (401, 403)
    log("POST /notifications/register-token without Authorization -> 401/403", ok,
        f"status={r.status_code}")


def test_register_empty_token(headers):
    r = requests.post(
        f"{BASE_URL}/notifications/register-token",
        json={"token": ""},
        headers=headers,
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    detail = body.get("detail") if isinstance(body, dict) else ""
    ok = r.status_code == 400 and "Token gerekli" in str(detail)
    log("POST /notifications/register-token empty token -> 400 'Token gerekli'", ok,
        f"status={r.status_code} body={body}")


def test_send_test_no_active_tokens(headers):
    # Deactivate all tokens for this user (unregister with empty token)
    requests.post(
        f"{BASE_URL}/notifications/unregister-token",
        json={"token": ""},
        headers=headers,
        timeout=30,
    )
    r = requests.post(
        f"{BASE_URL}/notifications/send-test",
        json={"title": "Test", "body": "Merhaba"},
        headers=headers,
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    detail = body.get("detail") if isinstance(body, dict) else ""
    ok = r.status_code == 404 and isinstance(detail, str) and len(detail) > 0
    log("POST /notifications/send-test (no active tokens) -> 404 Turkish error",
        ok, f"status={r.status_code} detail={detail}")


def test_report_run_regression(headers):
    """Regression sanity: cari ekstre report should return >=1 row."""
    payload = {
        "tenant_id": TENANT_ID,
        "dataset_key": "rap_cari_hesap_ekstresi_web",
        "params": {
            # NOTE: Param names must match the frontend/POS upstream schema exactly.
            # Wrong names (e.g. "CariKod" vs "CariKodu") cause upstream to return 0 rows.
            "BASTARIH": "2025-01-01",
            "BITTARIH": "2026-02-20 23:59:59",
            "BakiyeTip": 0,
            "Proje": "",
            "Lokasyon": "",
            "AktifDurum": "",
            "Cariler": "",
            "CariKodu": "",
            "CariAdi": "",
            "CariTur": "",
            "CariGrup": "",
            "Temsilci": "",
            "Sehir": "",
            "CariRut": "",
            "CariOzelKod1": "",
            "CariOzelKod2": "",
            "CariOzelKod3": "",
            "CariOzelKod4": "",
            "CariOzelKod5": "",
            "Detayli": 0,
            "BakiyeVermeyenHareketsizDevirlerGelmesin": 0,
            "MinBakiye": -99999999,
            "MaxBakiye": 99999999,
            "Page": 1,
            "PageSize": 500,
        },
    }
    r = requests.post(
        f"{BASE_URL}/data/report-run",
        json=payload,
        headers=headers,
        timeout=180,
    )
    try:
        body = r.json()
    except Exception:
        body = r.text
    rows = len(body.get("data", [])) if isinstance(body, dict) else 0
    ok = r.status_code == 200 and isinstance(body, dict) and body.get("ok") is True and rows >= 1
    log("POST /data/report-run cari_hesap_ekstresi_web regression (>=1 row)", ok,
        f"status={r.status_code} rows={rows}")


def main():
    print("=" * 70)
    print(f"Backend tests against {BASE_URL}")
    print("=" * 70)

    # Error case: no auth (run before login)
    test_register_no_auth()

    # Login
    try:
        token = login()
    except Exception as e:
        print(f"❌ FATAL: Login failed: {e}")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}"}

    # Clean slate: deactivate any existing tokens for this user
    requests.post(
        f"{BASE_URL}/notifications/unregister-token",
        json={"token": ""},
        headers=headers,
        timeout=30,
    )

    # 1. register-token + idempotency
    test_register_token(headers)
    test_register_token_idempotent(headers)

    # 2. my-tokens -> active
    test_my_tokens_active(headers)

    # 3. send-test
    test_send_test(headers)

    # 4. error: empty token
    test_register_empty_token(headers)

    # 5. unregister-token
    test_unregister_token(headers)

    # 6. my-tokens -> inactive
    test_my_tokens_inactive(headers)

    # 7. send-test with no active tokens -> 404
    test_send_test_no_active_tokens(headers)

    # 8. Regression: report-run
    test_report_run_regression(headers)

    print("\n" + "=" * 70)
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"RESULT: {passed}/{total} passed")
    print("=" * 70)
    if passed != total:
        for name, ok, detail in results:
            if not ok:
                print(f"  FAILED: {name}")
                print(f"     -> {detail}")
        sys.exit(1)


if __name__ == "__main__":
    main()
