"""Regression test (2026-05-01 14:00) for changes since last test:
  1. /api/data/table-detail now uses _on_demand_request (3-tier cache)
  2. /api/data/iptal-list cold/warm timing
  3. /api/data/stock-list fiyat_ad filter (Bayi vs all)
  4. /api/data/cari-list regression
  5. /api/data/report-run rap_filtre_lookup whitelist
  6. lookup_cached_report fuzzy match (cold/warm timing)
  7. Health checks (auth/me, stock-price-names, watcher startup banner)
"""
import sys
import time
import json
import requests

BACKEND_URL = "https://retail-sync-portal-1.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

TENANT_MERKEZ = "d5587c87a7f9476fa82b83f40accd6c7"
TENANT_GUMUSHANE = "4d9b503a96f5430aad34c430301a8aa1"

EMAIL = "cakmak_ebubekir@hotmail.com"
PASSWORD = "admin"

passes = 0
fails = 0
warnings_list = []
results = []


def log_pass(name, info=""):
    global passes
    passes += 1
    print(f"[PASS] {name}" + (f" — {info}" if info else ""))
    results.append((True, name, info))


def log_fail(name, info=""):
    global fails
    fails += 1
    print(f"[FAIL] {name}" + (f" — {info}" if info else ""))
    results.append((False, name, info))


def warn(msg):
    print(f"[WARN] {msg}")
    warnings_list.append(msg)


def login() -> str:
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    r.raise_for_status()
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    assert tok, f"No token in login response: {r.text[:200]}"
    return tok


def main():
    print("=" * 80)
    print(f"REGRESSION TEST — {API}")
    print("=" * 80)

    # ---------- 1. Login + auth/me ----------
    try:
        token = login()
        headers = {"Authorization": f"Bearer {token}"}
        log_pass("login (cakmak_ebubekir@hotmail.com)")
    except Exception as e:
        log_fail("login", str(e))
        return

    try:
        t0 = time.time()
        r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
        dt = time.time() - t0
        if r.status_code == 200 and isinstance(r.json(), dict) and r.json().get("email"):
            log_pass(f"GET /api/auth/me", f"{dt:.2f}s, user={r.json().get('username')} email={r.json().get('email')}")
        else:
            log_fail(f"GET /api/auth/me", f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        log_fail("GET /api/auth/me", str(e))

    # ---------- 2. stock-price-names ----------
    for tname, tid, expected in [("Merkez", TENANT_MERKEZ, 3), ("Gümüşhane", TENANT_GUMUSHANE, None)]:
        try:
            t0 = time.time()
            r = requests.post(f"{API}/data/stock-price-names", headers=headers,
                              json={"tenant_id": tid}, timeout=20)
            dt = time.time() - t0
            if r.status_code == 200 and r.json().get("ok"):
                cnt = len(r.json().get("data", []))
                if expected is not None and cnt != expected:
                    warn(f"stock-price-names ({tname}): expected {expected}, got {cnt}")
                log_pass(f"POST /api/data/stock-price-names {tname}", f"{dt:.2f}s, items={cnt}")
            else:
                log_fail(f"stock-price-names {tname}", f"status={r.status_code} body={r.text[:200]}")
        except Exception as e:
            log_fail(f"stock-price-names {tname}", str(e))

    # ---------- 3. stock-list fiyat_ad filter ----------
    # Bayi (1017) → ~6 items
    try:
        t0 = time.time()
        r = requests.post(f"{API}/data/stock-list", headers=headers,
                          json={"tenant_id": TENANT_MERKEZ, "fiyat_ad": 1017, "page": 1, "page_size": 50},
                          timeout=30)
        dt = time.time() - t0
        if r.status_code == 200 and r.json().get("ok"):
            j = r.json()
            total = j.get("total_count", 0)
            src = j.get("_source")
            if src != "mysql_direct":
                log_fail("stock-list fiyat_ad=1017 _source", f"got {src!r}")
            else:
                log_pass(f"stock-list fiyat_ad=1017 (Bayi) Merkez",
                         f"{dt:.2f}s total={total} _source={src}")
            if total > 200:
                warn(f"stock-list fiyat_ad=1017 expected ~6 but got {total} (filter may not be applied)")
        else:
            log_fail("stock-list fiyat_ad=1017", f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        log_fail("stock-list fiyat_ad=1017", str(e))

    # All (fiyat_ad=0) → many
    try:
        t0 = time.time()
        r = requests.post(f"{API}/data/stock-list", headers=headers,
                          json={"tenant_id": TENANT_MERKEZ, "fiyat_ad": 0, "page": 1, "page_size": 50},
                          timeout=30)
        dt = time.time() - t0
        if r.status_code == 200 and r.json().get("ok"):
            j = r.json()
            total = j.get("total_count", 0)
            src = j.get("_source")
            if src != "mysql_direct":
                log_fail("stock-list fiyat_ad=0 _source", f"got {src!r}")
            else:
                log_pass(f"stock-list fiyat_ad=0 (all) Merkez",
                         f"{dt:.2f}s total={total} _source={src}")
        else:
            log_fail("stock-list fiyat_ad=0", f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        log_fail("stock-list fiyat_ad=0", str(e))

    # ---------- 4. cari-list regression ----------
    try:
        t0 = time.time()
        r = requests.post(f"{API}/data/cari-list", headers=headers,
                          json={"tenant_id": TENANT_MERKEZ, "page": 1, "page_size": 50},
                          timeout=30)
        dt = time.time() - t0
        if r.status_code == 200 and r.json().get("ok"):
            j = r.json()
            total = j.get("total_count", 0)
            src = j.get("_source")
            if src != "mysql_direct":
                log_fail("cari-list _source", f"got {src!r}")
            else:
                log_pass(f"cari-list Merkez", f"{dt:.2f}s total={total} _source={src}")
        else:
            log_fail("cari-list", f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        log_fail("cari-list", str(e))

    # ---------- 5. report-run rap_filtre_lookup whitelist ----------
    try:
        t0 = time.time()
        r = requests.post(f"{API}/data/report-run", headers=headers,
                          json={"tenant_id": TENANT_MERKEZ, "dataset_key": "rap_filtre_lookup",
                                "params": {"Kaynak": "STOK_FIYAT_AD", "Q": ""}},
                          timeout=60)
        dt = time.time() - t0
        if r.status_code == 200:
            j = r.json()
            if j.get("ok"):
                log_pass(f"report-run rap_filtre_lookup whitelisted",
                         f"{dt:.2f}s rows={len(j.get('data') or [])} cache={j.get('_cache','-')}")
            else:
                log_fail("report-run rap_filtre_lookup", f"ok=false body={r.text[:200]}")
        else:
            log_fail("report-run rap_filtre_lookup",
                     f"status={r.status_code} body={r.text[:200]} (expected 200, was 400 before)")
    except Exception as e:
        log_fail("report-run rap_filtre_lookup", str(e))

    # ---------- 6. iptal-list cold/warm ----------
    sdate = "2026-05-01"
    edate = "2026-05-01"  # today — known to be in cache via notification_watcher
    try:
        t0 = time.time()
        r1 = requests.post(f"{API}/data/iptal-list", headers=headers,
                           json={"tenant_id": TENANT_MERKEZ, "sdate": sdate, "edate": edate},
                           timeout=180)
        cold = time.time() - t0
        if r1.status_code == 200 and r1.json().get("ok"):
            cold_rows = len(r1.json().get("data") or [])
            log_pass(f"iptal-list COLD", f"{cold:.2f}s rows={cold_rows}")
        else:
            log_fail("iptal-list COLD", f"status={r1.status_code} body={r1.text[:200]}")
            cold_rows = -1

        t0 = time.time()
        r2 = requests.post(f"{API}/data/iptal-list", headers=headers,
                           json={"tenant_id": TENANT_MERKEZ, "sdate": sdate, "edate": edate},
                           timeout=180)
        warm = time.time() - t0
        if r2.status_code == 200 and r2.json().get("ok"):
            warm_rows = len(r2.json().get("data") or [])
            speedup = cold / warm if warm > 0 else 0
            log_pass(f"iptal-list WARM",
                     f"{warm:.2f}s rows={warm_rows} (cold {cold:.2f}s, ~{speedup:.1f}× speedup)")
            if cold_rows >= 0 and warm_rows != cold_rows:
                warn(f"iptal-list row count differs: cold={cold_rows} warm={warm_rows}")
        else:
            log_fail("iptal-list WARM", f"status={r2.status_code} body={r2.text[:200]}")
    except Exception as e:
        log_fail("iptal-list cold/warm", str(e))

    # ---------- 7. Fuzzy params match: rap_cari_hesap_ekstresi_web cold→warm ----------
    rep_params = {"BASTARIH": "2026-04-01",
                  "BITTARIH": "2026-04-30 23:59:59",
                  "CARI_ID": 0}
    try:
        t0 = time.time()
        r1 = requests.post(f"{API}/data/report-run", headers=headers,
                           json={"tenant_id": TENANT_MERKEZ,
                                 "dataset_key": "rap_cari_hesap_ekstresi_web",
                                 "params": rep_params,
                                 "force_refresh": True},
                           timeout=120)
        cold = time.time() - t0
        if r1.status_code == 200 and r1.json().get("ok"):
            rows = len(r1.json().get("data") or [])
            log_pass(f"report-run rap_cari_hesap_ekstresi_web COLD",
                     f"{cold:.2f}s rows={rows} cache={r1.json().get('_cache','-')}")
        else:
            log_fail("rap_cari_hesap_ekstresi_web COLD",
                     f"status={r1.status_code} body={r1.text[:200]}")

        # Identical 2nd call — should be much faster (in-memory _GLOBAL_CACHE fresh)
        t0 = time.time()
        r2 = requests.post(f"{API}/data/report-run", headers=headers,
                           json={"tenant_id": TENANT_MERKEZ,
                                 "dataset_key": "rap_cari_hesap_ekstresi_web",
                                 "params": rep_params},
                           timeout=120)
        warm = time.time() - t0
        if r2.status_code == 200 and r2.json().get("ok"):
            rows = len(r2.json().get("data") or [])
            cache = r2.json().get("_cache", "-")
            log_pass(f"report-run rap_cari_hesap_ekstresi_web WARM",
                     f"{warm:.2f}s rows={rows} _cache={cache}")
            if warm > 1.0 and cache != "fresh":
                warn(f"warm call slow ({warm:.2f}s) — cache may not have hit")
        else:
            log_fail("rap_cari_hesap_ekstresi_web WARM",
                     f"status={r2.status_code} body={r2.text[:200]}")
    except Exception as e:
        log_fail("rap_cari_hesap_ekstresi_web cold/warm", str(e))

    # ---------- 8. table-detail with bogus + valid pos_id ----------
    # Bogus first
    try:
        t0 = time.time()
        r = requests.post(f"{API}/data/table-detail", headers=headers,
                          json={"tenant_id": TENANT_MERKEZ, "pos_id": 999999},
                          timeout=60)
        dt = time.time() - t0
        # Backend should not crash. POS may return error or empty data — either is acceptable.
        if r.status_code in (200, 502, 504):
            try:
                j = r.json()
                shape = sorted(list(j.keys())) if isinstance(j, dict) else "[non-dict]"
                log_pass(f"table-detail pos_id=999999 (graceful)",
                         f"{dt:.2f}s status={r.status_code} keys={shape}")
            except Exception:
                log_pass(f"table-detail pos_id=999999",
                         f"{dt:.2f}s status={r.status_code} (non-json body)")
        elif r.status_code == 500:
            log_fail("table-detail pos_id=999999", f"500 — backend crashed: body={r.text[:300]}")
        else:
            log_fail("table-detail pos_id=999999",
                     f"unexpected status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        log_fail("table-detail pos_id=999999", str(e))

    # Try to get a real pos_id from dashboard
    real_pos_id = None
    try:
        r = requests.get(f"{API}/data/dashboard?tenant_id={TENANT_MERKEZ}",
                         headers=headers, timeout=60)
        if r.status_code == 200:
            j = r.json()
            tables_block = j.get("acik_masalar", {})
            tables = tables_block.get("data", []) if isinstance(tables_block, dict) else []
            if isinstance(tables, list) and tables:
                # Find an item with POS_ID or ID
                for t in tables:
                    if isinstance(t, dict):
                        pid = t.get("POS_ID") or t.get("ID")
                        if pid:
                            real_pos_id = pid
                            break
            print(f"  [info] dashboard.acik_masalar items={len(tables) if isinstance(tables, list) else 0}, real_pos_id={real_pos_id}")
        else:
            print(f"  [info] dashboard returned {r.status_code} (skipping valid-pos_id test)")
    except Exception as e:
        print(f"  [info] dashboard fetch failed: {e}")

    if real_pos_id:
        try:
            t0 = time.time()
            r = requests.post(f"{API}/data/table-detail", headers=headers,
                              json={"tenant_id": TENANT_MERKEZ, "pos_id": int(real_pos_id)},
                              timeout=120)
            dt = time.time() - t0
            if r.status_code == 200 and r.json().get("ok"):
                j = r.json()
                rows = len(j.get("data") or [])
                src = j.get("_source", "-")
                log_pass(f"table-detail pos_id={real_pos_id}",
                         f"{dt:.2f}s rows={rows} _source={src} request_uid={j.get('request_uid','-')[:20]}")
            else:
                log_fail(f"table-detail pos_id={real_pos_id}",
                         f"status={r.status_code} body={r.text[:300]}")
        except Exception as e:
            log_fail(f"table-detail pos_id={real_pos_id}", str(e))
    else:
        warn("No real POS_ID available from dashboard.acik_masalar — skipping happy-path table-detail")

    # ---------- 9. Watcher startup banner check ----------
    print("\n[info] Checking backend logs for 'Negative-stock summary watcher started'...")
    import subprocess
    try:
        out = subprocess.run(["bash", "-c",
                              "grep -ah 'Negative-stock summary watcher started' /var/log/supervisor/backend.*.log | tail -3"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if out:
            log_pass("Notification watcher startup banner present", out.splitlines()[-1][:120])
        else:
            log_fail("Notification watcher startup banner",
                     "no '📦 Negative-stock summary watcher started' line in backend logs")
    except Exception as e:
        warn(f"could not grep backend logs: {e}")

    # ---------- Summary ----------
    print("\n" + "=" * 80)
    print(f"REGRESSION SUMMARY: {passes} passed / {fails} failed / {len(warnings_list)} warnings")
    print("=" * 80)
    if warnings_list:
        print("WARNINGS:")
        for w in warnings_list:
            print(f"  - {w}")
    print()
    sys.exit(0 if fails == 0 else 1)


if __name__ == "__main__":
    main()
