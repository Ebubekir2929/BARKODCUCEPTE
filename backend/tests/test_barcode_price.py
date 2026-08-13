"""Backend tests for POST /api/data/barcode-price (Barkoddan Fiyat Gör).

Feature: barcode -> product info + all price-name prices + stock qty.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://price-update-test.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

TENANT_ID = "d5587c87a7f9476fa82b83f40accd6c7"
KNOWN_BARKOD = "9990000000012"
UNKNOWN_BARKOD = "0000000000000"

LOGIN_EMAIL = "cakmak.ebubekir29@gmail.com"
LOGIN_PASSWORD = "1234567"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def token():
    """Login to obtain Bearer token."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=60,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    tok = data.get("token") or data.get("access_token") or (data.get("data") or {}).get("token")
    assert tok, f"no token in login response: {list(data.keys())}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Health regression ----------
def test_sistem_durum_healthy():
    """Regression: sistem-durum endpoint returns ok."""
    r = requests.get(f"{BASE_URL}/api/sistem-durum", timeout=60)
    assert r.status_code == 200, f"sistem-durum status: {r.status_code}"
    j = r.json()
    # tolerate different key names
    assert j.get("ok") in (True, None) or "status" in j or "mysql" in j, f"unexpected shape: {j}"


# ---------- Barcode-price feature tests ----------
def test_barcode_price_known(auth_headers):
    """Known barcode returns found=true with product + fiyatlar."""
    r = requests.post(
        f"{BASE_URL}/api/data/barcode-price",
        json={"tenant_id": TENANT_ID, "barkod": KNOWN_BARKOD},
        headers=auth_headers,
        timeout=90,
    )
    assert r.status_code == 200, f"status={r.status_code} body={r.text[:400]}"
    j = r.json()
    assert j.get("ok") is True
    assert j.get("found") is True, f"expected found=true, got: {j}"
    urun = j.get("urun") or {}
    assert urun.get("ad"), f"urun.ad missing: {urun}"
    # per problem statement, DENEME product
    assert "DENEME" in str(urun.get("ad", "")).upper(), f"expected DENEME in ad, got: {urun.get('ad')}"
    fiyatlar = j.get("fiyatlar") or []
    assert len(fiyatlar) >= 1, f"expected >=1 fiyat, got {fiyatlar}"
    for f in fiyatlar:
        assert f.get("fiyat_adi"), f"fiyat_adi missing: {f}"
        # numeric fiyat
        try:
            float(f.get("fiyat"))
        except (TypeError, ValueError):
            pytest.fail(f"non-numeric fiyat: {f}")


def test_barcode_price_unknown(auth_headers):
    """Unknown barcode returns found=false (no 500)."""
    r = requests.post(
        f"{BASE_URL}/api/data/barcode-price",
        json={"tenant_id": TENANT_ID, "barkod": UNKNOWN_BARKOD},
        headers=auth_headers,
        timeout=90,
    )
    assert r.status_code == 200, f"status={r.status_code} body={r.text[:400]}"
    j = r.json()
    assert j.get("ok") is True
    assert j.get("found") is False, f"expected found=false, got: {j}"


# ---------- Validation ----------
def test_barcode_price_missing_barkod(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/data/barcode-price",
        json={"tenant_id": TENANT_ID},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


def test_barcode_price_missing_tenant(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/data/barcode-price",
        json={"barkod": KNOWN_BARKOD},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


# ---------- Auth ----------
def test_barcode_price_requires_auth():
    """Request without Bearer token must be rejected."""
    r = requests.post(
        f"{BASE_URL}/api/data/barcode-price",
        json={"tenant_id": TENANT_ID, "barkod": KNOWN_BARKOD},
        timeout=30,
    )
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"
