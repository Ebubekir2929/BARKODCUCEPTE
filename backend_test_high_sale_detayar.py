"""Regression test for POST /api/data/high-sale-detail after _flatten_urunler
DETAYLAR support fix (2026-05-05).

Per review request: confirm 200s, no 500 errors, response bodies look reasonable.
"""
import os
import sys
import time
import json
import requests

BASE = "https://saas-dashboard-pos.preview.emergentagent.com/api"
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"
TENANT_ID = "d5587c87a7f9476fa82b83f40accd6c7"


def log(label, ok, ms, body, extra=""):
    status = "✅" if ok else "❌"
    print(f"{status} {label:55s} {ms:6d} ms  {extra}")
    if not ok:
        print(f"   Body: {json.dumps(body)[:500]}")


def login():
    t0 = time.time()
    r = requests.post(f"{BASE}/auth/login", json={
        "email": EMAIL,
        "password": PASSWORD,
    }, timeout=30)
    ms = int((time.time() - t0) * 1000)
    if r.status_code != 200:
        print(f"❌ Login failed {r.status_code}: {r.text}")
        sys.exit(1)
    j = r.json()
    token = j.get("access_token") or j.get("token")
    user = j.get("user") or {}
    tenants = user.get("tenants") or []
    print(f"✅ Login OK in {ms}ms. token_len={len(token or '')} tenants={len(tenants)}")
    if tenants:
        print(f"   tenants[0]: {tenants[0].get('tenant_id')} ({tenants[0].get('tenant_name')})")
    return token


def post(path, token, body, timeout=60):
    t0 = time.time()
    r = requests.post(f"{BASE}{path}", json=body,
                      headers={"Authorization": f"Bearer {token}"},
                      timeout=timeout)
    ms = int((time.time() - t0) * 1000)
    return r, ms


def main():
    token = login()

    failures = 0
    print("\n=== high-sale-detail tests ===\n")

    # Test 1: fis_id 22232422 (might be cached as STK-* MIKTAR>0)
    r, ms = post("/data/high-sale-detail", token, {
        "tenant_id": TENANT_ID, "fis_id": 22232422,
    })
    if r.status_code != 200:
        failures += 1
        log("high-sale-detail fis_id=22232422", False, ms, r.text[:300])
    else:
        j = r.json()
        details = j.get("details") or []
        totals = j.get("totals") or []
        src = j.get("_source", "?")
        ok_flag = j.get("ok") is True
        extra = f"details={len(details)} totals={len(totals)} src={src} ok={ok_flag}"
        # If details exist, look for STK- + MIKTAR>0
        sample = ""
        if details:
            d0 = details[0] if isinstance(details[0], dict) else {}
            sample = (
                f" sample[STOK_KODU={d0.get('STOK_KODU')!r} "
                f"STOK_ADI={d0.get('STOK_ADI')!r} "
                f"MIKTAR={d0.get('MIKTAR')!r} "
                f"TUTAR={d0.get('TUTAR')!r}]"
            )
            # Spec: at least one with STOK_KODU starting STK- AND MIKTAR>0 if cached
            has_stk = any(
                isinstance(d, dict)
                and str(d.get("STOK_KODU") or "").startswith("STK-")
                and float(d.get("MIKTAR") or 0) > 0
                for d in details
            )
            extra += f" has_STK+MIKTAR>0={has_stk}"
        log("high-sale-detail fis_id=22232422", ok_flag, ms, j, extra + sample)
        if not ok_flag:
            failures += 1

    # Test 2: fis_id 22280537 (might be cached as PRI:63292 / SİGARA)
    r, ms = post("/data/high-sale-detail", token, {
        "tenant_id": TENANT_ID, "fis_id": 22280537,
    })
    if r.status_code != 200:
        failures += 1
        log("high-sale-detail fis_id=22280537", False, ms, r.text[:300])
    else:
        j = r.json()
        details = j.get("details") or []
        totals = j.get("totals") or []
        src = j.get("_source", "?")
        ok_flag = j.get("ok") is True
        extra = f"details={len(details)} totals={len(totals)} src={src} ok={ok_flag}"
        sample = ""
        if details:
            d0 = details[0] if isinstance(details[0], dict) else {}
            sample = (
                f" sample[STOK_KODU={d0.get('STOK_KODU')!r} "
                f"STOK_ADI={d0.get('STOK_ADI')!r} "
                f"MIKTAR={d0.get('MIKTAR')!r}]"
            )
        log("high-sale-detail fis_id=22280537", ok_flag, ms, j, extra + sample)
        if not ok_flag:
            failures += 1

    # Test 3: non-existent fis_id 999999999
    r, ms = post("/data/high-sale-detail", token, {
        "tenant_id": TENANT_ID, "fis_id": 999999999,
    })
    if r.status_code != 200:
        failures += 1
        log("high-sale-detail fis_id=999999999 (non-existent)", False, ms, r.text[:300])
    else:
        j = r.json()
        details = j.get("details") or []
        totals = j.get("totals") or []
        ok_flag = j.get("ok") is True
        # Spec: should return ok:true with details:[] totals:[]
        is_empty = (details == [] and totals == [])
        extra = f"details={len(details)} totals={len(totals)} ok={ok_flag} empty={is_empty}"
        log("high-sale-detail fis_id=999999999", ok_flag and is_empty, ms, j, extra)
        if not (ok_flag and is_empty):
            failures += 1

    print("\n=== regression: iptal-detail ===\n")

    r, ms = post("/data/iptal-detail", token, {
        "tenant_id": TENANT_ID, "iptal_id": 1,
    })
    if r.status_code != 200:
        failures += 1
        log("iptal-detail iptal_id=1", False, ms, r.text[:300])
    else:
        j = r.json()
        ok_flag = j.get("ok") is True
        data_len = len(j.get("data") or [])
        log("iptal-detail iptal_id=1", ok_flag, ms, j, f"ok={ok_flag} data_rows={data_len}")
        if not ok_flag:
            failures += 1

    print("\n=== regression: fis-detail ===\n")

    r, ms = post("/data/fis-detail", token, {
        "tenant_id": TENANT_ID, "fis_id": 1,
    })
    if r.status_code != 200:
        failures += 1
        log("fis-detail fis_id=1", False, ms, r.text[:300])
    else:
        j = r.json()
        ok_flag = j.get("ok") is True
        det_len = len(j.get("details") or [])
        tot_len = len(j.get("totals") or [])
        log("fis-detail fis_id=1", ok_flag, ms, j, f"ok={ok_flag} details={det_len} totals={tot_len}")
        if not ok_flag:
            failures += 1

    print(f"\n=== Summary: {failures} failure(s) ===")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
