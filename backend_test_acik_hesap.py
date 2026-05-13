"""
Backend regression test for /api/data/acik-hesap-kisi cache lookup fix.

The endpoint previously timed out at 120s because the cache lookup params
included Page/PageSize which didn't match the cache row in
kasacepteweb.dataset_cache (which only stores {sdate, edate} for the
rap_acik_hesap_kisi_ozet_web dataset).

Fix: cache lookup params are now strictly {sdate, edate} and cache_only=True.

Verifies:
1) /acik-hesap-kisi 2026-05-13 (Merkez)
2) /acik-hesap-kisi 2026-05-12 (Merkez)
3) /acik-hesap-kisi today (Gümüşhane)
4) /acik-hesap-kisi sdate only (auto-fill edate)
5) /acik-hesap-kisi without tenant_id -> 400
6) Regression: /fis-detail, /cari-extre, /stock-extre still work
"""

import os
import time
import json
import datetime as dt

import requests

BASE = "https://mobile-pos-app-7.preview.emergentagent.com/api"
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"

MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"
GUMUSHANE = "4d9b503a96f5430aad34c430301a8aa1"

results = []


def log(name, ok, info=""):
    icon = "PASS" if ok else "FAIL"
    line = f"[{icon}] {name} :: {info}"
    print(line, flush=True)
    results.append((name, ok, info))


def login():
    r = requests.post(f"{BASE}/auth/login", json={
        "email": EMAIL,
        "password": PASSWORD,
    }, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def post_acik(token, body, timeout=15):
    """Call /data/acik-hesap-kisi and return (status, elapsed_ms, body)."""
    t0 = time.time()
    try:
        r = requests.post(
            f"{BASE}/data/acik-hesap-kisi",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
        )
        elapsed = (time.time() - t0) * 1000.0
        try:
            data = r.json()
        except Exception:
            data = {"_text": r.text[:300]}
        return r.status_code, elapsed, data
    except requests.exceptions.Timeout:
        elapsed = (time.time() - t0) * 1000.0
        return -1, elapsed, {"error": "timeout"}


def main():
    print(f"BASE = {BASE}")
    print(f"Logging in as {EMAIL} ...")
    token = login()
    print(f"Token len = {len(token)}\n")

    # =====================================================================
    # 1) Merkez 2026-05-13
    # =====================================================================
    status, elapsed, data = post_acik(token, {
        "tenant_id": MERKEZ,
        "sdate": "2026-05-13",
        "edate": "2026-05-13",
    })
    src = data.get("_source") if isinstance(data, dict) else None
    n = len(data.get("data", []) or []) if isinstance(data, dict) else 0
    totals = data.get("totals") if isinstance(data, dict) else None
    ok = (
        status == 200
        and elapsed < 5000
        and isinstance(data, dict)
        and "data" in data
        and isinstance(data["data"], list)
        and "totals" in data
        and "page" in data
        and "page_size" in data
    )
    log(
        "1) Merkez sdate=edate=2026-05-13",
        ok,
        f"status={status} elapsed={elapsed:.0f}ms rows={n} src={src} totals={totals}",
    )

    # =====================================================================
    # 2) Merkez 2026-05-12
    # =====================================================================
    status, elapsed, data = post_acik(token, {
        "tenant_id": MERKEZ,
        "sdate": "2026-05-12",
        "edate": "2026-05-12",
    })
    src = data.get("_source") if isinstance(data, dict) else None
    n = len(data.get("data", []) or []) if isinstance(data, dict) else 0
    totals = data.get("totals") if isinstance(data, dict) else None
    ok = (
        status == 200
        and elapsed < 5000
        and isinstance(data, dict)
        and isinstance(data.get("data"), list)
        and isinstance(data.get("totals"), dict)
        and "page" in data
        and "page_size" in data
    )
    log(
        "2) Merkez sdate=edate=2026-05-12",
        ok,
        f"status={status} elapsed={elapsed:.0f}ms rows={n} src={src} totals={totals}",
    )

    # =====================================================================
    # 3) Gümüşhane today
    # =====================================================================
    today = dt.date.today().strftime("%Y-%m-%d")
    status, elapsed, data = post_acik(token, {
        "tenant_id": GUMUSHANE,
        "sdate": today,
        "edate": today,
    })
    src = data.get("_source") if isinstance(data, dict) else None
    n = len(data.get("data", []) or []) if isinstance(data, dict) else 0
    totals = data.get("totals") if isinstance(data, dict) else None
    ok = (
        status == 200
        and elapsed < 5000
        and isinstance(data, dict)
        and isinstance(data.get("data"), list)
        and isinstance(data.get("totals"), dict)
    )
    log(
        f"3) Gümüşhane today={today}",
        ok,
        f"status={status} elapsed={elapsed:.0f}ms rows={n} src={src} totals={totals}",
    )

    # =====================================================================
    # 4) Merkez sdate-only (auto-fill edate)
    # =====================================================================
    status, elapsed, data = post_acik(token, {
        "tenant_id": MERKEZ,
        "sdate": "2026-05-13",
    })
    src = data.get("_source") if isinstance(data, dict) else None
    n = len(data.get("data", []) or []) if isinstance(data, dict) else 0
    ok = (
        status == 200
        and elapsed < 5000
        and isinstance(data, dict)
        and isinstance(data.get("data"), list)
    )
    log(
        "4) Merkez sdate-only (auto edate)",
        ok,
        f"status={status} elapsed={elapsed:.0f}ms rows={n} src={src}",
    )

    # =====================================================================
    # 5) No tenant_id -> 400
    # =====================================================================
    status, elapsed, data = post_acik(token, {}, timeout=10)
    ok = status == 400
    log(
        "5) No tenant_id -> 400",
        ok,
        f"status={status} elapsed={elapsed:.0f}ms body={json.dumps(data)[:200]}",
    )

    # =====================================================================
    # 6) Regression — /fis-detail, /cari-extre, /stock-extre
    # =====================================================================
    # 6a) fis-detail Merkez fis_id=20261131 (known cached entry)
    t0 = time.time()
    r = requests.post(
        f"{BASE}/data/fis-detail",
        json={"tenant_id": MERKEZ, "fis_id": 20261131},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    elapsed = (time.time() - t0) * 1000.0
    try:
        body = r.json()
    except Exception:
        body = {}
    details = body.get("details") if isinstance(body, dict) else None
    totals = body.get("totals") if isinstance(body, dict) else None
    ok = (
        r.status_code == 200
        and isinstance(body, dict)
        and isinstance(details, list)
        and isinstance(totals, list)
    )
    log(
        "6a) /fis-detail fis_id=20261131",
        ok,
        f"status={r.status_code} elapsed={elapsed:.0f}ms details={len(details or [])} totals={len(totals or [])}",
    )

    # 6b) cari-extre Merkez cari_id=438352 short date range
    t0 = time.time()
    r = requests.post(
        f"{BASE}/data/cari-extre",
        json={
            "tenant_id": MERKEZ,
            "cari_id": 438352,
            "sdate": "2026-01-01",
            "edate": "2026-02-15",
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    elapsed = (time.time() - t0) * 1000.0
    try:
        body = r.json()
    except Exception:
        body = {}
    data_list = body.get("data") if isinstance(body, dict) else None
    ok = (
        r.status_code == 200
        and isinstance(body, dict)
        and isinstance(data_list, list)
    )
    log(
        "6b) /cari-extre cari_id=438352 (regression)",
        ok,
        f"status={r.status_code} elapsed={elapsed:.0f}ms rows={len(data_list or [])}",
    )

    # 6c) stock-extre Merkez stok_id=438230
    t0 = time.time()
    r = requests.post(
        f"{BASE}/data/stock-extre",
        json={
            "tenant_id": MERKEZ,
            "stok_id": 438230,
            "sdate": "2026-05-01",
            "edate": "2026-05-12",
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    elapsed = (time.time() - t0) * 1000.0
    try:
        body = r.json()
    except Exception:
        body = {}
    data_list = body.get("data") if isinstance(body, dict) else None
    ok = (
        r.status_code == 200
        and isinstance(body, dict)
        and isinstance(data_list, list)
    )
    log(
        "6c) /stock-extre stok_id=438230 (regression)",
        ok,
        f"status={r.status_code} elapsed={elapsed:.0f}ms rows={len(data_list or [])}",
    )

    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"SUMMARY: {passed}/{total} PASS")
    for name, ok, info in results:
        icon = "✅" if ok else "❌"
        print(f"  {icon} {name}")
        if not ok:
            print(f"      {info}")
    print("=" * 70)

    return 0 if passed == total else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
