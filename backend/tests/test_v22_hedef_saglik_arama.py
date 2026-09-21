"""v22 — Hedef Takibi, Senkron Sağlığı, Hızlı Arama indeks uçları."""
import os
import time
import pytest
import requests

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
EMAIL, PASS = "cakmak.ebubekir29@gmail.com", "1234567"
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"      # Merkez (küçük)
TENANT_200K = "a6491c78291643e6b08e518e1de8e498"  # büyük stok listesi


@pytest.fixture(scope="module")
def auth():
    for _ in range(6):
        try:
            r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASS}, timeout=60)
            if r.status_code == 200:
                return {"Authorization": f"Bearer {r.json()['access_token']}"}
        except requests.RequestException:
            pass
        time.sleep(10)
    pytest.skip("DB dalgalanması — login olunamadı")


def test_surum_v22():
    r = requests.get(f"{BASE}/sistem-durum", timeout=30)
    assert r.json()["surum"].startswith("2026-09-22-v22")


def test_hedef_kaydet_ve_oku(auth):
    r = requests.put(f"{BASE}/hedef", json={"tenant_id": TENANT, "hedef": 250000}, headers=auth, timeout=60)
    assert r.status_code == 200 and r.json()["ok"]
    r = requests.get(f"{BASE}/hedef", params={"tenant_id": TENANT}, headers=auth, timeout=60)
    d = r.json()["data"]
    assert d["hedef"] == 250000.0
    assert d["kaynak_ay"] is None
    assert d["ay_gun"] >= 28 and d["gecen_gun"] + d["kalan_gun"] == d["ay_gun"]
    assert d["oran"] is not None and d["durum"] in ("tamamlandi", "onde", "geride")
    assert 0 <= d["beklenen_oran"] <= 100


def test_hedef_gelecek_ay_devralinir(auth):
    r = requests.get(f"{BASE}/hedef", params={"tenant_id": TENANT, "ay": "2027-01"}, headers=auth, timeout=60)
    d = r.json()["data"]
    assert d["hedef"] == 250000.0 and d["kaynak_ay"] is not None  # devralındı
    assert d["gecen_gun"] == 0 and d["kalan_gun"] == 31


def test_hedef_gecersiz(auth):
    assert requests.get(f"{BASE}/hedef", params={"tenant_id": TENANT, "ay": "2026-13"}, headers=auth, timeout=30).status_code == 422
    assert requests.put(f"{BASE}/hedef", json={"tenant_id": TENANT, "hedef": -5}, headers=auth, timeout=30).status_code == 422
    assert requests.get(f"{BASE}/hedef", params={"tenant_id": TENANT}, timeout=30).status_code in (401, 403)


def test_hedef_gecmis(auth):
    r = requests.get(f"{BASE}/hedef/gecmis", params={"tenant_id": TENANT}, headers=auth, timeout=120)
    d = r.json()["data"]
    assert len(d) == 6 and all("gerceklesen" in x and "hedef" in x for x in d)


def test_senkron_saglik(auth):
    r = requests.get(f"{BASE}/senkron/saglik", params={"tenant_id": TENANT}, headers=auth, timeout=120)
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["genel"] in ("iyi", "uyari", "kritik")
    assert d["pos"]["durum"] in ("iyi", "uyari", "kritik", "yok")
    assert len(d["veri_setleri"]) == 6 and all(v["durum"] in ("iyi", "uyari", "kritik", "yok") for v in d["veri_setleri"])
    assert "sayi" in d["hatalar"] and "sayi" in d["bekleyen_istekler"]
    assert isinstance(d["yarim_yuklemeler"], list)


def test_stok_arama_durum(auth):
    r = requests.get(f"{BASE}/data/stok-arama-durum", params={"tenant_id": TENANT_200K}, headers=auth, timeout=60)
    assert r.status_code == 200
    j = r.json()
    assert j["durum"]["asama"] in ("kuruluyor", "hazir", "eksik", "yok", "hata")
    assert isinstance(j["hazir"], bool)


def test_stok_arama_kucuk_tenant_ram_yolu(auth):
    r = requests.post(f"{BASE}/data/stock-list", json={"tenant_id": TENANT, "page": 1, "page_size": 10, "search": "a"}, headers=auth, timeout=120)
    assert r.status_code == 200 and r.json()["_source"] != "mysql_index"
