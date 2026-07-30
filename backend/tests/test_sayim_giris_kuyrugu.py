"""Backend tests for iteration 10 — Sayım Fişi Girişi (Phase 3).

Endpoints covered:
  POST /api/islem/sayim-create           (new — write queue for sayım fişi)
  GET  /api/islem/list?islem_grubu=sayim (returns detay with satirlar/toplam_kalem/toplam_miktar)

Focus (per main-agent review_request Phase 3):
  - Happy path 2 satırlar → ok:true, id, durum='bekliyor', toplam_kalem=2, toplam_miktar
  - GET /list round-trip: detay.satirlar / toplam_kalem / toplam_miktar; islem_turu_ad='Sayım Fişi'
  - Validation: empty satırlar → 400
  - Validation: negative miktar → 400
  - Validation: missing token → 401/403
  - Validation: malformed satır (missing ad OR missing stok_id) → 400

CLEANUP: after tests, DELETE created queue rows (islem_grubu='sayim', durum='bekliyor',
olusturan=<test user email>) so live POS client doesn't pull them into ERP12.
"""
import os
import pytest
import requests
import pymysql

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

# Gmail account per review_request; falls back to hotmail admin if 401
LOGIN_PRIMARY = {"email": "cakmak.ebubekir29@gmail.com", "password": "1234567"}
LOGIN_FALLBACK = {"email": "cakmak_ebubekir@hotmail.com", "password": "admin"}
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"

# Track created ids for CRITICAL cleanup (shared LIVE MySQL)
_CREATED_IDS: list = []
_LOGIN_EMAIL: str = ""


@pytest.fixture(scope="session")
def token():
    global _LOGIN_EMAIL
    r = requests.post(f"{BASE_URL}/api/auth/login", json=LOGIN_PRIMARY, timeout=20)
    if r.status_code != 200:
        r = requests.post(f"{BASE_URL}/api/auth/login", json=LOGIN_FALLBACK, timeout=20)
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
        _LOGIN_EMAIL = LOGIN_FALLBACK["email"]
    else:
        _LOGIN_EMAIL = LOGIN_PRIMARY["email"]
    tok = r.json().get("access_token")
    assert tok, "no access_token in login response"
    return tok


@pytest.fixture(scope="session")
def api(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


def _satir(stok_id=901, miktar=3.0, ad="TEST_sayim_kola", barkod="8690001"):
    return {"stok_id": stok_id, "barkod": barkod, "kod": "SK01", "ad": ad, "miktar": miktar}


# ---------------------- happy path ----------------------
class TestSayimCreateHappy:
    def test_happy_two_satirlar(self, api):
        payload = {
            "tenant_id": TENANT,
            "aciklama": "TEST_pytest_sayim_happy",
            "satirlar": [
                _satir(901, 3.0, "TEST_sayim_a", "8690001"),
                _satir(902, 2.5, "TEST_sayim_b", "8690002"),
            ],
        }
        r = api.post(f"{BASE_URL}/api/islem/sayim-create", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:300]
        js = r.json()
        assert js.get("ok") is True
        assert isinstance(js.get("id"), int) and js["id"] > 0
        _CREATED_IDS.append(js["id"])
        assert js.get("durum") == "bekliyor"
        assert js.get("toplam_kalem") == 2
        assert float(js.get("toplam_miktar")) == 5.5

        # verify persistence via /list
        r2 = api.get(f"{BASE_URL}/api/islem/list",
                     params={"tenant_id": TENANT, "islem_grubu": "sayim", "limit": 50},
                     timeout=15)
        assert r2.status_code == 200
        rows = r2.json().get("data", [])
        row = next((x for x in rows if x["id"] == js["id"]), None)
        assert row is not None, f"created sayim id {js['id']} not found in list"
        assert row["islem_turu"] == 0
        assert row["islem_turu_ad"] == "Sayım Fişi"
        assert float(row["tutar"]) == 5.5
        assert row["durum"] == "bekliyor"

        detay = row.get("detay")
        assert isinstance(detay, dict), f"detay must be parsed dict, got: {type(detay)}"
        assert isinstance(detay.get("satirlar"), list) and len(detay["satirlar"]) == 2
        assert detay.get("toplam_kalem") == 2
        assert float(detay.get("toplam_miktar")) == 5.5

    def test_happy_with_lokasyon(self, api):
        payload = {
            "tenant_id": TENANT,
            "aciklama": "TEST_pytest_sayim_lok",
            "lokasyon": 1,
            "satirlar": [_satir(903, 1.0, "TEST_sayim_c", "8690003")],
        }
        r = api.post(f"{BASE_URL}/api/islem/sayim-create", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:300]
        js = r.json()
        assert js["ok"] is True
        _CREATED_IDS.append(js["id"])
        assert js["toplam_kalem"] == 1
        assert float(js["toplam_miktar"]) == 1.0


# ---------------------- validation ----------------------
class TestSayimValidation:
    def test_empty_satirlar_400(self, api):
        payload = {"tenant_id": TENANT, "aciklama": "TEST_empty", "satirlar": []}
        r = api.post(f"{BASE_URL}/api/islem/sayim-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "ürün" in detail or "urun" in detail or "satır" in detail or "satir" in detail

    def test_negative_miktar_400(self, api):
        payload = {
            "tenant_id": TENANT, "aciklama": "TEST_neg",
            "satirlar": [_satir(904, -1.0, "TEST_neg", "8690004")],
        }
        r = api.post(f"{BASE_URL}/api/islem/sayim-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        detail = str(r.json().get("detail", "")).lower()
        assert "miktar" in detail or "negatif" in detail

    def test_missing_token_403(self):
        r = requests.post(f"{BASE_URL}/api/islem/sayim-create", json={
            "tenant_id": TENANT, "satirlar": [_satir()],
        }, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_malformed_missing_ad_400(self, api):
        # Missing 'ad' — SayimSatir has ad required
        payload = {
            "tenant_id": TENANT, "aciklama": "TEST_bad",
            "satirlar": [{"stok_id": 905, "miktar": 1.0, "barkod": "8690005"}],
        }
        r = api.post(f"{BASE_URL}/api/islem/sayim-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_malformed_missing_stok_id_400(self, api):
        payload = {
            "tenant_id": TENANT, "aciklama": "TEST_bad2",
            "satirlar": [{"ad": "TEST_no_id", "miktar": 1.0}],
        }
        r = api.post(f"{BASE_URL}/api/islem/sayim-create", json=payload, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


# ---------------------- CRITICAL: cleanup live queue rows ----------------------
def test_zz_cleanup_created_rows():
    """CRITICAL: MySQL is LIVE production. Delete rows we created here so the
    Windows POS client doesn't pull test data into user's ERP12."""
    if not _CREATED_IDS:
        pytest.skip("no ids to clean")
    host = os.environ.get("MYSQL_DATA_HOST")
    user = os.environ.get("MYSQL_DATA_USER")
    pw = os.environ.get("MYSQL_DATA_PASS")
    db = os.environ.get("MYSQL_DATA_DB")
    port = int(os.environ.get("MYSQL_DATA_PORT", "3306"))
    assert host and user and db, "MYSQL_DATA_* env not set"
    conn = pymysql.connect(host=host, user=user, password=pw, database=db, port=port,
                           charset="utf8mb4", connect_timeout=15)
    try:
        with conn.cursor() as cur:
            fmt_ids = ",".join(str(int(i)) for i in _CREATED_IDS)
            # Only delete rows that are still bekliyor AND grubu=sayim AND our tenant
            sql = (f"DELETE FROM mobil_islem_kuyrugu "
                   f"WHERE id IN ({fmt_ids}) AND islem_grubu='sayim' "
                   f"AND durum='bekliyor' AND tenant_id=%s")
            cur.execute(sql, (TENANT,))
            deleted = cur.rowcount
        conn.commit()
        print(f"[cleanup] deleted {deleted} sayim rows (ids={_CREATED_IDS})")
        assert deleted == len(_CREATED_IDS), \
            f"cleanup mismatch: created={len(_CREATED_IDS)} deleted={deleted}"
    finally:
        conn.close()
