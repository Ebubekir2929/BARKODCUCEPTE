"""v17 — Rapor Ön Yükleme API entegrasyon testleri.

Testler LIVE production MySQL üzerinden çalışır; sadece izin verilen
endpoint'ler kullanılır (SQL write yok). Merkez tenant POS'u offline olduğu
için report-run pending:true döner — beklenen davranış.
"""
import calendar
import os
import time
from datetime import date

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"
DATASET = "rap_personel_satis_ozet_web"


# ------------------------------------------------------------------ fixtures
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    assert "access_token" in j
    return j["access_token"]


@pytest.fixture(scope="module")
def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def bugun_params():
    bugun = date.today()
    ay_son = calendar.monthrange(bugun.year, bugun.month)[1]  # noqa
    ay_bas = date(bugun.year, bugun.month, 1)
    return {
        "BASTARIH": f"{ay_bas.strftime('%Y-%m-%d')} 00:00:00",
        "BITTARIH": f"{bugun.strftime('%Y-%m-%d')} 23:59:59",
        "Personel": "",
        "Lokasyon": "",
        "Page": 1,
        "PageSize": 500,
    }


def _report_run(auth_header, params, extra=None):
    body = {
        "tenant_id": TENANT,
        "dataset_key": DATASET,
        "params": params,
        "fetch_all": True,
        "wait_sec": 3,
    }
    if extra:
        body.update(extra)
    return requests.post(f"{API}/data/report-run", headers=auth_header, json=body, timeout=30)


def _liste(auth_header):
    r = requests.get(
        f"{API}/data/rapor-onyukleme-listesi",
        headers=auth_header,
        params={"tenant_id": TENANT},
        timeout=20,
    )
    return r


def _find_item(items, dataset_key, bas_tpl, bit_tpl):
    for it in items:
        t = it.get("template") or {}
        if it.get("dataset_key") == dataset_key and t.get("BASTARIH") == bas_tpl and t.get("BITTARIH") == bit_tpl:
            return it
    return None


# ---------------------------------------------------------------- login
def test_login_success(token):
    assert token and len(token) > 20


# --------------------------------------------------- sürüm / regresyon
def test_sistem_durum_surum():
    r = requests.get(f"{API}/sistem-durum", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("surum") == "2026-09-18-v17-rapor-on-yukleme", f"Got {j.get('surum')}"


# ------------------------------- rapor-onyukleme-listesi yetkilendirme
def test_liste_no_token_unauthorized():
    r = requests.get(f"{API}/data/rapor-onyukleme-listesi", params={"tenant_id": TENANT}, timeout=15)
    assert r.status_code in (401, 403), f"Got {r.status_code}"


def test_liste_missing_tenant_422(auth_header):
    r = requests.get(f"{API}/data/rapor-onyukleme-listesi", headers=auth_header, timeout=15)
    assert r.status_code == 422, f"Got {r.status_code} {r.text}"


def test_liste_basic_shape(auth_header):
    r = _liste(auth_header)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert isinstance(j.get("count"), int)
    assert isinstance(j.get("items"), list)
    assert j["count"] == len(j["items"])
    for it in j["items"]:
        assert "dataset_key" in it and isinstance(it["dataset_key"], str)
        assert isinstance(it.get("template"), dict)
        assert isinstance(it.get("params"), dict)
        assert isinstance(it.get("hit_count"), int)
        assert isinstance(it.get("last_used_at"), str)
        # params (resolved) date fields must be real YYYY-MM-DD (not templates)
        for k, v in it["params"].items():
            if isinstance(v, str) and v.startswith("{") and "}" in v:
                pytest.fail(f"params[{k}] contains unresolved token: {v}")


# ---------------------------------------------- usage counting flow
def test_usage_counting_flow(auth_header, bugun_params):
    # 1) İki kez normal çağır
    r1 = _report_run(auth_header, bugun_params)
    assert r1.status_code == 200, r1.text
    r2 = _report_run(auth_header, bugun_params)
    assert r2.status_code == 200, r2.text

    time.sleep(2)

    # 2) Şablon liste içinde olmalı, hit_count >= 2
    r = _liste(auth_header)
    assert r.status_code == 200
    items = r.json()["items"]
    it = _find_item(items, DATASET, "{MONTH_START} 00:00:00", "{TODAY} 23:59:59")
    assert it is not None, f"Şablon bulunamadı; items dataset_keys={[i['dataset_key'] for i in items]}"
    base_hits = it["hit_count"]
    assert base_hits >= 2, f"hit_count={base_hits}"

    # 3) _pending_poll:true → sayılmamalı
    r3 = _report_run(auth_header, bugun_params, extra={"_pending_poll": True})
    assert r3.status_code == 200, r3.text

    # 4) cache_only:true → sayılmamalı (ve <5s)
    t0 = time.time()
    r4 = _report_run(auth_header, bugun_params, extra={"cache_only": True})
    elapsed = time.time() - t0
    assert r4.status_code == 200, r4.text
    assert elapsed < 5, f"cache_only slow: {elapsed:.2f}s"
    assert not r4.json().get("pending"), f"cache_only should not be pending: {r4.json()}"

    time.sleep(2)
    r = _liste(auth_header)
    items = r.json()["items"]
    it2 = _find_item(items, DATASET, "{MONTH_START} 00:00:00", "{TODAY} 23:59:59")
    assert it2 is not None
    assert it2["hit_count"] == base_hits, (
        f"hit_count degismemeli (pending_poll+cache_only sayilmaz); base={base_hits} yeni={it2['hit_count']}"
    )

    # 5) Normal (bayraksız) tekrar → +1
    r5 = _report_run(auth_header, bugun_params)
    assert r5.status_code == 200, r5.text
    time.sleep(2)
    r = _liste(auth_header)
    items = r.json()["items"]
    it3 = _find_item(items, DATASET, "{MONTH_START} 00:00:00", "{TODAY} 23:59:59")
    assert it3 is not None
    assert it3["hit_count"] == base_hits + 1, f"Beklenen {base_hits+1} bulunan {it3['hit_count']}"

    # 6) Çözülmüş param bugünün tarihlerini içermeli
    bugun_str = date.today().strftime("%Y-%m-%d")
    ay_bas = date(date.today().year, date.today().month, 1).strftime("%Y-%m-%d")
    assert it3["params"]["BASTARIH"] == f"{ay_bas} 00:00:00"
    assert it3["params"]["BITTARIH"] == f"{bugun_str} 23:59:59"


# ---------------------------------------------- regresyon: dashboard
def test_dashboard_regression(auth_header):
    r = requests.get(
        f"{API}/data/dashboard",
        headers=auth_header,
        params={"tenant_id": TENANT, "sdate": "2026-09-01", "edate": "2026-09-18"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert "financial_data_location" in j, f"keys={list(j.keys())[:20]}"
