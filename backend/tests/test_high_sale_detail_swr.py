"""SWR high-sale-detail backend tests (iteration_3).

Covers:
- Missing fis_id → 400 with 'gerekli' message.
- Missing tenant_id → 400.
- Cache-only POST /api/data/high-sale-detail → fast (<10s), valid JSON shape {ok, details:[], totals:[]}.
- allow_fetch=true → 200 within ~30s (hard 25s wait_for cap + cache steps),
  NOT ~60s, NOT 500.
- Regression: /api/data/iptal-detail cache-only still 200 fast.
"""
import os
import time
import pytest
import requests

# ---------- config ----------
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

LOGIN_EMAIL = "cakmak_ebubekir@hotmail.com"
LOGIN_PASSWORD = "admin"

TENANT_MAIN = "eecd5678f55d4db88e15230d70718a02"
TENANT_ALT = "d5587c87a7f9476fa82b83f40accd6c7"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    tok = j.get("token") or j.get("access_token") or j.get("access")
    assert tok, f"no token in login response: {j}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def real_fis_id(auth_headers):
    """Best effort: find a real FIS_ID from fis_gunluk_bildirim_feed.

    We try /api/data/fis-gunluk-bildirim-feed with tenant_id — endpoint may
    or may not exist. If not, fall back to 999999.
    """
    for ep in ("/api/data/fis-gunluk-bildirim-feed", "/api/data/fis-gunluk-feed",
               "/api/data/notifications-feed"):
        try:
            r = requests.post(
                f"{BASE_URL}{ep}",
                headers=auth_headers,
                json={"tenant_id": TENANT_MAIN},
                timeout=15,
            )
            if r.status_code == 200:
                j = r.json()
                rows = j.get("data") if isinstance(j, dict) else None
                if isinstance(rows, list) and rows:
                    for row in rows:
                        if isinstance(row, dict) and row.get("FIS_ID"):
                            print(f"[fixture] found real FIS_ID={row.get('FIS_ID')}")
                            return int(row["FIS_ID"])
        except Exception as e:
            print(f"[fixture] {ep} lookup failed: {e}")
    print("[fixture] no real fis_id found; using fallback 999999")
    return 999999


# ---------- high-sale-detail SWR ----------

class TestHighSaleDetailSWR:
    def test_missing_fis_id_returns_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/data/high-sale-detail",
            headers=auth_headers,
            json={"tenant_id": TENANT_MAIN},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} body={r.text[:200]}"
        detail = r.json().get("detail", "")
        assert "gerekli" in detail.lower(), f"unexpected error detail: {detail}"
        assert "fis_id" in detail.lower() or "tenant_id" in detail.lower()

    def test_missing_tenant_id_returns_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/data/high-sale-detail",
            headers=auth_headers,
            json={"fis_id": 999999},
            timeout=10,
        )
        assert r.status_code == 400

    def test_cache_only_fast_response(self, auth_headers, real_fis_id):
        """SWR step 1: no allow_fetch → cache-only, must return quickly."""
        t0 = time.time()
        r = requests.post(
            f"{BASE_URL}/api/data/high-sale-detail",
            headers=auth_headers,
            json={"tenant_id": TENANT_MAIN, "fis_id": real_fis_id},
            timeout=15,
        )
        elapsed = time.time() - t0
        print(f"[cache-only] elapsed={elapsed:.2f}s fis_id={real_fis_id}")
        assert r.status_code == 200, f"expected 200, got {r.status_code} body={r.text[:300]}"
        j = r.json()
        assert isinstance(j, dict), "response must be dict"
        assert j.get("ok") is True, f"ok flag missing/false: {j}"
        assert "details" in j, f"missing 'details' key: {list(j.keys())}"
        assert isinstance(j["details"], list), "details must be list"
        assert "totals" in j, f"missing 'totals' key: {list(j.keys())}"
        assert isinstance(j["totals"], list), "totals must be list"
        # Cache-only must be fast (<3s per spec, allow 10s for cold ingress)
        assert elapsed < 10.0, f"cache-only took {elapsed:.2f}s (expected <10s)"

    def test_allow_fetch_bounded_wall_time(self, auth_headers, real_fis_id):
        """SWR step 2: allow_fetch=true → 200 within ~30s max.

        Backend uses asyncio.wait_for(..., timeout=25). We allow 40s total
        (cache-only step + wait_for(25s) + ingress). If it hits ~60s that is
        a REGRESSION vs iteration_2 iptal-detail behaviour we asked E1 to fix.
        """
        t0 = time.time()
        r = requests.post(
            f"{BASE_URL}/api/data/high-sale-detail",
            headers=auth_headers,
            json={
                "tenant_id": TENANT_MAIN,
                "fis_id": real_fis_id,
                "allow_fetch": True,
            },
            timeout=60,
        )
        elapsed = time.time() - t0
        print(f"[allow_fetch] elapsed={elapsed:.2f}s status={r.status_code}")
        assert r.status_code == 200, f"expected 200, got {r.status_code} body={r.text[:300]}"
        j = r.json()
        assert isinstance(j, dict)
        assert j.get("ok") is True
        assert isinstance(j.get("details"), list)
        assert isinstance(j.get("totals"), list)
        # HARD REQUIREMENT per problem statement: must NOT run ~60s
        assert elapsed < 45.0, (
            f"allow_fetch took {elapsed:.2f}s — spec says hard 25s wait_for cap "
            f"→ should be <30s, must not be ~60s"
        )
        if elapsed > 30.0:
            print(f"[allow_fetch] WARN: took {elapsed:.2f}s (>30s target)")

    def test_cache_only_alt_tenant_no_500(self, auth_headers):
        """Regression: alt tenant / synthetic fis_id must not 500."""
        r = requests.post(
            f"{BASE_URL}/api/data/high-sale-detail",
            headers=auth_headers,
            json={"tenant_id": TENANT_ALT, "fis_id": 999999},
            timeout=15,
        )
        assert r.status_code != 500, f"5xx response: {r.status_code} {r.text[:200]}"
        if r.status_code == 200:
            j = r.json()
            assert isinstance(j.get("details"), list)
            assert isinstance(j.get("totals"), list)


# ---------- regression: iptal-detail still works (iteration_2) ----------

class TestIptalDetailRegression:
    def test_iptal_detail_cache_only_fast(self, auth_headers):
        t0 = time.time()
        r = requests.post(
            f"{BASE_URL}/api/data/iptal-detail",
            headers=auth_headers,
            json={"tenant_id": TENANT_MAIN, "iptal_id": 1},
            timeout=15,
        )
        elapsed = time.time() - t0
        print(f"[iptal-detail cache-only] elapsed={elapsed:.2f}s")
        assert r.status_code == 200, f"expected 200, got {r.status_code}"
        j = r.json()
        assert isinstance(j.get("data"), list)
        assert isinstance(j.get("header"), dict)
        assert elapsed < 10.0, f"iptal-detail cache-only took {elapsed:.2f}s (expected <10s)"
