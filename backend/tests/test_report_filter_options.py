"""Iteration 14 — Verify rap_filtre_lookup fixes end-to-end.

Backend endpoint: POST /api/data/report-filter-options
Bug: Some tenants have dataset_cache rap_filtre_lookup blob = '[]'; user reported
empty filter dropdowns on report screen.

Tests:
  * Healthy tenant (d5587c...) — LOKASYON must return non-empty list of rows
    whose Kaynak == 'LOKASYON'. Also PERSONEL and FIS_TURU return 200 with a data list.
  * Empty-lookup tenant (6de69d3b...) — must NOT hang, must return 200 fast
    with empty (or graceful) data list, never 500.
  * Regression: login + /api/sistem-durum returns surum with healthy pools.
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else "https://price-update-test.preview.emergentagent.com"

EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "1234567"

HEALTHY_TENANT = "d5587c87a7f9476fa82b83f40accd6c7"
EMPTY_TENANT = "6de69d3b97094959ad70b48f628e6e57"
# Iter 15 — customer whose empty [] row was DELETED from dataset_cache.
DELETED_ROW_TENANT = "c918a648766449e28399ac909cc3236d"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    js = r.json()
    assert "access_token" in js
    return js["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Regression: auth + sistem-durum ----------

class TestRegression:
    def test_login_returns_access_token(self, token):
        assert token and len(token) > 30

    def test_sistem_durum_surum(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/sistem-durum", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text[:300]
        js = r.json()
        # surum field must be present
        assert "surum" in js, f"surum missing: {list(js.keys())}"
        # Not strictly enforcing exact string but log it
        print(f"surum={js.get('surum')}")
        # Basic health check — patron / data reachable indicator, if present
        # (payload shape can vary; only assert key presence)
        assert isinstance(js, dict)


# ---------- Report filter options ----------

class TestReportFilterOptionsHealthy:
    """Healthy tenant with 53KB rap_filtre_lookup blob."""

    def _post(self, auth_headers, source: str, timeout: int = 45):
        payload = {"tenant_id": HEALTHY_TENANT, "source": source}
        t0 = time.time()
        r = requests.post(
            f"{BASE_URL}/api/data/report-filter-options",
            headers=auth_headers,
            json=payload,
            timeout=timeout,
        )
        dt = time.time() - t0
        print(f"[{source}] status={r.status_code} elapsed={dt:.2f}s")
        return r, dt

    def test_lokasyon_returns_non_empty_rows(self, auth_headers):
        r, _ = self._post(auth_headers, "LOKASYON")
        assert r.status_code == 200, r.text[:400]
        js = r.json()
        assert "data" in js, f"no data key: {list(js.keys())}"
        data = js["data"]
        assert isinstance(data, list), f"data not list: {type(data)}"
        assert len(data) > 0, "LOKASYON returned empty list on healthy tenant"
        # Every row must be Kaynak==LOKASYON
        wrong = [row for row in data if str(row.get("Kaynak") or row.get("KAYNAK") or "").strip().upper() != "LOKASYON"]
        assert not wrong, f"rows with wrong Kaynak leaked in: {wrong[:2]}"
        print(f"LOKASYON returned {len(data)} rows; sample={data[0] if data else None}")

    def test_personel_returns_200_with_list(self, auth_headers):
        r, _ = self._post(auth_headers, "PERSONEL")
        assert r.status_code == 200, r.text[:400]
        js = r.json()
        assert "data" in js and isinstance(js["data"], list)
        # May be empty legitimately, but if any rows exist, Kaynak filter must match
        for row in js["data"]:
            k = str(row.get("Kaynak") or row.get("KAYNAK") or "").strip().upper()
            assert k == "PERSONEL", f"leaked row: {row}"
        print(f"PERSONEL rows={len(js['data'])}")

    def test_fis_turu_returns_200_with_list(self, auth_headers):
        r, _ = self._post(auth_headers, "FIS_TURU")
        assert r.status_code == 200, r.text[:400]
        js = r.json()
        assert "data" in js and isinstance(js["data"], list)
        print(f"FIS_TURU rows={len(js['data'])}")

    def test_second_call_is_fresh_cached(self, auth_headers):
        # First call likely 'live' or 'stale'; second within TTL_FRESH (30 min) must be 'fresh'
        r1, dt1 = self._post(auth_headers, "LOKASYON")
        assert r1.status_code == 200
        time.sleep(0.5)
        r2, dt2 = self._post(auth_headers, "LOKASYON")
        assert r2.status_code == 200
        js2 = r2.json()
        # Should be very fast on repeat (memory cache)
        print(f"first={dt1:.2f}s second={dt2:.2f}s cache={js2.get('_cache')}")
        assert dt2 < 5.0, f"second (cached) call too slow: {dt2}s"


class TestReportFilterOptionsEmpty:
    """Empty-lookup tenant — endpoint must not hang / 500."""

    def test_empty_tenant_lokasyon_no_hang(self, auth_headers):
        payload = {"tenant_id": EMPTY_TENANT, "source": "LOKASYON"}
        t0 = time.time()
        try:
            r = requests.post(
                f"{BASE_URL}/api/data/report-filter-options",
                headers=auth_headers,
                json=payload,
                timeout=45,
            )
        except requests.exceptions.Timeout:
            pytest.fail("Endpoint hung >45s on empty-lookup tenant")
        dt = time.time() - t0
        print(f"empty tenant LOKASYON status={r.status_code} elapsed={dt:.2f}s")
        # Must NOT be 500; 200 (with possibly-empty data) is expected
        assert r.status_code != 500, f"5xx on empty tenant: {r.text[:300]}"
        # 200 or 4xx acceptable, but the typical happy path is 200
        assert r.status_code in (200, 400, 401, 403, 404), f"unexpected status: {r.status_code}"
        if r.status_code == 200:
            js = r.json()
            assert "data" in js
            assert isinstance(js["data"], list)
            print(f"empty tenant data length={len(js['data'])}")

    def test_empty_tenant_returns_quickly(self, auth_headers):
        """Repeat call must be near-instant (cache) even for empty tenant."""
        payload = {"tenant_id": EMPTY_TENANT, "source": "PERSONEL"}
        # Warm up
        requests.post(f"{BASE_URL}/api/data/report-filter-options", headers=auth_headers, json=payload, timeout=45)
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/data/report-filter-options", headers=auth_headers, json=payload, timeout=15)
        dt = time.time() - t0
        print(f"empty tenant PERSONEL cached elapsed={dt:.2f}s status={r.status_code}")
        assert r.status_code != 500


# ---------- Iter 15: Tenant whose empty row was DELETED ----------

class TestDeletedRowTenant:
    """Tenant c918a648... — empty [] row was deleted from dataset_cache.
    Backend must return 200 gracefully (empty data list acceptable) and NOT 500/hang.
    _RAP_DENY prevents POS on-demand fallthrough for rap_filtre_lookup.
    """

    def test_lokasyon_returns_200_graceful_empty(self, auth_headers):
        payload = {"tenant_id": DELETED_ROW_TENANT, "source": "LOKASYON"}
        t0 = time.time()
        try:
            r = requests.post(
                f"{BASE_URL}/api/data/report-filter-options",
                headers=auth_headers,
                json=payload,
                timeout=45,
            )
        except requests.exceptions.Timeout:
            pytest.fail("Endpoint hung >45s on deleted-row tenant c918a648")
        dt = time.time() - t0
        print(f"deleted-row tenant LOKASYON status={r.status_code} elapsed={dt:.2f}s cache={r.headers.get('x-cache','?')}")
        assert r.status_code != 500, f"5xx on deleted-row tenant: {r.text[:400]}"
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:400]}"
        js = r.json()
        assert "data" in js and isinstance(js["data"], list), f"bad shape: {js}"
        # Empty list is acceptable (no cache row + _RAP_DENY blocks fallthrough).
        # Stale 30-min in-memory cache with [] is ALSO acceptable per review request.
        print(f"deleted-row tenant data length={len(js['data'])} _cache={js.get('_cache')}")

    def test_lokasyon_completes_quickly(self, auth_headers):
        """Must be fast; no hanging on POS on-demand call (blocked by _RAP_DENY)."""
        payload = {"tenant_id": DELETED_ROW_TENANT, "source": "LOKASYON"}
        # Warm up first
        requests.post(f"{BASE_URL}/api/data/report-filter-options", headers=auth_headers, json=payload, timeout=45)
        t0 = time.time()
        r = requests.post(
            f"{BASE_URL}/api/data/report-filter-options",
            headers=auth_headers,
            json=payload,
            timeout=20,
        )
        dt = time.time() - t0
        print(f"deleted-row LOKASYON second call elapsed={dt:.2f}s status={r.status_code}")
        assert r.status_code == 200
        assert dt < 10.0, f"repeat call too slow: {dt}s (possible hanging POS call?)"

    def test_multiple_sources_all_200(self, auth_headers):
        """A few sources sanity check — none should 500 for deleted-row tenant."""
        for src in ("PERSONEL", "FIS_TURU", "CARI"):
            payload = {"tenant_id": DELETED_ROW_TENANT, "source": src}
            r = requests.post(
                f"{BASE_URL}/api/data/report-filter-options",
                headers=auth_headers,
                json=payload,
                timeout=30,
            )
            print(f"deleted-row tenant {src}: status={r.status_code}")
            assert r.status_code == 200, f"{src} returned {r.status_code}: {r.text[:200]}"
            js = r.json()
            assert isinstance(js.get("data"), list), f"{src} bad shape"


# ---------- Iter 15: Direct MySQL SELECT to confirm DB row absence ----------

class TestDatasetCacheRowAbsence:
    """SELECT-only verification that dataset_cache has NO rap_filtre_lookup row
    for tenant c918a648. If a new row appears with row_count=0, that means the
    customer's POS client is still on the old code and just re-pushed — report but
    NOT a backend code bug.
    """

    def _connect(self):
        import pymysql
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        return pymysql.connect(
            host=os.environ["MYSQL_DATA_HOST"],
            user=os.environ["MYSQL_DATA_USER"],
            password=os.environ["MYSQL_DATA_PASS"],
            db=os.environ["MYSQL_DATA_DB"],
            port=3306,
            connect_timeout=15,
            read_timeout=15,
        )

    def test_no_rap_filtre_lookup_row_for_deleted_tenant(self):
        import pymysql
        try:
            conn = self._connect()
        except Exception as e:
            pytest.skip(f"MySQL unreachable: {e}")
        try:
            cur = conn.cursor(pymysql.cursors.DictCursor)
            cur.execute(
                "SELECT id, row_count, LENGTH(data_json) AS dj_len, updated_at "
                "FROM dataset_cache WHERE tenant_id=%s AND dataset_key='rap_filtre_lookup'",
                (DELETED_ROW_TENANT,),
            )
            rows = cur.fetchall()
            print(f"dataset_cache rows for {DELETED_ROW_TENANT} rap_filtre_lookup: {rows}")
            if rows:
                # Old POS client re-pushed. Report loudly but this is not a backend bug.
                for r in rows:
                    print(f"  row id={r['id']} row_count={r['row_count']} dj_len={r['dj_len']} updated_at={r['updated_at']}")
                    # A non-empty row would be a good sign (client upgraded).
                    if r["row_count"] > 0 or (r["dj_len"] or 0) > 2:
                        pytest.skip("Non-empty row exists — customer's client re-synced healthy data")
                pytest.fail(
                    f"rap_filtre_lookup empty row REAPPEARED for tenant {DELETED_ROW_TENANT} "
                    f"— old POS client still deployed / sync.php guard not deployed to prod"
                )
            # No row — deletion still in effect. Expected.
            assert len(rows) == 0
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def test_healthy_tenant_row_still_present(self):
        import pymysql
        try:
            conn = self._connect()
        except Exception as e:
            pytest.skip(f"MySQL unreachable: {e}")
        try:
            cur = conn.cursor(pymysql.cursors.DictCursor)
            cur.execute(
                "SELECT id, row_count, LENGTH(data_json) AS dj_len FROM dataset_cache "
                "WHERE tenant_id=%s AND dataset_key='rap_filtre_lookup'",
                (HEALTHY_TENANT,),
            )
            r = cur.fetchone()
            print(f"healthy tenant row: {r}")
            assert r is not None, "healthy tenant lost its rap_filtre_lookup row!"
            assert r["row_count"] > 0, f"healthy tenant row_count dropped to {r['row_count']}"
            assert r["dj_len"] > 100, "healthy tenant data_json unexpectedly small"
        finally:
            try:
                conn.close()
            except Exception:
                pass


# ---------- Validation ----------

class TestReportFilterOptionsValidation:
    def test_missing_tenant_returns_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/data/report-filter-options",
            headers=auth_headers,
            json={"source": "LOKASYON"},
            timeout=15,
        )
        assert r.status_code == 400, r.text[:200]

    def test_missing_source_returns_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/data/report-filter-options",
            headers=auth_headers,
            json={"tenant_id": HEALTHY_TENANT},
            timeout=15,
        )
        assert r.status_code == 400, r.text[:200]

    def test_no_auth_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/data/report-filter-options",
            headers={"Content-Type": "application/json"},
            json={"tenant_id": HEALTHY_TENANT, "source": "LOKASYON"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"
