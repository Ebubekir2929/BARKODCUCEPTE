from fastapi import APIRouter, HTTPException, Depends, Query
from services import get_data_pool
from routes.auth import get_current_user
from typing import Optional
import json
import logging
from datetime import date, datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["data"])


async def fetch_dataset(pool, tenant_id: str, dataset_key: str, filter_date: Optional[str] = None):
    """Fetch dataset - if filter_date given, match by sdate in params_json, otherwise get latest"""
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if filter_date:
                # Match records where sdate starts with the filter_date (YYYY-MM-DD)
                await cur.execute("""
                    SELECT data_json, row_count, synced_at, updated_at, params_json
                    FROM dataset_cache 
                    WHERE tenant_id = %s AND dataset_key = %s
                      AND params_json LIKE %s
                    ORDER BY updated_at DESC
                    LIMIT 1
                """, (tenant_id, dataset_key, f'%"sdate":"{filter_date}%'))
                row = await cur.fetchone()
                
                if not row:
                    # Try alternative format
                    await cur.execute("""
                        SELECT data_json, row_count, synced_at, updated_at, params_json
                        FROM dataset_cache 
                        WHERE tenant_id = %s AND dataset_key = %s
                          AND JSON_EXTRACT(params_json, '$.sdate') LIKE %s
                        ORDER BY updated_at DESC
                        LIMIT 1
                    """, (tenant_id, dataset_key, f'{filter_date}%'))
                    row = await cur.fetchone()
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
    
    if sdate and edate and sdate != edate:
        # Date RANGE: aggregate data across multiple days
        try:
            start = datetime.strptime(sdate, "%Y-%m-%d").date()
            end = datetime.strptime(edate, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Tarih formatı hatalı (YYYY-MM-DD)")
        
        for key in dashboard_keys:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    # Get all records in date range
                    await cur.execute("""
                        SELECT data_json, row_count, synced_at, updated_at, params_json
                        FROM dataset_cache 
                        WHERE tenant_id = %s AND dataset_key = %s
                          AND (
                            JSON_EXTRACT(params_json, '$.sdate') >= %s
                            AND JSON_EXTRACT(params_json, '$.sdate') <= %s
                          )
                        ORDER BY JSON_EXTRACT(params_json, '$.sdate') DESC
                    """, (tenant_id, key, f'{sdate} 00:00:00', f'{edate} 23:59:59'))
                    rows = await cur.fetchall()
            
            if rows:
                # For financial data, aggregate across days
                if key in ('financial_data', 'financial_data_location', 'cancel_data',
                           'top10_stock_movements', 'down10_stock_movements',
                           'hourly_data', 'hourly_location_data', 'iptal_ozet', 'iptal_detay'):
                    all_data = []
                    for r in rows:
                        try:
                            d = json.loads(r[0]) if r[0] else []
                            if isinstance(d, list):
                                all_data.extend(d)
                            else:
                                all_data.append(d)
                        except json.JSONDecodeError:
                            pass
                    
                    # For financial_data, aggregate totals
                    if key == 'financial_data' and all_data:
                        aggregated = {}
                        for item in all_data:
                            for k, v in item.items():
                                try:
                                    aggregated[k] = aggregated.get(k, 0) + float(v)
                                except (ValueError, TypeError):
                                    aggregated[k] = v
                        # Convert back to string format
                        for k, v in aggregated.items():
                            if isinstance(v, float):
                                aggregated[k] = f"{v:.8f}"
                        all_data = [aggregated]
                    
                    result[key] = {
                        "data": all_data,
                        "row_count": len(all_data),
                        "synced_at": rows[0][2].isoformat() if rows[0][2] else None,
                        "updated_at": rows[0][3].isoformat() if rows[0][3] else None,
                    }
                else:
                    # For acik_masalar etc, just get the latest
                    try:
                        data = json.loads(rows[0][0]) if rows[0][0] else []
                    except json.JSONDecodeError:
                        data = []
                    result[key] = {
                        "data": data,
                        "row_count": rows[0][1],
                        "synced_at": rows[0][2].isoformat() if rows[0][2] else None,
                        "updated_at": rows[0][3].isoformat() if rows[0][3] else None,
                    }
            else:
                result[key] = {"data": [], "row_count": 0, "synced_at": None, "updated_at": None}
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
