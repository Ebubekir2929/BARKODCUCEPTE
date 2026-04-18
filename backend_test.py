"""
Backend test for report endpoints:
- POST /api/data/report-filter-options
- POST /api/data/report-run

Auth: Login as berk (no tenant) and use admin's tenant_id in body.
"""
import os
import sys
import json
import time
import requests
from pathlib import Path

# Read backend URL from frontend/.env
FRONTEND_ENV = Path("/app/frontend/.env")
BACKEND_URL = None
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BACKEND_URL = line.split("=", 1)[1].strip().strip('"')
        break

if not BACKEND_URL:
    print("ERROR: EXPO_PUBLIC_BACKEND_URL not set in /app/frontend/.env")
    sys.exit(1)

API_BASE = f"{BACKEND_URL}/api"
print(f"Using API base: {API_BASE}")

# Test creds
BERK_USERNAME = "berk"
BERK_PASSWORD = "admin"
ADMIN_TENANT_ID = "d5587c87a7f9476fa82b83f40accd6c7"

results = []


def record(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name}: {detail}")
    results.append({"name": name, "passed": passed, "detail": detail})


def login(username, password):
    """POST /api/auth/login"""
    try:
        r = requests.post(
            f"{API_BASE}/auth/login",
            json={"email": username, "password": password},
            timeout=30,
        )
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:300]}"
        data = r.json()
        return data.get("access_token"), None
    except Exception as e:
        return None, str(e)


def main():
    # Step 1: Login as berk
    print("\n=== Step 1: Login as berk ===")
    token, err = login(BERK_USERNAME, BERK_PASSWORD)
    if not token:
        record("Login berk", False, f"Failed to login: {err}")
        print("Cannot proceed without auth. Exiting.")
        sys.exit(1)
    record("Login berk", True, f"Got JWT token (len={len(token)})")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # === report-filter-options: Error cases ===
    print("\n=== Step 2: /api/data/report-filter-options - Error handling ===")

    # Missing tenant_id
    r = requests.post(
        f"{API_BASE}/data/report-filter-options",
        headers=headers,
        json={"source": "STOK_FIYAT_AD"},
        timeout=30,
    )
    ok = r.status_code == 400 and "tenant_id" in r.text.lower()
    record("report-filter-options missing tenant_id -> 400", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # Missing source
    r = requests.post(
        f"{API_BASE}/data/report-filter-options",
        headers=headers,
        json={"tenant_id": ADMIN_TENANT_ID},
        timeout=30,
    )
    ok = r.status_code == 400
    record("report-filter-options missing source -> 400", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # No auth (no token)
    r = requests.post(
        f"{API_BASE}/data/report-filter-options",
        json={"tenant_id": ADMIN_TENANT_ID, "source": "STOK_FIYAT_AD"},
        timeout=30,
    )
    ok = r.status_code in (401, 403)
    record("report-filter-options no auth -> 401/403", ok, f"HTTP {r.status_code}")

    # === report-filter-options: Happy path ===
    print("\n=== Step 3: /api/data/report-filter-options - Valid request (STOK_FIYAT_AD) ===")
    print("(This calls remote sync.php and may take 10-30s)")
    t0 = time.time()
    filter_options = None
    try:
        r = requests.post(
            f"{API_BASE}/data/report-filter-options",
            headers=headers,
            json={"tenant_id": ADMIN_TENANT_ID, "source": "STOK_FIYAT_AD"},
            timeout=120,
        )
        elapsed = time.time() - t0
        if r.status_code != 200:
            record(
                "report-filter-options STOK_FIYAT_AD",
                False,
                f"HTTP {r.status_code} after {elapsed:.1f}s: {r.text[:400]}",
            )
        else:
            data = r.json()
            ok_flag = data.get("ok") is True
            has_data = isinstance(data.get("data"), list)
            detail = f"{elapsed:.1f}s, ok={data.get('ok')}, data_len={len(data.get('data') or [])}"
            if has_data and len(data["data"]) > 0:
                detail += f", sample={json.dumps(data['data'][0], ensure_ascii=False)[:250]}"
            record(
                "report-filter-options STOK_FIYAT_AD",
                ok_flag and has_data,
                detail,
            )
            filter_options = data.get("data") or []
    except Exception as e:
        record("report-filter-options STOK_FIYAT_AD", False, f"Exception: {e}")

    # Pick an ID from the options to use in report-run
    fiyat_ad_id = None
    if filter_options:
        first = filter_options[0] if isinstance(filter_options, list) and filter_options else {}
        print(f"  First option structure: {json.dumps(first, ensure_ascii=False)[:300] if isinstance(first, dict) else type(first)}")
        if isinstance(first, dict):
            for key in ("ID", "Id", "id", "Value", "value", "KEY", "key", "FiyatAd", "FIYAT_AD"):
                if key in first:
                    fiyat_ad_id = first[key]
                    print(f"  Using {key}={fiyat_ad_id} as FiyatAd")
                    break

    # === report-run: Error cases ===
    print("\n=== Step 4: /api/data/report-run - Error handling ===")

    # Missing tenant_id
    r = requests.post(
        f"{API_BASE}/data/report-run",
        headers=headers,
        json={"dataset_key": "rap_fiyat_listeleri_web", "params": {}},
        timeout=30,
    )
    ok = r.status_code == 400
    record("report-run missing tenant_id -> 400", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # Missing dataset_key
    r = requests.post(
        f"{API_BASE}/data/report-run",
        headers=headers,
        json={"tenant_id": ADMIN_TENANT_ID, "params": {}},
        timeout=30,
    )
    ok = r.status_code == 400
    record("report-run missing dataset_key -> 400", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # Invalid dataset_key
    r = requests.post(
        f"{API_BASE}/data/report-run",
        headers=headers,
        json={"tenant_id": ADMIN_TENANT_ID, "dataset_key": "invalid_dataset_xyz", "params": {}},
        timeout=30,
    )
    ok = r.status_code == 400
    record("report-run invalid dataset_key -> 400", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # No auth
    r = requests.post(
        f"{API_BASE}/data/report-run",
        json={
            "tenant_id": ADMIN_TENANT_ID,
            "dataset_key": "rap_fiyat_listeleri_web",
            "params": {"Aktif": 1, "Durum": 0, "Resimli": 0, "Page": 1, "PageSize": 500},
        },
        timeout=30,
    )
    ok = r.status_code in (401, 403)
    record("report-run no auth -> 401/403", ok, f"HTTP {r.status_code}")

    # === report-run: Happy path ===
    print("\n=== Step 5: /api/data/report-run - Valid request (rap_fiyat_listeleri_web) ===")
    print("(This calls remote sync.php and may take 10-30s)")

    params_body = {
        "Aktif": 1,
        "Durum": 0,
        "Resimli": 0,
        "Page": 1,
        "PageSize": 500,
    }
    if fiyat_ad_id is not None:
        params_body["FiyatAd"] = fiyat_ad_id
    else:
        print("  WARNING: No FiyatAd id from filter options; running without it")

    t0 = time.time()
    try:
        r = requests.post(
            f"{API_BASE}/data/report-run",
            headers=headers,
            json={
                "tenant_id": ADMIN_TENANT_ID,
                "dataset_key": "rap_fiyat_listeleri_web",
                "params": params_body,
            },
            timeout=180,
        )
        elapsed = time.time() - t0
        if r.status_code != 200:
            record(
                "report-run rap_fiyat_listeleri_web",
                False,
                f"HTTP {r.status_code} after {elapsed:.1f}s: {r.text[:500]}",
            )
        else:
            data = r.json()
            ok_flag = data.get("ok") is True
            has_data = isinstance(data.get("data"), list)
            detail = f"{elapsed:.1f}s, ok={data.get('ok')}, data_len={len(data.get('data') or [])}, request_uid={str(data.get('request_uid',''))[:20]}"
            if has_data and len(data["data"]) > 0:
                sample = data["data"][0]
                if isinstance(sample, dict):
                    detail += f", sample_keys={list(sample.keys())[:10]}"
            record(
                "report-run rap_fiyat_listeleri_web",
                ok_flag and has_data,
                detail,
            )
    except Exception as e:
        record("report-run rap_fiyat_listeleri_web", False, f"Exception: {e}")

    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        print(f"  [{status}] {r['name']}")
    print(f"\nTotal: {passed}/{total} passed")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
