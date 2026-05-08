"""
Backend regression test for KDV/Matrah breakdown fields & low_stock_daily_minute setting.
Per review request: /app/test_result.md → review_request.
"""
import os
import sys
import json
import time
from typing import Any, Dict, List, Tuple

import requests

BACKEND = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://notify-deep-link.preview.emergentagent.com"
).rstrip("/")
API = f"{BACKEND}/api"

ADMIN_EMAIL = "cakmak.ebubekir29@gmail.com"
ADMIN_PASSWORD = "123456"
TENANT_ID = "4d9b503a96f5430aad34c430301a8aa1"  # Gümüşhane

results: List[Tuple[str, bool, str]] = []


def rec(name: str, ok: bool, msg: str = "") -> None:
    results.append((name, ok, msg))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name} :: {msg}")


def login() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"identifier": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        # try alternative shapes
        r = requests.post(
            f"{API}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30,
        )
    r.raise_for_status()
    j = r.json()
    tok = j.get("token") or j.get("access_token") or (j.get("user") or {}).get("token")
    if not tok:
        raise RuntimeError(f"No token in login response keys={list(j.keys())}")
    return tok


def f(v: Any) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def test_dashboard_kdv(tok: str) -> None:
    headers = {"Authorization": f"Bearer {tok}"}

    # Test 1: with sdate/edate single day
    url = f"{API}/data/dashboard"
    params = {
        "tenant_id": TENANT_ID,
        "sdate": "2026-05-08",
        "edate": "2026-05-08",
    }
    t0 = time.time()
    r = requests.get(url, headers=headers, params=params, timeout=120)
    elapsed = time.time() - t0
    rec(
        "GET /api/data/dashboard sdate=edate=2026-05-08 status",
        r.status_code == 200,
        f"HTTP {r.status_code} in {elapsed*1000:.0f}ms",
    )
    if r.status_code != 200:
        print("RESPONSE BODY:", r.text[:500])
        return

    j = r.json()
    fdl = j.get("financial_data_location") or {}
    rows = fdl.get("data") or []
    rec(
        "financial_data_location.data is non-empty list",
        isinstance(rows, list) and len(rows) > 0,
        f"len={len(rows) if isinstance(rows, list) else 'N/A'}",
    )
    if not rows:
        # log keys
        print("Top-level keys:", list(j.keys()))
        return

    # Verify required fields
    required_any_breakdown = [
        "MATRAH_1", "MATRAH_10", "MATRAH_20",
        "KDV_1", "KDV_10", "KDV_20",
    ]
    sample = rows[0]
    print("First row keys (sample):", list(sample.keys())[:60])

    def has_loc(r: dict) -> bool:
        return r.get("LOKASYON") is not None
    def has_total_matrah(r: dict) -> bool:
        return r.get("TOPLAM_MATRAH") is not None
    def has_total_kdv(r: dict) -> bool:
        return r.get("TOPLAM_KDV") is not None
    def has_any_breakdown(r: dict) -> bool:
        return any(r.get(k) is not None for k in required_any_breakdown)

    loc_ok = all(has_loc(r) for r in rows)
    matrah_ok = all(has_total_matrah(r) for r in rows)
    kdv_ok = all(has_total_kdv(r) for r in rows)
    bk_ok = any(has_any_breakdown(r) for r in rows)

    rec("Each row has LOKASYON", loc_ok, "")
    rec("Each row has TOPLAM_MATRAH", matrah_ok, "")
    rec("Each row has TOPLAM_KDV", kdv_ok, "")
    rec(
        "At least one row has MATRAH_1/10/20 or KDV_1/10/20 set",
        bk_ok,
        f"sample TOPLAM_MATRAH={sample.get('TOPLAM_MATRAH')} TOPLAM_KDV={sample.get('TOPLAM_KDV')}",
    )

    # Aggregate sum check: sum(TOPLAM_MATRAH+TOPLAM_KDV) ≈ sum(MATRAH_*+KDV_*)
    sum_total = sum(f(r.get("TOPLAM_MATRAH")) + f(r.get("TOPLAM_KDV")) for r in rows)
    breakdown_keys = [
        "MATRAH_0", "MATRAH_1", "MATRAH_8", "MATRAH_10", "MATRAH_18", "MATRAH_20",
        "KDV_0", "KDV_1", "KDV_8", "KDV_10", "KDV_18", "KDV_20",
    ]
    sum_break = sum(sum(f(r.get(k)) for k in breakdown_keys) for r in rows)
    diff = abs(sum_total - sum_break)
    rec(
        "Sum(TOPLAM_MATRAH+TOPLAM_KDV) ≈ Sum(per-rate matrah+kdv) within ₺1",
        diff <= 1.0,
        f"sum_total={sum_total:.2f} sum_break={sum_break:.2f} diff={diff:.2f}",
    )

    # Test 2: without sdate/edate
    t0 = time.time()
    r = requests.get(url, headers=headers, params={"tenant_id": TENANT_ID}, timeout=120)
    elapsed = time.time() - t0
    rec(
        "GET /api/data/dashboard no date params status",
        r.status_code == 200,
        f"HTTP {r.status_code} in {elapsed*1000:.0f}ms",
    )
    if r.status_code == 200:
        jj = r.json()
        fdl2 = jj.get("financial_data_location") or {}
        rows2 = fdl2.get("data") or []
        rec(
            "no-date returns financial_data_location structure",
            isinstance(rows2, list),
            f"row_count={len(rows2)}",
        )

    # Test 4: Multi-day aggregation
    params_range = {
        "tenant_id": TENANT_ID,
        "sdate": "2026-05-06",
        "edate": "2026-05-08",
    }
    t0 = time.time()
    r = requests.get(url, headers=headers, params=params_range, timeout=120)
    elapsed = time.time() - t0
    rec(
        "GET /api/data/dashboard multi-day 2026-05-06..08 status",
        r.status_code == 200,
        f"HTTP {r.status_code} in {elapsed*1000:.0f}ms",
    )
    if r.status_code == 200:
        jj = r.json()
        fdl3 = jj.get("financial_data_location") or {}
        rows3 = fdl3.get("data") or []
        rec(
            "multi-day financial_data_location aggregated by LOKASYON",
            isinstance(rows3, list),
            f"row_count={len(rows3)}",
        )
        if rows3:
            # Verify LOKASYON unique (aggregation merges per-day per-location)
            locs = [r.get("LOKASYON") for r in rows3]
            unique_count = len(set(locs))
            rec(
                "LOKASYON values are unique after aggregation",
                unique_count == len(locs),
                f"unique={unique_count}/{len(locs)}",
            )
            # Verify breakdown sum check on aggregated rows
            sum_total = sum(f(r.get("TOPLAM_MATRAH")) + f(r.get("TOPLAM_KDV")) for r in rows3)
            sum_break = sum(sum(f(r.get(k)) for k in breakdown_keys) for r in rows3)
            diff = abs(sum_total - sum_break)
            rec(
                "Multi-day Sum(TOPLAM)+Sum(breakdown) within ₺1",
                diff <= 1.0,
                f"sum_total={sum_total:.2f} sum_break={sum_break:.2f} diff={diff:.2f}",
            )


def test_low_stock_daily_minute(tok: str) -> None:
    headers = {"Authorization": f"Bearer {tok}"}

    # GET initial settings
    r = requests.get(f"{API}/notifications/settings", headers=headers, timeout=30)
    rec(
        "GET /api/notifications/settings status",
        r.status_code == 200,
        f"HTTP {r.status_code}",
    )
    if r.status_code != 200:
        print("BODY:", r.text[:300])
        return
    j = r.json()
    s = j.get("settings") or {}
    rec(
        "GET settings includes low_stock_daily_minute (default integer)",
        "low_stock_daily_minute" in s and isinstance(s.get("low_stock_daily_minute"), int),
        f"value={s.get('low_stock_daily_minute')}",
    )
    saved_orig = s.copy()

    # Helper to POST with merged settings
    def post_settings(minute_val: int):
        body = {
            "notify_cancellations": s.get("notify_cancellations", True),
            "notify_line_cancellations": s.get("notify_line_cancellations", True),
            "notify_high_sales": s.get("notify_high_sales", True),
            "high_sales_threshold": s.get("high_sales_threshold", 5000.0),
            "notify_low_stock": s.get("notify_low_stock", True),
            "check_interval_minutes": s.get("check_interval_minutes", 15),
            "low_stock_mode": s.get("low_stock_mode", "daily"),
            "low_stock_daily_hour": s.get("low_stock_daily_hour", 13),
            "low_stock_daily_minute": minute_val,
            "low_stock_interval_hours": s.get("low_stock_interval_hours", 6),
        }
        return requests.post(f"{API}/notifications/settings", headers=headers, json=body, timeout=30)

    # Case A: 30 → persists
    r = post_settings(30)
    rec("POST settings low_stock_daily_minute=30", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code == 200:
        rg = requests.get(f"{API}/notifications/settings", headers=headers, timeout=30).json()
        v = (rg.get("settings") or {}).get("low_stock_daily_minute")
        rec("GET after POST 30 returns 30", v == 30, f"value={v}")

    # Case B: 75 → clamp to 59
    r = post_settings(75)
    rec("POST low_stock_daily_minute=75", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code == 200:
        rg = requests.get(f"{API}/notifications/settings", headers=headers, timeout=30).json()
        v = (rg.get("settings") or {}).get("low_stock_daily_minute")
        rec("75 clamps to 59", v == 59, f"value={v}")

    # Case C: -5 → clamp to 0
    r = post_settings(-5)
    rec("POST low_stock_daily_minute=-5", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code == 200:
        rg = requests.get(f"{API}/notifications/settings", headers=headers, timeout=30).json()
        v = (rg.get("settings") or {}).get("low_stock_daily_minute")
        rec("-5 clamps to 0", v == 0, f"value={v}")

    # Restore original
    try:
        post_settings(int(saved_orig.get("low_stock_daily_minute") or 0))
    except Exception:
        pass


def main():
    print(f"Backend: {API}")
    try:
        tok = login()
        print(f"Login OK, token len={len(tok)}")
    except Exception as e:
        print(f"LOGIN FAILED: {e}")
        sys.exit(2)

    print("\n===== KDV/Matrah Dashboard Tests =====")
    test_dashboard_kdv(tok)

    print("\n===== Notification Settings Tests (low_stock_daily_minute) =====")
    test_low_stock_daily_minute(tok)

    # Summary
    print("\n===== SUMMARY =====")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"PASSED {passed}/{total}")
    for name, ok, msg in results:
        flag = "✅" if ok else "❌"
        print(f" {flag} {name}: {msg}")
    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
