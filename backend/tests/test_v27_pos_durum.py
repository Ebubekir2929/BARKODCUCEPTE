# v27: Raporlar ekranı POS bağlantı uyarısı — GET /api/senkron/pos-durum
import os
import pytest
import requests

BASE_URL = (os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ['EXPO_BACKEND_URL']).rstrip('/')
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"
EMAIL, PWD = "cakmak.ebubekir29@gmail.com", "1234567"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PWD}, timeout=60)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    assert tok
    return tok


# Login
def test_login_returns_token(token):
    assert isinstance(token, str) and len(token) > 20


# pos-durum structure + kritik
def test_pos_durum_structure(token):
    r = requests.get(f"{BASE_URL}/api/senkron/pos-durum", params={"tenant_id": TENANT},
                     headers={"Authorization": f"Bearer {token}"}, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    d = j["data"]
    assert set(["aktif", "son_gorulme", "yas_sn", "durum"]).issubset(d.keys())
    assert isinstance(d["aktif"], bool)
    assert d["durum"] in ("iyi", "uyari", "kritik", "yok")
    print("pos-durum:", d)


def test_pos_durum_is_kritik(token):
    r = requests.get(f"{BASE_URL}/api/senkron/pos-durum", params={"tenant_id": TENANT},
                     headers={"Authorization": f"Bearer {token}"}, timeout=60)
    d = r.json()["data"]
    assert d["durum"] == "kritik"
    assert isinstance(d["yas_sn"], int) and d["yas_sn"] > 15 * 60
    assert d["son_gorulme"] and d["son_gorulme"].startswith("2026-10-31")


# Consistency with /senkron/saglik
def test_pos_durum_consistent_with_saglik(token):
    h = {"Authorization": f"Bearer {token}"}
    a = requests.get(f"{BASE_URL}/api/senkron/pos-durum", params={"tenant_id": TENANT}, headers=h, timeout=60).json()["data"]
    b = requests.get(f"{BASE_URL}/api/senkron/saglik", params={"tenant_id": TENANT}, headers=h, timeout=90).json()
    pos = b.get("pos") or b.get("data", {}).get("pos") or {}
    if not pos:
        pytest.skip("saglik pos block not found")
    assert pos.get("durum") == a["durum"]


# Auth required
def test_pos_durum_no_token():
    r = requests.get(f"{BASE_URL}/api/senkron/pos-durum", params={"tenant_id": TENANT}, timeout=30)
    assert r.status_code in (401, 403)


def test_pos_durum_bad_token():
    r = requests.get(f"{BASE_URL}/api/senkron/pos-durum", params={"tenant_id": TENANT},
                     headers={"Authorization": "Bearer invalid.token.x"}, timeout=30)
    assert r.status_code in (401, 403)


# Validation
def test_pos_durum_missing_tenant(token):
    r = requests.get(f"{BASE_URL}/api/senkron/pos-durum", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 422


def test_pos_durum_unknown_tenant(token):
    r = requests.get(f"{BASE_URL}/api/senkron/pos-durum", params={"tenant_id": "TEST_nonexistent"},
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code in (200, 403, 404)
    if r.status_code == 200:
        d = r.json()["data"]
        print("unknown tenant ->", d)
        assert d["durum"] == "yok" and d["aktif"] is False
