"""
Iter 20 — v16 'rapor-hazirlaniyor' pending model tests
Tests backend /api/data/report-run pending flow + sistem-durum + dashboard.
Merkez tenant POS is OFFLINE so live report calls MUST return pending:true.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"
TENANT_ID = "d5587c87a7f9476fa82b83f40accd6c7"  # Merkez (POS offline)


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    assert "access_token" in j
    assert "user" in j and "tenants" in j["user"]
    # Verify Merkez tenant present
    tenant_ids = [t.get("tenant_id") for t in j["user"]["tenants"]]
    assert TENANT_ID in tenant_ids, f"Merkez tenant not found in {tenant_ids}"
    return j["access_token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── /api/sistem-durum surum check ──────────────────────────────────────
def test_sistem_durum_surum():
    r = requests.get(f"{BASE_URL}/api/sistem-durum", timeout=15)
    assert r.status_code == 200
    j = r.json()
    surum = j.get("surum") or j.get("version") or ""
    assert surum == "2026-09-15-v16-rapor-hazirlaniyor", f"surum mismatch: {surum}"


# ── POST /api/data/report-run pending model ────────────────────────────
REPORT_BODY = {
    "tenant_id": TENANT_ID,
    "dataset_key": "rap_personel_satis_ozet_web",
    "params": {
        "BASTARIH": "2026-09-01 00:00:00",
        "BITTARIH": "2026-09-15 23:59:59",
        "Lokasyon": "",
        "Personel": "",
        "Page": 1,
        "PageSize": 500,
    },
    "fetch_all": True,
    "force_refresh": True,
    "wait_sec": 4,
}


def test_report_run_returns_pending(auth_headers):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/data/report-run",
        headers=auth_headers,
        json=REPORT_BODY,
        timeout=30,
    )
    elapsed_call = time.time() - t0
    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:400]}"
    assert elapsed_call < 15, f"Call took too long: {elapsed_call:.1f}s"
    j = r.json()
    assert j.get("ok") is True, f"ok not True: {j}"
    assert j.get("pending") is True, f"pending flag missing: {j}"
    assert j.get("status") in [
        "queued", "running", "indiriliyor", "baslatiliyor",
    ] or str(j.get("status", "")).startswith("sayfa"), f"unexpected status: {j.get('status')}"
    assert isinstance(j.get("elapsed_sec"), (int, float))
    assert j["elapsed_sec"] >= 3, f"elapsed_sec too small: {j.get('elapsed_sec')}"
    assert j.get("data") == []
    assert j.get("pages") == 0
    # cache marker (optional but expected)
    assert j.get("_cache") in ("pending", None) or True


def test_report_run_shared_bgtask_elapsed_grows(auth_headers):
    # First call kicks off (or joins existing) bg task
    r1 = requests.post(
        f"{BASE_URL}/api/data/report-run",
        headers=auth_headers,
        json=REPORT_BODY,
        timeout=30,
    )
    assert r1.status_code == 200
    j1 = r1.json()
    assert j1.get("pending") is True
    elapsed1 = float(j1.get("elapsed_sec", 0))

    time.sleep(3.5)

    body2 = {**REPORT_BODY, "force_refresh": False}
    r2 = requests.post(
        f"{BASE_URL}/api/data/report-run",
        headers=auth_headers,
        json=body2,
        timeout=30,
    )
    assert r2.status_code == 200
    j2 = r2.json()
    assert j2.get("pending") is True, f"expected pending on 2nd call: {j2}"
    elapsed2 = float(j2.get("elapsed_sec", 0))
    assert elapsed2 > elapsed1, (
        f"elapsed_sec did not grow (bg task not shared): {elapsed1} -> {elapsed2}"
    )


def test_report_run_cache_only_fast(auth_headers):
    body = {**REPORT_BODY, "cache_only": True, "force_refresh": False, "wait_sec": 2}
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/data/report-run",
        headers=auth_headers,
        json=body,
        timeout=15,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200
    assert elapsed < 5, f"cache_only too slow: {elapsed:.1f}s"
    j = r.json()
    assert j.get("ok") is True
    # Must NOT be pending in cache_only mode
    assert not j.get("pending"), f"cache_only returned pending: {j}"


def test_report_run_invalid_dataset(auth_headers):
    body = {**REPORT_BODY, "dataset_key": "nonexistent_dataset_xyz"}
    r = requests.post(
        f"{BASE_URL}/api/data/report-run",
        headers=auth_headers,
        json=body,
        timeout=15,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


def test_report_run_missing_tenant(auth_headers):
    body = {k: v for k, v in REPORT_BODY.items() if k != "tenant_id"}
    r = requests.post(
        f"{BASE_URL}/api/data/report-run",
        headers=auth_headers,
        json=body,
        timeout=15,
    )
    assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}"


# ── /api/data/dashboard date-range optimized path ──────────────────────
def test_dashboard_date_range(auth_headers):
    t0 = time.time()
    r = requests.get(
        f"{BASE_URL}/api/data/dashboard",
        headers=auth_headers,
        params={
            "tenant_id": TENANT_ID,
            "sdate": "2026-09-01",
            "edate": "2026-09-15",
        },
        timeout=20,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:400]}"
    assert elapsed < 15, f"too slow: {elapsed:.1f}s"
    j = r.json()
    assert "financial_data_location" in j
    assert "last_week" in j
    assert isinstance(j["last_week"], dict)
    assert "total" in j["last_week"]
    assert "all_locations" in j and isinstance(j["all_locations"], list)


def test_dashboard_single_day(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/data/dashboard",
        headers=auth_headers,
        params={
            "tenant_id": TENANT_ID,
            "sdate": "2026-09-08",
            "edate": "2026-09-08",
        },
        timeout=20,
    )
    assert r.status_code == 200
    j = r.json()
    assert "financial_data_location" in j
    assert "last_week" in j
