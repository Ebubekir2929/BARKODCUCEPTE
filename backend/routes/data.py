from fastapi import APIRouter, HTTPException, Depends, Query
from services import get_data_pool
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


def _sum_float(val):
    """Safely parse a numeric string/value to float"""
    try:
        return float(val) if val is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


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
            # Matrah/KDV
            'MATRAH_1', 'MATRAH_0', 'MATRAH_10', 'MATRAH_20',
            'KDV_1', 'KDV_10', 'KDV_20',
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
        # Step 1: Create request
        create_resp = await sync_post({
            "action": "request_create",
            "dataset_key": "acik_masa_detay",
            "params": {"POS_ID": int(pos_id)},
            "priority_no": 1,
            "requested_by": "mobile",
        }, tenant_id)
        
        request_uid = create_resp.get("request_uid", "")
        if not request_uid:
            raise HTTPException(status_code=502, detail="Detay isteği oluşturulamadı")
        
        # Step 2: Poll for result (max 35 seconds)
        for _ in range(50):  # 50 * 0.7s = 35s max
            status_resp = await sync_post({
                "action": "request_status",
                "request_uid": request_uid,
                "include_data": True,
            }, tenant_id)
            
            status = status_resp.get("status", "unknown")
            
            if status == "done":
                data = status_resp.get("cache", {}).get("data", [])
                return {
                    "ok": True,
                    "request_uid": request_uid,
                    "data": _fix_large_ints(data) if isinstance(data, list) else [],
                }
            
            if status == "error":
                error_text = status_resp.get("error_text", "Bilinmeyen hata")
                raise HTTPException(status_code=502, detail=f"POS hatası: {error_text}")
            
            await asyncio.sleep(0.7)
        
        raise HTTPException(status_code=504, detail="Detay zamanında gelmedi. Lütfen tekrar deneyin.")
    
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


async def _on_demand_request(tenant_id: str, dataset_key: str, params: dict, timeout_sec: int = 35, raw_cache: bool = False):
    """Generic on-demand: request_create → poll request_status → return data"""
    # Step 1: Create request
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
    
    # Step 2: Poll for result
    poll_interval = 0.25  # was 0.4 — fastest safe rate for snappier reports/stock
    for _ in range(int(timeout_sec / poll_interval)):
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
                await asyncio.sleep(0.8)  # was 1.5 — faster chunk retry
                continue

        status = status_resp.get("status", "unknown")
        
        if status == "done":
            cache = status_resp.get("cache", {})
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
            # Detect upstream MySQL "max_allowed_packet" — too much data for one query.
            # Return clean 502 with a friendly Turkish message instead of cryptic stacktrace,
            # so the client can show "Veri çok büyük, daraltın" or fall back gracefully.
            if "max_allowed_packet" in str(error_text).lower():
                raise HTTPException(
                    status_code=502,
                    detail="POS sunucusu cevap çok büyük olduğu için döndüremedi. Lütfen tarih aralığını kısaltın veya sayfa boyutunu küçültün.",
                )
            raise HTTPException(status_code=502, detail=f"POS hatası: {error_text}")
        
        await asyncio.sleep(0.7)
    
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

    params = {
        "sdate": f"{sdate} 00:00:00",
        "edate": f"{edate} 23:59:59",
        "Page": page,
        "PageSize": page_size,
    }

    try:
        result = await _on_demand_request(tenant_id, "rap_acik_hesap_kisi_ozet_web", params, timeout_sec=120)
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
        result_inner = await _on_demand_request(tenant_id, "hourly_stock_detail", params, timeout_sec=45)
        rows_inner = result_inner.get("data", []) if isinstance(result_inner, dict) else []
        import re as _re
        by_hour_inner: Dict[str, List[Any]] = {}
        for r in rows_inner:
            hour_label = r.get("SAAT_ADI") or r.get("SAAT") or ""
            if not hour_label:
                ts = r.get("TARIH") or r.get("ISLEM_TARIHI") or r.get("FIS_TARIHI") or ""
                m = _re.search(r"(\d{1,2}):\d{2}", str(ts))
                if m:
                    h = int(m.group(1))
                    hour_label = f"{h:02d}:00 - {(h + 1) % 24:02d}:00"
            if not hour_label:
                hour_label = "Bilinmeyen"
            if hour_label not in by_hour_inner:
                by_hour_inner[hour_label] = []
            by_hour_inner[hour_label].append(r)
        payload = {"ok": True, "by_hour": by_hour_inner, "row_count": len(rows_inner)}
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
        return await _on_demand_request(tenant_id, "hourly_stock_detail", params)
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
    """On-demand: Cancel receipt detail - items in a specific cancelled receipt"""
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
    
    try:
        return await _on_demand_request(tenant_id, "iptal_detay", params)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Iptal detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



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
                resp = await sync_post({
                    "action": "dataset_get",
                    "dataset_key": "iptal_detay",
                    "params": {
                        "sdate": f"{dt} 00:00:00",
                        "edate": f"{dt} 23:59:59",
                        "IPTAL_ID": None,
                    },
                }, tenant_id)
                day_data = resp.get("data", [])
                if isinstance(day_data, list):
                    all_data.extend(day_data)
            except Exception as e:
                logger.warning(f"Iptal list for {dt}: {e}")
                continue
        
        # Deduplicate by IPTAL_ID
        seen = set()
        unique_data = []
        for item in all_data:
            iptal_id = item.get("IPTAL_ID")
            if iptal_id and iptal_id not in seen:
                seen.add(iptal_id)
                unique_data.append(item)
        
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
    """Fetch stok_fiyat_adlari (price name list) via sync.php dataset_get"""
    tenant_id = body.get("tenant_id", "")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")
    
    try:
        resp = await sync_post({
            "action": "dataset_get",
            "dataset_key": "stok_fiyat_adlari",
            "params": {},
        }, tenant_id)
        data = resp.get("data", [])
        return {"ok": True, "data": data if isinstance(data, list) else []}
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
    """Fetch stock_list via sync.php dataset_get with PAGINATION support.

    POS client now writes pages into `dataset_cache_pages` table (≈200 records / 180KB
    per page). We stream pages on demand for true lazy loading.

    Body: { tenant_id, fiyat_ad?, page?, page_size?, force_refresh? }
      - page omitted → fetch ALL pages (combined; legacy behaviour)
      - page provided → fetch ONLY that page

    Response: { ok, data, page, page_size, total_pages, total_count }
    """
    tenant_id = body.get("tenant_id", "")
    fiyat_ad = body.get("fiyat_ad", "")
    force_refresh = bool(body.get("force_refresh", False))
    page = body.get("page")
    page_size = int(body.get("page_size") or 200)

    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    cache_key = f"stock_list::{tenant_id}::{fiyat_ad}::p={page}::ps={page_size}"
    now = time.time()
    TTL_FRESH = 300
    TTL_STALE = 1800

    cached = _GLOBAL_CACHE.get(cache_key)
    age = now - cached["ts"] if cached else None

    if cached and age is not None and age < TTL_FRESH and not force_refresh:
        return {**cached["payload"], "_cache": "fresh", "_age": int(age)}

    async def _fetch_one_page(page_num: int) -> dict:
        params = {"FIYAT_AD": fiyat_ad} if fiyat_ad else {}
        return await sync_post({
            "action": "dataset_get",
            "dataset_key": "stock_list",
            "params": params,
            "page": int(page_num),
            "page_size": page_size,
        }, tenant_id)

    async def _refresh():
        if page is not None:
            # Single page mode
            resp = await _fetch_one_page(int(page))
            data = resp.get("data") or []
            payload = {
                "ok": True,
                "data": _fix_large_ints(data) if isinstance(data, list) else [],
                "page": int(page),
                "page_size": page_size,
                "total_pages": int(resp.get("total_pages") or 0),
                "total_count": int(resp.get("total_count") or 0),
            }
        else:
            # Legacy combined mode — fetch first page, then accumulate remaining
            first = await _fetch_one_page(1)
            first_data = first.get("data") or []
            total_pages = int(first.get("total_pages") or 1)
            total_count = int(first.get("total_count") or len(first_data))
            all_rows = list(first_data) if isinstance(first_data, list) else []

            if total_pages > 1:
                # Parallel fetch the rest in batches of 5
                remaining = list(range(2, total_pages + 1))
                batch_size = 5
                for i in range(0, len(remaining), batch_size):
                    batch_pages = remaining[i:i + batch_size]
                    results = await asyncio.gather(
                        *[_fetch_one_page(p) for p in batch_pages],
                        return_exceptions=True,
                    )
                    for r in results:
                        if isinstance(r, Exception):
                            logger.warning(f"Stock page fetch failed: {r}")
                            continue
                        d = r.get("data") or []
                        if isinstance(d, list):
                            all_rows.extend(d)

            payload = {
                "ok": True,
                "data": _fix_large_ints(all_rows),
                "page_size": page_size,
                "total_pages": total_pages,
                "total_count": total_count,
            }
        _GLOBAL_CACHE[cache_key] = {"ts": time.time(), "payload": payload}
        return payload

    if cached and age is not None and age < TTL_STALE and not force_refresh:
        async def _bg():
            try:
                await _refresh()
            except Exception as e:
                logger.warning(f"Stock list bg refresh failed: {e}")
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
        logger.error(f"Stock list error: {e}")
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e)}
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
    """Fetch cari_bakiye_liste via sync.php dataset_get with PAGINATION (≈200 rec/page).

    Body: { tenant_id, page?, page_size?, force_refresh? }
      - page omitted → ALL pages combined
      - page provided → SINGLE page
    """
    tenant_id = body.get("tenant_id", "")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id gerekli")

    page = body.get("page")
    page_size = int(body.get("page_size") or 200)
    force_refresh = bool(body.get("force_refresh", False))

    cache_key = f"cari_list::{tenant_id}::p={page}::ps={page_size}"
    now = time.time()
    TTL_FRESH = 300
    TTL_STALE = 1800
    cached = _GLOBAL_CACHE.get(cache_key)
    age = now - cached["ts"] if cached else None

    if cached and age is not None and age < TTL_FRESH and not force_refresh:
        return {**cached["payload"], "_cache": "fresh", "_age": int(age)}

    async def _fetch_one_page(page_num: int) -> dict:
        return await sync_post({
            "action": "dataset_get",
            "dataset_key": "cari_bakiye_liste",
            "params": {},
            "page": int(page_num),
            "page_size": page_size,
        }, tenant_id)

    async def _refresh():
        if page is not None:
            resp = await _fetch_one_page(int(page))
            data = resp.get("data") or []
            payload = {
                "ok": True,
                "data": _fix_large_ints(data) if isinstance(data, list) else [],
                "page": int(page),
                "page_size": page_size,
                "total_pages": int(resp.get("total_pages") or 0),
                "total_count": int(resp.get("total_count") or 0),
            }
        else:
            first = await _fetch_one_page(1)
            first_data = first.get("data") or []
            total_pages = int(first.get("total_pages") or 1)
            total_count = int(first.get("total_count") or len(first_data))
            all_rows = list(first_data) if isinstance(first_data, list) else []
            if total_pages > 1:
                remaining = list(range(2, total_pages + 1))
                batch_size = 5
                for i in range(0, len(remaining), batch_size):
                    batch_pages = remaining[i:i + batch_size]
                    results = await asyncio.gather(
                        *[_fetch_one_page(p) for p in batch_pages],
                        return_exceptions=True,
                    )
                    for r in results:
                        if isinstance(r, Exception):
                            logger.warning(f"Cari page fetch failed: {r}")
                            continue
                        d = r.get("data") or []
                        if isinstance(d, list):
                            all_rows.extend(d)
            payload = {
                "ok": True,
                "data": _fix_large_ints(all_rows),
                "page_size": page_size,
                "total_pages": total_pages,
                "total_count": total_count,
            }
        _GLOBAL_CACHE[cache_key] = {"ts": time.time(), "payload": payload}
        return payload

    if cached and age is not None and age < TTL_STALE and not force_refresh:
        async def _bg():
            try:
                await _refresh()
            except Exception as e:
                logger.warning(f"Cari list bg refresh failed: {e}")
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
        logger.error(f"Cari list error: {e}")
        if cached:
            return {**cached["payload"], "_cache": "fallback_stale", "_age": int(age) if age is not None else 0, "_stale_reason": str(e)}
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cari-extre")
async def get_cari_extre(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch kart_extre_cari for a specific customer"""
    tenant_id = body.get("tenant_id", "")
    cari_id = body.get("cari_id")
    doviz_ad = body.get("doviz_ad", 1)
    tarih_baslangic = body.get("tarih_baslangic", "")
    tarih_bitis = body.get("tarih_bitis", "")
    devir = body.get("devir", "Devreden")
    
    if not tenant_id or cari_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve cari_id gerekli")
    
    if not tarih_baslangic:
        from datetime import date as date_cls
        tarih_baslangic = date_cls.today().replace(day=1).strftime("%Y-%m-%d")
    if not tarih_bitis:
        from datetime import date as date_cls
        tarih_bitis = date_cls.today().strftime("%Y-%m-%d")
    
    try:
        return await _on_demand_request(tenant_id, "kart_extre_cari", {
            "ID": int(cari_id),
            "DOVIZ_AD": int(doviz_ad),
            "TARIH_BASLANGIC": tarih_baslangic,
            "TARIH_BITIS": tarih_bitis,
            "DEVIR": devir,
        }, timeout_sec=45)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cari extre error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fis-detail")
async def get_fis_detail(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Fetch fis_detay_toplam for a specific receipt - handles result_sets structure"""
    tenant_id = body.get("tenant_id", "")
    fis_id = body.get("fis_id")
    
    if not tenant_id or fis_id is None:
        raise HTTPException(status_code=400, detail="tenant_id ve fis_id gerekli")
    
    try:
        result = await _on_demand_request(tenant_id, "fis_detay_toplam", {
            "FisId": int(fis_id),
        }, timeout_sec=35, raw_cache=True)
        
        cache = result.get("cache", {})
        data = cache.get("data", [])
        
        detail_rows = []
        total_row = {}
        
        # Handle multiple response structures (like PHP normalize_fis_multi_result)
        if isinstance(data, dict):
            # Structure: {"result_sets": [[details], [totals]]}
            if "result_sets" in data:
                rs = data["result_sets"]
                if isinstance(rs, list) and len(rs) >= 1:
                    detail_rows = rs[0] if isinstance(rs[0], list) else []
                if isinstance(rs, list) and len(rs) >= 2:
                    totals = rs[1] if isinstance(rs[1], list) else []
                    total_row = totals[0] if totals else {}
            # Structure: {"details": [...], "totals": [...]}
            elif "details" in data:
                detail_rows = data.get("details", [])
                totals = data.get("totals", data.get("summary", []))
                total_row = totals[0] if isinstance(totals, list) and totals else {}
        elif isinstance(data, list):
            if len(data) >= 2 and isinstance(data[0], list):
                # Structure: [[details], [totals]]
                detail_rows = data[0]
                total_row = data[1][0] if isinstance(data[1], list) and data[1] else {}
            else:
                # Flat list - all rows are details
                detail_rows = data
        
        return {
            "ok": True,
            "request_uid": result.get("request_uid", ""),
            "details": _fix_large_ints(detail_rows) if isinstance(detail_rows, list) else [],
            "totals": _fix_large_ints([total_row]) if total_row else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Fis detail error: {e}")
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
        result = await _on_demand_request(tenant_id, "rap_filtre_lookup", {
            "Kaynak": source,
            "Q": "",
        }, timeout_sec=30)
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
