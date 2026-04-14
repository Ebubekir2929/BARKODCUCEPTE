from fastapi import APIRouter, HTTPException, Depends, Query
from services import get_data_pool
from routes.auth import get_current_user
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["data"])


@router.get("/dataset/{dataset_key}")
async def get_dataset(
    dataset_key: str,
    tenant_id: str = Query(..., description="Tenant ID to fetch data for"),
    current_user: dict = Depends(get_current_user),
):
    """Fetch dataset from kasacepteweb.dataset_cache by tenant_id and dataset_key"""
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT data_json, row_count, synced_at, updated_at, params_json
                FROM dataset_cache 
                WHERE tenant_id = %s AND dataset_key = %s
                ORDER BY updated_at DESC
                LIMIT 1
            """, (tenant_id, dataset_key))
            row = await cur.fetchone()
    
    if not row:
        return {"data": [], "row_count": 0, "synced_at": None, "dataset_key": dataset_key}
    
    data_json, row_count, synced_at, updated_at, params_json = row
    
    try:
        data = json.loads(data_json) if data_json else []
    except json.JSONDecodeError:
        data = []
    
    try:
        params = json.loads(params_json) if params_json else {}
    except json.JSONDecodeError:
        params = {}
    
    return {
        "data": data,
        "row_count": row_count,
        "synced_at": synced_at.isoformat() if synced_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "params": params,
        "dataset_key": dataset_key,
    }


@router.get("/dashboard")
async def get_dashboard_data(
    tenant_id: str = Query(..., description="Tenant ID"),
    current_user: dict = Depends(get_current_user),
):
    """Fetch all dashboard datasets for a tenant in one request"""
    dashboard_keys = [
        "financial_data", "financial_data_location",
        "hourly_data", "hourly_location_data",
        "cancel_data", "top10_stock_movements", "down10_stock_movements",
        "acik_masalar", "iptal_ozet", "iptal_detay",
    ]
    
    pool = await get_data_pool()
    result = {}
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for key in dashboard_keys:
                await cur.execute("""
                    SELECT data_json, row_count, synced_at, updated_at
                    FROM dataset_cache 
                    WHERE tenant_id = %s AND dataset_key = %s
                    ORDER BY updated_at DESC
                    LIMIT 1
                """, (tenant_id, key))
                row = await cur.fetchone()
                
                if row:
                    try:
                        data = json.loads(row[0]) if row[0] else []
                    except json.JSONDecodeError:
                        data = []
                    result[key] = {
                        "data": data,
                        "row_count": row[1],
                        "synced_at": row[2].isoformat() if row[2] else None,
                        "updated_at": row[3].isoformat() if row[3] else None,
                    }
                else:
                    result[key] = {"data": [], "row_count": 0, "synced_at": None, "updated_at": None}
    
    return result


@router.get("/stock")
async def get_stock_data(
    tenant_id: str = Query(..., description="Tenant ID"),
    current_user: dict = Depends(get_current_user),
):
    """Fetch stock list for a tenant"""
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Get all stock_list entries (might have multiple with different params/FIYAT_AD)
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
    
    # Deduplicate by ID
    seen_ids = set()
    unique_stocks = []
    for stock in all_stocks:
        stock_id = stock.get("ID")
        if stock_id and stock_id not in seen_ids:
            seen_ids.add(stock_id)
            unique_stocks.append(stock)
    
    return {
        "data": unique_stocks,
        "row_count": len(unique_stocks),
    }


@router.get("/customers")
async def get_customers_data(
    tenant_id: str = Query(..., description="Tenant ID"),
    current_user: dict = Depends(get_current_user),
):
    """Fetch customer (cari) balance list for a tenant"""
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
    tenant_id: str = Query(..., description="Tenant ID"),
    current_user: dict = Depends(get_current_user),
):
    """List all available dataset keys for a tenant"""
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
