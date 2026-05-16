from fastapi import APIRouter, HTTPException, Depends, Query
from services import get_data_pool
from services.dataset_cache import (
    get_dataset_items,
    filter_stock_items,
    filter_cari_items,
    paginate,
    clear_dataset_cache,
    lookup_cached_report,
    write_dataset_cache,
    lookup_rows_dataset,
    ROWS_DATASETS,
)
from routes.auth import get_current_user
from typing import Optional, Dict, List, Any
import json
import logging
import time
import asyncio
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["data"])

# Global in-memory cache for heavy POS endpoints with stale-while-revalidate.
# Key format: "<endpoint>::<tenant_id>::<param_hash>"
# Value: { ts: float (epoch), payload: dict }
_GLOBAL_CACHE: Dict[str, Dict[str, Any]] = {}

# =========================================================================
# REQUEST_CREATE WHITELIST  (user request 2026-05-01)
# =========================================================================
# Only these datasets may fall through to sync.php (dataset_get + request_create
# polling) when MySQL cache misses. Everything else returns an empty result
# immediately — this eliminates all live POS round-trips from the dashboard
# and keeps the UI snappy even on cold starts.
#
# Keep this list TIGHT — adding a dataset here re-enables request_create for it.
REQUEST_ALLOWED_DATASETS: set = {
    # 2026-05-02 — new architecture per user spec.
    # These datasets are NOT cached in MySQL (no rows / no blob copy that
    # matches caller's params), so they must be fetched from POS via sync.php
    # request_create + poll. Everything else is served from MySQL only.
    "stok_extre",          # stock ledger (stock_detail drill-down)
    "stok_bilgi_miktar",   # stock quantity per location (paired with stok_extre)
    "kart_extre_cari",     # customer ledger (acik_hesap_kisi_detail / cari_detail)
    "fis_detay_toplam",    # receipt detail (table-detail drill-down)
    # 2026-05-13 — iptal_detay yeniden whitelist'te. Frontend için cache-only
    # (cache_only=True flag) ile cache miss → boş döner; arka plandaki
    # _preload_iptal_individual_cache POS'a request_create atıp bireysel
    # cache satırı oluşturur, böylece bir sonraki tıklamada line items hazır.
    "iptal_detay",
    # Legacy reports screen still needs live data from POS (rap_fis_kalem_listesi_web,
    # rap_cari_hesap_ekstresi_web, rap_personel_satis, rap_gunluk_ozet, …) covered by
    # the rap_ prefix in `_is_request_create_allowed` (rap_filtre_lookup is denied
    # there because its data lives in the dataset_cache blob too).
}

# 2026-05-13 — Hard DENY list: even rap_* prefix matches, never fall through to
# POS for these. Their data lives entirely in dataset_cache (filled by the web
# side / nightly sync). Routing them through sync.php was wasting 30-120 sn.
_RAP_DENY: set = {
    "rap_filtre_lookup",
    "rap_acik_hesap_kisi_ozet_web",  # Cari özet — web zaten cache'liyor
}

def _is_request_create_allowed(dataset_key: str) -> bool:
    """Return True when we are allowed to fall through to sync.php for this
    dataset. Covers both the explicit whitelist and the rap_* prefix.

    Explicit DENY list for datasets that live entirely in dataset_cache_rows
    and should NEVER ask POS at runtime — if MySQL is empty we just return [].
    """
    if not dataset_key:
        return False
    # Hard-denies (2026-05-13): filter lookups, cari summary, and any other
    # "must be cached" datasets. Reports filter dropdowns come from
    # rap_filtre_lookup; cari özet (rap_acik_hesap_kisi_ozet_web) is filled
    # by the web side cache. Both should never trigger sync.php round-trips.
    if dataset_key in _RAP_DENY:
        return False
    if dataset_key in REQUEST_ALLOWED_DATASETS:
        return True
    if dataset_key.startswith("rap_"):
        return True
    return False



def _sum_float(val):
    """Safely parse a numeric string/value to float"""
    try:
        return float(val) if val is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def _flatten_hourly_urunler(rows: list) -> list:
    """Expand `hourly_stock_detail` parent rows (one per SAAT+LOKASYON) into
    per-product rows by flattening each row's `URUNLER` array.

    POS pushes `hourly_stock_detail` as aggregate parents of the form:
      { SAAT_ADI, SAAT_NO, LOKASYON, LOKASYON_ID, TARIH, URUNLER: [ {STOK_ADI, ...}, ... ] }

    Downstream dashboards (Saatlik Satış Detayı modal, Karşılaştır drill-down,
    Lokasyon Saatlik Satışlar) need one visible line per product; we copy
    parent fields (SAAT_ADI, LOKASYON, …) onto each child product so the
    frontend can render them directly.

    Parents that have no URUNLER list are passed through unchanged (keeps
    legacy aggregate-only callers working). Caller decides whether to use
    the flat list.
    """
    if not isinstance(rows, list):
        return rows if rows is not None else []
    out: list = []
    # Fields to inherit from the parent hour+location row
    PARENT_FIELDS = (
        "SAAT_ADI", "SAAT_NO", "TARIH",
        "LOKASYON", "LOKASYON_ID",
        "SATIR_TIPI",
    )
    for r in rows:
        if not isinstance(r, dict):
            out.append(r)
            continue
        urunler = r.get("URUNLER")
        if isinstance(urunler, list) and urunler:
            parent_bits = {k: r.get(k) for k in PARENT_FIELDS if k in r}
            for u in urunler:
                if not isinstance(u, dict):
                    continue
                flat = {**parent_bits, **u}
                out.append(flat)
        else:
            # Keep parent row as-is when no URUNLER (rare / legacy)
            out.append(r)
    return out


def _fix_large_ints(data):
    """Convert large integers to strings to prevent JavaScript precision loss"""
    if isinstance(data, list):
        return [_fix_large_ints(item) for item in data]
    elif isinstance(data, dict):
        result = {}
        for k, v in data.items():
            if isinstance(v, int) and (v > 9007199254740991 or v < -9007199254740991):
                result[k] = str(v)
            elif isinstance(v, (dict, list)):
                result[k] = _fix_large_ints(v)
            else:
                result[k] = v
        return result
    return data


def aggregate_dataset(key: str, raw_items: list) -> list:
    """Aggregate multiple days of data into summarized results"""
    if not raw_items:
        return []
    
    if key == 'financial_data':
        # Sum all numeric fields across days → single row
        agg = {}
        for item in raw_items:
            for k, v in item.items():
                agg[k] = agg.get(k, 0) + _sum_float(v)
        for k, v in agg.items():
            agg[k] = f"{v:.8f}"
        return [agg]
    
    elif key == 'financial_data_location':
        # Group by LOKASYON, sum numeric fields
        loc_map = {}
        numeric_fields = [
            'GENELTOPLAM', 'NAKIT', 'KREDI_KARTI', 'VERESIYE', 'TOPLAM', 'KDV', 'FISTOPLAM', 'NETCIRO',
            # New ERP12/Perakende breakdown
            'PERAKENDE_GENELTOPLAM', 'ERP12_GENELTOPLAM',
            'PERAKENDE_NAKIT', 'ERP12_NAKIT',
            'PERAKENDE_KREDI_KARTI', 'ERP12_KREDI_KARTI',
            # Iskonto
            'TOPLAM_FIS_ISKONTO', 'TOPLAM_SATIR_ISKONTO', 'TOPLAM_ISKONTO',
            'PERAKENDE_TOPLAM_ISKONTO', 'ERP12_TOPLAM_ISKONTO',
            # Fiş sayıları
            'TOPLAM_FIS_SAYISI', 'PERAKENDE_FIS_SAYISI', 'ERP12_FIS_SAYISI',
            # Matrah/KDV - all standard Turkish KDV rates
            'MATRAH_0', 'MATRAH_1', 'MATRAH_8', 'MATRAH_10', 'MATRAH_18', 'MATRAH_20',
            'KDV_0', 'KDV_1', 'KDV_8', 'KDV_10', 'KDV_18', 'KDV_20',
            'TOPLAM_MATRAH', 'TOPLAM_KDV',
        ]
        for item in raw_items:
            loc = item.get('LOKASYON', 'Bilinmeyen')
            if loc not in loc_map:
                loc_map[loc] = {k: v for k, v in item.items()}
                for f in numeric_fields:
                    loc_map[loc][f] = _sum_float(item.get(f))
            else:
                for f in numeric_fields:
                    loc_map[loc][f] = loc_map[loc].get(f, 0) + _sum_float(item.get(f))
        # Convert back to string format
        result = []
        for loc, data in loc_map.items():
            row = dict(data)
            for f in numeric_fields:
                if f in row and isinstance(row[f], (int, float)):
                    row[f] = f"{row[f]:.8f}"
            result.append(row)
        return result
    
    elif key == 'hourly_data':
        # Group by SAAT_ADI, sum TOPLAM + FIS_ADEDI/FIS_SAYISI (receipt count per hour)
        hour_map = {}
        fis_fields = ('FIS_ADEDI', 'FIS_SAYISI', 'FIS_SAY', 'ADET', 'FIS_TOPLAM_ADET')
        for item in raw_items:
            hour = item.get('SAAT_ADI', '')
            if hour not in hour_map:
                hour_map[hour] = dict(item)
                hour_map[hour]['TOPLAM'] = _sum_float(item.get('TOPLAM'))
                for f in fis_fields:
                    if f in item:
                        hour_map[hour][f] = _sum_float(item.get(f))
            else:
                hour_map[hour]['TOPLAM'] = hour_map[hour].get('TOPLAM', 0) + _sum_float(item.get('TOPLAM'))
                for f in fis_fields:
                    if f in item:
                        hour_map[hour][f] = hour_map[hour].get(f, 0) + _sum_float(item.get(f))
        result = []
        for h, data in sorted(hour_map.items()):
            row = dict(data)
            row['TOPLAM'] = f"{row['TOPLAM']:.8f}" if isinstance(row['TOPLAM'], (int, float)) else row['TOPLAM']
            for f in fis_fields:
                if f in row and isinstance(row[f], (int, float)):
                    row[f] = f"{row[f]:.0f}"
            result.append(row)
        return result

    elif key == 'hourly_location_data':
        # Group by SAAT_ADI + LOKASYON, sum TOPLAM + FIS_ADEDI
        comp_map = {}
        fis_fields = ('FIS_ADEDI', 'FIS_SAYISI', 'FIS_SAY', 'ADET', 'FIS_TOPLAM_ADET')
        for item in raw_items:
            hour = item.get('SAAT_ADI', '')
            loc = item.get('LOKASYON', 'Bilinmeyen')
            ck = f"{hour}__{loc}"
            if ck not in comp_map:
                comp_map[ck] = dict(item)
                comp_map[ck]['TOPLAM'] = _sum_float(item.get('TOPLAM'))
                for f in fis_fields:
                    if f in item:
                        comp_map[ck][f] = _sum_float(item.get(f))
            else:
                comp_map[ck]['TOPLAM'] = comp_map[ck].get('TOPLAM', 0) + _sum_float(item.get('TOPLAM'))
                for f in fis_fields:
                    if f in item:
                        comp_map[ck][f] = comp_map[ck].get(f, 0) + _sum_float(item.get(f))
        result = []
        for _, data in sorted(comp_map.items()):
            row = dict(data)
            if isinstance(row.get('TOPLAM'), (int, float)):
                row['TOPLAM'] = f"{row['TOPLAM']:.8f}"
            for f in fis_fields:
                if f in row and isinstance(row[f], (int, float)):
                    row[f] = f"{row[f]:.0f}"
            result.append(row)
        return result
    
    elif key in ('top10_stock_movements', 'down10_stock_movements'):
        # Group by STOK_AD + LOKASYON (composite) to preserve per-branch detail
        stock_map = {}
        for item in raw_items:
            name = item.get('STOK_AD', '')
            loc = item.get('LOKASYON', item.get('LOKASYON_ADI', '-'))
            key_c = f"{name}__{loc}"
            if key_c not in stock_map:
                stock_map[key_c] = dict(item)
                stock_map[key_c]['MIKTAR_CIKIS'] = _sum_float(item.get('MIKTAR_CIKIS'))
                stock_map[key_c]['TUTAR_CIKIS'] = _sum_float(item.get('TUTAR_CIKIS'))
            else:
                stock_map[key_c]['MIKTAR_CIKIS'] = stock_map[key_c].get('MIKTAR_CIKIS', 0) + _sum_float(item.get('MIKTAR_CIKIS'))
                stock_map[key_c]['TUTAR_CIKIS'] = stock_map[key_c].get('TUTAR_CIKIS', 0) + _sum_float(item.get('TUTAR_CIKIS'))

        result = list(stock_map.values())
        result.sort(key=lambda x: x.get('TUTAR_CIKIS', 0), reverse=(key == 'top10_stock_movements'))
        for row in result:
            for f in ('MIKTAR_CIKIS', 'TUTAR_CIKIS'):
                if isinstance(row.get(f), (int, float)):
                    row[f] = f"{row[f]:.6f}"
        # Return more rows to cover multiple branches (was 10, now 50)
        return result[:50]
    
    elif key == 'cancel_data':
        # Group by LOKASYON, sum amounts
        loc_map = {}
        for item in raw_items:
            loc = item.get('LOKASYON', 'Bilinmeyen')
            if loc not in loc_map:
                loc_map[loc] = dict(item)
                loc_map[loc]['TUTAR_FIS'] = _sum_float(item.get('TUTAR_FIS'))
                loc_map[loc]['TUTAR_SATIR'] = _sum_float(item.get('TUTAR_SATIR'))
            else:
                loc_map[loc]['TUTAR_FIS'] = loc_map[loc].get('TUTAR_FIS', 0) + _sum_float(item.get('TUTAR_FIS'))
                loc_map[loc]['TUTAR_SATIR'] = loc_map[loc].get('TUTAR_SATIR', 0) + _sum_float(item.get('TUTAR_SATIR'))
        return list(loc_map.values())
    
    else:
        # For acik_masalar, iptal_ozet etc. - just return latest day's data (no aggregation)
        return raw_items



async def fetch_dataset(pool, tenant_id: str, dataset_key: str, filter_date: Optional[str] = None):
    """Fetch dataset - if filter_date given, find record matching that date, otherwise get latest"""
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if filter_date:
                # Fetch all records for this key and filter by date in Python
                await cur.execute("""
                    SELECT data_json, row_count, synced_at, updated_at, params_json
                    FROM dataset_cache 
                    WHERE tenant_id = %s AND dataset_key = %s
                    ORDER BY updated_at DESC
                """, (tenant_id, dataset_key))
                rows = await cur.fetchall()
                
                # Find the row matching the filter_date
                row = None
                for r in rows:
                    try:
                        params = json.loads(r[4]) if r[4] else {}
                        sdate_val = params.get('sdate', '')
                        if sdate_val and sdate_val.startswith(filter_date):
                            row = r
                            break
                    except (json.JSONDecodeError, TypeError):
                        continue
            else:
                # Get latest (real-time mode)
                await cur.execute("""
                    SELECT data_json, row_count, synced_at, updated_at, params_json
                    FROM dataset_cache 
                    WHERE tenant_id = %s AND dataset_key = %s
                    ORDER BY updated_at DESC
                    LIMIT 1
                """, (tenant_id, dataset_key))
                row = await cur.fetchone()
    
    if not row:
        return {"data": [], "row_count": 0, "synced_at": None, "updated_at": None, "params": {}}
    
    try:
        data = json.loads(row[0]) if row[0] else []
    except json.JSONDecodeError:
        data = []

    try:
        params = json.loads(row[4]) if row[4] else {}
    except json.JSONDecodeError:
        params = {}

    # ─── Delta-rows format detection ───
    # POS migrated to a delta-format where dataset_cache.data_json contains a
    # placeholder dict like {"delta_rows": true, "meta": {...}, "row_count": N}
    # and the actual records live in dataset_cache_rows. Frontend always
    # expects `data` to be a list, so we transparently load the rows here.
    if isinstance(data, dict) and (data.get("delta_rows") is True
                                   or "active_rows" in (data.get("meta") or {})
                                   or (not data.get("data") and data.get("row_count"))):
        try:
            async with pool.acquire() as conn2:
                async with conn2.cursor() as cur2:
                    await cur2.execute(
                        """
                        SELECT row_json FROM dataset_cache_rows
                        WHERE tenant_id=%s AND dataset_key=%s AND deleted_at IS NULL
                        ORDER BY id ASC LIMIT 5000
                        """,
                        (tenant_id, dataset_key),
                    )
                    rs = await cur2.fetchall()
            parsed = []
            for (raw,) in rs:
                if not raw:
                    continue
                try:
                    parsed.append(json.loads(raw))
                except Exception:
                    continue
            data = parsed
            # 2026-05-16 — dataset_cache_rows tablosu tarih bazlı bölümlenmiyor;
            # tüm tarihlerin satırlarını içeriyor. Eğer çağıran kod tek bir gün
            # için (filter_date) veri istiyorsa, bu blob'u tarihe göre süzeriz.
            # Aksi halde dashboard'da farklı günlerin iptalleri vs. sızıyor.
            if filter_date and data:
                date_keys_by_ds = {
                    "iptal_detay": ("TARIH_IPTAL", "IPTAL_TARIHI", "TARIH", "FIS_TARIHI", "TARIH_SAAT"),
                    "iptal_ozet":  ("TARIH_IPTAL", "IPTAL_TARIHI", "TARIH"),
                    "satis_detay": ("TARIH", "FIS_TARIHI"),
                    "garson_satis_ozet": ("TARIH",),
                    "acik_masalar": ("TARIH", "MASA_ACILIS_TARIHI"),
                }
                dkeys = date_keys_by_ds.get(dataset_key)
                if dkeys:
                    def _rd(r):
                        if not isinstance(r, dict):
                            return ""
                        for k in dkeys:
                            v = r.get(k)
                            if v:
                                return str(v).strip()[:10]
                        return ""
                    filtered = [r for r in data if not _rd(r) or _rd(r) == filter_date]
                    if len(filtered) != len(data):
                        logger.info(f"[fetch_dataset] {dataset_key} date={filter_date} delta_rows {len(data)} -> {len(filtered)} (date-filtered)")
                    data = filtered
        except Exception as e:
            logger.warning(f"[fetch_dataset] delta_rows fallback for {dataset_key} failed: {e}")
            data = []
    elif isinstance(data, dict):
        # Some datasets wrap as {"data": [...]} — unwrap
        inner = data.get("data")
        if isinstance(inner, list):
            data = inner

    if not isinstance(data, list):
        data = []

    # 2026-05-16 — UNIVERSAL DATE FILTER: POS occasionally returns
    # cache entries labeled for a specific date but containing rows
    # from many other dates (POS bug). When caller passes filter_date
    # we must strictly drop mismatched rows so the dashboard's "yesterday"
    # filter doesn't bleed in last-month data.
    if filter_date and data:
        _date_keys_by_ds = {
            "iptal_detay": ("TARIH_IPTAL", "IPTAL_TARIHI", "TARIH", "FIS_TARIHI", "TARIH_SAAT"),
            "iptal_ozet":  ("TARIH_IPTAL", "IPTAL_TARIHI", "TARIH"),
            "satis_detay": ("TARIH", "FIS_TARIHI"),
            "garson_satis_ozet": ("TARIH",),
            "acik_masalar": ("TARIH", "MASA_ACILIS_TARIHI"),
            "fis_gunluk_bildirim_feed": ("TARIH", "FIS_TARIHI"),
        }
        _dkeys = _date_keys_by_ds.get(dataset_key)
        if _dkeys:
            def _rd(r):
                if not isinstance(r, dict):
                    return ""
                for k in _dkeys:
                    v = r.get(k)
                    if v:
                        return str(v).strip()[:10]
                return ""
            before = len(data)
            data = [r for r in data if not _rd(r) or _rd(r) == filter_date]
            after = len(data)
            if before != after:
                logger.info(f"[fetch_dataset] {dataset_key} date={filter_date} hard-filtered {before} -> {after}")

    # Fix large integers for JavaScript safety
    data = _fix_large_ints(data)
    
    return {
        "data": data,
        "row_count": row[1],
        "synced_at": row[2].isoformat() if row[2] else None,
        "updated_at": row[3].isoformat() if row[3] else None,
        "params": params,
    }


@router.get("/dataset/{dataset_key}")
async def get_dataset(
    dataset_key: str,
    tenant_id: str = Query(...),
    sdate: Optional[str] = Query(None, description="Filter start date YYYY-MM-DD"),
    current_user: dict = Depends(get_current_user),
):
    pool = await get_data_pool()
    result = await fetch_dataset(pool, tenant_id, dataset_key, sdate)
    result["dataset_key"] = dataset_key
    return result


@router.get("/dashboard")
async def get_dashboard_data(
    tenant_id: str = Query(...),
    sdate: Optional[str] = Query(None, description="Filter start date YYYY-MM-DD"),
    edate: Optional[str] = Query(None, description="Filter end date YYYY-MM-DD"),
    current_user: dict = Depends(get_current_user),
):
    """Fetch all dashboard datasets. If sdate provided, fetch filtered data for that date range."""
    dashboard_keys = [
        "financial_data", "financial_data_location",
        "hourly_data", "hourly_location_data",
        "cancel_data", "top10_stock_movements", "down10_stock_movements",
        "acik_masalar", "iptal_ozet", "iptal_detay",
        "garson_satis_ozet",
    ]
    
    pool = await get_data_pool()
    result = {}
    
    # Also fetch last week data for comparison + all locations
    last_week_data = {}
    all_locations = []
    
    if sdate:
        if not edate:
            edate = sdate
        
        if sdate == edate:
            # Single date
            for key in dashboard_keys:
                result[key] = await fetch_dataset(pool, tenant_id, key, sdate)
                result[key].pop("params", None)
        else:
            # Date range - fetch ALL records once and filter/aggregate in Python
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("""
                        SELECT dataset_key, data_json, row_count, synced_at, updated_at, params_json
                        FROM dataset_cache 
                        WHERE tenant_id = %s
                        ORDER BY updated_at DESC
                    """, (tenant_id,))
                    all_rows = await cur.fetchall()
            
            # Group rows by dataset_key, filtered by date range
            from collections import defaultdict
            keyed_data = defaultdict(list)
            keyed_meta = {}
            
            for row in all_rows:
                dk, data_json, row_count, synced_at, updated_at, params_json = row
                if dk not in dashboard_keys:
                    continue
                try:
                    params = json.loads(params_json) if params_json else {}
                except (json.JSONDecodeError, TypeError):
                    params = {}
                
                sdate_val = params.get('sdate', '') if isinstance(params, dict) else ''
                if not sdate_val:
                    continue
                
                # Check if this record's date falls within the range
                record_date = sdate_val[:10]  # "2026-04-13"
                if sdate <= record_date <= edate:
                    try:
                        data = json.loads(data_json) if data_json else []
                    except json.JSONDecodeError:
                        data = []
                    
                    if isinstance(data, list):
                        keyed_data[dk].extend(data)
                    else:
                        keyed_data[dk].append(data)
                    
                    if dk not in keyed_meta:
                        keyed_meta[dk] = {
                            "synced_at": synced_at.isoformat() if synced_at else None,
                            "updated_at": updated_at.isoformat() if updated_at else None,
                        }
            
            # Aggregate each dataset
            for key in dashboard_keys:
                raw = keyed_data.get(key, [])
                meta = keyed_meta.get(key, {"synced_at": None, "updated_at": None})
                
                aggregated = aggregate_dataset(key, raw)
                result[key] = {
                    "data": aggregated,
                    "row_count": len(aggregated),
                    **meta,
                }
    else:
        # Single date or real-time
        filter_date = sdate if sdate else None
        for key in dashboard_keys:
            result[key] = await fetch_dataset(pool, tenant_id, key, filter_date)
            # Remove params from response to reduce size
            if "params" in result[key]:
                del result[key]["params"]
    
    # --- Fetch last week data for comparison ---
    try:
        from datetime import datetime, timedelta
        today = datetime.now()
        
        if sdate and edate:
            # Date range filter: last week = same range shifted 7 days back
            start_dt = datetime.strptime(sdate, "%Y-%m-%d")
            end_dt = datetime.strptime(edate, "%Y-%m-%d")
            lw_start = (start_dt - timedelta(days=7)).strftime("%Y-%m-%d")
            lw_end = (end_dt - timedelta(days=7)).strftime("%Y-%m-%d")
            
            # Fetch each day in the last week range
            lw_items = []
            cur_dt = start_dt - timedelta(days=7)
            end_lw_dt = end_dt - timedelta(days=7)
            while cur_dt <= end_lw_dt:
                day_str = cur_dt.strftime("%Y-%m-%d")
                try:
                    day_data = await fetch_dataset(pool, tenant_id, "financial_data_location", day_str)
                    day_items = day_data.get("data", [])
                    if isinstance(day_items, list):
                        lw_items.extend(day_items)
                except:
                    pass
                cur_dt += timedelta(days=1)
        elif sdate:
            lw_date = (datetime.strptime(sdate, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
            lw_data = await fetch_dataset(pool, tenant_id, "financial_data_location", lw_date)
            lw_items = lw_data.get("data", [])
        else:
            lw_date = (today - timedelta(days=7)).strftime("%Y-%m-%d")
            lw_data = await fetch_dataset(pool, tenant_id, "financial_data_location", lw_date)
            lw_items = lw_data.get("data", [])
        
        lw_cash = sum(_sum_float(i.get("NAKIT")) for i in lw_items)
        lw_card = sum(_sum_float(i.get("KREDI_KARTI")) for i in lw_items)
        lw_open = sum(_sum_float(i.get("VERESIYE")) + _sum_float(i.get("ACIK_HESAP")) for i in lw_items)
        lw_total = sum(_sum_float(i.get("TOPLAM")) for i in lw_items)
        
        # Location breakdown for last week
        lw_locations = {}
        for item in lw_items:
            loc = item.get("LOKASYON", "Bilinmeyen")
            if loc not in lw_locations:
                lw_locations[loc] = {"cash": 0, "card": 0, "openAccount": 0, "total": 0}
            lw_locations[loc]["cash"] += _sum_float(item.get("NAKIT"))
            lw_locations[loc]["card"] += _sum_float(item.get("KREDI_KARTI"))
            lw_locations[loc]["openAccount"] += _sum_float(item.get("VERESIYE")) + _sum_float(item.get("ACIK_HESAP"))
            lw_locations[loc]["total"] += _sum_float(item.get("TOPLAM"))
        
        result["last_week"] = {
            "cash": round(lw_cash, 2),
            "card": round(lw_card, 2),
            "openAccount": round(lw_open, 2),
            "total": round(lw_total, 2),
            "locations": {k: {kk: round(vv, 2) for kk, vv in v.items()} for k, v in lw_locations.items()},
        }
    except Exception as e:
        logger.warning(f"Last week data error: {e}")
        result["last_week"] = {"cash": 0, "card": 0, "openAccount": 0, "total": 0, "locations": {}}
    
    # --- Fetch all available locations ---
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    SELECT DISTINCT data_json FROM dataset_cache 
                    WHERE tenant_id = %s AND dataset_key = 'financial_data_location'
                    ORDER BY updated_at DESC LIMIT 30
                """, (tenant_id,))
                loc_rows = await cur.fetchall()
        
        all_locs = set()
        for r in loc_rows:
            try:
                items = json.loads(r[0]) if r[0] else []
                for item in items:
                    loc = item.get("LOKASYON", "")
                    if loc:
                        all_locs.add(loc)
            except:
                pass
        result["all_locations"] = sorted(list(all_locs))
    except Exception as e:
        logger.warning(f"All locations error: {e}")
        result["all_locations"] = []
    
    return result


@router.get("/stock")
async def get_stock_data(
    tenant_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT data_json, params_json, row_count, synced_at, updated_at
                FROM dataset_cache 
                WHERE tenant_id = %s AND dataset_key = 'stock_list'
                ORDER BY updated_at DESC
            """, (tenant_id,))
            rows = await cur.fetchall()
    
    all_stocks = []
    for row in rows:
        try:
            data = json.loads(row[0]) if row[0] else []
            all_stocks.extend(data)
        except json.JSONDecodeError:
            pass
    
    seen_ids = set()
    unique_stocks = []
    for stock in all_stocks:
        stock_id = stock.get("ID")
        if stock_id and stock_id not in seen_ids:
            seen_ids.add(stock_id)
            unique_stocks.append(stock)
    
    return {"data": unique_stocks, "row_count": len(unique_stocks)}


@router.get("/customers")
async def get_customers_data(
    tenant_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT data_json, row_count, synced_at, updated_at
                FROM dataset_cache 
                WHERE tenant_id = %s AND dataset_key = 'cari_bakiye_liste'
                ORDER BY updated_at DESC
                LIMIT 1
            """, (tenant_id,))
            row = await cur.fetchone()
    
    if not row:
        return {"data": [], "row_count": 0, "synced_at": None}
    
    try:
        data = json.loads(row[0]) if row[0] else []
    except json.JSONDecodeError:
        data = []
    
    return {
        "data": data,
        "row_count": row[1],
        "synced_at": row[2].isoformat() if row[2] else None,
        "updated_at": row[3].isoformat() if row[3] else None,
    }


@router.get("/dataset-keys")
async def get_available_dataset_keys(
    tenant_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT dataset_key, COUNT(*) as cnt, MAX(updated_at) as last_updated
                FROM dataset_cache 
                WHERE tenant_id = %s
                GROUP BY dataset_key
                ORDER BY dataset_key
            """, (tenant_id,))
            rows = await cur.fetchall()
    
    return {
        "tenant_id": tenant_id,
        "keys": [
            {"key": r[0], "count": r[1], "last_updated": r[2].isoformat() if r[2] else None}
            for r in rows
        ],
    }


# === On-demand sync requests (via sync.php) ===

import httpx
import asyncio

SYNC_URL = "https://kasaceptetransfer.berkyazilim.com/api/sync.php"


async def sync_post(payload: dict, tenant_id: str) -> dict:
    """Post to sync.php API"""
    payload["tenant_id"] = tenant_id
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            SYNC_URL,
            json=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
    data = resp.json()
    if resp.status_code >= 400:
        msg = data.get("error", data.get("message", f"HTTP {resp.status_code}"))
        raise HTTPException(status_code=502, detail=msg)
    if isinstance(data, dict) and data.get("ok") is False:
        msg = data.get("error", data.get("message", "Bilinmeyen sync hatası"))
        raise HTTPException(status_code=502, detail=msg)
    return data


@router.post("/table-detail")
async def get_table_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """On-demand: Request open table detail from POS via sync.php"""
    tenant_id = body.get("tenant_id", "")
    pos_id = body.get("pos_id")
    
    if not tenant_id or pos_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve pos_id gerekli")
    
    try:
        # Use unified 3-tier cache (MySQL direct → sync.php cache → request_create+poll)
        result = await _on_demand_request(
            tenant_id,
            "acik_masa_detay",
            {"POS_ID": int(pos_id)},
            timeout_sec=35,
        )

        # POS stores acik_masa_detay in a wrapper format:
        # [{ SATIR_TIPI: "ACIK_MASA_DETAY_TOPLAM", URUNLER: [{AD, FIYAT, MIKTAR, TUTAR, STOK_BIRIM_AD}, ...], ...metadata }]
        # The frontend expects a flat list of products, so we unwrap URUNLER here.
        try:
            rows = result.get("data") if isinstance(result, dict) else None
            if isinstance(rows, list) and rows:
                flat: list = []
                header: dict = {}
                for r in rows:
                    if not isinstance(r, dict):
                        continue
                    urunler = r.get("URUNLER")
                    if isinstance(urunler, list) and urunler:
                        # Keep first header metadata (for MASA / LOKASYON / GARSON / TOPLAM)
                        if not header:
                            header = {
                                k: r.get(k) for k in (
                                    "POS_ID", "MASA", "MASA_ID", "BOLUM",
                                    "LOKASYON", "LOKASYON_ID",
                                    "GARSON_AD", "GARSON_ID",
                                    "KDV_DAHIL_TOPLAM_TUTAR", "TOPLAM_TUTAR",
                                    "TOPLAM_MIKTAR", "ODENEN_TUTAR", "KALAN_TUTAR",
                                    "SATIR_SAYISI", "SON_ZAMAN",
                                )
                            }
                        flat.extend([u for u in urunler if isinstance(u, dict)])
                    else:
                        # Already flat (legacy / alt format) — keep as-is
                        flat.append(r)
                if flat:
                    if isinstance(result, dict):
                        result["data"] = flat
                        if header:
                            result["header"] = header
        except Exception as _unwrap_err:
            logger.debug(f"acik_masa_detay unwrap skipped: {_unwrap_err}")

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Table detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-request")
async def sync_request(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Generic sync request proxy - for future on-demand queries"""
    tenant_id = body.get("tenant_id", "")
    action = body.get("action", "")
    
    if not tenant_id or not action:
        raise HTTPException(status_code=400, detail="tenant_id ve action gerekli")
    
    try:
        result = await sync_post(body, tenant_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sync request error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _on_demand_request(tenant_id: str, dataset_key: str, params: dict, timeout_sec: int = 35, raw_cache: bool = False, skip_mysql_cache: bool = False, mysql_cache_max_age_sec: Optional[int] = None, cache_only: bool = False):
    """Generic on-demand: MySQL cache → sync.php cache → request_create+poll.

    Three-tier cache strategy:
      0. Direct MySQL read of kasacepteweb.dataset_cache  (FASTEST, no network)
      1. sync.php `dataset_get` (network, but avoids POS SQL run)
      2. sync.php `request_create`+poll  (actually executes query on POS)

    IMPORTANT — REQUEST_CREATE WHITELIST (user request 2026-05-01):
    Only datasets in `REQUEST_ALLOWED_DATASETS` are permitted to fall through to
    Step 1 (sync.php dataset_get) and Step 2 (request_create+poll). For every
    other dataset, we read MySQL and if nothing is cached we return an empty
    result immediately — this eliminates all POS round-trips from the main
    dashboard and keeps the UI instantaneous on cold starts.

    Allowed today:
      • stok_extre               — stock ledger drill-down
      • stok_bilgi_miktar        — stock quantity detail (paired with stok_extre)
      • kart_extre_cari          — customer ledger drill-down
      • All rap_* report keys    — legacy reports screen still needs live data

    Passing `skip_mysql_cache=True` forces a fresh sync.php call (use sparingly when
    freshness is critical). Passing `mysql_cache_max_age_sec=N` discards MySQL
    cached rows older than N seconds and falls through to sync.php.
    """
    # ---------- Step 0a: dataset_cache_rows fast-path (per-row pushed datasets) ----------
    # When the POS client pushes data directly to dataset_cache_rows (e.g.
    # iptal_detay, acik_masa_detay, hourly_stock_detail, rap_acik_hesap_kisi_ozet_web,
    # iptal_ozet, stock_list, cari_bakiye_liste), we can read it without hitting
    # sync.php at all. Filters are applied in Python on the cached rows.
    if not skip_mysql_cache and dataset_key in ROWS_DATASETS:
        try:
            rows = await lookup_rows_dataset(tenant_id, dataset_key, params)
            if rows is not None:
                # rows is a list (possibly empty) — data exists; serve directly
                if raw_cache:
                    return {
                        "ok": True,
                        "cache": {"data": rows},
                        "_cache_hit": True,
                        "_source": "rows_table",
                    }
                return {
                    "ok": True,
                    "data": _fix_large_ints(rows) if isinstance(rows, list) else [],
                    "_cache_hit": True,
                    "_source": "rows_table",
                }
        except Exception as e:
            logger.debug(f"[on_demand] rows_table lookup {dataset_key} failed: {e}")

    # ---------- Step 0b: direct MySQL blob lookup (legacy dataset_cache.data_json) ----------
    if not skip_mysql_cache:
        try:
            cached = await lookup_cached_report(
                tenant_id, dataset_key, params, max_age_sec=mysql_cache_max_age_sec
            )
            if cached:
                data = cached["data"]
                if raw_cache:
                    return {
                        "ok": True,
                        "cache": {"data": data},
                        "_cache_hit": True,
                        "_source": "mysql_direct",
                        "_age_sec": cached.get("age_sec"),
                    }
                return {
                    "ok": True,
                    "data": _fix_large_ints(data) if isinstance(data, list) else [],
                    "_cache_hit": True,
                    "_source": "mysql_direct",
                    "_age_sec": cached.get("age_sec"),
                }
        except Exception as e:
            logger.debug(f"[on_demand] mysql direct lookup {dataset_key} failed: {e}")

    # ---------- Whitelist gate: skip sync.php for non-whitelisted datasets ----------
    # User request (2026-05-01): dashboard datasets must not trigger POS
    # round-trips. If MySQL cache missed and this dataset is not in
    # REQUEST_ALLOWED_DATASETS (or not a rap_* report), return empty data now.
    # 2026-05-13 — cache_only=True flag: caller explicitly wants ZERO POS calls;
    # short-circuit here even for whitelisted datasets.
    if cache_only or not _is_request_create_allowed(dataset_key):
        if cache_only:
            logger.debug(
                f"[on_demand] cache_only mode for {dataset_key} — returning MySQL state"
            )
        else:
            logger.info(
                f"[on_demand] BLOCKED request_create {dataset_key} tenant={tenant_id} — "
                f"not in whitelist; returning empty (MySQL-only mode)"
            )
        if raw_cache:
            return {
                "ok": True,
                "cache": {"data": []},
                "_cache_hit": False,
                "_source": "mysql_only_blocked",
            }
        return {
            "ok": True,
            "data": [],
            "_cache_hit": False,
            "_source": "mysql_only_blocked",
        }

    # ---------- Step 1: try sync.php cache (instant if hot) ----------
    try:
        cache_resp = await sync_post({
            "action": "dataset_get",
            "dataset_key": dataset_key,
            "params": params,
        }, tenant_id)
        if cache_resp.get("ok") and isinstance(cache_resp.get("data"), list):
            data = cache_resp["data"]
            # Write-through to kasacepteweb.dataset_cache so the next call hits Step 0
            try:
                asyncio.create_task(write_dataset_cache(tenant_id, dataset_key, params, data))
            except Exception:
                pass
            if raw_cache:
                return {"ok": True, "cache": cache_resp, "_cache_hit": True, "_source": "sync_cache"}
            return {
                "ok": True,
                "data": _fix_large_ints(data) if isinstance(data, list) else [],
                "_cache_hit": True,
                "_source": "sync_cache",
            }
    except Exception as e:
        logger.debug(f"[on_demand] dataset_get {dataset_key} fallback: {e}")

    # ---------- Step 2: fresh request ----------
    create_resp = await sync_post({
        "action": "request_create",
        "dataset_key": dataset_key,
        "params": params,
        "priority_no": 1,
        "requested_by": "mobile",
    }, tenant_id)

    request_uid = create_resp.get("request_uid", "")
    if not request_uid:
        raise HTTPException(status_code=502, detail="İstek oluşturulamadı")
    
    # Step 2: Poll for result — adaptive backoff for snappier cached responses.
    # Most already-cached queries finish in <0.5s; fresh queries take 2-10s.
    # Start polling very fast (80ms) for first 10 tries, then back off.
    poll_start = time.time()
    poll_count = 0
    deadline = poll_start + timeout_sec
    while time.time() < deadline:
        poll_count += 1
        status_resp = await sync_post({
            "action": "request_status",
            "request_uid": request_uid,
            "include_data": True,
        }, tenant_id)

        # Detect chunked upload still in progress (sync.php streaming results in N parts)
        # Continue polling instead of bailing out — this caused notifications/data drops
        if not status_resp.get("ok", True):
            err_code = str(status_resp.get("error", "")).lower()
            if "upload_incomplete" in err_code or "result_upload" in err_code:
                received = status_resp.get("received_parts", 0)
                total = status_resp.get("total_parts", 0)
                logger.info(f"[on_demand] {dataset_key} chunked upload {received}/{total}; retrying...")
                await asyncio.sleep(0.6)
                continue

        status = status_resp.get("status", "unknown")
        
        if status == "done":
            cache = status_resp.get("cache", {})
            data_for_cache = cache.get("data", []) if isinstance(cache.get("data"), list) else []
            # Write-through to kasacepteweb.dataset_cache so the next call hits Step 0
            try:
                if data_for_cache:
                    asyncio.create_task(write_dataset_cache(tenant_id, dataset_key, params, data_for_cache))
            except Exception:
                pass
            if raw_cache:
                return {"ok": True, "request_uid": request_uid, "cache": cache}
            data = cache.get("data", [])
            return {
                "ok": True,
                "request_uid": request_uid,
                "data": _fix_large_ints(data) if isinstance(data, list) else [],
            }
        
        if status == "error":
            error_text = status_resp.get("error_text", "Bilinmeyen hata")
            if "max_allowed_packet" in str(error_text).lower():
                raise HTTPException(
                    status_code=502,
                    detail="POS sunucusu cevap çok büyük olduğu için döndüremedi. Lütfen tarih aralığını kısaltın veya sayfa boyutunu küçültün.",
                )
            raise HTTPException(status_code=502, detail=f"POS hatası: {error_text}")

        # Adaptive backoff
        if poll_count <= 10:
            await asyncio.sleep(0.15)   # fast start: 150ms × 10 = 1.5s total
        elif poll_count <= 25:
            await asyncio.sleep(0.35)   # medium: 350ms × 15 = 5.25s
        else:
            await asyncio.sleep(0.8)    # slow: 800ms for long-running queries

    raise HTTPException(status_code=504, detail="Detay zamanında gelmedi. Lütfen tekrar deneyin.")


@router.post("/acik-hesap-kisi")
async def get_acik_hesap_kisi(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """On-demand: Müşteri bazlı açık hesap detayı.
    Uses RAP_ACIK_HESAP_KISI_OZET_WEB procedure.

    Body: { tenant_id, sdate, edate, page?, pageSize? }
    Returns: list of customers with open balances + perakende/erp12 split.
    """
    tenant_id = body.get("tenant_id", "")
    sdate = body.get("sdate") or body.get("date", "")
    edate = body.get("edate") or sdate

    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    if not sdate:
        from datetime import date as date_cls
        sdate = date_cls.today().strftime("%Y-%m-%d")
    if not edate:
        edate = sdate

    page = int(body.get("page", 1))
    page_size = int(body.get("pageSize", 200))

    # 2026-05-13 — Cache lookup için SADECE sdate/edate kullan. Web tarafı
    # bu dataset'i Page/PageSize'sız (tek satır cache) yazıyor. Eski param
    # set'i (Page=1, PageSize=200) cache'le eşleşmediği için POS'a gereksiz
    # request_create atılıyordu. cache_only=True ile POS roundtrip kesin
    # engelleniyor. Pagination caller tarafında uygulanır (rows zaten 200'ün
    # altında geliyor).
    params = {
        "sdate": f"{sdate} 00:00:00",
        "edate": f"{edate} 23:59:59",
    }

    try:
        result = await _on_demand_request(
            tenant_id, "rap_acik_hesap_kisi_ozet_web", params,
            timeout_sec=120, cache_only=True,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Acik hesap kisi error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    rows = result.get("data", []) if isinstance(result, dict) else []

    # Extract grand totals from first row (proc returns same TOPLAM_KAYIT etc. per row)
    totals = {
        "toplam_kayit": 0,
        "genel_toplam": 0.0,
        "genel_perakende": 0.0,
        "genel_erp12": 0.0,
    }
    if rows:
        first = rows[0]
        totals = {
            "toplam_kayit": int(first.get("TOPLAM_KAYIT", 0) or 0),
            "genel_toplam": float(first.get("GENEL_TOPLAM_ACIK_HESAP", 0) or 0),
            "genel_perakende": float(first.get("GENEL_PERAKENDE_ACIK_HESAP", 0) or 0),
            "genel_erp12": float(first.get("GENEL_ERP12_ACIK_HESAP", 0) or 0),
        }

    return {"ok": True, "data": rows, "totals": totals, "page": page, "page_size": page_size}


@router.post("/hourly-detail-full")
async def get_hourly_stock_detail_full(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """On-demand: Full-day hourly stock detail. Fetches stock-detail rows for an
    entire date (or date range) in ONE request, then groups by SAAT_ADI so the
    client doesn't have to call /hourly-detail for each hour individually.

    Body: { tenant_id, date: YYYY-MM-DD [or sdate/edate], lokasyon_id?: int }

    Returns: { ok, by_hour: { "HH:00 - HH:00": [rows...] } }
    """
    tenant_id = body.get("tenant_id", "")
    filter_date = body.get("date", "") or body.get("sdate", "")
    edate_in = body.get("edate", "")
    lokasyon_id = body.get("lokasyon_id")

    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    if not filter_date:
        from datetime import date as date_cls
        filter_date = date_cls.today().strftime("%Y-%m-%d")

    # If no edate provided, treat as single day
    if not edate_in:
        edate_in = filter_date

    # Build full-day sdate/edate for the POS query
    params = {
        "sdate": f"{filter_date} 00:00:00",
        "edate": f"{edate_in} 23:59:59",
        "lokasyonID": int(lokasyon_id) if lokasyon_id else None,
    }

    # Memory cache (stale-while-revalidate) — same params hit returns instantly
    cache_key = f"hourly_full::{tenant_id}::{filter_date}::{edate_in}::{lokasyon_id or 'all'}"
    now = time.time()
    TTL_FRESH = 60       # 1 min: serve immediately
    TTL_STALE = 600      # 10 min: serve stale + bg refresh
    cached = _GLOBAL_CACHE.get(cache_key)
    age = now - cached["ts"] if cached else None
    force_refresh = bool(body.get("force_refresh", False))

    if cached and age is not None and age < TTL_FRESH and not force_refresh:
        return {**cached["payload"], "_cache": "fresh", "_age": int(age)}

    async def _do_fetch():
        # 2026-05-02 — return RAW product rows (not Python-side aggregated)
        # so the frontend can both:
        #   • aggregate per (hour, lokasyon) to draw the chart bars
        #   • show "products sold in this hour" with STOK_ADI, MIKTAR, FIYAT
        # Pass _skip_aggregate=True so lookup_rows_dataset skips the SQL
        # GROUP BY pushdown for hourly_stock_detail and returns the deduped
        # raw rows.
        rich_params = dict(params)
        rich_params["_skip_aggregate"] = True
        result_inner = await _on_demand_request(tenant_id, "hourly_stock_detail", rich_params, timeout_sec=45)
        rows_inner = result_inner.get("data", []) if isinstance(result_inner, dict) else []
        # POS pushes parent aggregate rows (one per SAAT_ADI+LOKASYON) with a
        # nested `URUNLER` array carrying per-product fields (STOK_ADI,
        # BIRIM_ADI, TOPLAM_MIKTAR, KDV_DAHIL_TOPLAM_TUTAR, …). Flatten to
        # URUN-level so the chart AND the product-detail modal render correctly.
        # Totals remain consistent because parent fields == sum of children.
        rows_inner = _flatten_hourly_urunler(rows_inner)
        # 2026-05-06 — POS bazen sorgulanan tarih dışındaki (önceki gün, vs.)
        # satırları da döndürebiliyor (örn. "DENEME 2" 2026-05-05 tarihli satır
        # 2026-05-06 sorgusuyla geliyordu → ₺114K hayalet ciro). Burada
        # sdate <= TARIH <= edate olmayan kayıtları kesin olarak filtreliyoruz.
        # NOTE: params'ta sdate "YYYY-MM-DD HH:MM:SS" formatında olabilir,
        # her iki tarafı da YYYY-MM-DD'ye normalize ediyoruz.
        try:
            _sd_raw = str(params.get("sdate") or "").strip()
            _ed_raw = str(params.get("edate") or _sd_raw).strip()
            _sd = _sd_raw.split(" ")[0].split("T")[0] if _sd_raw else ""
            _ed = _ed_raw.split(" ")[0].split("T")[0] if _ed_raw else _sd
            if _sd:
                def _row_in_range(_r: Dict[str, Any]) -> bool:
                    rd_raw = _r.get("TARIH") or _r.get("TARIH_ADI") or _r.get("TARIH_KAYIT")
                    if not rd_raw:
                        return True  # tarih alanı yoksa kabul et
                    rd = str(rd_raw).strip().split(" ")[0].split("T")[0]
                    if not rd:
                        return True
                    return _sd <= rd <= (_ed or _sd)
                _before = len(rows_inner)
                rows_inner = [r for r in rows_inner if _row_in_range(r)]
                _filtered = _before - len(rows_inner)
                if _filtered > 0:
                    logger.info(f"[hourly-detail-full] tenant={tenant_id} date={_sd}..{_ed} filtered {_filtered} stale rows (kept {len(rows_inner)})")
        except Exception as _e:
            logger.warning(f"[hourly-detail-full] date filter failed: {_e}")
        # Bucket raw rows by hour (preserve ALL fields — STOK_ADI, MIKTAR,
        # KDV_DAHIL_BIRIM_FIYAT, LOKASYON, LOKASYON_ID, …)
        by_hour_inner: Dict[str, List[Any]] = {}
        for r in rows_inner:
            hour_label = (r.get("SAAT_ADI") or r.get("SAAT") or "").strip()
            if not hour_label:
                continue
            by_hour_inner.setdefault(hour_label, []).append(r)
        payload = {
            "ok": True,
            "by_hour": by_hour_inner,
            "row_count": len(rows_inner),
            "hour_count": len(by_hour_inner),
        }
        _GLOBAL_CACHE[cache_key] = {"ts": time.time(), "payload": payload}
        return payload

    if cached and age is not None and age < TTL_STALE and not force_refresh:
        async def _bg():
            try:
                await _do_fetch()
            except Exception as e:
                logger.warning(f"Hourly full bg refresh failed: {e}")
        asyncio.create_task(_bg())
        return {**cached["payload"], "_cache": "stale", "_age": int(age)}

    try:
        fresh = await _do_fetch()
        return {**fresh, "_cache": "live", "_age": 0}
    except HTTPException as e:
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e.detail)}
        raise
    except Exception as e:
        logger.error(f"Hourly full detail error: {e}")
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e)}
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/hourly-detail-full-DEPRECATED")
async def _deprecated_dummy(body: dict, current_user: dict = Depends(get_current_user)):
    """Eski yapı - korumak için tutuldu, ama artık kullanılmıyor"""
    return {"ok": False, "error": "deprecated"}


@router.post("/hourly-detail")
async def get_hourly_stock_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """On-demand: Hourly stock detail - products sold in a specific hour"""
    tenant_id = body.get("tenant_id", "")
    hour_label = body.get("hour_label", "")  # e.g. "10:00 - 11:00"
    filter_date = body.get("date", "")  # YYYY-MM-DD
    lokasyon_id = body.get("lokasyon_id")  # optional
    
    if not tenant_id or not hour_label:
        raise HTTPException(status_code=400, detail="tenant_id ve hour_label gerekli")
    
    if not filter_date:
        from datetime import date as date_cls
        filter_date = date_cls.today().strftime("%Y-%m-%d")
    
    # Parse hour label: "10:00 - 11:00" → start_hour=10
    import re
    match = re.match(r'^\s*(\d{1,2})\s*:\s*00\s*-\s*(\d{1,2})\s*:\s*00\s*$', hour_label)
    if not match:
        # Try simpler format: "10:00"
        match2 = re.match(r'^\s*(\d{1,2})\s*:\s*00\s*$', hour_label)
        if match2:
            start_hour = int(match2.group(1))
        else:
            raise HTTPException(status_code=400, detail=f"Geçersiz saat formatı: {hour_label}")
    else:
        start_hour = int(match.group(1))
    
    params = {
        "sdate": f"{filter_date} {start_hour:02d}:00:00",
        "edate": f"{filter_date} {start_hour:02d}:59:59",
        "lokasyonID": int(lokasyon_id) if lokasyon_id else None,
    }
    
    try:
        result = await _on_demand_request(tenant_id, "hourly_stock_detail", params)
        # Flatten parent rows (SAAT+LOKASYON aggregates) into per-product rows
        # by expanding the `URUNLER` array. Saatlik Satış Detayı modalında
        # her ürün (STOK_ADI + BIRIM_ADI + MIKTAR + TUTAR) ayrı satır olarak
        # gözüksün.
        try:
            if isinstance(result, dict):
                d = result.get("data")
                if isinstance(d, list) and d:
                    result["data"] = _flatten_hourly_urunler(d)
        except Exception as _unwrap_err:
            logger.debug(f"hourly-detail flatten skipped: {_unwrap_err}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Hourly detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/iptal-detail")
async def get_iptal_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """On-demand: Cancel receipt detail - items in a specific cancelled receipt.

    Strategy:
      1. Try MySQL blob cache (fast, if line items already cached).
      2. If the cached result contains only the iptal HEADER (SATIR_MI=false) and
         no product line items, force a fresh sync.php request_create call so POS
         sends the SATIR_MI=true detail rows.
      3. Return ONLY the product line items (SATIR_MI=true), matching IPTAL_ID
         when provided — so the modal shows `STOK_AD`, `MIKTAR`, `SATIR_TUTAR`.
    """
    tenant_id = body.get("tenant_id", "")
    iptal_id = body.get("iptal_id")
    filter_date = body.get("date", "")

    if not tenant_id or iptal_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve iptal_id gerekli")

    if not filter_date:
        from datetime import date as date_cls
        filter_date = date_cls.today().strftime("%Y-%m-%d")

    params = {
        "sdate": f"{filter_date} 00:00:00",
        "edate": f"{filter_date} 23:59:59",
        "IPTAL_ID": int(iptal_id),
    }

    def _extract_line_items(payload: dict) -> list:
        """Keep only product-line rows matching the requested IPTAL_ID."""
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return []
        out: list = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            # Must be a product line (SATIR_MI=true) or at least have STOK_AD/STOK_ADI/STOK_ID
            is_satir = (
                r.get("SATIR_MI") is True
                or bool(r.get("STOK_AD") or r.get("STOK_ADI") or r.get("STOK_ID"))
            )
            if not is_satir:
                continue
            try:
                if int(r.get("IPTAL_ID") or 0) != int(iptal_id):
                    continue
            except (TypeError, ValueError):
                continue
            out.append(r)
        return out

    def _extract_header(payload: dict) -> dict:
        """2026-02 — push-tıklamada header bilgisi (LOKASYON, MASA, ZAMAN,
        GENEL_TOPLAM, KULLANICI, NEDEN) için iptal_detay cache'inden
        SATIR_MI=False olan ana kayıtı bul."""
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return {}
        for r in rows:
            if not isinstance(r, dict):
                continue
            try:
                if int(r.get("IPTAL_ID") or 0) != int(iptal_id):
                    continue
            except (TypeError, ValueError):
                continue
            # Header row = SATIR_MI False or no STOK_AD/STOK_ID
            if r.get("SATIR_MI") is False or not (r.get("STOK_AD") or r.get("STOK_ADI") or r.get("STOK_ID")):
                return r
        # Eğer hiç header yoksa ilk eşleşen satırın metadata alanlarını döndür
        for r in rows:
            if isinstance(r, dict):
                try:
                    if int(r.get("IPTAL_ID") or 0) == int(iptal_id):
                        return {k: v for k, v in r.items() if k not in ("STOK_AD", "STOK_ADI", "STOK_ID", "MIKTAR", "SATIR_TUTAR")}
                except (TypeError, ValueError):
                    pass
        return {}

    try:
        # Step 1a — bireysel cache: IPTAL_ID + scope='iptal_detail' (line items dolu)
        # cache_only=True: cache miss durumunda POS'a istek atma, boş dön.
        # POS request_create işini arka plandaki _preload_iptal_individual_cache
        # yapacak — kullanıcı bekletilmez.
        # 2026-05-16 — POS bazı senaryolarda cache'i `tarih_baslangic/tarih_bitis`
        # ile de yazıyor. Önce bu ek parametrelerle dene; bulamazsa sade
        # IPTAL_ID+scope ile tekrar dene.
        individual_params_with_date = {
            "IPTAL_ID": int(iptal_id),
            "scope": "iptal_detail",
            "tarih_baslangic": f"{filter_date} 00:00:00",
            "tarih_bitis": f"{filter_date} 23:59:59",
        }
        result = await _on_demand_request(
            tenant_id, "iptal_detay", individual_params_with_date, cache_only=True,
        )
        line_items = _extract_line_items(result)
        header = _extract_header(result)
        # Fallback: sade IPTAL_ID + scope ile dene (eski POS yazımı)
        if not line_items and not header:
            individual_params = {"IPTAL_ID": int(iptal_id), "scope": "iptal_detail"}
            result = await _on_demand_request(
                tenant_id, "iptal_detay", individual_params, cache_only=True,
            )
            line_items = _extract_line_items(result)
            header = _extract_header(result)

        # Step 1b — bireysel cache yoksa: günlük toplu cache'ten (IPTAL_ID=null)
        # bu IPTAL_ID'nin header'ını filtrele. Line items olmaz ama en azından
        # TUTAR, LOKASYON, PERSONEL gözükür.
        if not line_items and not header:
            bulk_params = {
                "IPTAL_ID": None,
                "sdate": f"{filter_date} 00:00:00",
                "edate": f"{filter_date} 23:59:59",
            }
            bulk_result = await _on_demand_request(
                tenant_id, "iptal_detay", bulk_params, cache_only=True,
            )
            # Toplu cache rows arasında bu IPTAL_ID'yi filtrele
            bulk_rows = bulk_result.get("data", []) if isinstance(bulk_result, dict) else []
            iptal_rows = [
                r for r in bulk_rows
                if isinstance(r, dict) and int(r.get("IPTAL_ID") or 0) == int(iptal_id)
            ]
            line_items = _extract_line_items({"data": iptal_rows})
            if not header and iptal_rows:
                header = _extract_header({"data": iptal_rows})
            if not line_items:
                logger.info(
                    f"[iptal-detail] cache hit (bulk only, no line items) "
                    f"for IPTAL_ID={iptal_id} tenant={tenant_id}"
                )
            # 2026-05-16 — Preload kaldırıldı (kullanıcı isteği): cache'de yoksa
            # POS'a yeni request_create + MySQL write yapılmıyor. Sadece var olan
            # cache'i okuyoruz. Cache eksikse boş döner, kullanıcı uyarısı gösterilir.
            result = bulk_result if isinstance(bulk_result, dict) else result

        # Return product rows + header info — modal uses header for LOKASYON/MASA/etc
        # 2026-05-13 — Normalize header.TUTAR from IPTAL_TUTAR (cache stores
        # the receipt amount in IPTAL_TUTAR but frontend reads TUTAR).
        if header:
            ipt_tutar = header.get("IPTAL_TUTAR") if isinstance(header, dict) else None
            if ipt_tutar in (None, "", 0, "0"):
                # Fallback: sum SATIR_TUTAR of line items
                try:
                    ipt_tutar = sum(
                        float(r.get("SATIR_TUTAR") or 0) for r in line_items
                    )
                except (TypeError, ValueError):
                    ipt_tutar = 0
            if not header.get("TUTAR"):
                header["TUTAR"] = ipt_tutar
            header["IPTAL_TUTAR"] = ipt_tutar
            if not header.get("DETAY_SATIR_SAYISI"):
                header["DETAY_SATIR_SAYISI"] = len(line_items)

        if isinstance(result, dict):
            result["data"] = _fix_large_ints(line_items)
            result["header"] = _fix_large_ints(header) if header else {}
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Iptal detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _preload_iptal_individual_cache(tenant_id: str, iptal_id: int, filter_date: str) -> None:
    """2026-05-13 — Yeni iptal için bireysel cache (line items dahil) yoksa,
    POS sync.php'e tek seferlik request_create at ki sonraki tıklamalarda
    cache hit olsun. Best-effort, hatalar yutulur.
    """
    try:
        params = {
            "IPTAL_ID": iptal_id,
            "scope": "iptal_detail",
            "tarih_baslangic": f"{filter_date} 00:00:00",
            "tarih_bitis": f"{filter_date} 23:59:59",
        }
        await _on_demand_request(
            tenant_id, "iptal_detay", params,
            timeout_sec=45,
            skip_mysql_cache=True,   # cache'i atla → doğrudan POS request_create
        )
        logger.info(f"[preload_iptal] ✅ individual cache filled for IPTAL_ID={iptal_id}")
    except Exception as e:
        logger.debug(f"[preload_iptal] failed IPTAL_ID={iptal_id}: {e}")



@router.post("/iptal-list")
async def get_iptal_list(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch full list of cancellations - for date ranges, fetch each day and merge"""
    tenant_id = body.get("tenant_id", "")
    filter_date = body.get("date", "")
    sdate = body.get("sdate", "")
    edate = body.get("edate", "")
    
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")
    
    # 2026-05-16 — Debug what frontend is actually sending
    logger.info(f"[iptal-list] REQ tenant={tenant_id[:8]} sdate={sdate!r} edate={edate!r} filter_date={filter_date!r}")
    
    try:
        from datetime import datetime, timedelta
        
        dates_to_fetch = []
        if sdate and edate:
            start = datetime.strptime(sdate, "%Y-%m-%d")
            end = datetime.strptime(edate, "%Y-%m-%d")
            current = start
            while current <= end:
                dates_to_fetch.append(current.strftime("%Y-%m-%d"))
                current += timedelta(days=1)
        elif filter_date:
            dates_to_fetch = [filter_date]
        else:
            from datetime import date as date_cls
            dates_to_fetch = [date_cls.today().strftime("%Y-%m-%d")]
        
        all_data = []
        for dt in dates_to_fetch:
            try:
                # Prefer MySQL direct (_on_demand_request handles 3-tier caching)
                # 2026-05-16 — cache_only=True: kullanıcı isteği üzerine POS'a
                # request_create atılmıyor. Cache'de varsa döner, yoksa boş.
                resp = await _on_demand_request(
                    tenant_id,
                    "iptal_detay",
                    {
                        "sdate": f"{dt} 00:00:00",
                        "edate": f"{dt} 23:59:59",
                        "IPTAL_ID": None,
                    },
                    timeout_sec=45,
                    cache_only=True,
                )
                day_data = resp.get("data", [])
                if isinstance(day_data, list):
                    # 2026-05-16 — Safety net: even if cache returned a wider
                    # date range (blob cache may have multiple days), strictly
                    # filter rows to the requested day. Frontend's primary
                    # date field is TARIH_IPTAL, with fallbacks.
                    def _row_date(r: dict) -> str:
                        for key in ("TARIH_IPTAL", "IPTAL_TARIHI", "TARIH", "FIS_TARIHI", "TARIH_SAAT"):
                            v = r.get(key)
                            if v:
                                return str(v).strip()[:10]
                        return ""
                    before_count = len(day_data)
                    filtered = [r for r in day_data if not _row_date(r) or _row_date(r) == dt]
                    after_count = len(filtered)
                    if before_count != after_count:
                        logger.info(f"[iptal-list] dt={dt} filtered {before_count} -> {after_count} (excluded mismatched dates)")
                    elif before_count > 0:
                        sample = day_data[0]
                        sample_date = _row_date(sample)
                        logger.info(f"[iptal-list] dt={dt} rows={before_count} all-kept sample_date={sample_date!r} keys={list(sample.keys())[:8]}")
                    all_data.extend(filtered)
            except Exception as e:
                logger.warning(f"Iptal list for {dt}: {e}")
                continue
        
        # Deduplicate by IPTAL_ID + normalize TUTAR field
        # 2026-05-13 — Cache rows have IPTAL_TUTAR populated but TUTAR=null.
        # Frontend reads `item.TUTAR` for the receipt amount, so copy
        # IPTAL_TUTAR → TUTAR before returning. Also compute SATIR_TUTAR
        # sum across all line-items for the receipt as a sanity check.
        from collections import defaultdict
        iptal_groups: dict = defaultdict(list)
        for item in all_data:
            iid = item.get("IPTAL_ID")
            if iid:
                iptal_groups[iid].append(item)
        seen = set()
        unique_data = []
        for item in all_data:
            iptal_id = item.get("IPTAL_ID")
            if iptal_id and iptal_id not in seen:
                seen.add(iptal_id)
                # Build a per-iptal summary using the first row + aggregate
                merged = dict(item)
                group = iptal_groups.get(iptal_id, [item])
                # Receipt amount: prefer IPTAL_TUTAR; fallback to sum(SATIR_TUTAR)
                ipt_tutar = item.get("IPTAL_TUTAR")
                if ipt_tutar in (None, "", 0, "0"):
                    try:
                        ipt_tutar = sum(
                            float(r.get("SATIR_TUTAR") or 0) for r in group
                        )
                    except (TypeError, ValueError):
                        ipt_tutar = 0
                # Expose TUTAR for the frontend (it reads item.TUTAR)
                merged["TUTAR"] = ipt_tutar
                merged["IPTAL_TUTAR"] = ipt_tutar
                # Line item count (frontend shows DETAY_SATIR_SAYISI)
                if not merged.get("DETAY_SATIR_SAYISI"):
                    merged["DETAY_SATIR_SAYISI"] = len(group)
                unique_data.append(merged)
        
        return {
            "ok": True,
            "data": _fix_large_ints(unique_data),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Iptal list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === STOK ENDPOINTS ===

@router.post("/stock-price-names")
async def get_stock_price_names(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch stok_fiyat_adlari (price name list) directly from kasacepteweb MySQL."""
    tenant_id = body.get("tenant_id", "")
    force_refresh = bool(body.get("force_refresh", False))
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    try:
        items = await get_dataset_items(tenant_id, "stok_fiyat_adlari", force_refresh=force_refresh)
        return {"ok": True, "data": _fix_large_ints(items) if items else []}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock price names error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-list")
async def get_stock_list_sync(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch stock_list directly from kasacepteweb MySQL (dataset_cache_rows).

    The POS client pushes fresh stock data into MySQL via dataset_cache_rows so we
    no longer need to call sync.php here — this is ~50× faster for 60k+ item
    tenants and removes the "100-item" truncation bug entirely.

    Body: {
      tenant_id, fiyat_ad?, page?, page_size?, force_refresh?,
      # optional filters (also supported client-side for now, but we can
      # paginate filtered results server-side for very large tenants)
      search?, groups?, markas?, kdv_values?,
      aktif?, hareketli?, qty?, profit?,
      price_min?, price_max?,
    }

    Response: { ok, data, page, page_size, total_pages, total_count }
    """
    tenant_id = body.get("tenant_id", "")
    fiyat_ad = body.get("fiyat_ad", "")  # kept for frontend compat; unused server-side
    force_refresh = bool(body.get("force_refresh", False))
    page = body.get("page")
    page_size = int(body.get("page_size") or 200)

    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    try:
        # Filter detection — when no filters are passed, we can skip the
        # expensive in-memory full-table load and serve directly from MySQL
        # with LIMIT/OFFSET. This brings cold-cache stock-list for Gümüşhane
        # (63,840 rows) down from ~6.7s to <500ms.
        has_filter = any(k in body for k in (
            "search", "groups", "markas", "kdv_values",
            "aktif", "hareketli", "qty", "profit", "price_min", "price_max"
        ))

        # Same logic for fiyat_ad: when 0/empty we don't need to filter
        fa_id = None
        if fiyat_ad not in (None, "", 0, "0"):
            try:
                fa_id = int(fiyat_ad)
            except (TypeError, ValueError):
                fa_id = None

        if not has_filter and fa_id is None and page is not None:
            # Fast path replaced 2026-05-02 — stock_list now lives in
            # dataset_cache_pages (each row holds a page = JSON array). The
            # old per-row SQL LIMIT/OFFSET path doesn't apply anymore.
            # _load_all_rows handles PAGES_DATASETS, so slow-path is fast
            # enough (in-memory cached after first load).
            pass

        # Slow path: full in-memory load + filtering (used when any filter active)
        t0 = time.time()
        items = await get_dataset_items(tenant_id, "stock_list", force_refresh=force_refresh)
        load_ms = int((time.time() - t0) * 1000)

        # --- FIYAT_AD filter ---
        # Each stock row has a FIYAT_AD / FIYAT_AD_ID field identifying which
        # price list its FIYAT came from. When the user selects a specific
        # fiyat_ad from the frontend dropdown we only return rows that match it.
        # `0` / "" / None = "all" (show everything).
        if fa_id is not None:
            def _fa(it):
                raw = it.get("FIYAT_AD") or it.get("FIYAT_AD_ID") or 0
                try:
                    return int(raw)
                except (TypeError, ValueError):
                    return 0
            items = [it for it in items if _fa(it) == fa_id]

        # If any filter is explicitly requested, apply it BEFORE pagination.
        has_filter = any(k in body for k in (
            "search", "groups", "markas", "kdv_values",
            "aktif", "hareketli", "qty", "profit", "price_min", "price_max"
        ))
        if has_filter:
            items = filter_stock_items(
                items,
                search=body.get("search") or "",
                groups=body.get("groups") or [],
                kdv_values=body.get("kdv_values") or [],
                markas=body.get("markas") or [],
                aktif=body.get("aktif") if body.get("aktif") is not None else None,
                hareketli=body.get("hareketli") if body.get("hareketli") is not None else None,
                qty=body.get("qty"),
                profit=body.get("profit"),
                price_min=float(body["price_min"]) if body.get("price_min") not in (None, "") else None,
                price_max=float(body["price_max"]) if body.get("price_max") not in (None, "") else None,
            )

        pg = paginate(items, page, page_size)
        return {
            "ok": True,
            "data": _fix_large_ints(pg["data"]),
            "page": pg["page"],
            "page_size": pg["page_size"],
            "total_pages": pg["total_pages"],
            "total_count": pg["total_count"],
            "_source": "mysql_direct",
            "_load_ms": load_ms,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-detail")
async def get_stock_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch stok_bilgi_miktar and stok_extre for a specific stock item"""
    tenant_id = body.get("tenant_id", "")
    stock_id = body.get("stock_id")
    
    if not tenant_id or stock_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve stock_id gerekli")
    
    try:
        # Fetch both miktar and extre in parallel
        miktar_task = _on_demand_request(tenant_id, "stok_bilgi_miktar", {"ID": int(stock_id), "LOKASYON": 0}, timeout_sec=35)
        extre_task = _on_demand_request(tenant_id, "stok_extre", {"ID": int(stock_id)}, timeout_sec=35)
        
        miktar_result, extre_result = await asyncio.gather(miktar_task, extre_task, return_exceptions=True)
        
        miktar_data = miktar_result.get("data", []) if isinstance(miktar_result, dict) else []
        extre_data = extre_result.get("data", []) if isinstance(extre_result, dict) else []
        
        return {
            "ok": True,
            "miktar": _fix_large_ints(miktar_data) if isinstance(miktar_data, list) else [],
            "extre": _fix_large_ints(extre_data) if isinstance(extre_data, list) else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === CARİ ENDPOINTS ===

@router.post("/cari-list")
async def get_cari_list_sync(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch cari_bakiye_liste directly from kasacepteweb MySQL (dataset_cache_rows).

    Body: { tenant_id, page?, page_size?, force_refresh?,
            search?, groups?, aktif?, bakiye?, bakiye_min?, bakiye_max? }
    """
    tenant_id = body.get("tenant_id", "")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    page = body.get("page")
    page_size = int(body.get("page_size") or 200)
    force_refresh = bool(body.get("force_refresh", False))

    try:
        t0 = time.time()
        items = await get_dataset_items(tenant_id, "cari_bakiye_liste", force_refresh=force_refresh)
        load_ms = int((time.time() - t0) * 1000)

        # 2026-05-12 — Boş cari satırlarını dışla. POS'tan bazen
        # AD/KOD'u olmayan veya placeholder satırlar gelebiliyor; bunlar UI'da
        # boş kart olarak görünüp kafa karıştırıyor.
        def _is_empty_cari(c: dict) -> bool:
            ad = str(c.get("AD") or c.get("CARI_ADI") or "").strip()
            kod = str(c.get("KOD") or c.get("CARI_KODU") or "").strip()
            return not ad and not kod
        items = [c for c in (items or []) if not _is_empty_cari(c)]

        has_filter = any(k in body for k in (
            "search", "groups", "aktif", "bakiye", "bakiye_min", "bakiye_max"
        ))
        if has_filter:
            items = filter_cari_items(
                items,
                search=body.get("search") or "",
                groups=body.get("groups") or [],
                aktif=body.get("aktif") if body.get("aktif") is not None else None,
                bakiye=body.get("bakiye"),
                bakiye_min=float(body["bakiye_min"]) if body.get("bakiye_min") not in (None, "") else None,
                bakiye_max=float(body["bakiye_max"]) if body.get("bakiye_max") not in (None, "") else None,
            )

        pg = paginate(items, page, page_size)
        return {
            "ok": True,
            "data": _fix_large_ints(pg["data"]),
            "page": pg["page"],
            "page_size": pg["page_size"],
            "total_pages": pg["total_pages"],
            "total_count": pg["total_count"],
            "_source": "mysql_direct",
            "_load_ms": load_ms,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cari list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cari-extre")
async def get_cari_extre(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch kart_extre_cari for a specific customer.
    
    2026-05-12 — _on_demand_request zaten Step 0b'de MySQL dataset_cache'i
    direkt okur (lookup_cached_report). Cache HIT olduğunda POS'a gitmez ve
    çok hızlı yanıt verir. Burada sadece parametre düzenleme + cache yaş limiti.
    """
    tenant_id = body.get("tenant_id", "")
    cari_id = body.get("cari_id")
    doviz_ad = body.get("doviz_ad", 1)
    tarih_baslangic = body.get("tarih_baslangic", "")
    tarih_bitis = body.get("tarih_bitis", "")
    devir = body.get("devir", "Devreden")
    force_refresh = bool(body.get("force_refresh", False))
    
    if not tenant_id or cari_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve cari_id gerekli")
    
    if not tarih_baslangic:
        from datetime import date as date_cls
        tarih_baslangic = date_cls.today().replace(day=1).strftime("%Y-%m-%d")
    if not tarih_bitis:
        from datetime import date as date_cls
        tarih_bitis = date_cls.today().strftime("%Y-%m-%d")
    
    try:
        result = await _on_demand_request(
            tenant_id, "kart_extre_cari", {
                "ID": int(cari_id),
                "DOVIZ_AD": int(doviz_ad),
                "TARIH_BASLANGIC": tarih_baslangic,
                "TARIH_BITIS": tarih_bitis,
                "DEVIR": devir,
            },
            timeout_sec=45,
            skip_mysql_cache=force_refresh,
        )
        # Surface cache hit info to frontend
        if isinstance(result, dict):
            result["from_cache"] = bool(result.get("_cache_hit"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cari extre error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-extre")
async def get_stock_extre(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch stok_extre (stock movement history) for a specific product.
    
    2026-05-12 — Cache'den okuyup (params: {ID: stok_id}) tarih filtresini
    backend tarafında uygular. Frontend tarih_baslangic / tarih_bitis gönderir.
    """
    tenant_id = body.get("tenant_id", "")
    stok_id = body.get("stok_id")
    tarih_baslangic = body.get("tarih_baslangic", "")
    tarih_bitis = body.get("tarih_bitis", "")
    force_refresh = bool(body.get("force_refresh", False))

    if not tenant_id or stok_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve stok_id gerekli")

    if not tarih_baslangic:
        from datetime import date as date_cls
        tarih_baslangic = date_cls.today().replace(day=1).strftime("%Y-%m-%d")
    if not tarih_bitis:
        from datetime import date as date_cls
        tarih_bitis = date_cls.today().strftime("%Y-%m-%d")

    rows: list = []
    from_cache = False
    try:
        result = await _on_demand_request(
            tenant_id, "stok_extre", {"ID": int(stok_id)},
            timeout_sec=35, raw_cache=True,
            skip_mysql_cache=force_refresh,
        )
        from_cache = bool(result.get("_cache_hit"))
        cache_data = (result or {}).get("cache", {})
        rows = cache_data.get("data", []) or []
        if isinstance(rows, dict):
            if "result_sets" in rows and isinstance(rows["result_sets"], list) and rows["result_sets"]:
                rows = rows["result_sets"][0] if isinstance(rows["result_sets"][0], list) else []
            else:
                rows = []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock extre fetch error: {e}")
        rows = []

    # Apply date filter (TARIH ISO YYYY-MM-DD)
    def _row_date(r: dict) -> str:
        for k in ("TARIH", "TARIHI", "ISLEM_TARIHI", "FIS_TARIHI", "TARIH_STR"):
            v = r.get(k)
            if v:
                return str(v)[:10]
        return ""

    filtered = [r for r in rows if (not _row_date(r)) or (_row_date(r) >= tarih_baslangic and _row_date(r) <= tarih_bitis)]

    return {
        "ok": True,
        "data": _fix_large_ints(filtered),
        "total_rows": len(rows),
        "filtered_rows": len(filtered),
        "from_cache": from_cache,
        "tarih_baslangic": tarih_baslangic,
        "tarih_bitis": tarih_bitis,
    }


@router.post("/fis-detail")
async def get_fis_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch fis detail + totals — Önce MySQL cache, MISS olursa POS canlı sorgu.
    
    PHP sync config: dataset_key='fis_detay_toplam' → sql: dbo.GetFisDetayVeToplam
    multi_result: true → İki result set döner: [details], [totals]
    
    2026-05-12 — Aylık fişler önceden cache'lenmiş olur (anında); cache MISS
    durumunda eski fişler için _on_demand_request ile POS'a request_create
    atılır ve sonuç hem dönüş hem de cache'e yazılır.
    """
    from services.dataset_cache import lookup_cached_report
    
    tenant_id = body.get("tenant_id", "")
    fis_id = body.get("fis_id")
    
    if not tenant_id or fis_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve fis_id gerekli")
    
    params = {"FisId": int(fis_id)}
    
    def _parse_data(data):
        detail_rows = []
        total_row = {}
        if isinstance(data, dict):
            if "result_sets" in data:
                rs = data["result_sets"]
                if isinstance(rs, list) and len(rs) >= 1:
                    detail_rows = rs[0] if isinstance(rs[0], list) else []
                if isinstance(rs, list) and len(rs) >= 2:
                    totals = rs[1] if isinstance(rs[1], list) else []
                    total_row = totals[0] if totals else {}
            elif "details" in data:
                detail_rows = data.get("details", [])
                totals = data.get("totals", data.get("summary", []))
                total_row = totals[0] if isinstance(totals, list) and totals else {}
        elif isinstance(data, list):
            if len(data) >= 2 and isinstance(data[0], list):
                detail_rows = data[0]
                total_row = data[1][0] if isinstance(data[1], list) and data[1] else {}
            else:
                detail_rows = data
        return detail_rows, total_row
    
    # 1) MySQL cache lookup (lookup_cached_report tolerant comparison)
    try:
        cached = await lookup_cached_report(tenant_id, "fis_detay_toplam", params, max_age_sec=86400 * 90)
        if cached and isinstance(cached, dict):
            data = cached.get("data")
            logger.info(f"[fis-detail] cache HIT fis_id={fis_id} data_type={type(data).__name__}")
            detail_rows, total_row = _parse_data(data)
            logger.info(f"[fis-detail] cache parsed: details={len(detail_rows) if isinstance(detail_rows, list) else 'na'} totals={bool(total_row)}")
            if detail_rows or total_row:
                return {
                    "ok": True,
                    "from_cache": True,
                    "cached_at": str(cached.get("updated_at", "")),
                    "details": _fix_large_ints(detail_rows) if isinstance(detail_rows, list) else [],
                    "totals": _fix_large_ints([total_row]) if total_row else [],
                }
            else:
                logger.warning(f"[fis-detail] cache HIT but empty parse, raw: {str(data)[:300]}")
        else:
            logger.info(f"[fis-detail] cache MISS fis_id={fis_id}, falling back to POS")
    except Exception as e:
        logger.warning(f"[fis-detail] cache lookup error: {e}")
    
    # 2) Fallback — POS canlı sorgu (eski fişler için)
    try:
        result = await _on_demand_request(tenant_id, "fis_detay_toplam", params,
                                          timeout_sec=35, raw_cache=True)
        cache = result.get("cache", {})
        data = cache.get("data", [])
        logger.info(f"[fis-detail] POS fallback fis_id={fis_id} data_type={type(data).__name__}")
        detail_rows, total_row = _parse_data(data)
        logger.info(f"[fis-detail] POS parsed: details={len(detail_rows) if isinstance(detail_rows, list) else 'na'} totals={bool(total_row)}")
        if not detail_rows and not total_row:
            logger.warning(f"[fis-detail] POS raw response: {str(data)[:500]}")
        return {
            "ok": True,
            "from_cache": False,
            "request_uid": result.get("request_uid", ""),
            "details": _fix_large_ints(detail_rows) if isinstance(detail_rows, list) else [],
            "totals": _fix_large_ints([total_row]) if total_row else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"fis-detail POS fallback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/high-sale-detail")
async def get_high_sale_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """2026-05-05 — Yüksek Satış push'una tıklandığında çağrılır.

    Strategy: read `fis_gunluk_bildirim_feed` directly from MySQL cache
    (cache-first via `_on_demand_request`). Find the row whose FIS_ID matches
    the requested one and return its nested `URUNLER` array (line items) as
    `details`. The row itself is returned as `totals` so the modal can show
    BELGENO / KESEN_PERSONEL / LOKASYON / TUTAR.

    The user has agreed to extend `fis_gunluk_bildirim_feed` rows with a
    `URUNLER` array on the POS side; if the array is missing we fall back to
    `fis_detay_toplam` (also cache-first) so the modal still has lines to show.
    """
    tenant_id = body.get("tenant_id", "")
    fis_id = body.get("fis_id")
    if not tenant_id or fis_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve fis_id gerekli")

    try:
        fis_id_int = int(fis_id)
    except (TypeError, ValueError):
        fis_id_int = None

    def _match_row(rows: list) -> dict:
        if not isinstance(rows, list):
            return {}
        target_str = str(fis_id)
        for r in rows:
            if not isinstance(r, dict):
                continue
            row_fid = r.get("FIS_ID")
            if row_fid is None:
                continue
            if fis_id_int is not None:
                try:
                    if int(row_fid) == fis_id_int:
                        return r
                    continue
                except (TypeError, ValueError):
                    pass
            if str(row_fid) == target_str:
                return r
        return {}

    def _flatten_urunler(row: dict) -> list:
        """Extract a flat list of product rows from a feed row.

        2026-05-05 — User confirmed POS stores receipt lines under the
        `DETAYLAR` key as a **JSON-encoded string** (not an array). Each
        line carries DETAY_ID / STOK_KODU / STOK_ADI / BIRIM_ADI / MIKTAR
        / FIYAT / DAHIL_FIYAT / TUTAR / DAHIL_TUTAR / SATIR_ISKONTO_TUTARI
        / KDV_HARIC_NET_TUTAR / KDV_TUTARI / KDV_DAHIL_NET_TUTAR / LOKASYON.
        Other keys (URUNLER, ITEMS, …) are kept as fallbacks.
        """
        candidates = ("DETAYLAR", "URUNLER", "ITEMS", "LINES", "KALEMLER", "SATIRLAR")
        raw = None
        for k in candidates:
            if k in row:
                raw = row[k]
                break
        if raw is None:
            return []
        # JSON-encoded array of objects
        if isinstance(raw, str):
            import json as _json
            try:
                raw = _json.loads(raw)
            except Exception:
                return []
        if not isinstance(raw, list):
            return []
        out: list = []
        for el in raw:
            if isinstance(el, dict):
                out.append(el)
            elif isinstance(el, list):
                # nested array of dicts
                for sub in el:
                    if isinstance(sub, dict):
                        out.append(sub)
        return out

    try:
        # Step 1 — read cache. We bypass the standard `_on_demand_request`
        # whitelist + param-matching logic and read the most recent row from
        # `dataset_cache` directly. Reason: `fis_gunluk_bildirim_feed` is
        # populated by the watcher with a TARIH-bearing params_json that does
        # not match the empty `{}` params we pass here.
        rows: list = []
        try:
            from services.dataset_cache import get_data_pool
            import json as _json2
            pool = await get_data_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    # Try newest entries first; if the FIS_ID isn't in them,
                    # iterate through more candidates. We collect rows from
                    # ALL recent caches and let `_match_row` pick the right
                    # one — receipts may straddle day boundaries.
                    await cur.execute(
                        """
                        SELECT data_json, row_count, synced_at FROM dataset_cache
                        WHERE tenant_id=%s AND dataset_key=%s
                        ORDER BY synced_at DESC LIMIT 8
                        """,
                        (tenant_id, "fis_gunluk_bildirim_feed"),
                    )
                    merged: list = []
                    seen_fids: set = set()
                    for cand in await cur.fetchall():
                        try:
                            data = _json2.loads(cand[0] or "[]")
                        except Exception:
                            continue
                        if not isinstance(data, list):
                            continue
                        for r in data:
                            if not isinstance(r, dict):
                                continue
                            fid = r.get("FIS_ID")
                            try:
                                fid_key = int(fid) if fid is not None else None
                            except (TypeError, ValueError):
                                fid_key = str(fid)
                            if fid_key in seen_fids:
                                continue
                            seen_fids.add(fid_key)
                            merged.append(r)
                    rows = merged
        except Exception as e_db:
            logger.warning(f"[high-sale-detail] direct cache lookup failed: {e_db}")

        # Fall back to the regular cached path (covers edge cases where the
        # direct query failed).
        # 2026-05-16 — cache_only=True: kullanıcı isteği, POS'a request_create
        # yapılmıyor, sadece mevcut cache okunuyor.
        if not rows:
            result = await _on_demand_request(
                tenant_id, "fis_gunluk_bildirim_feed", {}, raw_cache=True,
                cache_only=True,
            )
            cache = result.get("cache") or {}
            if isinstance(cache.get("data"), list):
                rows = cache["data"]
            elif isinstance(result.get("data"), list):
                rows = result["data"]
        else:
            result = {"_source": "mysql_cache_direct"}

        row = _match_row(rows)
        details = _flatten_urunler(row)
        logger.info(
            f"[high-sale-detail] tenant={tenant_id} fis_id={fis_id} "
            f"feed_rows={len(rows)} match={'Y' if row else 'N'} "
            f"details_from_feed={len(details)}"
        )

        # Step 2 — fallback to fis_detay_toplam if URUNLER missing
        fallback_used = False
        if not details and fis_id_int is not None:
            fallback_used = True
            try:
                # 2026-05-16 — cache_only=True: kullanıcı isteği, POS'a request_create yok.
                fb = await _on_demand_request(
                    tenant_id, "fis_detay_toplam", {"FisId": fis_id_int},
                    timeout_sec=20, raw_cache=True, cache_only=True,
                )
                fb_data = (fb.get("cache") or {}).get("data") or fb.get("data")
                # `fis_detay_toplam` may return [[details], [totals]] or {result_sets:[…]}
                if isinstance(fb_data, dict):
                    rs = fb_data.get("result_sets") or []
                    if isinstance(rs, list) and rs and isinstance(rs[0], list):
                        details = rs[0]
                    elif "details" in fb_data and isinstance(fb_data["details"], list):
                        details = fb_data["details"]
                elif isinstance(fb_data, list):
                    if fb_data and isinstance(fb_data[0], list):
                        details = fb_data[0]
                    else:
                        details = fb_data
                if details and isinstance(details, list) and isinstance(details[0], dict):
                    # 2026-05-06 — `fis_detay_toplam` farklı kolon adları kullanır
                    # (STOK / MIKTAR_FIS / BIRIM / TOPLAM_SATIR_ISKONTOSU). Modal'a
                    # gitmeden önce normalize edip feed schema'ya çevir.
                    normalized: list = []
                    for r in details:
                        if not isinstance(r, dict):
                            continue
                        nr = dict(r)
                        # Stok adı
                        if not nr.get("STOK_ADI"):
                            nr["STOK_ADI"] = (
                                nr.get("STOK") or nr.get("STOK_AD") or
                                nr.get("AD") or nr.get("ACIKLAMA") or ""
                            )
                        # Stok kodu
                        if not nr.get("STOK_KODU"):
                            nr["STOK_KODU"] = nr.get("STOK_KOD") or nr.get("KOD") or nr.get("BARKOD") or ""
                        # Miktar
                        if nr.get("MIKTAR") in (None, "", 0, "0", "0.000"):
                            mf = nr.get("MIKTAR_FIS")
                            if mf not in (None, "", 0, "0"):
                                nr["MIKTAR"] = mf
                        # Birim
                        if not nr.get("BIRIM_ADI"):
                            nr["BIRIM_ADI"] = nr.get("BIRIM") or ""
                        # İndirim (satır iskontosu)
                        if not nr.get("SATIR_ISKONTO_TUTARI"):
                            nr["SATIR_ISKONTO_TUTARI"] = (
                                nr.get("TOPLAM_SATIR_ISKONTOSU") or
                                nr.get("ISKONTO_TUTARI") or nr.get("INDIRIM_TUTARI") or "0"
                            )
                        # KDV dahil net tutar (modalin tercih ettiği)
                        if not nr.get("KDV_DAHIL_NET_TUTAR"):
                            nr["KDV_DAHIL_NET_TUTAR"] = (
                                nr.get("DAHIL_TUTAR") or nr.get("TUTAR") or "0"
                            )
                        normalized.append(nr)
                    details = normalized
            except Exception as e_fb:
                logger.info(f"[high-sale-detail] fis_detay_toplam fallback failed: {e_fb}")

        # 2026-05-13 — Aggregate KDV + İskonto + Kalem from DETAYLAR into
        # the totals row. The feed row itself only carries TUTAR / DETAY_TOPLAM_*
        # but the frontend HighSaleDetailModal reads `totals.KDV_TUTAR` /
        # `totals.ISKONTO_TUTAR` / `totals.KALEM_SAYISI`. Compute them now so
        # the modal can render values directly from cache (no extra calls).
        try:
            if isinstance(row, dict) and isinstance(details, list) and details:
                kdv_sum = 0.0
                isk_sum = 0.0
                net_sum = 0.0
                kalem = 0
                for d in details:
                    if not isinstance(d, dict):
                        continue
                    kalem += 1
                    try:
                        kdv_sum += float(
                            d.get("KDV_TUTARI") or d.get("KDV_TUTAR") or 0
                        )
                    except (TypeError, ValueError):
                        pass
                    try:
                        isk_sum += float(
                            d.get("TOPLAM_ISKONTO_TUTARI")
                            or d.get("SATIR_ISKONTO_TUTARI")
                            or d.get("ISKONTO_TUTARI")
                            or d.get("INDIRIM_TUTARI")
                            or 0
                        )
                    except (TypeError, ValueError):
                        pass
                    try:
                        net_sum += float(
                            d.get("KDV_DAHIL_NET_TUTAR")
                            or d.get("DAHIL_TUTAR")
                            or d.get("NET_TUTAR")
                            or d.get("TUTAR")
                            or 0
                        )
                    except (TypeError, ValueError):
                        pass
                # Write back to the totals row (frontend expects flat fields)
                row = dict(row)
                row["KDV_TUTAR"] = round(kdv_sum, 2)
                row["KDV_TUTARI"] = round(kdv_sum, 2)
                row["ISKONTO_TUTAR"] = round(isk_sum, 2)
                row["TOPLAM_ISKONTO_TUTARI"] = round(isk_sum, 2)
                row["INDIRIM_TUTAR"] = round(isk_sum, 2)
                row["KALEM_SAYISI"] = kalem
                row["TOPLAM"] = round(net_sum, 2)
                # Fallback: if main TUTAR is missing/0 but details summed to a real value
                if not row.get("TUTAR") and net_sum:
                    row["TUTAR"] = round(net_sum, 2)
        except Exception as _e_agg:
            logger.debug(f"[high-sale-detail] totals aggregation failed: {_e_agg}")

        return {
            "ok": True,
            "_source": result.get("_source", "unknown"),
            "details": _fix_large_ints(details) if isinstance(details, list) else [],
            "totals": _fix_large_ints([row]) if row else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"high-sale-detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === RAPOR ENDPOINTS ===

@router.post("/report-run")
async def run_report(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Run any report via sync.php request_create with given dataset_key and params.
    With in-memory cache (TTL 180s fresh / 900s stale) to mitigate slow POS responses
    and repeated identical queries."""
    tenant_id = body.get("tenant_id", "")
    dataset_key = body.get("dataset_key", "")
    params = body.get("params", {})
    force_refresh = bool(body.get("force_refresh", False))

    if not tenant_id or not dataset_key:
        raise HTTPException(status_code=400, detail="tenant_id ve dataset_key gerekli")

    # Validate allowed report keys
    allowed_keys = [
        "rap_fiyat_listeleri_web", "rap_satis_adet_kar_web", "rap_stok_envanter_web",
        "rap_lm_gelir_tablosu", "rap_personel_satis_ozet_web",
        "rap_fis_kalem_listesi_web", "rap_cari_hesap_ekstresi_web",
        "rap_filtre_lookup", "rap_acik_hesap_kisi_ozet_web",
    ]
    if dataset_key not in allowed_keys:
        raise HTTPException(status_code=400, detail=f"Geçersiz rapor: {dataset_key}")

    # Build cache key from params (excluding pagination Page so all-pages share)
    fetch_all = bool(body.get("fetch_all", False))
    params_for_key = {k: v for k, v in (params or {}).items() if k != "Page"}
    try:
        params_hash = json.dumps(params_for_key, sort_keys=True, default=str)
    except Exception:
        params_hash = str(params_for_key)
    cache_key = f"report::{dataset_key}::{tenant_id}::{params_hash}::all={fetch_all}"
    now = time.time()
    TTL_FRESH = 180     # 3 min: serve immediately
    TTL_STALE = 900     # 15 min: serve while refreshing in background

    cached = _GLOBAL_CACHE.get(cache_key)
    age = now - cached["ts"] if cached else None

    if cached and age is not None and age < TTL_FRESH and not force_refresh:
        return {**cached["payload"], "_cache": "fresh", "_age": int(age)}

    async def _do_fetch() -> dict:
        try:
            logger.info(f"Running report: {dataset_key} with params: {params}")

            if fetch_all and isinstance(params, dict) and "PageSize" in params:
                page_size = int(params.get("PageSize") or 500)
                first_result = await _on_demand_request(tenant_id, dataset_key, {**params, "Page": 1, "PageSize": page_size}, timeout_sec=90)
                first_data = first_result.get("data", []) if isinstance(first_result, dict) else []
                if not isinstance(first_data, list):
                    first_data = []
                req_uid = first_result.get("request_uid", "")

                if len(first_data) < page_size:
                    logger.info(f"Report result (single page): {dataset_key} -> {len(first_data)} rows")
                    return {"ok": True, "request_uid": req_uid, "data": first_data, "pages": 1}

                all_rows = list(first_data)
                page = 2
                max_pages = 50
                batch_size = 8  # was 5 — more parallelism for snappier reports
                done = False
                while not done and page <= max_pages:
                    tasks = [
                        _on_demand_request(tenant_id, dataset_key, {**params, "Page": p, "PageSize": page_size}, timeout_sec=90)
                        for p in range(page, min(page + batch_size, max_pages + 1))
                    ]
                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    for r in results:
                        if isinstance(r, Exception):
                            logger.warning(f"Page fetch error: {r}")
                            done = True
                            break
                        d = r.get("data", []) if isinstance(r, dict) else []
                        if not isinstance(d, list) or len(d) == 0:
                            done = True
                            break
                        all_rows.extend(d)
                        if len(d) < page_size:
                            done = True
                            break
                    page += batch_size

                logger.info(f"Report result (paged): {dataset_key} -> {len(all_rows)} rows across {page-1} page(s)")
                return {"ok": True, "request_uid": req_uid, "data": all_rows, "pages": page - 1}

            result = await _on_demand_request(tenant_id, dataset_key, params, timeout_sec=90)
            data_count = len(result.get("data", [])) if isinstance(result.get("data"), list) else 0
            logger.info(f"Report result: {dataset_key} -> {data_count} rows")
            return result
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Report run error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    # Stale cache → kick off bg refresh, return stale immediately
    if cached and age is not None and age < TTL_STALE and not force_refresh:
        async def _bg():
            try:
                fresh = await _do_fetch()
                _GLOBAL_CACHE[cache_key] = {"ts": time.time(), "payload": fresh}
            except Exception as e:
                logger.warning(f"Report bg refresh failed: {e}")
        asyncio.create_task(_bg())
        return {**cached["payload"], "_cache": "stale", "_age": int(age)}

    # Live fetch with fallback to any cache
    try:
        fresh = await _do_fetch()
        _GLOBAL_CACHE[cache_key] = {"ts": time.time(), "payload": fresh}
        return {**fresh, "_cache": "live", "_age": 0}
    except HTTPException as e:
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e.detail)}
        raise


@router.post("/report-filter-options")
async def get_report_filter_options(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch filter dropdown options via rap_filtre_lookup.
    Aggressive caching: filter options change rarely; serve from memory for 30 minutes."""
    tenant_id = body.get("tenant_id", "")
    source = body.get("source", "")

    if not tenant_id or not source:
        raise HTTPException(status_code=400, detail="tenant_id ve source gerekli")

    cache_key = f"filter_options::{tenant_id}::{source}"
    now = time.time()
    TTL_FRESH = 1800   # 30 min — filter sources very rarely change
    TTL_STALE = 7200   # 2 hours

    cached = _GLOBAL_CACHE.get(cache_key)
    age = now - cached["ts"] if cached else None

    if cached and age is not None and age < TTL_FRESH:
        return {**cached["payload"], "_cache": "fresh", "_age": int(age)}

    async def _refresh():
        # 2026-05-02 — POS sync now stores rap_filtre_lookup as a SINGLE big
        # blob with params {Kaynak:"", Q:""} containing every dropdown's rows
        # under a `Kaynak` field. So we fetch the full blob once and filter
        # by `Kaynak == source` in Python instead of asking POS per-source.
        result = await _on_demand_request(tenant_id, "rap_filtre_lookup", {
            "Kaynak": "",
            "Q": "",
        }, timeout_sec=30)
        # Filter the rows for the requested source
        try:
            all_rows = result.get("data", []) if isinstance(result, dict) else []
        except Exception:
            all_rows = []
        if isinstance(all_rows, list) and source:
            wanted = source.strip().upper()
            filtered = [
                r for r in all_rows
                if str(r.get("Kaynak") or r.get("KAYNAK") or "").strip().upper() == wanted
            ]
            result = {**(result if isinstance(result, dict) else {}), "data": filtered}
        _GLOBAL_CACHE[cache_key] = {"ts": time.time(), "payload": result}
        return result

    if cached and age is not None and age < TTL_STALE:
        async def _bg():
            try:
                await _refresh()
            except Exception as e:
                logger.warning(f"Filter options bg refresh failed: {e}")
        asyncio.create_task(_bg())
        return {**cached["payload"], "_cache": "stale", "_age": int(age)}

    try:
        fresh = await _refresh()
        return {**fresh, "_cache": "live", "_age": 0}
    except HTTPException as e:
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e.detail)}
        raise
    except Exception as e:
        logger.error(f"Report filter options error: {e}")
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e)}
        raise HTTPException(status_code=500, detail=str(e))
