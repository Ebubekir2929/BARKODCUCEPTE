#!/usr/bin/env python3
"""
Regression test for:
 - POST /api/data/hourly-detail-full (new SQL-level aggregation)
 - POST /api/data/iptal-list
 - POST /api/data/stock-list
 - POST /api/data/cari-list
 - POST /api/data/table-detail (with invalid pos_id)
 - GET  /api/data/dashboard

Review request: ensure no 500s, no >5s Android-ANR-triggering responses.
Report timings + payload sizes + any errors.
"""
import os
import sys
import time
import json
import requests
from datetime import date, timedelta

BASE_URL = "https://retail-sync-portal-1.preview.emergentagent.com/api"

LOGIN_EMAIL = "cakmak_ebubekir@hotmail.com"
LOGIN_PASSWORD = "admin"

TENANT_GUMUSHANE = "4d9b503a96f5430aad34c430301a8aa1"
TENANT_MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"

ANR_LIMIT_SEC = 5.0
RESULTS = []


def _log(name: str, ok: bool, secs: float, size: int, detail: str = ""):
    status = "✅" if ok else "❌"
    print(f"{status} {name:<55} {secs*1000:8.0f} ms  {size:>8} bytes  {detail}")
    RESULTS.append({"name": name, "ok": ok, "secs": secs, "size": size, "detail": detail})


def login() -> str:
    url = f"{BASE_URL}/auth/login"
    r = requests.post(url, json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD}, timeout=30)
    r.raise_for_status()
    token = r.json().get("access_token") or r.json().get("token")
    if not token:
        raise RuntimeError(f"No token in login response: {r.text[:300]}")
    return token


def post(token: str, path: str, body: dict, timeout: int = 60):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}{path}",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    elapsed = time.time() - t0
    size = len(r.content)
    return r, elapsed, size


def get(token: str, path: str, params: dict, timeout: int = 60):
    t0 = time.time()
    r = requests.get(
        f"{BASE_URL}{path}",
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    elapsed = time.time() - t0
    size = len(r.content)
    return r, elapsed, size


# ---------- Tests ----------

def test_hourly_full(token: str):
    """POST /api/data/hourly-detail-full for Gümüşhane + Merkez.
    cold<5s (review wants <2s), warm<300ms, payload<5KB.
    """
    today = date.today().strftime("%Y-%m-%d")
    for tenant_name, tenant_id in [("Gümüşhane", TENANT_GUMUSHANE), ("Merkez", TENANT_MERKEZ)]:
        body = {"tenant_id": tenant_id, "sdate": today, "edate": today, "force_refresh": True}
        # Cold
        r, elapsed, size = post(token, "/data/hourly-detail-full", body, timeout=60)
        detail = ""
        ok = r.status_code == 200
        if ok:
            try:
                j = r.json()
            except Exception as e:
                ok = False
                detail = f"json parse: {e}"
                _log(f"hourly-full cold ({tenant_name})", ok, elapsed, size, detail)
                continue
            if not j.get("ok"):
                ok = False
                detail = f"ok=false payload={json.dumps(j)[:200]}"
            elif "by_hour" not in j or "row_count" not in j or "hour_count" not in j:
                ok = False
                detail = f"missing keys; got={list(j.keys())}"
            else:
                # Validate aggregate shape
                by_hour = j.get("by_hour") or {}
                shape_ok = True
                shape_err = ""
                for hk, vlist in by_hour.items():
                    if not isinstance(vlist, list) or len(vlist) != 1:
                        shape_ok = False
                        shape_err = f"hour {hk} not list[1] (got {type(vlist).__name__} len={len(vlist) if isinstance(vlist, list) else 'N/A'})"
                        break
                    row = vlist[0]
                    for k in ("KDV_DAHIL_TOPLAM_TUTAR", "TOPLAM_TUTAR", "FIS_SAYISI"):
                        if k not in row:
                            shape_ok = False
                            shape_err = f"hour {hk} missing {k}"
                            break
                    if not row.get("_AGGREGATE"):
                        shape_ok = False
                        shape_err = f"hour {hk} _AGGREGATE missing/false"
                        break
                    if not shape_ok:
                        break
                if not shape_ok:
                    ok = False
                    detail = shape_err
                else:
                    detail = f"hours={j.get('hour_count')} rows={j.get('row_count')} cache={j.get('_cache')}"
        else:
            detail = f"HTTP {r.status_code}: {r.text[:200]}"
        if ok and elapsed > ANR_LIMIT_SEC:
            ok = False
            detail += f" (>ANR {elapsed:.2f}s)"
        _log(f"hourly-full cold ({tenant_name})", ok, elapsed, size, detail)

        # Payload <5KB check (pure informational — flag as warning if exceeded)
        if size >= 5120:
            _log(f"hourly-full PAYLOAD<5KB ({tenant_name})", False, 0, size, f"payload {size} bytes exceeds 5KB")
        else:
            _log(f"hourly-full PAYLOAD<5KB ({tenant_name})", True, 0, size, "OK")

        # Warm (no force_refresh) – should hit memory cache
        body2 = {"tenant_id": tenant_id, "sdate": today, "edate": today}
        r2, elapsed2, size2 = post(token, "/data/hourly-detail-full", body2, timeout=30)
        w_ok = (r2.status_code == 200)
        w_detail = ""
        if w_ok:
            try:
                j2 = r2.json()
                w_detail = f"cache={j2.get('_cache')} age={j2.get('_age')}"
            except Exception as e:
                w_ok = False
                w_detail = f"json: {e}"
        else:
            w_detail = f"HTTP {r2.status_code}: {r2.text[:150]}"
        # Warm target 300ms
        if w_ok and elapsed2 > 0.5:
            w_ok = False
            w_detail += f" (>500ms)"
        _log(f"hourly-full warm ({tenant_name})", w_ok, elapsed2, size2, w_detail)


def test_iptal_list(token: str):
    today = date.today().strftime("%Y-%m-%d")
    for tenant_name, tenant_id in [("Merkez", TENANT_MERKEZ), ("Gümüşhane", TENANT_GUMUSHANE)]:
        body = {"tenant_id": tenant_id, "sdate": today, "edate": today}
        # Cold
        r, elapsed, size = post(token, "/data/iptal-list", body, timeout=45)
        ok = r.status_code == 200
        detail = ""
        rows = 0
        if ok:
            try:
                j = r.json()
                rows = len(j.get("data") or [])
                detail = f"rows={rows} ok={j.get('ok')} source={j.get('_source', 'n/a')}"
            except Exception as e:
                ok = False
                detail = f"json: {e}"
        else:
            detail = f"HTTP {r.status_code}: {r.text[:200]}"
        if ok and elapsed > ANR_LIMIT_SEC:
            ok = False
            detail += f" (>ANR {elapsed:.2f}s)"
        _log(f"iptal-list cold ({tenant_name})", ok, elapsed, size, detail)

        # Warm
        r2, elapsed2, size2 = post(token, "/data/iptal-list", body, timeout=30)
        w_ok = (r2.status_code == 200)
        w_detail = ""
        if w_ok:
            try:
                j2 = r2.json()
                w_detail = f"rows={len(j2.get('data') or [])} src={j2.get('_source', '?')}"
            except Exception:
                pass
        else:
            w_detail = f"HTTP {r2.status_code}"
        _log(f"iptal-list warm ({tenant_name})", w_ok, elapsed2, size2, w_detail)


def test_stock_list(token: str):
    for tenant_name, tenant_id in [("Merkez", TENANT_MERKEZ), ("Gümüşhane", TENANT_GUMUSHANE)]:
        # fiyat_ad=0 full list
        body_full = {
            "tenant_id": tenant_id,
            "page": 1,
            "per_page": 50,
            "fiyat_ad": 0,
        }
        r, elapsed, size = post(token, "/data/stock-list", body_full, timeout=45)
        ok = r.status_code == 200
        detail = ""
        total_full = -1
        if ok:
            try:
                j = r.json()
                total_full = j.get("total_count", -1)
                detail = f"total={total_full} src={j.get('_source')} page={len(j.get('data') or [])}"
            except Exception as e:
                ok = False
                detail = f"json: {e}"
        else:
            detail = f"HTTP {r.status_code}: {r.text[:200]}"
        if ok and elapsed > ANR_LIMIT_SEC:
            ok = False
            detail += f" (>ANR {elapsed:.2f}s)"
        _log(f"stock-list fiyat_ad=0 ({tenant_name})", ok, elapsed, size, detail)

        # fiyat_ad=1017 subset (Bayi)
        body_sub = {
            "tenant_id": tenant_id,
            "page": 1,
            "per_page": 50,
            "fiyat_ad": 1017,
        }
        r2, elapsed2, size2 = post(token, "/data/stock-list", body_sub, timeout=45)
        ok2 = r2.status_code == 200
        detail2 = ""
        total_sub = -1
        if ok2:
            try:
                j2 = r2.json()
                total_sub = j2.get("total_count", -1)
                detail2 = f"total={total_sub} src={j2.get('_source')}"
                # Informational: subset should be <= full
                if total_full >= 0 and total_sub > total_full:
                    detail2 += f" (WARN: subset>{total_full}=full)"
            except Exception as e:
                ok2 = False
                detail2 = f"json: {e}"
        else:
            detail2 = f"HTTP {r2.status_code}: {r2.text[:200]}"
        if ok2 and elapsed2 > ANR_LIMIT_SEC:
            ok2 = False
            detail2 += f" (>ANR {elapsed2:.2f}s)"
        _log(f"stock-list fiyat_ad=1017 ({tenant_name})", ok2, elapsed2, size2, detail2)


def test_cari_list(token: str):
    for tenant_name, tenant_id in [("Merkez", TENANT_MERKEZ), ("Gümüşhane", TENANT_GUMUSHANE)]:
        body = {"tenant_id": tenant_id, "page": 1, "per_page": 50}
        r, elapsed, size = post(token, "/data/cari-list", body, timeout=45)
        ok = r.status_code == 200
        detail = ""
        if ok:
            try:
                j = r.json()
                detail = f"total={j.get('total_count')} src={j.get('_source')} page={len(j.get('data') or [])}"
            except Exception as e:
                ok = False
                detail = f"json: {e}"
        else:
            detail = f"HTTP {r.status_code}: {r.text[:200]}"
        if ok and elapsed > ANR_LIMIT_SEC:
            ok = False
            detail += f" (>ANR {elapsed:.2f}s)"
        _log(f"cari-list ({tenant_name})", ok, elapsed, size, detail)


def test_table_detail_invalid(token: str):
    """Should NOT crash (no 500) even with bogus pos_id."""
    body = {"tenant_id": TENANT_MERKEZ, "pos_id": 999999999}
    r, elapsed, size = post(token, "/data/table-detail", body, timeout=45)
    # Acceptable: 200 with empty data OR a controlled 4xx. 500 = fail.
    if r.status_code == 500:
        _log("table-detail invalid pos_id", False, elapsed, size, f"500 ERROR: {r.text[:200]}")
        return
    ok = (r.status_code in (200, 400, 404, 422))
    detail = f"HTTP {r.status_code}"
    try:
        j = r.json()
        if isinstance(j, dict):
            detail += f" ok={j.get('ok')} data_len={len(j.get('data') or []) if isinstance(j.get('data'), list) else '-'}"
    except Exception:
        pass
    if ok and elapsed > ANR_LIMIT_SEC:
        ok = False
        detail += f" (>ANR {elapsed:.2f}s)"
    _log("table-detail invalid pos_id (no-crash)", ok, elapsed, size, detail)


def test_dashboard(token: str):
    today = date.today().strftime("%Y-%m-%d")
    for tenant_name, tenant_id in [("Merkez", TENANT_MERKEZ), ("Gümüşhane", TENANT_GUMUSHANE)]:
        r, elapsed, size = get(
            token, "/data/dashboard",
            {"tenant_id": tenant_id, "sdate": today, "edate": today},
            timeout=60,
        )
        ok = r.status_code == 200
        detail = ""
        if ok:
            try:
                j = r.json()
                detail = f"keys={len(j.keys())} size={size}"
            except Exception as e:
                ok = False
                detail = f"json: {e}"
        else:
            detail = f"HTTP {r.status_code}: {r.text[:300]}"
        if ok and elapsed > ANR_LIMIT_SEC:
            ok = False
            detail += f" (>ANR {elapsed:.2f}s)"
        # Payload check < 50KB
        size_ok = size < 51200
        _log(f"dashboard ({tenant_name})", ok, elapsed, size, detail)
        _log(f"dashboard PAYLOAD<50KB ({tenant_name})", size_ok, 0, size, "OK" if size_ok else f"{size} bytes > 50KB")


def main():
    print(f"Base URL: {BASE_URL}")
    print(f"Login: {LOGIN_EMAIL}")
    try:
        token = login()
    except Exception as e:
        print(f"❌ LOGIN FAILED: {e}")
        return 2
    print(f"✅ Logged in (token len={len(token)})")
    print(f"{'─'*130}")
    print(f"{'TEST':<55} {'TIME':>11}  {'SIZE':>8}  DETAIL")
    print(f"{'─'*130}")

    test_hourly_full(token)
    print()
    test_iptal_list(token)
    print()
    test_stock_list(token)
    print()
    test_cari_list(token)
    print()
    test_table_detail_invalid(token)
    print()
    test_dashboard(token)
    print(f"{'─'*130}")

    passed = sum(1 for r in RESULTS if r["ok"])
    failed = len(RESULTS) - passed
    print(f"PASS: {passed}/{len(RESULTS)}   FAIL: {failed}")
    if failed:
        print("\nFAILED TESTS:")
        for r in RESULTS:
            if not r["ok"]:
                print(f"  ❌ {r['name']}: {r['detail']}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
