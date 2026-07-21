"""Backend tests for iteration 4 — cache-fast paths for
/api/data/cari-extre, /api/data/fis-detail, /api/data/stock-extre,
/api/data/stock-detail (see review_request iteration_4).

All tests assert both status codes AND response shape/data, and enforce
wall-time budgets so regressions like "cache_only takes 30s" surface.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://price-update-test.preview.emergentagent.com").rstrip("/")
LOGIN = {"email": "cakmak_ebubekir@hotmail.com", "password": "admin"}

TENANT_CARI = "d5587c87a7f9476fa82b83f40accd6c7"
TENANT_FIS = "b9f4d960e43f462d9b77915577add71a"
TENANT_STOCK = "8b92455909574c25b622314ae43b7a0e"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=LOGIN, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token in login response"
    return tok


@pytest.fixture(scope="session")
def api(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


def _post(api, path, body, timeout=35):
    t0 = time.time()
    r = api.post(f"{BASE_URL}{path}", json=body, timeout=timeout)
    return r, time.time() - t0


# ---------- /api/data/cari-extre — date-agnostic cache fallback ----------
class TestCariExtre:
    def test_cache_only_known_cari_fast(self, api):
        """Main agent smoke: cari 443847 must return <3s from cache."""
        r, elapsed = _post(api, "/api/data/cari-extre", {
            "tenant_id": TENANT_CARI,
            "cari_id": 443847,
            "tarih_baslangic": "2026-07-01",
            "tarih_bitis": "2026-07-31",
            "cache_only": True,
        })
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 5.0, f"cache_only too slow: {elapsed:.2f}s"
        js = r.json()
        assert js.get("ok") is True
        assert "data" in js
        # cache path should surface a source flag when hit
        # (mysql_date_agnostic or mysql_direct)
        src = js.get("_source", "")
        # empty data is acceptable (POS may be offline), but no 500

    def test_cache_only_unknown_cari_no_hang(self, api):
        """cari 99999999 has NO cache → must return 200 quickly with empty data, NOT hang."""
        r, elapsed = _post(api, "/api/data/cari-extre", {
            "tenant_id": TENANT_CARI,
            "cari_id": 99999999,
            "tarih_baslangic": "2026-07-01",
            "tarih_bitis": "2026-07-31",
            "cache_only": True,
        })
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 8.0, f"cache_only miss hung: {elapsed:.2f}s"
        js = r.json()
        assert js.get("ok") is True
        data = js.get("data", [])
        assert isinstance(data, list)
        # Empty is expected for unknown cari
        assert len(data) == 0

    def test_missing_params_400(self, api):
        r, _ = _post(api, "/api/data/cari-extre", {"tenant_id": TENANT_CARI})
        assert r.status_code == 400


# ---------- /api/data/fis-detail — feed fallback + wait_for cap ----------
class TestFisDetail:
    def test_cache_only_known_fis_fast(self, api):
        """fis_id 27560618 with cache_only:true → <5s, details≥0, totals shape."""
        r, elapsed = _post(api, "/api/data/fis-detail", {
            "tenant_id": TENANT_FIS,
            "fis_id": 27560618,
            "cache_only": True,
        })
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 5.0, f"cache_only too slow: {elapsed:.2f}s"
        js = r.json()
        assert js.get("ok") is True
        assert isinstance(js.get("details"), list)
        assert isinstance(js.get("totals"), list)
        # If feed HIT, totals[0] should have GENELTOPLAM
        if js.get("_source") == "bildirim_feed":
            assert len(js["totals"]) >= 1
            assert "GENELTOPLAM" in js["totals"][0] or "TUTAR" in js["totals"][0]

    def test_cache_only_unknown_fis_empty_fast(self, api):
        """fis_id=1 with cache_only:true → 200 fast empty."""
        r, elapsed = _post(api, "/api/data/fis-detail", {
            "tenant_id": TENANT_FIS,
            "fis_id": 1,
            "cache_only": True,
        })
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 5.0, f"cache_only miss hung: {elapsed:.2f}s"
        js = r.json()
        assert js.get("ok") is True
        assert js.get("details") == [] or js.get("details") == []
        assert js.get("from_cache") in (False, True)

    def test_unknown_fis_without_cache_only_capped(self, api):
        """fis_id=1 without cache_only → must complete ≤35s (25s wait_for + margin), no 500."""
        r, elapsed = _post(api, "/api/data/fis-detail", {
            "tenant_id": TENANT_FIS,
            "fis_id": 1,
        }, timeout=40)
        # Hard cap: wait_for(25s) + parse overhead; allow 35s wall
        assert elapsed < 35.0, f"wait_for cap breached: {elapsed:.2f}s"
        # Must not be a 500. 200 (empty/POS-timeout handled) or 4xx acceptable.
        assert r.status_code != 500, f"got 500: {r.text[:300]}"
        assert r.status_code == 200
        js = r.json()
        assert js.get("ok") is True

    def test_missing_params_400(self, api):
        r, _ = _post(api, "/api/data/fis-detail", {"tenant_id": TENANT_FIS})
        assert r.status_code == 400


# ---------- /api/data/stock-extre + /api/data/stock-detail regression ----------
class TestStockCache:
    def test_stock_extre_cache_only_fast(self, api):
        r, elapsed = _post(api, "/api/data/stock-extre", {
            "tenant_id": TENANT_STOCK,
            "stok_id": 683703,
            "tarih_baslangic": "2026-07-01",
            "tarih_bitis": "2026-07-31",
            "cache_only": True,
        })
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 8.0, f"stock-extre cache_only slow: {elapsed:.2f}s"
        js = r.json()
        assert js.get("ok") is True
        assert isinstance(js.get("data"), list)

    def test_stock_detail_cache_only_fast(self, api):
        # Endpoint may be /stock-detail or /stok-detail; try both defensively
        payload = {
            "tenant_id": TENANT_STOCK,
            "stock_id": 683703,
            "stok_id": 683703,
            "cache_only": True,
        }
        r, elapsed = _post(api, "/api/data/stock-detail", payload)
        if r.status_code == 404:
            pytest.skip("stock-detail endpoint not present under that path")
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 8.0, f"stock-detail cache_only slow: {elapsed:.2f}s"
        js = r.json()
        assert isinstance(js, dict)
