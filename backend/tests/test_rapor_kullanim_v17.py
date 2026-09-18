"""v17 — Rapor Ön Yükleme şablonlama birim testleri (DB gerekmez)."""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import rapor_kullanim as rk  # noqa: E402

BUGUN = date(2026, 9, 18)  # Cuma


def test_ay_basi_bugun_sablonu():
    p = {"BASTARIH": "2026-09-01 00:00:00", "BITTARIH": "2026-09-18 23:59:59", "Lokasyon": "75919", "Page": 4, "PageSize": 500}
    t = rk.sablonlastir(p, BUGUN)
    assert t["BASTARIH"] == "{MONTH_START} 00:00:00"
    assert t["BITTARIH"] == "{TODAY} 23:59:59"
    assert t["Page"] == 1 and t["Lokasyon"] == "75919"


def test_cozum_gelecek_gune_gore():
    t = {"BASTARIH": "{MONTH_START} 00:00:00", "BITTARIH": "{TODAY} 23:59:59", "X": "{DAYS_AGO:7}", "Y": "{WEEK_START}"}
    c = rk.coz(t, date(2026, 10, 7))  # Çarşamba
    assert c == {"BASTARIH": "2026-10-01 00:00:00", "BITTARIH": "2026-10-07 23:59:59", "X": "2026-09-30", "Y": "2026-10-05"}


def test_onceki_ay_ve_gun_once():
    t = rk.sablonlastir({"BASTARIH": "2026-08-01", "BITTARIH": "2026-08-31", "SON": "2026-09-11"}, BUGUN)
    assert t == {"BASTARIH": "{PREV_MONTH_START}", "BITTARIH": "{PREV_MONTH_END}", "SON": "{DAYS_AGO:7}"}
    assert rk.coz(t, BUGUN) == {"BASTARIH": "2026-08-01", "BITTARIH": "2026-08-31", "SON": "2026-09-11"}


def test_eski_sabit_tarih_sablonlanmaz():
    assert rk.sablonlastir({"BASTARIH": "2026-03-01 00:00:00", "BITTARIH": "2026-09-18 23:59:59"}, BUGUN) is None


def test_gelecek_tarih_sablonlanmaz_ama_bugunu_kapsar():
    assert rk.sablonlastir({"BITTARIH": "2026-09-30 23:59:59"}, BUGUN) == {"BITTARIH": "{MONTH_END} 23:59:59"}
    assert rk.bugunu_kapsar({"BASTARIH": "2026-09-01 00:00:00", "BITTARIH": "2026-09-18 23:59:59"}, BUGUN) is True
    assert rk.bugunu_kapsar({"BASTARIH": "2026-09-01 00:00:00", "BITTARIH": "2026-09-17 23:59:59"}, BUGUN) is False
    assert rk.bugunu_kapsar({"Lokasyon": "1"}, BUGUN) is False


def test_hash_sirali_ve_kararli():
    a = rk.sablon_hash("rap_x", {"A": 1, "B": "{TODAY}"})
    b = rk.sablon_hash("rap_x", {"B": "{TODAY}", "A": 1})
    assert a == b and len(a) == 32
