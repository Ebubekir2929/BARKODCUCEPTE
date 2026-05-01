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
      1. Prefer `dataset_cache_rows` (one DB row per item) – used for large datasets
         like stock_list / cari_bakiye_liste.
      2. Fallback to `dataset_cache.data_json` (a single JSON array blob) – used
         for small lookup datasets like stok_fiyat_adlari.
    """
    pool = await get_data_pool()
    items: List[dict] = []
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
    "stock_list",
    "cari_bakiye_liste",
    "iptal_ozet",
    "iptal_detay",
    "acik_masa_detay",
    "rap_acik_hesap_kisi_ozet_web",
    "hourly_stock_detail",
    "rap_filtre_lookup",
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
    """Filter cached iptal_detay / iptal_ozet rows by sdate/edate and IPTAL_ID."""
    sdate = (params or {}).get("sdate") or ""
    edate = (params or {}).get("edate") or ""
    iptal_id = (params or {}).get("IPTAL_ID")
    out = []
    for r in items:
        if iptal_id not in (None, "", 0):
            try:
                if int(r.get("IPTAL_ID") or 0) != int(iptal_id):
                    continue
            except (TypeError, ValueError):
                continue
        if not _between_dates(r, sdate, edate, ["IPTAL_TARIHI", "TARIH", "FIS_TARIHI", "TARIH_SAAT"]):
            continue
        out.append(r)
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
    """Filter cached hourly_stock_detail rows by sdate/edate + LOKASYON + STOK_ID."""
    p = params or {}
    sdate = p.get("sdate") or p.get("SDATE") or p.get("BASTARIH") or ""
    edate = p.get("edate") or p.get("EDATE") or p.get("BITTARIH") or ""
    stok_id = p.get("ID") or p.get("STOK_ID") or 0
    lokasyon = p.get("LOKASYON")
    saat = p.get("SAAT") or p.get("HOUR")
    out = []
    for r in items:
        if stok_id not in (None, "", 0):
            try:
                if int(r.get("STOK_ID") or r.get("ID") or 0) != int(stok_id):
                    continue
            except (TypeError, ValueError):
                continue
        if lokasyon not in (None, "", 0):
            if str(r.get("LOKASYON") or "").strip() != str(lokasyon).strip():
                if str(r.get("LOKASYON_ID") or "") != str(lokasyon):
                    continue
        if saat not in (None, ""):
            if str(r.get("SAAT") or r.get("HOUR") or "").strip() != str(saat).strip():
                continue
        if not _between_dates(r, sdate, edate, ["TARIH", "FIS_TARIHI", "SAAT_TARIH"]):
            continue
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


async def lookup_rows_dataset(
    tenant_id: str,
    dataset_key: str,
    params: dict,
) -> Optional[List[dict]]:
    """Try to serve a request from `dataset_cache_rows` (param-filtered).

    Returns:
      list of matching rows if the dataset has been pushed AND filter matched
      (could be empty list — the data exists, just no matches for these params)
      None if nothing has been pushed yet → caller should fall back to sync.php
    """
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
        try:
            from services import get_data_pool
            pool = await get_data_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        SELECT
                          SUBSTRING_INDEX(SUBSTRING_INDEX(row_json, '"SAAT_ADI":"', -1), '"', 1) AS saat_adi,
                          SUBSTRING_INDEX(SUBSTRING_INDEX(row_json, '"LOKASYON":"', -1), '"', 1) AS lokasyon,
                          SUBSTRING_INDEX(SUBSTRING_INDEX(row_json, '"LOKASYON_ID":', -1), ',', 1) + 0 AS lokasyon_id,
                          SUM(CAST(NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(row_json, '"KDV_DAHIL_TOPLAM_TUTAR":', -1), ',', 1), '') AS DECIMAL(18,4))) AS amount,
                          SUM(CAST(NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(row_json, '"SATIR_SAYISI":', -1), ',', 1), '') AS UNSIGNED)) AS satir,
                          COUNT(*) AS row_count
                        FROM dataset_cache_rows
                        WHERE tenant_id=%s AND dataset_key='hourly_stock_detail' AND deleted_at IS NULL
                        GROUP BY saat_adi, lokasyon, lokasyon_id
                        """,
                        (tenant_id,),
                    )
                    rows = await cur.fetchall()
            # Build the synthetic "row" list the frontend expects: 1 row per
            # (hour, location) carrying the aggregated KDV_DAHIL_TOPLAM_TUTAR.
            # Filter by lokasyon if requested.
            p = params or {}
            wanted_lok = p.get("lokasyonID") or p.get("LOKASYON_ID") or p.get("lokasyon_id")
            out = []
            for r in rows:
                if not r:
                    continue
                lok_id = int(r[2] or 0)
                if wanted_lok not in (None, "", 0):
                    try:
                        if int(wanted_lok) != lok_id:
                            continue
                    except (TypeError, ValueError):
                        pass
                out.append({
                    "SAAT_ADI": (r[0] or "").strip(),
                    "LOKASYON": (r[1] or "").strip(),
                    "LOKASYON_ID": lok_id,
                    "KDV_DAHIL_TOPLAM_TUTAR": float(r[3] or 0),
                    "TOPLAM_TUTAR": float(r[3] or 0),
                    "SATIR_SAYISI": int(r[4] or 0),
                    "_AGGREGATE": True,
                })
            return out
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
