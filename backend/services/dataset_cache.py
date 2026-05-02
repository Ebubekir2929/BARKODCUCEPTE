"""Direct MySQL query helpers for stock_list and cari_bakiye_liste datasets.

These datasets are now pushed directly into `kasacepteweb.dataset_cache_rows`
by the POS client, so we read them directly instead of going through sync.php.

Each row's `row_json` column contains the full JSON payload for one stock/cari item.
We maintain a module-level in-memory cache to avoid re-parsing 60k+ JSON rows on
every request; revision checking keeps the cache consistent.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from services import get_data_pool

logger = logging.getLogger(__name__)

# Cache: { (tenant_id, dataset_key): { "ts": float, "revision": int,
#                                     "items": list, "row_count": int } }
_DATASET_MEM_CACHE: Dict[Tuple[str, str], Dict[str, Any]] = {}
_DATASET_LOCKS: Dict[Tuple[str, str], asyncio.Lock] = {}

# Time before we *always* re-check the revision number (seconds). Revision check
# is a single fast SQL query, so this is cheap; safe to keep short.
_CACHE_FRESH_TTL = 30

# Hard ceiling – after this, we drop the cache entry completely even if revision
# hasn't changed, to free memory from tenants nobody is using.
_CACHE_MAX_AGE = 3600


def _get_lock(tenant_id: str, dataset_key: str) -> asyncio.Lock:
    key = (tenant_id, dataset_key)
    lock = _DATASET_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _DATASET_LOCKS[key] = lock
    return lock


async def _fetch_meta(tenant_id: str, dataset_key: str) -> Optional[Dict[str, Any]]:
    """Cheap query — get the revision of the current cache on MySQL side."""
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT revision_no, row_count, synced_at, params_json
                FROM dataset_cache
                WHERE tenant_id=%s AND dataset_key=%s
                ORDER BY synced_at DESC LIMIT 1
                """,
                (tenant_id, dataset_key),
            )
            row = await cur.fetchone()
    if not row:
        return None
    return {
        "revision_no": int(row[0] or 0),
        "row_count": int(row[1] or 0),
        "synced_at": row[2],
        "params_json": row[3],
    }


async def _load_all_rows(tenant_id: str, dataset_key: str) -> List[dict]:
    """Full load of parsed JSON rows.

    Strategy:
      0. (NEW 2026-05-02) For PAGES_DATASETS, concatenate every page from
         `dataset_cache_pages`. Each page row holds a JSON array in `data_json`.
      1. Prefer `dataset_cache_rows` (one DB row per item) – used for hourly
         datasets and similar high-cardinality non-paginated keys.
      2. Fallback to `dataset_cache.data_json` (a single JSON array blob) – used
         for small lookup datasets like stok_fiyat_adlari.
    """
    pool = await get_data_pool()
    items: List[dict] = []

    # 0) Pages table (new pagination layout for big datasets)
    if dataset_key in PAGES_DATASETS:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT params_hash
                    FROM dataset_cache_pages
                    WHERE tenant_id=%s AND dataset_key=%s
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (tenant_id, dataset_key),
                )
                latest = await cur.fetchone()
                if latest:
                    await cur.execute(
                        """
                        SELECT data_json
                        FROM dataset_cache_pages
                        WHERE tenant_id=%s AND dataset_key=%s AND params_hash=%s
                        ORDER BY page_no ASC
                        """,
                        (tenant_id, dataset_key, latest[0]),
                    )
                    pages = await cur.fetchall()
                    for (raw,) in pages or []:
                        if not raw:
                            continue
                        try:
                            arr = json.loads(raw)
                        except Exception:
                            continue
                        if isinstance(arr, list):
                            items.extend(p for p in arr if isinstance(p, dict))
                        elif isinstance(arr, dict) and isinstance(arr.get("data"), list):
                            items.extend(p for p in arr["data"] if isinstance(p, dict))
            if items:
                return items

    # 1) Try per-row table first
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT row_json FROM dataset_cache_rows
                WHERE tenant_id=%s AND dataset_key=%s AND deleted_at IS NULL
                ORDER BY id ASC
                """,
                (tenant_id, dataset_key),
            )
            while True:
                batch = await cur.fetchmany(5000)
                if not batch:
                    break
                for (raw,) in batch:
                    if not raw:
                        continue
                    try:
                        items.append(json.loads(raw))
                    except Exception:
                        continue

    if items:
        return items

    # 2) Fallback to the blob column
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT data_json FROM dataset_cache
                WHERE tenant_id=%s AND dataset_key=%s
                ORDER BY synced_at DESC LIMIT 1
                """,
                (tenant_id, dataset_key),
            )
            row = await cur.fetchone()
            if not row or not row[0]:
                return []
            try:
                parsed = json.loads(row[0])
            except Exception as e:
                logger.warning(f"[data_mem_cache] could not parse data_json for {tenant_id}/{dataset_key}: {e}")
                return []
            if isinstance(parsed, list):
                return [p for p in parsed if isinstance(p, dict)]
            if isinstance(parsed, dict):
                # Sometimes the payload is {"data": [...]} or similar
                for k in ("data", "rows", "items", "result"):
                    v = parsed.get(k)
                    if isinstance(v, list):
                        return [p for p in v if isinstance(p, dict)]
                return [parsed]
            return []


async def get_dataset_items(
    tenant_id: str,
    dataset_key: str,
    force_refresh: bool = False,
) -> List[dict]:
    """Return the full list of parsed items for tenant+dataset, using mem cache."""
    key = (tenant_id, dataset_key)
    now = time.time()
    cached = _DATASET_MEM_CACHE.get(key)

    # Fast path: within TTL and not forced → serve cached
    if cached and not force_refresh and (now - cached["ts"]) < _CACHE_FRESH_TTL:
        return cached["items"]

    lock = _get_lock(tenant_id, dataset_key)
    async with lock:
        # Re-read cache after acquiring lock (another coroutine may have filled it)
        cached = _DATASET_MEM_CACHE.get(key)
        now = time.time()
        if cached and not force_refresh and (now - cached["ts"]) < _CACHE_FRESH_TTL:
            return cached["items"]

        meta = await _fetch_meta(tenant_id, dataset_key)
        if not meta:
            logger.info(f"[data_mem_cache] no dataset_cache row for {tenant_id} / {dataset_key}")
            _DATASET_MEM_CACHE[key] = {"ts": now, "revision": 0, "items": [], "row_count": 0}
            return []

        rev = meta["revision_no"]
        # If we have cached items and the revision hasn't changed AND we're not forced,
        # just bump the ts and return (we've just paid 1 cheap SQL query).
        if cached and not force_refresh and cached.get("revision") == rev:
            cached["ts"] = now
            return cached["items"]

        # Need full reload
        t0 = time.time()
        items = await _load_all_rows(tenant_id, dataset_key)
        elapsed = (time.time() - t0) * 1000
        logger.info(
            f"[data_mem_cache] reloaded {dataset_key} tenant={tenant_id} "
            f"items={len(items)} rev={rev} in {elapsed:.0f}ms"
        )
        _DATASET_MEM_CACHE[key] = {
            "ts": now,
            "revision": rev,
            "items": items,
            "row_count": meta["row_count"],
        }
        return items


async def lookup_cached_report(
    tenant_id: str,
    dataset_key: str,
    params: dict,
    max_age_sec: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Try to find a cached report result in kasacepteweb.dataset_cache.

    First attempts an exact binary params_json match; if that misses, loads up to
    20 most-recent candidate rows for (tenant, dataset_key) and compares each
    stored `params_json` to the caller's params as a **dict** (order-insensitive,
    whitespace-insensitive, trailing "0" tolerant). This greatly improves hit
    rate when the POS uses a slightly different JSON formatter than we do.
    """
    try:
        params_str = json.dumps(params or {}, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    except Exception:
        return None

    pool = await get_data_pool()
    from datetime import datetime

    def _norm_dict(d):
        """Normalise a dict so equal semantic params compare equal."""
        if not isinstance(d, dict):
            return d
        out = {}
        for k, v in d.items():
            if v is None:
                continue
            if isinstance(v, str):
                v = v.strip()
                if v == "":
                    continue
            if isinstance(v, (int, float)):
                # Treat 0 and 0.0 and '' as equivalent "none"
                if v == 0:
                    continue
            if isinstance(v, dict):
                v = _norm_dict(v)
                if not v:
                    continue
            out[str(k).strip()] = v
        return out

    target_norm = _norm_dict(params or {})

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 1) Fast path: exact binary match.
            # When multiple rows share the exact same params_json (e.g. POS
            # writes a 1-row delta update + we wrote the full 182-row response),
            # pick the one with the most rows — that's almost always the
            # complete result. Tiebreak by recency.
            await cur.execute(
                """
                SELECT data_json, row_count, synced_at, params_json
                FROM dataset_cache
                WHERE tenant_id=%s AND dataset_key=%s AND params_json=%s
                ORDER BY row_count DESC, synced_at DESC LIMIT 1
                """,
                (tenant_id, dataset_key, params_str),
            )
            row = await cur.fetchone()

            # 2) Fallback: fuzzy semantic match across recent entries.
            # Order by row_count DESC first because we may have multiple cache
            # rows for the same logical params (one written by POS sync.php with
            # its own hash, one written by our write_dataset_cache with our hash).
            # The row with the most data is almost always the "complete" one;
            # POS sometimes writes a single-row delta update right after.
            if not row:
                await cur.execute(
                    """
                    SELECT data_json, row_count, synced_at, params_json
                    FROM dataset_cache
                    WHERE tenant_id=%s AND dataset_key=%s
                    ORDER BY row_count DESC, synced_at DESC LIMIT 20
                    """,
                    (tenant_id, dataset_key),
                )
                candidates = await cur.fetchall()
                for cand in candidates:
                    try:
                        cand_params = json.loads(cand[3] or "{}")
                    except Exception:
                        continue
                    if _norm_dict(cand_params) == target_norm:
                        row = cand
                        break

    if not row:
        return None

    raw, row_count, synced_at = row[0], row[1], row[2]
    age_sec = None
    if synced_at:
        try:
            age_sec = (datetime.now() - synced_at).total_seconds()
        except Exception:
            age_sec = None
    if max_age_sec is not None and age_sec is not None and age_sec > max_age_sec:
        return None

    try:
        data = json.loads(raw or '[]')
    except Exception:
        return None
    if not isinstance(data, list):
        data = []

    return {
        "data": data,
        "row_count": int(row_count or len(data)),
        "synced_at": synced_at,
        "age_sec": age_sec,
    }


# =========================================================================
#  Per-row dataset filtering (rows-table-backed datasets)
# =========================================================================

# Datasets that are pushed directly to `dataset_cache_rows` by the POS client.
# For these we read all rows, then filter by request params in Python — far
# faster than re-querying via sync.php on every request.
ROWS_DATASETS: set = {
    # 2026-05-02 — new architecture per user spec.
    # Only `hourly_stock_detail` lives in dataset_cache_rows now.
    # stock_list / cari_bakiye_liste moved to dataset_cache_pages (PAGES_DATASETS below).
    # acik_masa_detay, iptal_detay, iptal_ozet, rap_acik_hesap_kisi_ozet_web,
    # rap_filtre_lookup moved to the dataset_cache blob (read via fetch_dataset
    # → lookup_cached_report).
    "hourly_stock_detail",
}

# Datasets paginated into dataset_cache_pages. Each page holds a JSON array of
# rows in `data_json` plus a `page_no`. We aggregate all pages for a tenant /
# dataset in `lookup_pages_dataset` to produce the full row list.
PAGES_DATASETS: set = {
    "stock_list",
    "cari_bakiye_liste",
}


def filter_rap_filtre_lookup_rows(items: List[dict], params: dict) -> List[dict]:
    """Filter cached rap_filtre_lookup rows by Kaynak (source) and Q (search)."""
    p = params or {}
    kaynak = (p.get("Kaynak") or "").strip().upper()
    q = (p.get("Q") or "").strip().lower()
    out = []
    for r in items:
        if kaynak:
            rs = str(r.get("KAYNAK") or r.get("SOURCE") or r.get("KAYNAK_KOD") or "").strip().upper()
            if rs and rs != kaynak:
                continue
        if q:
            ad = str(r.get("AD") or r.get("ADI") or r.get("LABEL") or "").lower()
            kod = str(r.get("KOD") or r.get("ID") or r.get("VALUE") or "").lower()
            if q not in ad and q not in kod:
                continue
        out.append(r)
    return out


def _between_dates(row: dict, sdate: Optional[str], edate: Optional[str], date_keys: list) -> bool:
    """Return True if row's date (under any of `date_keys`) falls within [sdate, edate].

    sdate/edate may be 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'. We compare lexically
    after slicing to the same length, which works fine for ISO-formatted dates.
    """
    if not sdate and not edate:
        return True
    val = None
    for k in date_keys:
        v = row.get(k)
        if v:
            val = str(v).strip()
            break
    if not val:
        return True  # no date in row — keep it rather than dropping
    if sdate:
        s = str(sdate).strip()
        if val[:len(s)] < s[:len(val)]:
            # Try date portion only (10 chars)
            if val[:10] < s[:10]:
                return False
    if edate:
        e = str(edate).strip()
        if val[:len(e)] > e[:len(val)]:
            if val[:10] > e[:10]:
                return False
    return True


def filter_iptal_rows(items: List[dict], params: dict) -> List[dict]:
    """Filter cached iptal_detay / iptal_ozet rows by sdate/edate and IPTAL_ID.

    Drill-down behaviour (2026-05-01): When IPTAL_ID is specified by the
    frontend (user tapped an iptal to see line items) AND the cached rows for
    that IPTAL_ID contain ONLY headers (SATIR_MI=False, no product line items),
    we return None so the caller (`_on_demand_request`) falls through to
    sync.php — the POS will then return the actual line items.
    """
    sdate = (params or {}).get("sdate") or ""
    edate = (params or {}).get("edate") or ""
    iptal_id = (params or {}).get("IPTAL_ID")
    out = []
    has_satir = False
    for r in items:
        if iptal_id not in (None, "", 0):
            try:
                if int(r.get("IPTAL_ID") or 0) != int(iptal_id):
                    continue
            except (TypeError, ValueError):
                continue
        if not _between_dates(r, sdate, edate, ["IPTAL_TARIHI", "TARIH", "FIS_TARIHI", "TARIH_SAAT"]):
            continue
        # Track whether we have any product-line rows
        if r.get("SATIR_MI") is True or r.get("STOK_AD") or r.get("STOK_ID"):
            has_satir = True
        out.append(r)
    # If user is drilling into a specific iptal but the cache only has headers,
    # signal a cache miss so sync.php can fetch the line items from POS.
    if iptal_id not in (None, "", 0) and out and not has_satir:
        return None  # type: ignore[return-value]
    return out


def filter_acik_masa_detay_rows(items: List[dict], params: dict) -> List[dict]:
    """Filter cached acik_masa_detay rows by POS_ID."""
    pos_id = (params or {}).get("POS_ID")
    if pos_id in (None, "", 0):
        return list(items)
    try:
        pid = int(pos_id)
    except (TypeError, ValueError):
        return list(items)
    return [r for r in items if int(r.get("POS_ID") or 0) == pid]


def filter_acik_hesap_rows(items: List[dict], params: dict) -> List[dict]:
    """Filter cached rap_acik_hesap_kisi_ozet_web rows by date range + cari fields."""
    p = params or {}
    sdate = p.get("BASTARIH") or ""
    edate = p.get("BITTARIH") or ""
    cari_id = p.get("CARI_ID") or p.get("Cariler") or ""
    cari_grup = (p.get("CariGrup") or "").strip()
    cari_tur = (p.get("CariTur") or "").strip()
    out = []
    for r in items:
        if cari_id not in (None, "", 0):
            try:
                if int(r.get("CARI_ID") or 0) != int(cari_id):
                    continue
            except (TypeError, ValueError):
                continue
        if cari_grup and str(r.get("CARI_GRUP") or "").strip() != cari_grup:
            continue
        if cari_tur and str(r.get("CARI_TUR") or "").strip() != cari_tur:
            continue
        if not _between_dates(r, sdate, edate, ["TARIH", "BASTARIH", "VADE_TARIHI"]):
            continue
        out.append(r)
    return out


def filter_hourly_stock_detail_rows(items: List[dict], params: dict) -> List[dict]:
    """Filter cached hourly_stock_detail rows by sdate/edate + LOKASYON + STOK_ID.

    The rows do NOT have a TARIH field (only SAAT_ADI/SAAT_NO), so when a
    single-hour request is made (sdate "YYYY-MM-DD HH:00:00", edate same hour),
    we filter by SAAT_NO instead of comparing date strings.

    Dedupe: POS sync may push the same product under different params_hash
    (full-day vs. single-hour query), causing the rows table to contain
    duplicate (saat, stok_id, lokasyon) entries. We keep ONE row per unique
    key. If `items` is already an ordered list (latest-first), the first
    occurrence wins; otherwise the de-dup is best-effort.
    """
    p = params or {}
    sdate = p.get("sdate") or p.get("SDATE") or p.get("BASTARIH") or ""
    edate = p.get("edate") or p.get("EDATE") or p.get("BITTARIH") or ""
    stok_id = p.get("ID") or p.get("STOK_ID") or 0
    lokasyon = p.get("LOKASYON") or p.get("lokasyonID") or p.get("LOKASYON_ID") or p.get("lokasyon_id")
    saat = p.get("SAAT") or p.get("HOUR")

    # Detect a single-hour request and filter by SAAT_NO
    target_hour = None
    try:
        if (
            isinstance(sdate, str) and isinstance(edate, str)
            and len(sdate) >= 13 and len(edate) >= 13
            and sdate[:10] == edate[:10] and sdate[11:13] == edate[11:13]
        ):
            target_hour = int(sdate[11:13])
    except (ValueError, TypeError):
        target_hour = None

    seen = set()
    out = []
    for r in items:
        if stok_id not in (None, "", 0):
            try:
                if int(r.get("STOK_ID") or r.get("ID") or 0) != int(stok_id):
                    continue
            except (TypeError, ValueError):
                continue
        if lokasyon not in (None, "", 0):
            same_name = str(r.get("LOKASYON") or "").strip() == str(lokasyon).strip()
            same_id = str(r.get("LOKASYON_ID") or "") == str(lokasyon)
            if not (same_name or same_id):
                continue
        if saat not in (None, ""):
            if str(r.get("SAAT") or r.get("HOUR") or r.get("SAAT_NO") or "").strip() != str(saat).strip():
                continue
        if target_hour is not None:
            try:
                row_hour = int(r.get("SAAT_NO"))
            except (TypeError, ValueError):
                row_hour = None
            if row_hour is None:
                # Fallback: parse SAAT_ADI ("14:00 - 15:00") → 14
                try:
                    row_hour = int(str(r.get("SAAT_ADI") or "")[:2])
                except (TypeError, ValueError):
                    row_hour = None
            if row_hour != target_hour:
                continue
        # Dedupe by (saat_adi, stok_id, lokasyon_id)
        dedupe_key = (
            (r.get("SAAT_ADI") or "").strip(),
            str(r.get("STOK_ID") or ""),
            str(r.get("LOKASYON_ID") or ""),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        out.append(r)
    return out


async def _load_filtered_rows_sql(
    tenant_id: str,
    dataset_key: str,
    sql_filter: str,
    sql_params: tuple,
) -> List[dict]:
    """Load rows from dataset_cache_rows with a custom SQL WHERE clause.

    Used for datasets with cheap-to-push-down filters (e.g. date ranges on
    hourly_stock_detail) so we don't have to load 60k+ rows into Python memory
    just to discard 99% of them.
    """
    pool = await get_data_pool()
    items: List[dict] = []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                SELECT row_json FROM dataset_cache_rows
                WHERE tenant_id=%s AND dataset_key=%s AND deleted_at IS NULL
                  AND ({sql_filter})
                ORDER BY id ASC
                """,
                (tenant_id, dataset_key, *sql_params),
            )
            while True:
                batch = await cur.fetchmany(2000)
                if not batch:
                    break
                for (raw,) in batch:
                    if not raw:
                        continue
                    try:
                        items.append(json.loads(raw))
                    except Exception:
                        continue
    return items


async def lookup_pages_dataset(
    tenant_id: str,
    dataset_key: str,
    params: dict,
) -> Optional[List[dict]]:
    """Aggregate all pages for a paginated dataset from `dataset_cache_pages`.

    `dataset_cache_pages` stores chunks of large datasets (page_no, data_json
    holding a JSON array). We concatenate every page (latest snapshot per
    page_no) and then pass the resulting full row list through the regular
    Python filter pipeline.

    Returns:
      list of rows after filter; or None if no pages exist for this tenant
      / dataset (caller may then fall back to blob lookup or sync.php).
    """
    if dataset_key not in PAGES_DATASETS:
        return None
    try:
        from services import get_data_pool
        pool = await get_data_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Pick the most recent params_hash for this tenant/dataset
                # so we don't mix snapshots from different push batches.
                await cur.execute(
                    """
                    SELECT params_hash
                    FROM dataset_cache_pages
                    WHERE tenant_id=%s AND dataset_key=%s
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (tenant_id, dataset_key),
                )
                row = await cur.fetchone()
                if not row:
                    return None
                latest_hash = row[0]
                await cur.execute(
                    """
                    SELECT data_json
                    FROM dataset_cache_pages
                    WHERE tenant_id=%s AND dataset_key=%s AND params_hash=%s
                    ORDER BY page_no ASC
                    """,
                    (tenant_id, dataset_key, latest_hash),
                )
                pages = await cur.fetchall()
        # Concatenate page arrays in order
        merged: List[dict] = []
        for (data_json_raw,) in pages or []:
            try:
                arr = json.loads(data_json_raw) if data_json_raw else []
            except Exception:
                continue
            if isinstance(arr, list):
                merged.extend(arr)
            elif isinstance(arr, dict) and isinstance(arr.get("data"), list):
                merged.extend(arr["data"])
        if not merged:
            return []
        # Apply per-dataset Python filter so things like sdate/edate, lokasyon,
        # and Q-search work the same as for the rows-table path.
        if dataset_key == "stock_list":
            return filter_stock_items(merged, params or {})
        if dataset_key == "cari_bakiye_liste":
            return filter_cari_items(merged, params or {})
        return merged
    except Exception as e:
        logger.warning(f"[lookup_pages] {dataset_key} failed: {e}")
        return None


async def lookup_rows_dataset(
    tenant_id: str,
    dataset_key: str,
    params: dict,
) -> Optional[List[dict]]:
    """Try to serve a request from `dataset_cache_rows` (param-filtered).

    Delegates to `lookup_pages_dataset` for paginated datasets (stock_list,
    cari_bakiye_liste — stored in dataset_cache_pages).

    Returns:
      list of matching rows if the dataset has been pushed AND filter matched
      (could be empty list — the data exists, just no matches for these params)
      None if nothing has been pushed yet → caller should fall back to sync.php
    """
    # Paginated datasets live in dataset_cache_pages (new architecture 2026-05-02).
    if dataset_key in PAGES_DATASETS:
        return await lookup_pages_dataset(tenant_id, dataset_key, params)

    if dataset_key not in ROWS_DATASETS:
        return None

    # Fast existence check: a single COUNT(*) takes <5ms thanks to the
    # (tenant_id, dataset_key, params_hash, deleted_at) index. We skip the
    # potentially-expensive `get_dataset_items` (which can load 60k+ rows)
    # if nothing has been pushed yet for this tenant+dataset.
    try:
        from services import get_data_pool
        pool = await get_data_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT 1 FROM dataset_cache_rows
                    WHERE tenant_id=%s AND dataset_key=%s AND deleted_at IS NULL
                    LIMIT 1
                    """,
                    (tenant_id, dataset_key),
                )
                exists = await cur.fetchone()
        if not exists:
            return None  # nothing pushed yet → fall back
    except Exception as e:
        logger.debug(f"[lookup_rows] existence check failed for {dataset_key}: {e}")
        return None

    # ─── Optimisation: SQL-level pushdown for hourly_stock_detail ───
    # This dataset can be huge (5k+ rows for busy tenants) but the frontend
    # only needs per-hour totals. Use MySQL string functions to aggregate
    # at the DB layer — avoids parsing 5k JSON blobs in Python (which was
    # taking 2.3s and triggering Android ANR).
    if dataset_key == "hourly_stock_detail":
        # SQL aggregation pushdown is ONLY appropriate when the request spans
        # the whole day (or multiple hours) AND the caller wants AGGREGATE
        # data (dashboard "saatlik chart"). For everything else (single-hour
        # drill-down, CompareModal product breakdown, "Şube Bazlı Tüm Ürünler"
        # matrix) we MUST return raw product rows.
        sdate_str = (params or {}).get("sdate", "") or ""
        edate_str = (params or {}).get("edate", "") or ""
        skip_agg = bool((params or {}).get("_skip_aggregate", False))
        is_single_hour = (
            len(sdate_str) >= 16 and len(edate_str) >= 16
            and sdate_str[:10] == edate_str[:10]
            and sdate_str[11:13] == edate_str[11:13]
        )
        if is_single_hour or skip_agg:
            # picks the most recent push per (saat_adi, stok_id, lokasyon_id).
            # This MUST match the dedupe order used by the full-day SQL agg
            # below, otherwise the single-hour SUM and the dashboard chart
            # disagree (user reported "27 bin chart, 24 bin detail").
            try:
                from services import get_data_pool
                pool = await get_data_pool()
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        if skip_agg and not is_single_hour:
                            # Full-day RAW — no hour pre-filter, return ALL rows
                            await cur.execute(
                                """
                                SELECT row_json, updated_at
                                FROM dataset_cache_rows
                                WHERE tenant_id=%s AND dataset_key='hourly_stock_detail'
                                  AND deleted_at IS NULL
                                ORDER BY updated_at DESC
                                """,
                                (tenant_id,),
                            )
                            target_hour_int = None
                        else:
                            target_hour = sdate_str[11:13]
                            like_pattern = f"%\"SAAT_ADI\":\"{target_hour}:00 - %"
                            await cur.execute(
                                """
                                SELECT row_json, updated_at
                                FROM dataset_cache_rows
                                WHERE tenant_id=%s AND dataset_key='hourly_stock_detail'
                                  AND deleted_at IS NULL
                                  AND row_json LIKE %s
                                ORDER BY updated_at DESC
                                """,
                                (tenant_id, like_pattern),
                            )
                            target_hour_int = int(target_hour)
                        rows = await cur.fetchall()
                p = params or {}
                wanted_lok = p.get("lokasyonID") or p.get("LOKASYON_ID") or p.get("lokasyon_id")
                seen: set = set()
                out: list = []
                for row_json_raw, _upd in rows or []:
                    try:
                        d = json.loads(row_json_raw) if isinstance(row_json_raw, (str, bytes)) else (row_json_raw or {})
                    except Exception:
                        continue
                    if target_hour_int is not None:
                        try:
                            h = int(d.get("SAAT_NO") if d.get("SAAT_NO") is not None else str(d.get("SAAT_ADI") or "")[:2])
                        except (TypeError, ValueError):
                            continue
                        if h != target_hour_int:
                            continue
                    if wanted_lok not in (None, "", 0):
                        try:
                            if int(wanted_lok) != int(d.get("LOKASYON_ID") or 0):
                                continue
                        except (TypeError, ValueError):
                            pass
                    key = (
                        (d.get("SAAT_ADI") or "").strip(),
                        str(d.get("STOK_ID") or ""),
                        str(d.get("LOKASYON_ID") or ""),
                    )
                    if key in seen:
                        continue
                    seen.add(key)

                    # Combine the 3 revenue columns into a single total.
                    # Use MAX not SUM — the POS stores the same retail sale in
                    # both KDV_DAHIL_TOPLAM_TUTAR and PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR
                    # (sometimes also in ERP12), so adding them double-counts.
                    # Taking the max gives the correct single value per product
                    # regardless of which column the POS chose to populate.
                    def _f(v):
                        try:
                            return float(v) if v is not None else 0.0
                        except (TypeError, ValueError):
                            return 0.0
                    combined = max(
                        _f(d.get("KDV_DAHIL_TOPLAM_TUTAR")),
                        _f(d.get("PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR")),
                        _f(d.get("ERP12_KDV_DAHIL_TOPLAM_TUTAR")),
                    )
                    d_out = dict(d)
                    d_out["_ORIG_KDV_DAHIL_TOPLAM_TUTAR"] = d.get("KDV_DAHIL_TOPLAM_TUTAR")
                    d_out["KDV_DAHIL_TOPLAM_TUTAR"] = combined
                    d_out["TOPLAM_TUTAR"] = combined
                    out.append(d_out)
                return out
            except Exception as e:
                logger.warning(f"[lookup_rows] single-hour direct DB failed: {e}; fallback to mem_cache")
                # Fall through to mem_cache + filter_hourly_stock_detail_rows below
        if not is_single_hour:
            try:
                from services import get_data_pool
                pool = await get_data_pool()
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        # Fetch raw rows + updated_at; dedupe in Python by
                        # (SAAT_ADI, STOK_ID, LOKASYON_ID) — keep the most
                        # recent push. Same-content rows can exist multiple
                        # times when POS sync writes the same product under
                        # different params_hash (e.g., full-day vs. single-hour
                        # snapshot). Aggregating without dedupe double-counts.
                        await cur.execute(
                            """
                            SELECT row_json, updated_at
                            FROM dataset_cache_rows
                            WHERE tenant_id=%s AND dataset_key='hourly_stock_detail' AND deleted_at IS NULL
                            ORDER BY updated_at DESC
                            """,
                            (tenant_id,),
                        )
                        rows = await cur.fetchall()
                # ─── Python-side dedupe + aggregation ───
                # Track the latest row per (saat_adi, stok_id, lokasyon_id).
                latest: dict = {}
                for row_json_raw, upd in rows or []:
                    try:
                        d = json.loads(row_json_raw) if isinstance(row_json_raw, (str, bytes)) else (row_json_raw or {})
                    except Exception:
                        continue
                    saat = (d.get("SAAT_ADI") or "").strip()
                    if not saat:
                        continue
                    stok_id = d.get("STOK_ID") or 0
                    lok_id = int(d.get("LOKASYON_ID") or 0)
                    key = (saat, str(stok_id), lok_id)
                    if key not in latest:  # first row wins because we ORDER BY updated_at DESC
                        latest[key] = d
                # Aggregate the deduped rows by (hour, location)
                p = params or {}
                wanted_lok = p.get("lokasyonID") or p.get("LOKASYON_ID") or p.get("lokasyon_id")

                def _f(v):
                    try:
                        return float(v) if v is not None else 0.0
                    except (TypeError, ValueError):
                        return 0.0

                agg: dict = {}
                for d in latest.values():
                    saat = (d.get("SAAT_ADI") or "").strip()
                    lok = (d.get("LOKASYON") or "").strip()
                    lok_id = int(d.get("LOKASYON_ID") or 0)
                    if wanted_lok not in (None, "", 0):
                        try:
                            if int(wanted_lok) != lok_id:
                                continue
                        except (TypeError, ValueError):
                            pass
                    bucket = (saat, lok, lok_id)
                    if bucket not in agg:
                        agg[bucket] = {
                            "SAAT_ADI": saat,
                            "LOKASYON": lok,
                            "LOKASYON_ID": lok_id,
                            "KDV_DAHIL_TOPLAM_TUTAR": 0.0,
                            "TOPLAM_TUTAR": 0.0,
                            "BRUT_KDV_DAHIL_TOPLAM_TUTAR": 0.0,
                            "GENEL_ISKONTO_TUTARI": 0.0,
                            "PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR": 0.0,
                            "ERP12_KDV_DAHIL_TOPLAM_TUTAR": 0.0,
                            "SATIR_SAYISI": 0,
                            "_AGGREGATE": True,
                        }
                    a = agg[bucket]
                    # MAX — not SUM — of the 3 revenue columns. The POS stores
                    # the same retail sale in both KDV_DAHIL and PERAKENDE
                    # (and sometimes ERP12). Summing double-counts; max picks
                    # the "canonical" value whichever column happens to hold it.
                    amt = max(
                        _f(d.get("KDV_DAHIL_TOPLAM_TUTAR")),
                        _f(d.get("PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR")),
                        _f(d.get("ERP12_KDV_DAHIL_TOPLAM_TUTAR")),
                    )
                    a["KDV_DAHIL_TOPLAM_TUTAR"] += amt
                    a["TOPLAM_TUTAR"] += amt
                    a["BRUT_KDV_DAHIL_TOPLAM_TUTAR"] += _f(d.get("BRUT_KDV_DAHIL_TOPLAM_TUTAR"))
                    a["GENEL_ISKONTO_TUTARI"] += _f(d.get("GENEL_ISKONTO_TUTARI"))
                    a["PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR"] += _f(d.get("PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR"))
                    a["ERP12_KDV_DAHIL_TOPLAM_TUTAR"] += _f(d.get("ERP12_KDV_DAHIL_TOPLAM_TUTAR"))
                    a["SATIR_SAYISI"] += 1
                return list(agg.values())
            except Exception as e:
                logger.warning(f"[lookup_rows] hourly_stock_detail SQL agg failed: {e}; falling back")
                # Fall through to the slow Python path below

    items = await get_dataset_items(tenant_id, dataset_key)
    if not items:
        return None  # nothing pushed yet

    if dataset_key in ("iptal_ozet", "iptal_detay"):
        return filter_iptal_rows(items, params)
    if dataset_key == "acik_masa_detay":
        return filter_acik_masa_detay_rows(items, params)
    if dataset_key == "rap_acik_hesap_kisi_ozet_web":
        return filter_acik_hesap_rows(items, params)
    if dataset_key == "hourly_stock_detail":
        return filter_hourly_stock_detail_rows(items, params)
    if dataset_key == "rap_filtre_lookup":
        return filter_rap_filtre_lookup_rows(items, params)
    return list(items)


async def write_dataset_cache(
    tenant_id: str,
    dataset_key: str,
    params: dict,
    data: list,
) -> None:
    """Write a sync.php result back into kasacepteweb.dataset_cache so subsequent
    requests with the same params hit the MySQL fast-path instead of going
    through sync.php again.

    Idempotent: uses INSERT ... ON DUPLICATE KEY UPDATE.

    The schema columns we touch:
      - tenant_id, dataset_key (composite key)
      - params_hash: SHA256(params_json)  — we store sha256 of our canonical
        serialization which is also what `lookup_cached_report` first tries.
      - params_json: canonical JSON
      - data_json: the result list as JSON
      - row_count: len(data)
      - revision_no: bumped each write
      - synced_at, updated_at: NOW()
    """
    if not isinstance(data, list):
        return
    try:
        params_json = json.dumps(params or {}, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    except Exception:
        return
    import hashlib
    params_hash = hashlib.sha256(params_json.encode('utf-8')).hexdigest()
    try:
        data_json = json.dumps(data, ensure_ascii=False, default=str)
    except Exception:
        logger.debug(f"[write_cache] skip {dataset_key}: data not JSON-serialisable")
        return
    row_count = len(data)

    pool = await get_data_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO dataset_cache
                        (tenant_id, dataset_key, params_hash, params_json,
                         data_json, row_count, revision_no, synced_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 1, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE
                        params_json = VALUES(params_json),
                        data_json   = VALUES(data_json),
                        row_count   = VALUES(row_count),
                        revision_no = revision_no + 1,
                        synced_at   = NOW(),
                        updated_at  = NOW()
                    """,
                    (
                        tenant_id, dataset_key, params_hash, params_json,
                        data_json, row_count,
                    ),
                )
            await conn.commit()
        logger.info(
            f"[write_cache] wrote {dataset_key} tenant={tenant_id} "
            f"rows={row_count} hash={params_hash[:10]}"
        )
    except Exception as e:
        logger.warning(f"[write_cache] failed {dataset_key}: {e}")


def clear_dataset_cache(tenant_id: Optional[str] = None, dataset_key: Optional[str] = None):
    """Clear specific tenant/dataset cache or the whole thing if both None."""
    if tenant_id is None and dataset_key is None:
        _DATASET_MEM_CACHE.clear()
        return
    to_remove = []
    for k in _DATASET_MEM_CACHE:
        if tenant_id and k[0] != tenant_id:
            continue
        if dataset_key and k[1] != dataset_key:
            continue
        to_remove.append(k)
    for k in to_remove:
        _DATASET_MEM_CACHE.pop(k, None)


# =========================================================================
#  High-level filter helpers
# =========================================================================


def _norm_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def filter_stock_items(
    items: List[dict],
    *,
    search: str = "",
    groups: Optional[List[str]] = None,
    kdv_values: Optional[List[str]] = None,
    markas: Optional[List[str]] = None,
    aktif: Optional[bool] = None,
    hareketli: Optional[bool] = None,
    qty: Optional[str] = None,          # "zero" | "positive" | "negative" | "low" | "mid" | "high"
    profit: Optional[str] = None,       # "profit" | "loss"
    price_min: Optional[float] = None,
    price_max: Optional[float] = None,
) -> List[dict]:
    def _kdv_norm(v: Any) -> str:
        return str(v or "").replace(".00", "")

    q = search.strip().lower() if search else ""
    grp_set = {g for g in (groups or []) if g}
    kdv_set = {k for k in (kdv_values or []) if k}
    marka_set = {m for m in (markas or []) if m}

    out: List[dict] = []
    for s in items:
        if q:
            if not (q in str(s.get("AD", "") or "").lower()
                    or q in str(s.get("KOD", "") or "").lower()
                    or q in str(s.get("BARKOD", "") or "").lower()):
                continue
        if grp_set:
            g = _norm_str(s.get("STOK_GRUP") or s.get("GRUP"))
            if g not in grp_set:
                continue
        if kdv_set:
            v = _kdv_norm(s.get("KDV_PAREKENDE") or s.get("KDV"))
            if v not in kdv_set:
                continue
        if marka_set:
            m = _norm_str(s.get("STOK_MARKA"))
            if m not in marka_set:
                continue
        if aktif is not None:
            if bool(s.get("AKTIF")) != aktif:
                continue
        if hareketli is not None:
            if bool(s.get("HAREKETLI")) != hareketli:
                continue
        if qty is not None:
            try:
                m = float(s.get("MIKTAR") or 0)
            except (TypeError, ValueError):
                m = 0.0
            if qty == "zero" and m != 0:
                continue
            if qty == "positive" and not (m > 0):
                continue
            if qty == "negative" and not (m < 0):
                continue
            if qty == "low" and not (0 < m < 10):
                continue
            if qty == "mid" and not (10 <= m < 100):
                continue
            if qty == "high" and not (m >= 100):
                continue
        if profit is not None:
            try:
                sell = float(s.get("FIYAT") or 0)
                buy = float(s.get("SON_ALIS_FIYAT") or 0)
            except (TypeError, ValueError):
                sell = buy = 0.0
            if profit == "profit" and not (sell > 0 and buy > 0 and sell > buy):
                continue
            if profit == "loss" and not (buy > 0 and sell <= buy):
                continue
        if price_min is not None or price_max is not None:
            try:
                p = float(s.get("FIYAT") or 0)
            except (TypeError, ValueError):
                p = 0.0
            if price_min is not None and p < price_min:
                continue
            if price_max is not None and p > price_max:
                continue
        out.append(s)
    return out


def filter_cari_items(
    items: List[dict],
    *,
    search: str = "",
    groups: Optional[List[str]] = None,
    aktif: Optional[bool] = None,
    bakiye: Optional[str] = None,   # "borclu" | "alacakli" | "sifir"
    bakiye_min: Optional[float] = None,
    bakiye_max: Optional[float] = None,
) -> List[dict]:
    q = search.strip().lower() if search else ""
    grp_set = {g for g in (groups or []) if g}
    out: List[dict] = []
    for c in items:
        if q:
            if not (q in str(c.get("AD", "") or "").lower()
                    or q in str(c.get("KOD", "") or "").lower()
                    or q in str(c.get("EK_AD", "") or "").lower()
                    or q in str(c.get("USTID", "") or "").lower()
                    or q in str(c.get("TELEFON", "") or "").lower()
                    or q in str(c.get("TELEFON_CEP", "") or "").lower()):
                continue
        if grp_set:
            g = _norm_str(c.get("CARI_GRUP"))
            if g not in grp_set:
                continue
        if aktif is not None:
            if bool(c.get("AKTIF")) != aktif:
                continue
        if bakiye or bakiye_min is not None or bakiye_max is not None:
            try:
                b = float(c.get("BAKIYE") or 0)
            except (TypeError, ValueError):
                b = 0.0
            ba = str(c.get("BA") or "").strip("{}").upper()
            signed = b if ba != "A" else -b  # {A} = alacaklı (negative)
            if bakiye == "borclu" and not (signed > 0):
                continue
            if bakiye == "alacakli" and not (signed < 0):
                continue
            if bakiye == "sifir" and signed != 0:
                continue
            if bakiye_min is not None and signed < bakiye_min:
                continue
            if bakiye_max is not None and signed > bakiye_max:
                continue
        out.append(c)
    return out


def paginate(items: List[dict], page: Optional[int], page_size: int) -> Dict[str, Any]:
    total = len(items)
    page_size = max(1, int(page_size or 200))
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 0

    if page is None:
        # legacy "return everything" behaviour
        return {
            "data": items,
            "page": None,
            "page_size": page_size,
            "total_pages": total_pages,
            "total_count": total,
        }

    p = max(1, int(page))
    start = (p - 1) * page_size
    end = start + page_size
    return {
        "data": items[start:end],
        "page": p,
        "page_size": page_size,
        "total_pages": total_pages,
        "total_count": total,
    }
