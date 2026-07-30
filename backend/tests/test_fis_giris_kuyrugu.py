"""Backend tests for iteration 9 — Fatura/Fiş Girişi (Phase 2).

Endpoints covered:
  POST /api/islem/fis-create           (new — write queue for fatura/fiş)
  GET  /api/islem/list?islem_grubu=fis (returns detay with satırlar/geneltoplam)
  GET  /api/islem/kasalar              (must remain ok:true)

Focus (per main-agent review_request Phase 2):
  - Happy path (satış faturası, açık hesap) inserts a queue row + returns geneltoplam
  - Validation: empty satırlar → 400
  - Validation: invalid fis_tipi → 400
  - Validation: nakit/kart without kasa_id → 400
  - Validation: total 0 (all miktar=0 or fiyat=0) → 400
  - List round-trip: detay.satirlar + geneltoplam parsed from detay_json
  - Kasalar endpoint smoke check (ok:true)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://price-update-test.preview.emergentagent.com").rstrip("/")
# Use tenant admin from /app/memory/test_credentials.md (matches review_request)
# NOTE: gmail account (per review_request) rejected in current environment with 401,
# fall back to hotmail admin (iteration 8 pattern) — same tenant is passed via body payload,
# so this exercises the exact same code path.
LOGIN = {"email": "cakmak_ebubekir@hotmail.com", "password": "admin"}
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=LOGIN, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token in login response"
    return tok


@pytest.fixture(scope="session")
def api(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


def _satir(stok_id=101, miktar=2.0, fiyat=15.5, ad="TEST_urun_kola", barkod="8690"):
    return {"stok_id": stok_id, "barkod": barkod, "kod": "K01", "ad": ad,
            "miktar": miktar, "fiyat": fiyat}


# ---------------------- kasalar smoke ----------------------
class TestKasalar:
    def test_kasalar_ok(self, api):
        r = api.get(f"{BASE_URL}/api/islem/kasalar", params={"tenant_id": TENANT}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        js = r.json()
        assert js.get("ok") is True
        assert isinstance(js.get("data"), list)


# ---------------------- happy path ----------------------
class TestFisCreateHappy:
    def test_satis_faturasi_acik_hesap(self, api):
        payload = {
            "tenant_id": TENANT,
            "fis_tipi": "satis_faturasi",
            "cari_id": 438745,
            "cari_ad": "TEST_pytest_fis_cari",
            "odeme_tipi": "acik_hesap",
            "satirlar": [_satir(101, 2.0, 15.50), _satir(102, 1.0, 20.0, ad="TEST_urun_2", barkod="8691")],
            "aciklama": "TEST_pytest_fis_ah",
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:300]
        js = r.json()
        assert js.get("ok") is True
        assert isinstance(js.get("id"), int) and js["id"] > 0
        assert js.get("durum") == "bekliyor"
        # 2*15.50 + 1*20.00 = 51.00
        assert float(js.get("geneltoplam")) == 51.00, f"geneltoplam mismatch: {js}"

        # verify persistence via /list with islem_grubu=fis
        r2 = api.get(f"{BASE_URL}/api/islem/list",
                     params={"tenant_id": TENANT, "islem_grubu": "fis", "limit": 50},
                     timeout=15)
        assert r2.status_code == 200
        rows = r2.json().get("data", [])
        row = next((x for x in rows if x["id"] == js["id"]), None)
        assert row is not None, f"created fis id {js['id']} not found in list"
        assert row["islem_turu"] == 47  # satis_faturasi
        assert row["islem_turu_ad"] == "Satış Faturası"
        # cari_taraf=borclu for satis_faturasi
        assert row["kart_borclu_ad"] == "TEST_pytest_fis_cari"
        assert float(row["tutar"]) == 51.00
        assert row["durum"] == "bekliyor"

        detay = row.get("detay")
        assert isinstance(detay, dict), f"detay must be parsed dict, got: {type(detay)}"
        assert detay.get("odeme_tipi") == "acik_hesap"
        assert isinstance(detay.get("satirlar"), list) and len(detay["satirlar"]) == 2
        assert float(detay.get("geneltoplam")) == 51.00

    def test_nakit_with_kasa(self, api):
        payload = {
            "tenant_id": TENANT,
            "fis_tipi": "satis_fisi",
            "cari_id": 438745, "cari_ad": "TEST_nakit_cari",
            "odeme_tipi": "nakit",
            "kasa_id": 75923, "kasa_ad": "Merkez",
            "satirlar": [_satir(103, 3.0, 10.0)],
            "aciklama": "TEST_pytest_fis_nakit",
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:300]
        js = r.json()
        assert js["ok"] is True
        assert float(js["geneltoplam"]) == 30.0


# ---------------------- validation ----------------------
class TestFisValidation:
    def test_empty_satirlar_400(self, api):
        payload = {
            "tenant_id": TENANT, "fis_tipi": "satis_faturasi",
            "cari_id": 1, "cari_ad": "T", "odeme_tipi": "acik_hesap", "satirlar": [],
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "ürün" in detail or "urun" in detail or "satır" in detail or "satir" in detail

    def test_invalid_fis_tipi_400(self, api):
        payload = {
            "tenant_id": TENANT, "fis_tipi": "gecersiz_tip",
            "cari_id": 1, "cari_ad": "T", "odeme_tipi": "acik_hesap",
            "satirlar": [_satir()],
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "fiş" in detail or "fis" in detail or "geçersiz" in detail

    def test_nakit_without_kasa_400(self, api):
        payload = {
            "tenant_id": TENANT, "fis_tipi": "satis_faturasi",
            "cari_id": 1, "cari_ad": "T", "odeme_tipi": "nakit",
            "satirlar": [_satir()],
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "kasa" in detail

    def test_kart_without_kasa_400(self, api):
        payload = {
            "tenant_id": TENANT, "fis_tipi": "satis_faturasi",
            "cari_id": 1, "cari_ad": "T", "odeme_tipi": "kart",
            "satirlar": [_satir()],
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=15)
        assert r.status_code == 400
        assert "kasa" in str(r.json().get("detail", "")).lower()

    def test_total_zero_400(self, api):
        payload = {
            "tenant_id": TENANT, "fis_tipi": "satis_faturasi",
            "cari_id": 1, "cari_ad": "T", "odeme_tipi": "acik_hesap",
            "satirlar": [_satir(miktar=0, fiyat=0)],
        }
        r = api.post(f"{BASE_URL}/api/islem/fis-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "toplam" in detail or "0" in detail

    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/islem/fis-create", json={
            "tenant_id": TENANT, "fis_tipi": "satis_faturasi",
            "cari_id": 1, "odeme_tipi": "acik_hesap",
            "satirlar": [_satir()],
        }, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
