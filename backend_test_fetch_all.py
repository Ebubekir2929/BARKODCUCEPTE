"""
Backend test: fetch_all=true on /api/data/report-run.
User-reported bug: "fiyat listesi ve envanterde 500 kayıt geliyor, halbuki 2500 olmalı"
Verifies that with fetch_all=true the endpoint returns more than 500 rows
when upstream POS data exceeds 500 rows.
"""
import os
import sys
import time
import json
import requests

BASE = "https://report-filter-fix.preview.emergentagent.com/api"
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"

TENANT_MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"
TENANT_GUMUSHANE = "4d9b503a96f5430aad34c430301a8aa1"


def section(title):
    print("\n" + "=" * 78)
    print(f"  {title}")
    print("=" * 78)


def login():
    section("1) LOGIN")
    t0 = time.time()
    r = requests.post(
        f"{BASE}/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    dt = (time.time() - t0) * 1000
    print(f"POST /auth/login -> {r.status_code} in {dt:.0f}ms")
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token")
    assert token, "No access_token in login response"
    print(f"Token len={len(token)} user.email={body.get('user', {}).get('email')}")
    print(f"User tenants: {len(body.get('user', {}).get('tenants', []))}")
    return token


def filter_options(token):
    section("2) FILTER OPTIONS — STOK_FIYAT_AD")
    t0 = time.time()
    r = requests.post(
        f"{BASE}/data/report-filter-options",
        json={"tenant_id": TENANT_MERKEZ, "source": "STOK_FIYAT_AD"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    dt = (time.time() - t0) * 1000
    print(f"-> {r.status_code} in {dt:.0f}ms")
    assert r.status_code == 200, r.text
    data = r.json().get("data", [])
    print(f"Got {len(data)} entries")
    for entry in data:
        print(f"  {entry}")
    return data


def report_run(token, body, label):
    """Helper. Runs /report-run, prints status/size/pages, returns response dict."""
    print(f"\n--- {label} ---")
    print(f"Body: {json.dumps(body, ensure_ascii=False)}")
    t0 = time.time()
    try:
        r = requests.post(
            f"{BASE}/data/report-run",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=300,
        )
    except Exception as e:
        print(f"REQUEST FAILED: {e}")
        return None
    dt = (time.time() - t0) * 1000
    print(f"HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        print(f"Response: {r.text[:600]}")
        return None
    payload = r.json()
    data = payload.get("data", [])
    pages = payload.get("pages")
    cache = payload.get("_cache")
    print(f"ok={payload.get('ok')} data.length={len(data) if isinstance(data, list) else '?'} pages={pages} _cache={cache}")
    return payload


def verdict_for_fetch_all(payload, label):
    if not payload:
        print(f"❌ {label}: NO RESPONSE / ERROR")
        return False, 0
    data = payload.get("data") or []
    pages = payload.get("pages") or 1
    n = len(data) if isinstance(data, list) else 0
    if n > 500:
        print(f"✅ {label}: fetch_all RETURNED {n} rows ({pages} pages) — MORE THAN 500 ✓")
        return True, n
    elif n == 500:
        print(f"⚠️  {label}: fetch_all returned EXACTLY 500 rows ({pages} pages). Pagination may be capped or upstream has only 500.")
        return False, n
    else:
        print(f"⚠️  {label}: fetch_all returned {n} rows ({pages} pages). Either small dataset or empty.")
        return None, n  # not a failure if dataset legitimately small


def main():
    token = login()
    filter_options(token)

    results = {}

    # 3) FIYAT LISTELERI fetch_all (3 fiyat ad'i)
    section("3) FIYAT LISTELERI fetch_all (CRITICAL)")
    for fiyat_ad in [1017, 1016, 1018]:
        payload = report_run(
            token,
            {
                "tenant_id": TENANT_MERKEZ,
                "dataset_key": "rap_fiyat_listeleri_web",
                "params": {
                    "Aktif": 1, "Durum": 0, "Resimli": 0,
                    "Page": 1, "PageSize": 500,
                    "FiyatAd": fiyat_ad,
                },
                "fetch_all": True,
                "force_refresh": True,
            },
            f"fiyat_listeleri FiyatAd={fiyat_ad}",
        )
        v, n = verdict_for_fetch_all(payload, f"FiyatAd={fiyat_ad}")
        results[f"fiyat_listeleri_{fiyat_ad}"] = (v, n, payload)

    # 4) STOK ENVANTER fetch_all
    section("4) STOK ENVANTER fetch_all")
    payload = report_run(
        token,
        {
            "tenant_id": TENANT_MERKEZ,
            "dataset_key": "rap_stok_envanter_web",
            "params": {"Page": 1, "PageSize": 500, "Tarih": "2026-05-05"},
            "fetch_all": True,
            "force_refresh": True,
        },
        "stok_envanter",
    )
    v, n = verdict_for_fetch_all(payload, "stok_envanter")
    results["stok_envanter"] = (v, n, payload)

    # 5) FIS KALEM LISTESI fetch_all
    section("5) FIS KALEM LISTESI fetch_all")
    payload = report_run(
        token,
        {
            "tenant_id": TENANT_MERKEZ,
            "dataset_key": "rap_fis_kalem_listesi_web",
            "params": {
                "Detayli": 0,
                "Page": 1, "PageSize": 500,
                "BTarih": "2026-04-01 00:00",
                "STarih": "2026-05-05 23:59",
                "MinTutar": -99999999,
                "MaxTutar": 99999999,
            },
            "fetch_all": True,
            "force_refresh": True,
        },
        "fis_kalem_listesi",
    )
    v, n = verdict_for_fetch_all(payload, "fis_kalem_listesi")
    results["fis_kalem_listesi"] = (v, n, payload)

    # 6) REGRESSION (no fetch_all)
    section("6) REGRESSION fiyat_listeleri WITHOUT fetch_all")
    payload = report_run(
        token,
        {
            "tenant_id": TENANT_MERKEZ,
            "dataset_key": "rap_fiyat_listeleri_web",
            "params": {
                "Aktif": 1, "Durum": 0, "Resimli": 0,
                "Page": 1, "PageSize": 500,
                "FiyatAd": 1017,
            },
            "force_refresh": True,
        },
        "fiyat_listeleri (single page)",
    )
    if payload:
        d = payload.get("data") or []
        n = len(d) if isinstance(d, list) else 0
        if n <= 500:
            print(f"✅ Single-page returned {n} rows (≤500). OK.")
            results["fiyat_listeleri_single"] = (True, n, payload)
        else:
            print(f"❌ Single-page returned {n} rows (>500). UNEXPECTED.")
            results["fiyat_listeleri_single"] = (False, n, payload)
    else:
        results["fiyat_listeleri_single"] = (False, 0, None)

    # 7) REGRESSION cari_hesap_ekstresi (~146 rows)
    section("7) REGRESSION rap_cari_hesap_ekstresi_web (baseline 146)")
    payload = report_run(
        token,
        {
            "tenant_id": TENANT_MERKEZ,
            "dataset_key": "rap_cari_hesap_ekstresi_web",
            "params": {
                "Cariler": "",
                "CariKodu": "",
                "CariAdi": "",
                "CariTur": "",
                "CariGrup": "",
                "Temsilci": "",
                "Sehir": "",
                "CariRut": "",
                "CariOzelKod1": "",
                "CariOzelKod2": "",
                "CariOzelKod3": "",
                "CariOzelKod4": "",
                "CariOzelKod5": "",
                "Proje": "",
                "Lokasyon": "",
                "AktifDurum": 1,
                "BTarih": "2026-04-01 00:00",
                "STarih": "2026-05-05 23:59",
                "MinBakiye": -99999999,
                "MaxBakiye": 99999999,
                "Page": 1,
                "PageSize": 500,
            },
            "force_refresh": True,
        },
        "cari_hesap_ekstresi",
    )
    if payload:
        d = payload.get("data") or []
        n = len(d) if isinstance(d, list) else 0
        if n >= 100:
            print(f"✅ Cari Hesap Ekstresi returned {n} rows (baseline ~146).")
            results["cari_hesap_ekstresi"] = (True, n, payload)
        else:
            print(f"⚠️  Cari Hesap Ekstresi returned {n} rows. Baseline expected ~146.")
            results["cari_hesap_ekstresi"] = (False, n, payload)
    else:
        results["cari_hesap_ekstresi"] = (False, 0, None)

    # ==== SUMMARY ====
    section("FINAL VERDICT")
    print(f"{'TEST':<40} {'STATUS':<10} {'ROWS':<10} {'PAGES':<8}")
    for k, (v, n, p) in results.items():
        pages = (p or {}).get("pages", "—") if p else "—"
        status = "PASS" if v is True else ("FAIL" if v is False else "INFO")
        print(f"{k:<40} {status:<10} {n:<10} {pages}")

    # Print a verdict line on the critical bug
    print()
    big_pass = any(
        v is True and n > 500
        for k, (v, n, p) in results.items()
        if k.startswith("fiyat_listeleri_") and not k.endswith("single")
    ) or (results.get("stok_envanter", (None, 0, None))[1] > 500) \
       or (results.get("fis_kalem_listesi", (None, 0, None))[1] > 500)

    if big_pass:
        print("🎉 fetch_all=true IS RETURNING > 500 ROWS for at least one report.")
    else:
        print("⚠️  fetch_all=true did NOT return > 500 rows for any tested report.")
        print("    This may be legitimate (upstream POS truly has ≤500 rows for these")
        print("    filters) OR pagination is broken. Check pages count + backend logs.")

    return results


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
