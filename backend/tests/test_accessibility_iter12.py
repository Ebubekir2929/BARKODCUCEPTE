"""
Iteration 12 — App Accessibility Regression Suite
User reported 'ŞUAN KASACEPTEYE ERİŞEMİYORUM' (cannot access app).
Verifies: root HTML loads, /api/auth/login, /api/islem/kaynak-liste (lokasyon_list).
Read-only tests — SAFE against live production ERP MySQL.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://price-update-test.preview.emergentagent.com").rstrip("/")
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"
TENANT_ID = "d5587c87a7f9476fa82b83f40accd6c7"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed status={r.status_code} body={r.text[:300]}"
    body = r.json()
    assert "access_token" in body and body["access_token"]
    return body["access_token"]


# --- app accessibility ---
class TestAccessibility:
    def test_root_loads_200(self, api):
        r = api.get(BASE_URL + "/", timeout=15)
        assert r.status_code == 200, f"root returned {r.status_code}"
        # Expo web bundle should mention Expo / html
        assert "<html" in r.text.lower() or "expo" in r.text.lower()


# --- auth ---
class TestAuth:
    def test_login_returns_token_and_user(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
        assert r.status_code == 200
        b = r.json()
        assert b.get("token_type") == "bearer"
        assert b["user"]["email"] == EMAIL
        # tenant present
        assert any(t["tenant_id"] == TENANT_ID for t in b["user"]["tenants"])
        assert b["license"]["is_valid"] is True


# --- islem kaynak-liste ---
class TestIslemKaynakListe:
    def test_lokasyon_list_ok_true(self, api, token):
        headers = {"Authorization": f"Bearer {token}"}
        r = api.get(
            f"{BASE_URL}/api/islem/kaynak-liste",
            params={"tenant_id": TENANT_ID, "key": "lokasyon_list"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200
        b = r.json()
        assert b.get("ok") is True
        assert "data" in b and isinstance(b["data"], list)
        assert b.get("kaynak") == "lokasyon_list"
