"""Backend tests for iteration 8 — Mobil Finans İşlem Kuyruğu (Phase 1).

Endpoints covered:
  GET  /api/islem/turler
  GET  /api/islem/kasalar?tenant_id=...
  POST /api/islem/create
  GET  /api/islem/list?tenant_id=...
  POST /api/islem/kasa-ekle

Focus (per main-agent review_request):
  - Direction reversal: type 2 (Nakit Ödeme, C->K) vs type 1 (Nakit Tahsilat, K->C)
  - 400 error paths (missing vade, tutar<=0, invalid type)
  - Çek record (type 21) with vade/cek_no persisted
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://price-update-test.preview.emergentagent.com").rstrip("/")
LOGIN = {"email": "cakmak_ebubekir@hotmail.com", "password": "admin"}
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=LOGIN, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token"
    return tok


@pytest.fixture(scope="session")
def api(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


# ---------------------- catalog endpoints ----------------------
class TestCatalog:
    def test_turler_returns_9(self, api):
        r = api.get(f"{BASE_URL}/api/islem/turler", timeout=15)
        assert r.status_code == 200, r.text[:200]
        js = r.json()
        assert js["ok"] is True
        turler = js.get("turler", [])
        assert isinstance(turler, list) and len(turler) == 9, f"expected 9 turler, got {len(turler)}"
        kods = {t["kod"] for t in turler}
        assert kods == {1, 2, 7, 8, 15, 17, 21, 31, 35}, f"unexpected kods: {kods}"
        # Direction sanity from catalog
        by_kod = {t["kod"]: t for t in turler}
        assert by_kod[1]["borclu"] == "kasa" and by_kod[1]["alacakli"] == "cari"
        assert by_kod[2]["borclu"] == "cari" and by_kod[2]["alacakli"] == "kasa"
        assert by_kod[21]["cek_senet"] is True

    def test_kasalar_returns_seeded_5(self, api):
        r = api.get(f"{BASE_URL}/api/islem/kasalar", params={"tenant_id": TENANT}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        js = r.json()
        assert js["ok"] is True
        data = js.get("data", [])
        assert isinstance(data, list) and len(data) >= 5, f"expected ≥5 kasa, got {len(data)}"
        kart_ids = {row["kart_id"] for row in data}
        assert 75923 in kart_ids, f"seed kart 75923 (Merkez Kasa) missing: {kart_ids}"


# ---------------------- create + direction verification ----------------------
class TestCreateDirection:
    def test_type2_reversed_direction(self, api):
        """Type 2 Nakit Ödeme: borclu=cari, alacakli=kasa (REVERSED vs type 1)."""
        payload = {
            "tenant_id": TENANT,
            "islem_turu": 2,
            "cari_id": 438745,
            "cari_ad": "TEST_iter8_cari",
            "kasa_id": 75923,
            "kasa_ad": "Merkez",
            "tutar": 25.75,
            "aciklama": "TEST_pytest_type2",
        }
        r = api.post(f"{BASE_URL}/api/islem/create", json=payload, timeout=15)
        assert r.status_code == 200, r.text[:200]
        js = r.json()
        assert js["ok"] is True
        assert "id" in js and isinstance(js["id"], int) and js["id"] > 0
        assert js.get("durum") == "bekliyor"
        created_id = js["id"]

        # Verify persistence + direction via GET /list
        r2 = api.get(f"{BASE_URL}/api/islem/list", params={"tenant_id": TENANT, "limit": 50}, timeout=15)
        assert r2.status_code == 200, r2.text[:200]
        rows = r2.json().get("data", [])
        row = next((x for x in rows if x["id"] == created_id), None)
        assert row is not None, f"created id {created_id} not found in list"
        assert row["islem_turu"] == 2
        assert row["kart_borclu_ad"] == "TEST_iter8_cari", (
            f"type 2 borclu must be CARI, got {row['kart_borclu_ad']}"
        )
        assert row["kart_alacakli_ad"] == "Merkez", (
            f"type 2 alacakli must be KASA, got {row['kart_alacakli_ad']}"
        )
        assert float(row["tutar"]) == 25.75
        assert row["durum"] == "bekliyor"

    def test_type1_original_direction_regression(self, api):
        """Type 1 Nakit Tahsilat: borclu=kasa, alacakli=cari (baseline)."""
        payload = {
            "tenant_id": TENANT,
            "islem_turu": 1,
            "cari_id": 438745,
            "cari_ad": "TEST_iter8_cari_t1",
            "kasa_id": 75923,
            "kasa_ad": "MerkezT1",
            "tutar": 10.00,
            "aciklama": "TEST_pytest_type1",
        }
        r = api.post(f"{BASE_URL}/api/islem/create", json=payload, timeout=15)
        assert r.status_code == 200, r.text[:200]
        created_id = r.json()["id"]
        r2 = api.get(f"{BASE_URL}/api/islem/list", params={"tenant_id": TENANT, "limit": 50}, timeout=15)
        row = next((x for x in r2.json()["data"] if x["id"] == created_id), None)
        assert row is not None
        assert row["kart_borclu_ad"] == "MerkezT1", "type 1 borclu must be KASA"
        assert row["kart_alacakli_ad"] == "TEST_iter8_cari_t1", "type 1 alacakli must be CARI"


# ---------------------- 400 validation paths ----------------------
class TestValidation:
    def test_cek_missing_vade_400(self, api):
        """Type 21 (Çek Girişi) without vade_tarihi must return 400."""
        payload = {
            "tenant_id": TENANT, "islem_turu": 21,
            "cari_id": 438745, "cari_ad": "TEST", "kasa_id": 75923, "kasa_ad": "Merkez",
            "tutar": 100.0,
        }
        r = api.post(f"{BASE_URL}/api/islem/create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "vade" in detail, f"detail should mention vade, got: {detail}"

    def test_tutar_zero_400(self, api):
        payload = {
            "tenant_id": TENANT, "islem_turu": 1,
            "cari_id": 438745, "cari_ad": "TEST", "kasa_id": 75923, "kasa_ad": "M",
            "tutar": 0.0,
        }
        r = api.post(f"{BASE_URL}/api/islem/create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_invalid_type_400(self, api):
        payload = {
            "tenant_id": TENANT, "islem_turu": 999,
            "cari_id": 438745, "cari_ad": "T", "kasa_id": 75923, "kasa_ad": "M",
            "tutar": 10.0,
        }
        r = api.post(f"{BASE_URL}/api/islem/create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


# ---------------------- Çek record persistence ----------------------
class TestCekRecord:
    def test_cek_full_record(self, api):
        """Type 21 with full vade/cek_no/vergi_no must persist and reflect in list."""
        payload = {
            "tenant_id": TENANT,
            "islem_turu": 21,
            "cari_id": 438745,
            "cari_ad": "TEST_cek_cari",
            "kasa_id": 75923,
            "kasa_ad": "Merkez",
            "tutar": 500.00,
            "aciklama": "TEST_pytest_cek",
            "vade_tarihi": "2026-08-15",
            "cek_no": "CK123",
            "vergi_no": "1234567890",
        }
        r = api.post(f"{BASE_URL}/api/islem/create", json=payload, timeout=15)
        assert r.status_code == 200, r.text[:200]
        js = r.json()
        assert js["ok"] is True
        created_id = js["id"]

        r2 = api.get(f"{BASE_URL}/api/islem/list", params={"tenant_id": TENANT, "limit": 50}, timeout=15)
        row = next((x for x in r2.json()["data"] if x["id"] == created_id), None)
        assert row is not None, f"created cek id {created_id} not in list"
        assert row["islem_turu"] == 21
        assert row["cek_no"] == "CK123"
        assert row["vade_tarihi"] == "2026-08-15", f"vade mismatch: {row['vade_tarihi']}"
        assert row["durum"] == "bekliyor"
        # cek 21 direction: borclu=kasa, alacakli=cari
        assert row["kart_borclu_ad"] == "Merkez"
        assert row["kart_alacakli_ad"] == "TEST_cek_cari"


# ---------------------- auth guard ----------------------
class TestAuth:
    def test_create_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/islem/create", json={
            "tenant_id": TENANT, "islem_turu": 1,
            "cari_id": 1, "kasa_id": 1, "tutar": 1.0,
        }, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
