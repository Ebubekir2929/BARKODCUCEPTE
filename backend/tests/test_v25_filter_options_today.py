"""v25 (1.0.58) — report-filter-options endpoint: LOKASYON (x2 -> fresh cache) + PERSONEL. Max 4 calls."""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORDS = ["1234567", "123456"]


@pytest.fixture(scope="module")
def auth():
    for pw in PASSWORDS:
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": pw}, timeout=60)
        if r.status_code == 200:
            js = r.json()
            user = js.get("user") or {}
            tenant = user.get("active_tenant_id") or user.get("tenant_id") or js.get("active_tenant_id")
            if not tenant:
                tenants = user.get("tenants") or js.get("tenants") or []
                if tenants:
                    t0 = tenants[0]
                    tenant = t0.get("tenant_id") or t0.get("id") if isinstance(t0, dict) else t0
            return {"h": {"Authorization": f"Bearer {js['access_token']}"}, "tenant": tenant or "d5587c87a7f9476fa82b83f40accd6c7"}
    pytest.skip("login failed")


def _call(auth, source):
    return requests.post(f"{BASE_URL}/api/data/report-filter-options", headers=auth["h"],
                         json={"tenant_id": auth["tenant"], "source": source}, timeout=90)


# Filter options — LOKASYON first + second call (cache fresh)
class TestFilterOptions:
    def test_lokasyon_first_and_cached(self, auth):
        r1 = _call(auth, "LOKASYON")
        assert r1.status_code == 200, r1.text[:300]
        j1 = r1.json()
        print("LOKASYON#1", {k: v for k, v in j1.items() if k != "data"}, "len", len(j1.get("data") or []))
        assert j1.get("ok") is True
        assert isinstance(j1.get("data"), list)
        assert len(j1["data"]) > 0, "LOKASYON empty for default tenant"
        r2 = _call(auth, "LOKASYON")
        assert r2.status_code == 200
        j2 = r2.json()
        print("LOKASYON#2", {k: v for k, v in j2.items() if k != "data"}, "len", len(j2.get("data") or []))
        assert j2.get("ok") is True
        assert j2.get("_cache") == "fresh", f"_cache={j2.get('_cache')}"

    def test_personel(self, auth):
        r = _call(auth, "PERSONEL")
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        print("PERSONEL", {k: v for k, v in j.items() if k != "data"}, "len", len(j.get("data") or []), (j.get("data") or [])[:2])
        assert j.get("ok") is True
        assert isinstance(j.get("data"), list)
