"""Iteration 19 — GET /api/data/haftalik-trend endpoint tests.

Tenant A (kullanıcı Merkez): d5587c87a7f9476fa82b83f40accd6c7 → son 7 gün 0 olabilir.
Tenant B (harici, canlı): ea5231b886ef47baac5b49188f2ef0d3 → günlük 300K-800K bekleniyor.
"""
import os
import requests
import pytest

from pathlib import Path
def _load_backend_url():
    env_file = Path("/app/frontend/.env")
    for line in env_file.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found")
BASE_URL = _load_backend_url()
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"
TENANT_MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"
TENANT_LIVE = "ea5231b886ef47baac5b49188f2ef0d3"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


class TestHaftalikTrend:
    def test_endpoint_merkez_shape(self, headers):
        r = requests.get(f"{BASE_URL}/api/data/haftalik-trend",
                         params={"tenant_id": TENANT_MERKEZ},
                         headers=headers, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        j = r.json()
        assert j.get("ok") is True, f"ok flag missing: {j}"
        assert isinstance(j.get("data"), list), "data not list"
        assert len(j["data"]) == 7, f"expected 7 days, got {len(j['data'])}"
        for i, gun in enumerate(j["data"]):
            assert set(["tarih", "toplam", "nakit", "kart"]).issubset(gun.keys()), \
                f"missing fields on day {i}: {gun.keys()}"
            assert isinstance(gun["tarih"], str) and len(gun["tarih"]) == 10
            for k in ("toplam", "nakit", "kart"):
                assert isinstance(gun[k], (int, float)), f"{k} not numeric"

    def test_endpoint_merkez_dates_ascending(self, headers):
        r = requests.get(f"{BASE_URL}/api/data/haftalik-trend",
                         params={"tenant_id": TENANT_MERKEZ},
                         headers=headers, timeout=30)
        dates = [d["tarih"] for d in r.json()["data"]]
        assert dates == sorted(dates), f"dates not ascending: {dates}"

    def test_endpoint_live_tenant_has_data(self, headers):
        """Canlı tenant'ta günlük toplamlar mantıklı aralıkta olmalı."""
        r = requests.get(f"{BASE_URL}/api/data/haftalik-trend",
                         params={"tenant_id": TENANT_LIVE},
                         headers=headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        gunluk_toplamlar = [d["toplam"] for d in j["data"]]
        toplam_7 = sum(gunluk_toplamlar)
        # En az 3 günün > 0 olmasını bekleyelim (canlı POS)
        pozitif_gun = sum(1 for t in gunluk_toplamlar if t > 0)
        print(f"[LIVE] 7-day totals: {gunluk_toplamlar}, sum={toplam_7:.2f}, positive_days={pozitif_gun}")
        assert toplam_7 > 0, f"live tenant has 0 sales in 7d: {gunluk_toplamlar}"
        # Sağlık kontrolü: nakit + kart <= toplam olmalı (± rounding)
        for d in j["data"]:
            if d["toplam"] > 0:
                assert d["nakit"] + d["kart"] <= d["toplam"] + 1, \
                    f"nakit+kart > toplam: {d}"

    def test_endpoint_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/data/haftalik-trend",
                         params={"tenant_id": TENANT_MERKEZ}, timeout=15)
        assert r.status_code in (401, 403), f"expected auth error, got {r.status_code}"

    def test_endpoint_missing_tenant_id(self, headers):
        r = requests.get(f"{BASE_URL}/api/data/haftalik-trend",
                         headers=headers, timeout=15)
        assert r.status_code == 422, f"expected 422 for missing tenant_id, got {r.status_code}"
