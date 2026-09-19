"""
v18 backend tests — Barkodcu Cepte
- Login
- GET /api/sistem-durum (surum regression)
- GET /api/data/dashboard (single-day fast path)
- POST /api/data/hourly-detail (params_hash indexed rows cache)
- POST /api/data/hourly-detail-full (aggregated hourly)
- GET /api/data/gunluk-urun-satis (new endpoint)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"

TENANT_200K = "a6491c78291643e6b08e518e1de8e498"   # 200K-product tenant
TENANT_B9   = "b9f4d960e43f462d9b77915577add71a"
TENANT_MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Sürüm ----------
def test_sistem_durum_surum(headers):
    r = requests.get(f"{BASE_URL}/api/sistem-durum", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("surum") == "2026-09-19-v18-saatlik-indeks", f"got surum={j.get('surum')}"


# ---------- Dashboard single-day ----------
def test_dashboard_a6491_single_day(headers):
    t0 = time.time()
    r = requests.get(
        f"{BASE_URL}/api/data/dashboard",
        params={"tenant_id": TENANT_200K, "sdate": "2026-09-19", "edate": "2026-09-19"},
        headers=headers, timeout=30,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 8.0, f"dashboard took {elapsed:.2f}s (>8s)"
    j = r.json()
    for k in ("financial_data", "financial_data_location", "hourly_data",
              "top10_stock_movements", "iptal_detay", "last_week", "all_locations"):
        assert k in j, f"missing key: {k}"
    fdl = j["financial_data_location"]
    assert isinstance(fdl.get("data"), list) and len(fdl["data"]) == 1, f"financial_data_location rows={len(fdl.get('data') or [])}"
    assert (fdl["data"][0].get("LOKASYON") or "").upper() == "KARS", fdl["data"][0].get("LOKASYON")
    assert isinstance(j["hourly_data"].get("data"), list) and len(j["hourly_data"]["data"]) > 0
    top = j["top10_stock_movements"].get("data") or []
    assert len(top) == 10, f"top10 has {len(top)} rows"
    assert isinstance(j["iptal_detay"].get("data"), list)
    lw = j["last_week"]
    assert isinstance(lw, dict) and isinstance(lw.get("total"), (int, float))
    assert isinstance(j["all_locations"], list)


def test_dashboard_b9f4_geneltoplam(headers):
    r = requests.get(
        f"{BASE_URL}/api/data/dashboard",
        params={"tenant_id": TENANT_B9, "sdate": "2026-09-14", "edate": "2026-09-14"},
        headers=headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    fdl = j["financial_data_location"].get("data") or []
    assert fdl, "financial_data_location empty"
    gt = str(fdl[0].get("GENELTOPLAM"))
    assert gt == "27049.92", f"GENELTOPLAM={gt}"


# ---------- hourly-detail ----------
def test_hourly_detail_14(headers):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/data/hourly-detail",
        json={"tenant_id": TENANT_200K, "hour_label": "14:00 - 15:00",
              "lokasyon_id": None, "date": "2026-09-19"},
        headers=headers, timeout=30,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 6.0, f"hourly-detail took {elapsed:.2f}s"
    j = r.json()
    assert j.get("ok") is True
    data = j.get("data")
    assert isinstance(data, list) and len(data) > 0, "empty data"
    for row in data[:20]:
        assert (row.get("STOK_ADI") or "").strip(), f"missing STOK_ADI: {row}"
        assert "LOKASYON" in row
    src = j.get("_source")
    assert src == "cache", f"_source={src}"


def test_hourly_detail_10(headers):
    r = requests.post(
        f"{BASE_URL}/api/data/hourly-detail",
        json={"tenant_id": TENANT_200K, "hour_label": "10:00 - 11:00",
              "lokasyon_id": None, "date": "2026-09-19"},
        headers=headers, timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    assert j.get("ok") is True
    assert len(j.get("data") or []) > 0


# ---------- hourly-detail-full ----------
def test_hourly_detail_full(headers):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/data/hourly-detail-full",
        json={"tenant_id": TENANT_200K, "date": "2026-09-19"},
        headers=headers, timeout=30,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 12.0, f"hourly-detail-full took {elapsed:.2f}s"
    j = r.json()
    assert j.get("ok") is True
    by_hour = j.get("by_hour")
    assert isinstance(by_hour, dict) and len(by_hour) >= 5, f"by_hour keys={len(by_hour or {})}"
    assert (j.get("row_count") or 0) > 500, f"row_count={j.get('row_count')}"


# ---------- gunluk-urun-satis ----------
def test_gunluk_urun_satis_a6491(headers):
    t0 = time.time()
    r = requests.get(
        f"{BASE_URL}/api/data/gunluk-urun-satis",
        params={"tenant_id": TENANT_200K, "tarih": "2026-09-19"},
        headers=headers, timeout=30,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 8.0, f"gunluk-urun-satis took {elapsed:.2f}s"
    j = r.json()
    assert j.get("ok") is True
    assert (j.get("urun_sayisi") or 0) > 500, f"urun_sayisi={j.get('urun_sayisi')}"
    data = j.get("data") or []
    assert isinstance(data, list) and len(data) > 0
    # sort desc by MIKTAR — check first 20
    top20 = data[:20]
    for i in range(len(top20) - 1):
        assert top20[i]["MIKTAR"] >= top20[i + 1]["MIKTAR"], f"sort broken at i={i}"
    # per-item shape
    for u in top20:
        assert u.get("STOK_ADI"), f"missing STOK_ADI: {u}"
        assert isinstance(u.get("MIKTAR"), (int, float)), u
        assert isinstance(u.get("TUTAR"), (int, float)), u
        assert "BIRIM_ADI" in u
        assert "SAAT_SAYISI" in u
        assert isinstance(u.get("SAATLER"), list)
        assert isinstance(u.get("LOKASYONLAR"), list)
    # aggregates
    sum_miktar = round(sum(u["MIKTAR"] for u in data), 3)
    sum_tutar = sum(u["TUTAR"] for u in data)
    assert abs(sum_miktar - j["toplam_miktar"]) < 0.01, f"miktar mismatch {sum_miktar} vs {j['toplam_miktar']}"
    assert abs(sum_tutar - j["toplam_tutar"]) < 0.05, f"tutar mismatch {sum_tutar} vs {j['toplam_tutar']}"


def test_gunluk_urun_satis_b9f4_toplam_tutar(headers):
    r = requests.get(
        f"{BASE_URL}/api/data/gunluk-urun-satis",
        params={"tenant_id": TENANT_B9, "tarih": "2026-09-14"},
        headers=headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    tt = j.get("toplam_tutar") or 0
    assert abs(tt - 44607.92) <= 1.0, f"toplam_tutar={tt} (expected ~44607.92)"


def test_gunluk_urun_satis_invalid_tarih(headers):
    r = requests.get(
        f"{BASE_URL}/api/data/gunluk-urun-satis",
        params={"tenant_id": TENANT_200K, "tarih": "19-09-2026"},
        headers=headers, timeout=30,
    )
    assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text}"


def test_gunluk_urun_satis_merkez_empty(headers):
    r = requests.get(
        f"{BASE_URL}/api/data/gunluk-urun-satis",
        params={"tenant_id": TENANT_MERKEZ, "tarih": "2026-09-19"},
        headers=headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j.get("urun_sayisi") == 0, f"urun_sayisi={j.get('urun_sayisi')}"
    assert j.get("data") == []
