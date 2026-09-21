"""v23 — Haftalık Rapor Maili: ayar/önizleme uçları + saf yardımcı fonksiyonlar."""
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from services import haftalik_rapor as hr  # noqa: E402

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
EMAIL, PASS = "cakmak.ebubekir29@gmail.com", "1234567"


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


# ── saf yardımcılar ──────────────────────────────────────────────────────────
def test_gecen_hafta_araligi():
    # Pazartesi 2026-09-21 → önceki Pzt–Paz
    assert hr.gecen_hafta_araligi(date(2026, 9, 21)) == (date(2026, 9, 14), date(2026, 9, 20))
    # Hafta ortası (Çarşamba) da aynı tamamlanmış haftayı verir
    assert hr.gecen_hafta_araligi(date(2026, 9, 23)) == (date(2026, 9, 14), date(2026, 9, 20))
    # Pazar → hâlâ önceki hafta
    assert hr.gecen_hafta_araligi(date(2026, 9, 27)) == (date(2026, 9, 14), date(2026, 9, 20))


def test_hafta_etiketi_ve_para():
    assert hr.hafta_etiketi(date(2026, 9, 14)) == "2026-W38"
    assert hr.para(12345.678) == "₺12.345,68"
    assert hr.para(0) == "₺0,00"
    assert hr.para(-5.5) == "-₺5,50"
    assert hr.aralik_metni(date(2026, 9, 14), date(2026, 9, 20)) == "14 – 20 Eylül 2026"
    assert hr.aralik_metni(date(2026, 9, 28), date(2026, 10, 4)) == "28 Eylül – 4 Ekim 2026"


def test_sonraki_pazartesi():
    ist = timezone(timedelta(hours=3))
    # Salı 10:00 → 6 gün sonra Pazartesi 08:00
    s = hr.sonraki_pazartesi_saniye(datetime(2026, 9, 22, 10, 0, tzinfo=ist))
    assert s == (datetime(2026, 9, 28, hr.RAPOR_SAATI_ISTANBUL, 0, tzinfo=ist) - datetime(2026, 9, 22, 10, 0, tzinfo=ist)).total_seconds()
    # Pazartesi saatten ÖNCE → aynı gün
    s = hr.sonraki_pazartesi_saniye(datetime(2026, 9, 21, hr.RAPOR_SAATI_ISTANBUL - 1, 30, tzinfo=ist))
    assert 0 < s <= 3600
    # Pazartesi saatten SONRA → 7 gün sonra
    s = hr.sonraki_pazartesi_saniye(datetime(2026, 9, 21, hr.RAPOR_SAATI_ISTANBUL + 1, 0, tzinfo=ist))
    assert 6 * 86400 < s < 7 * 86400


def test_html_ve_metin_uretimi():
    v = {
        "hafta": "2026-W38", "baslangic": "2026-09-14", "bitis": "2026-09-20", "aralik": "14 – 20 Eylül 2026",
        "kullanici": "Test", "email": "t@x.com", "genel_toplam": 1500.0, "veri_var": True,
        "kaynaklar": [{
            "tenant_id": "abc", "name": "Ana Veri", "toplam": 1000.0, "nakit": 400.0, "kart": 600.0,
            "onceki_toplam": 800.0, "degisim_yuzde": 25.0, "satisli_gun": 2,
            "gunler": [{"tarih": f"2026-09-{d:02d}", "gun": g, "toplam": 500.0 if d in (14, 18) else 0.0, "nakit": 0.0, "kart": 0.0}
                       for d, g in zip(range(14, 21), hr._GUN_KISA)],
            "en_iyi_gun": {"tarih": "2026-09-14", "gun": "Pzt", "toplam": 500.0, "nakit": 0.0, "kart": 0.0},
            "hedef": {"ay": "2026-09", "ay_adi": "Eylül", "hedef": 2000.0, "gerceklesen": 1000.0, "oran": 50.0, "kalan": 1000.0},
        }, {
            "tenant_id": "def", "name": "Şube", "toplam": 500.0, "nakit": 500.0, "kart": 0.0,
            "onceki_toplam": 0.0, "degisim_yuzde": None, "satisli_gun": 1,
            "gunler": [{"tarih": f"2026-09-{d:02d}", "gun": g, "toplam": 0.0, "nakit": 0.0, "kart": 0.0} for d, g in zip(range(14, 21), hr._GUN_KISA)],
            "en_iyi_gun": None, "hedef": None,
        }],
    }
    html = hr.rapor_html(v)
    assert "₺1.000,00" in html and "▲ 25.0%" in html and "Eylül hedefi" in html
    assert "TÜM KAYNAKLAR TOPLAMI" in html and "₺1.500,00" in html
    assert "önceki hafta verisi yok" in html and "Bu hafta satış kaydı yok." in html
    assert "display:flex" not in html  # e-posta istemcisi uyumluluğu
    metin = hr.rapor_metin(v)
    assert "[Ana Veri] Toplam: ₺1.000,00" in metin and "+25.0%" in metin and "Tüm kaynaklar toplamı" in metin


# ── API uçları ───────────────────────────────────────────────────────────────
def test_surum_v23():
    r = requests.get(f"{BASE}/sistem-durum", timeout=30)
    d = r.json()
    assert d["surum"].startswith("2026-09-23-v23")
    assert "haftalik_rapor" in d


def test_ayar_oku_ve_degistir(auth):
    r = requests.get(f"{BASE}/rapor-mail/ayar", headers=auth, timeout=60)
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["email"] == EMAIL and "Pazartesi" in d["sonraki"] and isinstance(d["aktif"], bool)
    onceki = d["aktif"]
    try:
        r = requests.put(f"{BASE}/rapor-mail/ayar", json={"aktif": False}, headers=auth, timeout=60)
        assert r.status_code == 200 and r.json()["aktif"] is False
        assert requests.get(f"{BASE}/rapor-mail/ayar", headers=auth, timeout=60).json()["data"]["aktif"] is False
        r = requests.put(f"{BASE}/rapor-mail/ayar", json={"aktif": True}, headers=auth, timeout=60)
        assert requests.get(f"{BASE}/rapor-mail/ayar", headers=auth, timeout=60).json()["data"]["aktif"] is True
    finally:
        requests.put(f"{BASE}/rapor-mail/ayar", json={"aktif": onceki}, headers=auth, timeout=60)


def test_onizleme(auth):
    r = requests.get(f"{BASE}/rapor-mail/onizleme", headers=auth, timeout=180)
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["hafta"].startswith("20") and "W" in d["hafta"]
    assert date.fromisoformat(d["bitis"]) - date.fromisoformat(d["baslangic"]) == timedelta(days=6)
    assert date.fromisoformat(d["baslangic"]).weekday() == 0
    assert len(d["kaynaklar"]) >= 1
    for k in d["kaynaklar"]:
        assert len(k["gunler"]) == 7 and k["gunler"][0]["gun"] == "Pzt"
        assert round(sum(g["toplam"] for g in k["gunler"]), 2) == k["toplam"]


def test_yetkisiz():
    assert requests.get(f"{BASE}/rapor-mail/ayar", timeout=30).status_code in (401, 403)
    assert requests.post(f"{BASE}/rapor-mail/gonder-simdi", timeout=30).status_code in (401, 403)
