"""
Backend tests for the new negative-stock summary notification feature.

Covers:
  1) Startup log contains "📦 Negative-stock summary watcher started"
  2) POST /api/notifications/scan-now-eksi-stok
     - before enabling notify_low_stock / registering token → no_subscribers_for_user
     - after enabling → ok:true with tenant list, negative_count, pushed, sample
  3) Confirms per-item eksi-stok spam is disabled in _check_tenant_for_user
     (section 2 is a no-op comment block; only _negative_stock_summary_loop emits low-stock pushes)
  4) Dedup bypass on manual endpoint (second call still returns pushed=true if negative_count>0)
  5) GET /api/notifications/settings persists notify_low_stock
  6) Regression: GET /api/notifications/my-tokens + register/unregister flow still works
"""
from __future__ import annotations
import os
import sys
import json
import time
import re
from typing import Any, Dict
import httpx

BASE_URL = os.environ.get(
    "BACKEND_BASE",
    "https://retail-sync-portal-1.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "cakmak_ebubekir@hotmail.com"  # "berk" — as specified in the review request
PASSWORD = "admin"

# Second user that actually owns Merkez (d5587c87...) & Gümüşhane per MySQL/Mongo data.
# Used to exercise the happy path (tenants[] with real stock_list data) because
# the review-specified user (berk / user 8) has ZERO tenants attached (no primary
# users.tenant_id and no rows in mongo user_tenants).
EMAIL_ADMIN = "cakmak.ebubekir29@gmail.com"
PASSWORD_ADMIN = "123456"

TEST_TOKEN = "ExponentPushToken[TEST_STUB]"

# Tracks results
_results: list[tuple[str, bool, str]] = []


def _log(name: str, ok: bool, detail: str = "") -> None:
    mark = "✅" if ok else "❌"
    print(f"{mark} {name} — {detail}")
    _results.append((name, ok, detail))


def _must(ok: bool, name: str, detail: str = ""):
    _log(name, ok, detail)
    if not ok:
        return False
    return True


def login() -> str:
    r = httpx.post(
        f"{API}/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    assert tok, f"no access_token in login response: {j}"
    print(f"[login] ok user_id={j.get('user',{}).get('user_id')} tenants={[t.get('tenant_id')[:8]+'…' for t in j.get('user',{}).get('tenants',[]) or []]}")
    return tok


def auth_headers(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def check_startup_log() -> None:
    name = "1. Startup log contains negative-stock watcher banner"
    try:
        with open("/var/log/supervisor/backend.err.log", "rb") as f:
            # tail last 400KB
            try:
                f.seek(-400_000, os.SEEK_END)
            except OSError:
                f.seek(0)
            data = f.read().decode("utf-8", errors="ignore")
    except Exception as e:
        _log(name, False, f"cannot read log: {e}")
        return

    # Look for the banner (emoji + phrase)
    pattern = r"Negative-stock summary watcher started\s*[—-]\s*fires daily at TR\s*\[13,\s*20\]:00"
    m = re.search(pattern, data)
    _log(
        name,
        bool(m),
        "banner found in backend.err.log" if m else "banner NOT found in recent log",
    )


def check_settings_get_has_flag(tok: str) -> Dict[str, Any] | None:
    r = httpx.get(f"{API}/notifications/settings", headers=auth_headers(tok), timeout=20)
    ok = r.status_code == 200
    j = r.json() if ok else {}
    has_flag = "notify_low_stock" in j.get("settings", {}) if j.get("ok") else False
    _log(
        "5. GET /notifications/settings returns notify_low_stock",
        ok and has_flag,
        f"status={r.status_code} settings_keys={list(j.get('settings',{}).keys()) if j else '-'}",
    )
    return j if ok else None


def post_settings(tok: str, notify_low_stock: bool, high_sales_threshold: float = 5000.0) -> None:
    body = {
        "notify_cancellations": True,
        "notify_line_cancellations": True,
        "notify_high_sales": True,
        "high_sales_threshold": high_sales_threshold,
        "notify_low_stock": notify_low_stock,
        "check_interval_minutes": 1,
    }
    r = httpx.post(
        f"{API}/notifications/settings",
        headers=auth_headers(tok),
        json=body,
        timeout=20,
    )
    ok = r.status_code == 200 and r.json().get("ok")
    _log(
        f"POST /notifications/settings notify_low_stock={notify_low_stock}",
        ok,
        f"status={r.status_code} body={r.text[:160]}",
    )


def register_token(tok: str) -> None:
    r = httpx.post(
        f"{API}/notifications/register-token",
        headers=auth_headers(tok),
        json={"token": TEST_TOKEN, "platform": "android", "device_name": "test-eksistok"},
        timeout=20,
    )
    ok = r.status_code == 200 and r.json().get("ok")
    _log("register fake push token (ExponentPushToken[TEST_STUB])", ok, f"status={r.status_code}")


def unregister_token(tok: str) -> None:
    try:
        r = httpx.post(
            f"{API}/notifications/unregister-token",
            headers=auth_headers(tok),
            json={"token": TEST_TOKEN},
            timeout=20,
        )
        _log("cleanup: unregister test token", r.status_code == 200, f"status={r.status_code}")
    except Exception as e:
        _log("cleanup: unregister test token", False, str(e))


def scan_now_eksi_stok(tok: str, label: str = "first") -> Dict[str, Any] | None:
    r = httpx.post(
        f"{API}/notifications/scan-now-eksi-stok",
        headers=auth_headers(tok),
        timeout=180,
    )
    try:
        j = r.json()
    except Exception:
        j = {"_raw": r.text[:500]}
    print(f"[scan_now_eksi_stok/{label}] status={r.status_code} json={json.dumps(j, ensure_ascii=False)[:800]}")
    if r.status_code != 200:
        _log(f"POST /scan-now-eksi-stok [{label}]", False, f"HTTP {r.status_code}")
        return None
    return j


def check_per_item_spam_disabled() -> None:
    name = "3. Per-item low_stock push inside _check_tenant_for_user is DISABLED"
    try:
        with open("/app/backend/services/notification_watcher.py", "r") as f:
            src = f.read()
    except Exception as e:
        _log(name, False, f"cannot read file: {e}")
        return

    # Evidence 1: the marker comment about moving to dedicated loop
    marker_re = re.search(
        r"Eksi Stok summary notifications moved to dedicated _negative_stock_summary_loop",
        src,
    )

    # Evidence 2: find the body of _check_tenant_for_user and ensure there's no
    # `_push_many` call wrapped in a `for kod, info in totals.items()` loop.
    func_match = re.search(
        r"async def _check_tenant_for_user\([\s\S]+?(?=\n(?:async )?def |\Z)",
        src,
    )
    per_item_loop = False
    if func_match:
        body = func_match.group(0)
        per_item_loop = bool(
            re.search(r"for\s+\w+\s*,\s*\w+\s+in\s+totals\.items\(\)\s*:", body)
            or re.search(r"📦\s*Eksi\s*Stok.*\n.*await\s+_push_many", body)
        )

    ok = bool(marker_re) and not per_item_loop
    _log(
        name,
        ok,
        (
            f"marker_comment={'yes' if marker_re else 'NO'} "
            f"per_item_totals_loop={'STILL PRESENT' if per_item_loop else 'absent'}"
        ),
    )


def main():
    print(f"BASE = {BASE_URL}")

    # ─── 1) startup log ────────────────────────────────────
    check_startup_log()

    # ─── 3) code-level check (before touching backend) ─────
    check_per_item_spam_disabled()

    # Login
    tok = login()

    # ─── 2a) disable notify_low_stock + unregister token, expect no_subscribers_for_user ───
    post_settings(tok, notify_low_stock=False)
    unregister_token(tok)  # ensure no active token
    j = scan_now_eksi_stok(tok, label="no_subs")
    _log(
        "2a. scan-now-eksi-stok returns no_subscribers_for_user when disabled",
        bool(j)
        and j.get("ok") is False
        and j.get("reason") == "no_subscribers_for_user",
        f"response={json.dumps(j, ensure_ascii=False) if j else '(none)'}",
    )

    # ─── 2b) enable notify_low_stock + register token ───────
    post_settings(tok, notify_low_stock=True)
    register_token(tok)

    # ─── 5) settings GET must include notify_low_stock ──────
    settings = check_settings_get_has_flag(tok)
    if settings:
        flag_val = settings.get("settings", {}).get("notify_low_stock")
        _log(
            "5b. notify_low_stock persisted as true",
            flag_val is True,
            f"value={flag_val}",
        )

    # ─── 2c) scan-now-eksi-stok with "real" subscriber ─────────
    # NOTE: The review-specified user (berk / user 8) has NO primary tenant_id
    # and NO rows in mongo user_tenants, so even with notify_low_stock=1 and an
    # active token, _collect_low_stock_subscribers returns [] for this user
    # and the endpoint correctly returns no_subscribers_for_user. The happy
    # path (tenants[] populated) is validated in the HAPPY-PATH block below
    # using cakmak.ebubekir29@gmail.com (user 55) who owns Merkez + Gümüşhane.
    j = scan_now_eksi_stok(tok, label="with_subs_berk")
    berk_expected_no_subs = (
        bool(j) and j.get("ok") is False and j.get("reason") == "no_subscribers_for_user"
    )
    _log(
        "2b (berk). scan-now-eksi-stok still returns no_subscribers_for_user because user 8 has no tenants",
        berk_expected_no_subs,
        f"response={json.dumps(j, ensure_ascii=False) if j else '-'}",
    )

    # ─── 6) Regression: my-tokens + register/unregister sanity ──
    r = httpx.get(f"{API}/notifications/my-tokens", headers=auth_headers(tok), timeout=20)
    _log(
        "6. GET /notifications/my-tokens (regression)",
        r.status_code == 200 and r.json().get("ok") is True,
        f"status={r.status_code} tokens={len(r.json().get('tokens', [])) if r.status_code==200 else '-'}",
    )

    # Cleanup user 8 first
    unregister_token(tok)
    post_settings(tok, notify_low_stock=False)

    # ────────────────────────────────────────────────────────────────
    # HAPPY-PATH VALIDATION using admin user (cakmak.ebubekir29@gmail.com)
    # who actually owns Merkez (d5587c87...) + Gümüşhane. The review-spec
    # user (berk) has NO tenants so the endpoint correctly returns
    # no_subscribers_for_user for them; to confirm tenants[] works when
    # subscribers exist we exercise the endpoint with admin.
    # ────────────────────────────────────────────────────────────────
    print("\n──── HAPPY-PATH with admin user ────")
    r = httpx.post(
        f"{API}/auth/login",
        json={"email": EMAIL_ADMIN, "password": PASSWORD_ADMIN},
        timeout=30,
    )
    if r.status_code != 200:
        _log("admin login", False, f"status={r.status_code} body={r.text[:160]}")
    else:
        admin_tok = r.json().get("access_token")
        _log("admin login", True, "ok")

        try:
            # Enable + register fake token
            post_settings(admin_tok, notify_low_stock=True)
            httpx.post(
                f"{API}/notifications/register-token",
                headers=auth_headers(admin_tok),
                json={"token": TEST_TOKEN, "platform": "android", "device_name": "admin-eksistok"},
                timeout=20,
            )

            # Call 1
            j = scan_now_eksi_stok(admin_tok, label="admin_1st")
            ok_happy = bool(j) and j.get("ok") is True and isinstance(j.get("tenants"), list) and len(j["tenants"]) > 0
            _log(
                "2b. scan-now-eksi-stok returns ok:true + non-empty tenants[] (admin user w/ subscribers)",
                ok_happy,
                f"ok={j.get('ok') if j else None} tenants={len(j.get('tenants',[])) if j else 0}",
            )

            if ok_happy and j:
                tenants = j["tenants"]
                req_keys = {"tenant_id", "tenant_name", "total_items", "negative_count", "pushed", "sample"}
                shape_ok = all(req_keys.issubset(set(t.keys())) for t in tenants)
                _log("2c. tenant record shape correct", shape_ok, f"keys={list(tenants[0].keys())}")

                merkez = next((t for t in tenants if t["tenant_id"] == "d5587c87a7f9476fa82b83f40accd6c7"), None)
                if merkez:
                    print(
                        f"[merkez] total_items={merkez['total_items']} "
                        f"negative={merkez['negative_count']} pushed={merkez['pushed']} "
                        f"sample={merkez['sample'][:3]}"
                    )
                    _log("2d. Merkez total_items > 0", merkez["total_items"] > 0,
                         f"total_items={merkez['total_items']} (review expected ~2466)")
                    consistency_ok = (
                        (merkez["negative_count"] > 0 and merkez["pushed"] is True) or
                        (merkez["negative_count"] == 0 and merkez["pushed"] is False)
                    )
                    _log("2e. Merkez negative_count ↔ pushed consistency", consistency_ok,
                         f"neg={merkez['negative_count']} pushed={merkez['pushed']}")
                else:
                    _log("2d. Merkez found in admin tenants", False,
                         f"tenants={[t['tenant_id'] for t in tenants]}")

                all_int = all(isinstance(t["total_items"], int) and t["total_items"] >= 0 for t in tenants)
                _log("2f. total_items non-negative int for every tenant", all_int)

                # Call 2 (dedup bypass test)
                j2 = scan_now_eksi_stok(admin_tok, label="admin_2nd")
                ok2 = bool(j2) and j2.get("ok") is True
                _log("4. Dedup bypass — 2nd call still returns ok:true", ok2,
                     f"ok={j2.get('ok') if j2 else None}")
                if ok2 and j and j2:
                    pushed1 = any(t.get("pushed") for t in j["tenants"])
                    pushed2 = any(t.get("pushed") for t in j2["tenants"])
                    if pushed1:
                        _log(
                            "4b. Manual endpoint pushes again on repeat (dedup bypass confirmed)",
                            pushed2,
                            f"1st_pushed={pushed1} 2nd_pushed={pushed2}",
                        )
                    else:
                        _log(
                            "4b. No negative stock → no push → dedup bypass N/A",
                            True,
                            "neither call pushed; dedup test not applicable",
                        )
        finally:
            # Cleanup admin side
            httpx.post(
                f"{API}/notifications/unregister-token",
                headers=auth_headers(admin_tok),
                json={"token": TEST_TOKEN},
                timeout=20,
            )
            post_settings(admin_tok, notify_low_stock=False)

    # Summary
    passed = sum(1 for _, ok, _ in _results if ok)
    total = len(_results)
    print("\n" + "=" * 70)
    print(f"RESULT: {passed}/{total} passed")
    for name, ok, detail in _results:
        print(f"  {'PASS' if ok else 'FAIL'} — {name}  [{detail}]")
    print("=" * 70)
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
