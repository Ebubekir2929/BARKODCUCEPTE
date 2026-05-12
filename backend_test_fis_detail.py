#!/usr/bin/env python3
"""
Test for FIS DETAIL cache fix (multi-result-set) + regression tests.

Verifies the 2026-05-12 fix in dataset_cache.py lookup_cached_report() that
preserves dict shape for multi-result datasets (fis_detay_toplam).
"""
import requests
import json
import sys
import time

BASE_URL = "https://kart-stok-fix.preview.emergentagent.com/api"
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"
TENANT_MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"
TENANT_GUMUSHANE = "4d9b503a96f5430aad34c430301a8aa1"

PASS = []
FAIL = []

def log_pass(name, msg=""):
    print(f"✅ {name}: {msg}")
    PASS.append(name)

def log_fail(name, msg=""):
    print(f"❌ {name}: {msg}")
    FAIL.append((name, msg))

def login():
    print("\n=== LOGIN ===")
    r = requests.post(f"{BASE_URL}/auth/login",
                      json={"email": EMAIL, "password": PASSWORD},
                      timeout=30)
    if r.status_code != 200:
        print(f"❌ Login failed: {r.status_code} {r.text}")
        sys.exit(1)
    token = r.json().get("token") or r.json().get("access_token")
    if not token:
        print(f"❌ Login: no token in response: {r.text[:200]}")
        sys.exit(1)
    print(f"✅ Login OK, token len {len(token)}")
    return token


def test_fis_detail(token, name, fis_id, expect_details_min=0, expect_totals=False,
                    expect_from_cache=None, expect_empty=False):
    print(f"\n--- {name}: fis_id={fis_id} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"tenant_id": TENANT_MERKEZ, "fis_id": fis_id}
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/data/fis-detail", json=body, headers=headers, timeout=60)
    dt = (time.time() - t0) * 1000
    print(f"  HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    ok = data.get("ok")
    details = data.get("details", [])
    totals = data.get("totals", [])
    from_cache = data.get("from_cache")
    print(f"  ok={ok} details={len(details)} totals={len(totals)} from_cache={from_cache}")
    if details:
        first = details[0]
        print(f"  detail keys: {sorted(list(first.keys()))[:10]}")
        print(f"  detail sample: STOK={first.get('STOK')!r} BARKOD={first.get('BARKOD')!r} "
              f"MIKTAR_FIS={first.get('MIKTAR_FIS')!r} TUTAR={first.get('TUTAR')!r}")
    if totals:
        t = totals[0]
        print(f"  totals: GENELTOPLAM={t.get('GENELTOPLAM')!r} KDV_TOPLAM={t.get('KDV_TOPLAM')!r} "
              f"SATIR_TOPLAM={t.get('SATIR_TOPLAM')!r}")

    if not ok:
        log_fail(name, f"ok=False: {data}")
        return

    if expect_empty:
        if len(details) == 0 and len(totals) == 0:
            log_pass(name, "empty details/totals as expected")
        else:
            log_fail(name, f"expected empty but got details={len(details)} totals={len(totals)}")
        return

    issues = []
    if expect_details_min > 0 and len(details) < expect_details_min:
        issues.append(f"details<{expect_details_min} (got {len(details)})")
    if expect_totals and len(totals) != 1:
        issues.append(f"expected totals=1 got {len(totals)}")
    if expect_from_cache is True and from_cache is not True:
        issues.append(f"expected from_cache=True got {from_cache}")
    # Field shape on details
    if details and expect_details_min > 0:
        d0 = details[0]
        for f in ("STOK", "MIKTAR_FIS", "TUTAR"):
            if f not in d0:
                issues.append(f"detail missing field '{f}'")
                break
    # Field shape on totals
    if totals and expect_totals:
        t0 = totals[0]
        for f in ("GENELTOPLAM",):
            if f not in t0:
                issues.append(f"totals missing field '{f}'")
                break

    if issues:
        log_fail(name, "; ".join(issues))
    else:
        log_pass(name, f"details={len(details)} totals={len(totals)} from_cache={from_cache}")


def test_fis_detail_missing_fis_id(token):
    name = "fis-detail missing fis_id → 400"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.post(f"{BASE_URL}/data/fis-detail",
                      json={"tenant_id": TENANT_MERKEZ}, headers=headers, timeout=30)
    print(f"  HTTP {r.status_code}: {r.text[:200]}")
    if r.status_code == 400 and "tenant_id ve fis_id gerekli" in r.text:
        log_pass(name)
    else:
        log_fail(name, f"expected 400 Turkish msg, got {r.status_code}: {r.text[:200]}")


def test_fis_detail_no_auth():
    name = "fis-detail no auth → 403"
    print(f"\n--- {name} ---")
    r = requests.post(f"{BASE_URL}/data/fis-detail",
                      json={"tenant_id": TENANT_MERKEZ, "fis_id": 20261131}, timeout=30)
    print(f"  HTTP {r.status_code}")
    if r.status_code == 403:
        log_pass(name)
    else:
        log_fail(name, f"expected 403 got {r.status_code}")


def test_cari_extre(token):
    name = "cari-extre regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "tenant_id": TENANT_MERKEZ,
        "cari_id": 438352,
        "tarih_baslangic": "2025-01-01",
        "tarih_bitis": "2026-02-15",
    }
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/data/cari-extre", json=body, headers=headers, timeout=60)
    dt = (time.time() - t0) * 1000
    print(f"  HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    arr = data.get("data", [])
    print(f"  data rows={len(arr)}")
    if arr:
        print(f"  first row keys: {sorted(list(arr[0].keys()))[:12]}")
    issues = []
    if not isinstance(arr, list):
        issues.append("data not list")
    if arr:
        first = arr[0]
        if "BELGE_ID" not in first and "ACIKLAMA" not in first:
            issues.append(f"missing BELGE_ID/ACIKLAMA fields: keys={list(first.keys())[:10]}")
    if issues:
        log_fail(name, "; ".join(issues))
    else:
        log_pass(name, f"{len(arr)} rows")


def test_stock_extre(token):
    name = "stock-extre regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "tenant_id": TENANT_MERKEZ,
        "stok_id": 438230,
        "tarih_baslangic": "2026-05-01",
        "tarih_bitis": "2026-05-12",
    }
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/data/stock-extre", json=body, headers=headers, timeout=60)
    dt = (time.time() - t0) * 1000
    print(f"  HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    arr = data.get("data", [])
    print(f"  data rows={len(arr)}")
    if arr:
        first = arr[0]
        print(f"  first row keys: {sorted(list(first.keys()))[:12]}")
    issues = []
    if not isinstance(arr, list):
        issues.append("data not list")
    if arr:
        first = arr[0]
        for f in ("FIS_ID", "BELGENO", "FIS_TURU"):
            if f not in first:
                issues.append(f"missing field '{f}'")
                break
    if issues:
        log_fail(name, "; ".join(issues))
    else:
        log_pass(name, f"{len(arr)} rows")


def test_stock_list(token):
    name = "stock-list regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"tenant_id": TENANT_MERKEZ, "page": 1, "page_size": 5}
    r = requests.post(f"{BASE_URL}/data/stock-list", json=body, headers=headers, timeout=30)
    print(f"  HTTP {r.status_code}")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    src = data.get("_source")
    arr = data.get("data", [])
    print(f"  _source={src} data_len={len(arr)}")
    if src == "mysql_direct" and len(arr) == 5:
        log_pass(name, f"_source=mysql_direct data=5")
    else:
        log_fail(name, f"_source={src} data_len={len(arr)}")


def test_cari_list(token):
    name = "cari-list regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"tenant_id": TENANT_MERKEZ, "page": 1, "page_size": 5}
    r = requests.post(f"{BASE_URL}/data/cari-list", json=body, headers=headers, timeout=30)
    print(f"  HTTP {r.status_code}")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    src = data.get("_source")
    print(f"  _source={src} data_len={len(data.get('data', []))}")
    if src == "mysql_direct":
        log_pass(name, f"_source=mysql_direct")
    else:
        log_fail(name, f"_source={src}")


def test_iptal_detail(token):
    name = "iptal-detail regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"tenant_id": TENANT_MERKEZ, "iptal_id": 1}
    r = requests.post(f"{BASE_URL}/data/iptal-detail", json=body, headers=headers, timeout=60)
    print(f"  HTTP {r.status_code}")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    print(f"  ok={data.get('ok')} data_len={len(data.get('data', []))}")
    if data.get("ok") is True:
        log_pass(name, f"ok=True data_len={len(data.get('data', []))}")
    else:
        log_fail(name, f"ok={data.get('ok')}")


def test_high_sale_detail(token):
    name = "high-sale-detail regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    body = {"tenant_id": TENANT_MERKEZ, "fis_id": 20261131}
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/data/high-sale-detail", json=body, headers=headers, timeout=60)
    dt = (time.time() - t0) * 1000
    print(f"  HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    print(f"  ok={data.get('ok')} details={len(data.get('details', []))} totals={len(data.get('totals', []))}")
    if data.get("ok") is True:
        log_pass(name)
    else:
        log_fail(name, f"ok={data.get('ok')}")


def test_dashboard(token):
    name = "dashboard regression"
    print(f"\n--- {name} ---")
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "tenant_id": TENANT_MERKEZ,
        "sdate": "2026-05-12",
        "edate": "2026-05-12",
    }
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/data/dashboard", params=params, headers=headers, timeout=60)
    dt = (time.time() - t0) * 1000
    print(f"  HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        log_fail(name, f"HTTP {r.status_code}: {r.text[:300]}")
        return
    data = r.json()
    fdl = data.get("financial_data_location", {})
    fdl_data = fdl.get("data", []) if isinstance(fdl, dict) else []
    print(f"  financial_data_location rows={len(fdl_data)}")
    issues = []
    if not fdl:
        issues.append("missing financial_data_location")
    if fdl_data:
        first = fdl_data[0]
        if "TOPLAM_MATRAH" not in first:
            issues.append("missing TOPLAM_MATRAH")
        if "TOPLAM_KDV" not in first:
            issues.append("missing TOPLAM_KDV")
    if issues:
        log_fail(name, "; ".join(issues))
    else:
        log_pass(name, f"{len(fdl_data)} location rows")


def main():
    print("=" * 70)
    print("FIS DETAIL CACHE FIX + REGRESSION TEST SUITE")
    print("=" * 70)

    token = login()

    print("\n" + "=" * 70)
    print("PRIMARY: FIS DETAIL (multi-result-set cache)")
    print("=" * 70)

    # 1-3: retail FIS_IDs — should return >=1 details + 1 totals with from_cache=True
    test_fis_detail(token, "fis-detail 20261131 (retail)", 20261131,
                    expect_details_min=1, expect_totals=True, expect_from_cache=True)
    test_fis_detail(token, "fis-detail 20271741 (retail)", 20271741,
                    expect_details_min=1, expect_totals=True, expect_from_cache=True)
    test_fis_detail(token, "fis-detail 20311658 (retail)", 20311658,
                    expect_details_min=1, expect_totals=True, expect_from_cache=True)
    # 4: cari-side older invoice
    test_fis_detail(token, "fis-detail 438724 (cari side)", 438724,
                    expect_details_min=1, expect_totals=True)
    # 5: nonexistent → graceful empty
    test_fis_detail(token, "fis-detail nonexistent 9999999999999", 9999999999999,
                    expect_empty=True)
    # 6 & 7: error cases
    test_fis_detail_missing_fis_id(token)
    test_fis_detail_no_auth()

    print("\n" + "=" * 70)
    print("REGRESSION TESTS")
    print("=" * 70)
    test_cari_extre(token)
    test_stock_extre(token)
    test_stock_list(token)
    test_cari_list(token)
    test_iptal_detail(token)
    test_high_sale_detail(token)
    test_dashboard(token)

    print("\n" + "=" * 70)
    print(f"SUMMARY: {len(PASS)} PASS / {len(FAIL)} FAIL")
    print("=" * 70)
    if FAIL:
        print("\nFAILURES:")
        for n, m in FAIL:
            print(f"  ❌ {n}: {m}")
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
