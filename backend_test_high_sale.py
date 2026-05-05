#!/usr/bin/env python3
"""
Test for new endpoint POST /api/data/high-sale-detail + regression on
fis-detail, iptal-detail, dashboard.

Per review_request:
 1) Login with cakmak.ebubekir29@gmail.com / 123456 -> 200 + token + tenants
 2) high-sale-detail with valid bearer + tenant -> 200 + ok:true (details may be empty)
 3) high-sale-detail without token -> 401/403
 4) high-sale-detail with missing fis_id -> 400
 5) Regression: fis-detail with same tenant_id + fis_id:1 -> 200
 6) Regression: iptal-detail with same tenant_id + iptal_id:1 -> 200
 7) Regression: GET /api/data/dashboard?tenant_id=<tid> -> 200
"""
import sys
import time
import json
import requests

BASE_URL = "https://saas-dashboard-pos.preview.emergentagent.com/api"

LOGIN_EMAIL = "cakmak.ebubekir29@gmail.com"
LOGIN_PASSWORD = "123456"

RESULTS = []


def _log(name, ok, secs, detail=""):
    status = "PASS" if ok else "FAIL"
    icon = "OK " if ok else "X  "
    print(f"[{icon}] {name:<55} {secs*1000:8.0f} ms  {detail}")
    RESULTS.append({"name": name, "ok": ok, "secs": secs, "detail": detail})


def login():
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=30,
    )
    elapsed = time.time() - t0
    if r.status_code != 200:
        _log("login", False, elapsed, f"HTTP {r.status_code}: {r.text[:300]}")
        return None, None
    j = r.json()
    token = j.get("access_token") or j.get("token")
    user = j.get("user") or {}
    tenants = user.get("tenants") or []
    if not token:
        _log("login", False, elapsed, f"no token: {json.dumps(j)[:300]}")
        return None, None
    if not tenants:
        _log("login", False, elapsed, f"no tenants on user: {json.dumps(user)[:300]}")
        return token, []
    _log("login", True, elapsed,
         f"token_len={len(token)} tenants={len(tenants)} first_tenant_id={tenants[0].get('tenant_id')}")
    return token, tenants


def post(path, body, token=None, timeout=60):
    t0 = time.time()
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = requests.post(f"{BASE_URL}{path}", json=body, headers=headers, timeout=timeout)
    elapsed = time.time() - t0
    return r, elapsed


def get(path, params, token=None, timeout=60):
    t0 = time.time()
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = requests.get(f"{BASE_URL}{path}", params=params, headers=headers, timeout=timeout)
    elapsed = time.time() - t0
    return r, elapsed


def test_high_sale_detail_happy(token, tenant_id):
    """Test #2 — POST /high-sale-detail with valid bearer + fis_id=1."""
    r, elapsed = post("/data/high-sale-detail",
                      {"tenant_id": tenant_id, "fis_id": 1},
                      token=token, timeout=60)
    ok = r.status_code == 200
    detail = ""
    if ok:
        try:
            j = r.json()
            details = j.get("details")
            totals = j.get("totals")
            src = j.get("_source", "?")
            if not isinstance(details, list):
                ok = False
                detail = f"details not list: {type(details).__name__}"
            elif not isinstance(totals, list):
                ok = False
                detail = f"totals not list: {type(totals).__name__}"
            elif j.get("ok") is not True:
                ok = False
                detail = f"ok != true: {json.dumps(j)[:200]}"
            else:
                detail = (f"ok=True details_len={len(details)} totals_len={len(totals)} "
                          f"_source={src}")
        except Exception as e:
            ok = False
            detail = f"json: {e}; body={r.text[:200]}"
    else:
        detail = f"HTTP {r.status_code}: {r.text[:300]}"
    _log("high-sale-detail (fis_id=1, valid auth)", ok, elapsed, detail)


def test_high_sale_detail_alternate_fis_ids(token, tenant_id):
    """Try fis_id=100 and a known live fis_id (14993774 from earlier high_sale test)."""
    for fid in (100, 14993774):
        r, elapsed = post("/data/high-sale-detail",
                          {"tenant_id": tenant_id, "fis_id": fid},
                          token=token, timeout=60)
        ok = r.status_code == 200
        detail = ""
        if ok:
            try:
                j = r.json()
                detail = (f"ok={j.get('ok')} details={len(j.get('details') or [])} "
                          f"totals={len(j.get('totals') or [])} src={j.get('_source')}")
                if j.get("ok") is not True:
                    ok = False
            except Exception as e:
                ok = False
                detail = f"json: {e}"
        else:
            detail = f"HTTP {r.status_code}: {r.text[:200]}"
        _log(f"high-sale-detail (fis_id={fid})", ok, elapsed, detail)


def test_high_sale_detail_no_auth(tenant_id):
    """Test #3 — POST /high-sale-detail without token -> 401/403."""
    r, elapsed = post("/data/high-sale-detail",
                      {"tenant_id": tenant_id, "fis_id": 1},
                      token=None, timeout=30)
    # FastAPI HTTPBearer default returns 403 when missing; review request says 401.
    # Accept either 401 or 403 as proper auth-rejection.
    ok = r.status_code in (401, 403)
    detail = f"HTTP {r.status_code}: {r.text[:200]}"
    _log("high-sale-detail (no token)", ok, elapsed, detail)


def test_high_sale_detail_missing_fis_id(token, tenant_id):
    """Test #4 — POST /high-sale-detail without fis_id -> 400."""
    r, elapsed = post("/data/high-sale-detail",
                      {"tenant_id": tenant_id},
                      token=token, timeout=30)
    ok = r.status_code == 400
    detail = f"HTTP {r.status_code}: {r.text[:300]}"
    _log("high-sale-detail (missing fis_id)", ok, elapsed, detail)


def test_high_sale_detail_missing_tenant(token):
    """Bonus — POST /high-sale-detail without tenant_id -> 400."""
    r, elapsed = post("/data/high-sale-detail",
                      {"fis_id": 1},
                      token=token, timeout=30)
    ok = r.status_code == 400
    detail = f"HTTP {r.status_code}: {r.text[:300]}"
    _log("high-sale-detail (missing tenant_id)", ok, elapsed, detail)


def test_fis_detail_regression(token, tenant_id):
    """Test #5 — Regression POST /fis-detail with fis_id=1 -> 200."""
    r, elapsed = post("/data/fis-detail",
                      {"tenant_id": tenant_id, "fis_id": 1},
                      token=token, timeout=60)
    ok = r.status_code == 200
    detail = ""
    if ok:
        try:
            j = r.json()
            detail = (f"ok={j.get('ok')} details={len(j.get('details') or [])} "
                      f"totals={len(j.get('totals') or [])} src={j.get('_source')}")
        except Exception as e:
            ok = False
            detail = f"json: {e}"
    else:
        detail = f"HTTP {r.status_code}: {r.text[:300]}"
    _log("REGRESSION fis-detail (fis_id=1)", ok, elapsed, detail)


def test_iptal_detail_regression(token, tenant_id):
    """Test #6 — Regression POST /iptal-detail with iptal_id=1 -> 200."""
    r, elapsed = post("/data/iptal-detail",
                      {"tenant_id": tenant_id, "iptal_id": 1},
                      token=token, timeout=60)
    ok = r.status_code == 200
    detail = ""
    if ok:
        try:
            j = r.json()
            detail = (f"ok={j.get('ok')} details={len(j.get('details') or [])} "
                      f"totals={len(j.get('totals') or [])} src={j.get('_source')}")
        except Exception as e:
            ok = False
            detail = f"json: {e}"
    else:
        detail = f"HTTP {r.status_code}: {r.text[:300]}"
    _log("REGRESSION iptal-detail (iptal_id=1)", ok, elapsed, detail)


def test_dashboard_regression(token, tenant_id):
    """Test #7 — Regression GET /dashboard?tenant_id=... -> 200."""
    r, elapsed = get("/data/dashboard",
                     {"tenant_id": tenant_id},
                     token=token, timeout=60)
    ok = r.status_code == 200
    detail = ""
    if ok:
        try:
            j = r.json()
            detail = f"keys={len(j.keys())} bytes={len(r.content)}"
        except Exception as e:
            ok = False
            detail = f"json: {e}"
    else:
        detail = f"HTTP {r.status_code}: {r.text[:300]}"
    _log("REGRESSION dashboard", ok, elapsed, detail)


def main():
    print(f"Base URL: {BASE_URL}")
    print(f"Login: {LOGIN_EMAIL}")
    print("=" * 130)

    token, tenants = login()
    if not token:
        print("LOGIN FAILED — aborting suite")
        return 2
    if not tenants:
        print("USER HAS NO TENANTS — cannot run tenant-scoped tests")
        return 2

    tenant_id = tenants[0].get("tenant_id")
    tenant_name = tenants[0].get("tenant_name") or tenants[0].get("name")
    print(f"Using tenant: {tenant_id}  ({tenant_name})")
    print(f"Tenants on user: {[t.get('tenant_id') for t in tenants]}")
    print("=" * 130)

    # Auth/validation tests first (don't need network upstream)
    test_high_sale_detail_no_auth(tenant_id)
    test_high_sale_detail_missing_fis_id(token, tenant_id)
    test_high_sale_detail_missing_tenant(token)

    # Happy path
    test_high_sale_detail_happy(token, tenant_id)
    test_high_sale_detail_alternate_fis_ids(token, tenant_id)

    # Regression
    test_fis_detail_regression(token, tenant_id)
    test_iptal_detail_regression(token, tenant_id)
    test_dashboard_regression(token, tenant_id)

    print("=" * 130)
    passed = sum(1 for r in RESULTS if r["ok"])
    failed = len(RESULTS) - passed
    print(f"PASS: {passed}/{len(RESULTS)}   FAIL: {failed}")
    if failed:
        print("\nFAILED TESTS:")
        for r in RESULTS:
            if not r["ok"]:
                print(f"  X  {r['name']}: {r['detail']}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
