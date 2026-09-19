"""v20 — Senkron teşhisi + yarım yükleme tamamlama uçları (200K ürünlü müşteri)."""
import os
import time
import pytest
import requests

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
EMAIL, PASS = "cakmak.ebubekir29@gmail.com", "1234567"
TENANT_200K = "a6491c78291643e6b08e518e1de8e498"
EXPECTED_SURUM_PREFIX = "2026-09-20-v20"


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


def test_surum_v20():
    r = requests.get(f"{BASE}/sistem-durum", timeout=30)
    assert r.status_code == 200
    assert r.json()["surum"].startswith(EXPECTED_SURUM_PREFIX)


def test_senkron_tani_hafif(auth):
    r = requests.get(f"{BASE}/data/senkron-tani", params={"tenant_id": TENANT_200K, "hafif": "true"}, headers=auth, timeout=120)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    for k in ("ust_kayit", "sayfalar", "son_loglar", "son_24s_islem_ozeti", "tamamlama_durumu"):
        assert k in j
    assert j["yarim_yuklemeler"] is None  # hafif modda ağır GROUP BY atlanır
    # 200K müşteri: stok listesi web tarafında tamamlandı → üst kayıt ve sayfalar dolu
    assert j["ust_kayit"] and j["ust_kayit"]["row_count"] > 100_000
    assert sum(s["satir"] for s in j["sayfalar"]) == j["ust_kayit"]["row_count"]


def test_tamamla_tenant_id_zorunlu(auth):
    r = requests.post(f"{BASE}/data/senkron-yarim-yukleme-tamamla", json={}, headers=auth, timeout=30)
    assert r.status_code == 400


def test_tamamla_yetkisiz():
    r = requests.post(f"{BASE}/data/senkron-yarim-yukleme-tamamla", json={"tenant_id": TENANT_200K}, timeout=30)
    assert r.status_code in (401, 403)


def test_stok_listesi_200k_akis(auth):
    r = requests.post(f"{BASE}/data/stock-list", json={"tenant_id": TENANT_200K, "page": 1, "page_size": 50}, headers=auth, timeout=120)
    assert r.status_code == 200
    j = r.json()
    assert j["_source"] == "mysql_stream"
    assert j["total_count"] > 100_000
    assert len(j["data"]) == 50
