from fastapi import APIRouter, HTTPException, Depends, Query
from services import get_data_pool
from routes.auth import get_current_user
from typing import Optional
import json
import logging
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["data"])


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
        numeric_fields = ['GENELTOPLAM', 'NAKIT', 'KREDI_KARTI', 'VERESIYE', 'TOPLAM', 'KDV', 'FISTOPLAM', 'NETCIRO']
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
        # Group by SAAT_ADI, sum TOPLAM
        hour_map = {}
        for item in raw_items:
            hour = item.get('SAAT_ADI', '')
            if hour not in hour_map:
                hour_map[hour] = dict(item)
                hour_map[hour]['TOPLAM'] = _sum_float(item.get('TOPLAM'))
            else:
                hour_map[hour]['TOPLAM'] = hour_map[hour].get('TOPLAM', 0) + _sum_float(item.get('TOPLAM'))
        result = []
        for h, data in sorted(hour_map.items()):
            row = dict(data)
            row['TOPLAM'] = f"{row['TOPLAM']:.8f}" if isinstance(row['TOPLAM'], (int, float)) else row['TOPLAM']
            result.append(row)
        return result
    
    elif key in ('top10_stock_movements', 'down10_stock_movements'):
        # Group by STOK_AD, sum MIKTAR_CIKIS and TUTAR_CIKIS
        stock_map = {}
        for item in raw_items:
            name = item.get('STOK_AD', '')
            if name not in stock_map:
                stock_map[name] = dict(item)
                stock_map[name]['MIKTAR_CIKIS'] = _sum_float(item.get('MIKTAR_CIKIS'))
                stock_map[name]['TUTAR_CIKIS'] = _sum_float(item.get('TUTAR_CIKIS'))
            else:
                stock_map[name]['MIKTAR_CIKIS'] = stock_map[name].get('MIKTAR_CIKIS', 0) + _sum_float(item.get('MIKTAR_CIKIS'))
                stock_map[name]['TUTAR_CIKIS'] = stock_map[name].get('TUTAR_CIKIS', 0) + _sum_float(item.get('TUTAR_CIKIS'))
        
        result = list(stock_map.values())
        result.sort(key=lambda x: x.get('TUTAR_CIKIS', 0), reverse=(key == 'top10_stock_movements'))
        for row in result:
            for f in ('MIKTAR_CIKIS', 'TUTAR_CIKIS'):
                if isinstance(row.get(f), (int, float)):
                    row[f] = f"{row[f]:.6f}"
        return result[:10]
    
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
    ]
    
    pool = await get_data_pool()
    result = {}
    
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
