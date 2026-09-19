"""Iteration 23 — v19 acceptance tests.

Covers:
  * GET  /api/data/gunluk-urun-detay       (hourly + receipts for one product/day)
  * GET  /api/data/haftalik-urun-trend     (7-day per-product breakdown)
  * POST /api/data/stock-list              (mysql_stream path for >25K rows)
  * GET  /api/sistem-durum                 (surum string)
  * GET  /api/data/gunluk-urun-satis       (v18 regression)
"""
import math
import time
from pathlib import Path

import pytest
import requests


def _load_backend_url():
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found")


BASE_URL = _load_backend_url()
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"
TENANT_MERKEZ = "b9f4d960e43f462d9b77915577add71a"
TENANT_LIVE = "ea5231b886ef47baac5b49188f2ef0d3"
TARIH = "2026-09-14"
STOK_ID = "27210514"
STOK_ADI = "GALETA"
EXPECTED_SURUM = "2026-09-20-v20-baslik-buyuk-isim"


def _request_with_retry(method: str, url: str, **kw):
    """DB is intermittent — retry once after 20s on timeout/5xx."""
    kw.setdefault("timeout", 45)
    for attempt in range(2):
        try:
            r = requests.request(method, url, **kw)
            if r.status_code < 500:
                return r
            if attempt == 0:
                time.sleep(20)
                continue
            return r
        except requests.exceptions.RequestException:
            if attempt == 0:
                time.sleep(20)
                continue
            raise
    return r  # pragma: no cover


@pytest.fixture(scope="module")
def token():
    r = _request_with_retry("POST", f"{BASE_URL}/api/auth/login",
                            json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ============================================================
# 1) /api/sistem-durum — surum sanity
# ============================================================
class TestSistemDurum:
    def test_surum_matches_v19(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/sistem-durum", headers=headers)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j.get("surum") == EXPECTED_SURUM, f"surum mismatch: {j.get('surum')}"


# ============================================================
# 2) /api/data/gunluk-urun-detay (v19)
# ============================================================
class TestGunlukUrunDetay:
    def test_happy_path_galeta(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/data/gunluk-urun-detay",
                                params={"tenant_id": TENANT_MERKEZ, "tarih": TARIH,
                                        "stok_id": STOK_ID, "stok_adi": STOK_ADI},
                                headers=headers, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        j = r.json()
        assert j.get("ok") is True
        assert j.get("STOK_ADI") == "GALETA", f"STOK_ADI mismatch: {j.get('STOK_ADI')}"
        assert j.get("toplam_miktar") == 18, f"toplam_miktar mismatch: {j.get('toplam_miktar')}"

        saatler = j.get("saatler") or []
        assert isinstance(saatler, list) and len(saatler) == 7, \
            f"saatler length expected 7, got {len(saatler)}"
        for s in saatler:
            assert isinstance(s.get("SAAT"), str) and len(s["SAAT"]) == 5 and s["SAAT"][2] == ":", \
                f"bad SAAT format: {s.get('SAAT')}"
            assert isinstance(s.get("MIKTAR"), (int, float))
            assert isinstance(s.get("TUTAR"), (int, float))

        fisler = j.get("fisler") or []
        assert isinstance(fisler, list)
        assert 10 <= len(fisler) <= 20, f"fisler length ~14 expected, got {len(fisler)}"
        for f in fisler:
            for k in ("FIS_ID", "FIS_TARIHI", "URUN_MIKTAR", "URUN_TUTAR"):
                assert k in f, f"missing {k} in fis: {f}"

    def test_missing_stok_id_and_adi_returns_400(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/data/gunluk-urun-detay",
                                params={"tenant_id": TENANT_MERKEZ, "tarih": TARIH},
                                headers=headers)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_bad_tarih_returns_422(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/data/gunluk-urun-detay",
                                params={"tenant_id": TENANT_MERKEZ, "tarih": "14-09-2026",
                                        "stok_adi": STOK_ADI},
                                headers=headers)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:200]}"


# ============================================================
# 3) /api/data/haftalik-urun-trend (v19)
# ============================================================
class TestHaftalikUrunTrend:
    def test_happy_path_merkez_limit5(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/data/haftalik-urun-trend",
                                params={"tenant_id": TENANT_MERKEZ, "bitis": TARIH, "limit": 5},
                                headers=headers, timeout=90)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        j = r.json()
        assert j.get("ok") is True

        gunler = j.get("gunler") or []
        assert len(gunler) == 7, f"gunler len {len(gunler)}"
        assert gunler[-1] == TARIH, f"last gun should be {TARIH}, got {gunler[-1]}"
        for g in gunler:
            assert isinstance(g, str) and len(g) == 10

        gt = j.get("gun_toplamlari") or []
        assert isinstance(gt, list) and len(gt) == 7
        for v in gt:
            assert isinstance(v, (int, float))

        data = j.get("data") or []
        assert isinstance(data, list) and len(data) == 5, f"data length {len(data)}"

        # sorted by TOPLAM desc
        toplams = [d["TOPLAM"] for d in data]
        assert toplams == sorted(toplams, reverse=True), f"data not sorted desc: {toplams}"

        for item in data:
            gunluk = item.get("GUNLUK") or []
            assert isinstance(gunluk, list) and len(gunluk) == 7
            for v in gunluk:
                assert isinstance(v, (int, float))
            assert isinstance(item.get("TOPLAM"), (int, float))
            assert isinstance(item.get("TUTAR"), (int, float))
            assert isinstance(item.get("GUN_ORT"), (int, float))
            ivme = item.get("IVME_YUZDE")
            assert ivme is None or isinstance(ivme, (int, float)), f"IVME_YUZDE bad: {ivme}"

        # first item GALETA TOPLAM 77
        assert data[0]["STOK_ADI"] == "GALETA", f"top1 STOK_ADI: {data[0]['STOK_ADI']}"
        assert data[0]["TOPLAM"] == 77, f"top1 TOPLAM: {data[0]['TOPLAM']}"

    def test_limit_zero_returns_422(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/data/haftalik-urun-trend",
                                params={"tenant_id": TENANT_MERKEZ, "bitis": TARIH, "limit": 0},
                                headers=headers)
        assert r.status_code == 422, f"expected 422, got {r.status_code}"


# ============================================================
# 4) /api/data/stock-list — mysql_stream path (v19)
# ============================================================
class TestStockListStream:
    def test_large_tenant_stream_page2(self, headers):
        t0 = time.perf_counter()
        r = _request_with_retry("POST", f"{BASE_URL}/api/data/stock-list",
                                json={"tenant_id": TENANT_LIVE, "page": 2, "page_size": 50},
                                headers=headers, timeout=30)
        elapsed = time.perf_counter() - t0
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert elapsed < 15, f"took {elapsed:.2f}s (>15s)"
        j = r.json()
        assert j.get("_source") == "mysql_stream", f"_source={j.get('_source')}"
        data = j.get("data") or []
        assert len(data) == 50, f"data len {len(data)}"
        assert j.get("total_count", 0) > 25000, f"total_count={j.get('total_count')}"
        expected_pages = math.ceil(j["total_count"] / 50)
        assert j.get("total_pages") == expected_pages, \
            f"total_pages {j.get('total_pages')} != expected {expected_pages}"

    def test_large_tenant_stream_with_search(self, headers):
        r = _request_with_retry("POST", f"{BASE_URL}/api/data/stock-list",
                                json={"tenant_id": TENANT_LIVE, "page": 1, "page_size": 50,
                                      "search": "3"},
                                headers=headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j.get("_source") == "mysql_stream", f"_source={j.get('_source')}"
        data = j.get("data") or []
        assert len(data) > 0, "expected non-empty data with search='3'"
        assert j.get("total_count", 0) > 0
        for row in data:
            hay = " ".join(str(v) for v in row.values() if v is not None)
            assert "3" in hay, f"row has no '3': {row}"

    def test_small_tenant_regression(self, headers):
        r = _request_with_retry("POST", f"{BASE_URL}/api/data/stock-list",
                                json={"tenant_id": TENANT_MERKEZ, "page": 1, "page_size": 20},
                                headers=headers, timeout=45)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        j = r.json()
        assert j.get("ok") in (True, None), f"ok flag: {j.get('ok')}"
        assert isinstance(j.get("data"), list), "data not list"


# ============================================================
# 5) v18 regression — gunluk-urun-satis
# ============================================================
class TestGunlukUrunSatisRegression:
    def test_merkez_2026_09_14(self, headers):
        r = _request_with_retry("GET", f"{BASE_URL}/api/data/gunluk-urun-satis",
                                params={"tenant_id": TENANT_MERKEZ, "tarih": TARIH},
                                headers=headers, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        j = r.json()
        assert j.get("urun_sayisi") == 130, f"urun_sayisi={j.get('urun_sayisi')}"
