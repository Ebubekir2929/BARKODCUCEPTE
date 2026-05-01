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

    The POS client writes the raw JSON result into `dataset_cache.data_json` when it
    fulfils a sync.php request_create call. If we can find a matching row (same
    tenant + dataset_key + params) we can serve it directly without another sync.php
    round-trip.

    Params are serialized with `json.dumps(..., sort_keys=True, separators=(',', ':'))`
    to match the POS client's canonical format.

    Args:
      tenant_id: tenant ID
      dataset_key: e.g. 'rap_cari_hesap_ekstresi_web'
      params: the same dict the frontend sent
      max_age_sec: only return the cached row if it's younger than this many seconds.
                   None = no age limit.

    Returns:
      { 'data': list, 'row_count': int, 'synced_at': datetime, 'age_sec': float }
      or None if nothing matching is in cache (or it's too old).
    """
    try:
        params_str = json.dumps(params or {}, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    except Exception:
        return None

    pool = await get_data_pool()
    from datetime import datetime
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Primary lookup: exact params_json match (binary-safe)
            await cur.execute(
                """
                SELECT data_json, row_count, synced_at
                FROM dataset_cache
                WHERE tenant_id=%s AND dataset_key=%s AND params_json=%s
                ORDER BY synced_at DESC LIMIT 1
                """,
                (tenant_id, dataset_key, params_str),
            )
            row = await cur.fetchone()
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
