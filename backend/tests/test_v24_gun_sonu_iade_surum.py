"""v24 — Açık hesap gün sonu dondurma, iade fişleri, sürüm sağlığı."""
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from services import acik_hesap_gun_sonu as gs  # noqa: E402

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
EMAIL, PASS = "cakmak.ebubekir29@gmail.com", "1234567"
T_A649 = "a6491c78291643e6b08e518e1de8e498"
IST = timezone(timedelta(hours=3))


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


def test_sonraki_calisma_zamanlari():
    d = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=IST)  # noqa: E731
    assert gs._sonraki_calisma(d("2026-10-13 10:00")) == (d("2026-10-13 23:55"), "dondur")
    assert gs._sonraki_calisma(d("2026-10-13 23:56")) == (d("2026-10-14 00:03"), "tamamla")
    assert gs._sonraki_calisma(d("2026-10-13 00:01")) == (d("2026-10-13 00:03"), "tamamla")
    assert gs._sonraki_calisma(d("2026-10-13 00:05")) == (d("2026-10-13 23:55"), "dondur")


def test_surum_v24():
    d = requests.get(f"{BASE}/sistem-durum", timeout=30).json()
    assert d["surum"].startswith("2026-10-13-v24")
    assert "acik_hesap_gun_sonu" in d


def test_acik_hesap_gecmis_gun_gun_sonu_kaynagi(auth):
    dun = (datetime.now(IST).date() - timedelta(days=1)).isoformat()
    r = requests.post(f"{BASE}/data/acik-hesap-kisi", json={"tenant_id": T_A649, "sdate": dun, "edate": dun}, headers=auth, timeout=90)
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] and j["kaynak"] in ("gun_sonu", "cache")
    if j["kaynak"] == "gun_sonu":
        assert j["dondurma_at"]
    # bugün → her zaman cache
    bugun = datetime.now(IST).date().isoformat()
    r = requests.post(f"{BASE}/data/acik-hesap-kisi", json={"tenant_id": T_A649, "sdate": bugun, "edate": bugun}, headers=auth, timeout=90)
    assert r.status_code == 200 and r.json()["kaynak"] == "cache"


def test_iade_fisler(auth):
    r = requests.get(f"{BASE}/data/iade-fisler", params={"tenant_id": T_A649, "sdate": "2026-10-12"}, headers=auth, timeout=90)
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] and j["sdate"] == "2026-10-12" and j["edate"] == "2026-10-12"
    assert j["fis_sayisi"] == len(j["data"])
    for f in j["data"]:
        assert "iade" in str(f["FIS_TURU_AD"]).lower() or "İade" in str(f["FIS_TURU_AD"])
        assert isinstance(f["DETAYLAR"], list)
    assert round(sum(float(f["TUTAR"]) for f in j["data"]), 2) == j["toplam_tutar"]
    assert round(sum(k["tutar"] for k in j["kisiler"]), 2) == j["toplam_tutar"]
    if j["kisiler"]:
        ad = j["kisiler"][0]["personel"]
        r2 = requests.get(f"{BASE}/data/iade-fisler", params={"tenant_id": T_A649, "sdate": "2026-10-12", "personel": ad.lower()}, headers=auth, timeout=90)
        assert r2.json()["fis_sayisi"] == j["kisiler"][0]["fis_sayisi"]  # büyük/küçük harf duyarsız
        r3 = requests.get(f"{BASE}/data/iade-fisler", params={"tenant_id": T_A649, "sdate": "2026-10-12", "personel": "OLMAYAN KISI"}, headers=auth, timeout=90)
        assert r3.json()["fis_sayisi"] == 0


def test_iade_fisler_dogrulama(auth):
    assert requests.get(f"{BASE}/data/iade-fisler", params={"tenant_id": T_A649, "sdate": "12.10.2026"}, headers=auth, timeout=30).status_code == 422
    assert requests.get(f"{BASE}/data/iade-fisler", params={"tenant_id": T_A649, "sdate": "2026-01-01", "edate": "2026-03-01"}, headers=auth, timeout=30).status_code == 422
    assert requests.get(f"{BASE}/data/iade-fisler", params={"tenant_id": T_A649, "sdate": "2026-10-12"}, timeout=30).status_code in (401, 403)


def test_saglik_surumler(auth):
    r = requests.get(f"{BASE}/senkron/saglik", params={"tenant_id": T_A649}, headers=auth, timeout=120)
    assert r.status_code == 200
    s = r.json()["data"]["surumler"]
    assert s["client"]["beklenen"] and "v24" in s["client"]["beklenen"]
    assert s["client"]["durum"] in ("guncel", "eski", "bilinmiyor")
    assert s["sync_php"]["beklenen"] and s["sync_php"]["beklenen"].startswith("2026-10-13-v22")
    assert s["sync_php"]["durum"] in ("guncel", "eski", "bilinmiyor")
    if s["client"]["durum"] == "eski" or s["sync_php"]["durum"] == "eski":
        assert r.json()["data"]["genel"] in ("uyari", "kritik")
