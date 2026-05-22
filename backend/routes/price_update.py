"""
Price Update — mobil uygulamadan POS ürün fiyatlarını "pending" olarak işaretler.
Windows POS client periyodik olarak polling endpoint'ini çağırıp bu kayıtları
yerel sistemine uygular, sonra mark-applied ile onaylar.

Mimari (kullanıcı talebi 2026-05-21):
   Mobile  ──POST──>  patron.pending_price_updates  (status='pending')
                            │
                            └──poll──>  Windows POS client  ──apply local──>  POS DB
                                                │
                                            mark-applied
                                                ▼
                            patron.pending_price_updates  (status='applied')

POS API KREDİSİ YAKMAZ — sadece MariaDB read/write.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
import logging

from services import get_data_pool, get_patron_pool
from routes.auth import get_current_user, sha1_hash

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stock/price-update", tags=["price-update"])


# =============================================================================
# SCHEMA — auto create on first call
# =============================================================================

_TABLE_INITIALIZED = False

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS pending_price_updates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    product_barcode VARCHAR(64) DEFAULT NULL,
    product_name VARCHAR(255) DEFAULT NULL,
    price_name_id INT DEFAULT NULL,
    price_name VARCHAR(100) DEFAULT NULL,
    old_price DECIMAL(15,2) DEFAULT NULL,
    new_price DECIMAL(15,2) NOT NULL,
    status ENUM('pending','applied','failed','cancelled') NOT NULL DEFAULT 'pending',
    source VARCHAR(20) NOT NULL DEFAULT 'mobile',
    batch_id VARCHAR(40) DEFAULT NULL,
    created_at DATETIME NULL,
    applied_at DATETIME DEFAULT NULL,
    error_message VARCHAR(500) DEFAULT NULL,
    notes VARCHAR(500) DEFAULT NULL,
    INDEX idx_tenant_status (tenant_id, status),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


# Run an idempotent ALTER for upgrades from earlier table version
async def _migrate_add_price_name_cols(cur):
    """Adds price_name_id / price_name columns if they don't exist (idempotent)."""
    try:
        await cur.execute("SHOW COLUMNS FROM pending_price_updates LIKE 'price_name_id'")
        if not await cur.fetchone():
            await cur.execute("ALTER TABLE pending_price_updates ADD COLUMN price_name_id INT NULL AFTER product_name")
            await cur.execute("ALTER TABLE pending_price_updates ADD COLUMN price_name VARCHAR(100) NULL AFTER price_name_id")
            logger.info("pending_price_updates: added price_name_id + price_name columns")
    except Exception as e:
        logger.warning(f"_migrate_add_price_name_cols skipped: {e}")


async def ensure_table_exists():
    global _TABLE_INITIALIZED
    if _TABLE_INITIALIZED:
        return
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(CREATE_TABLE_SQL)
            await _migrate_add_price_name_cols(cur)
    _TABLE_INITIALIZED = True
    logger.info("pending_price_updates table ensured")


# =============================================================================
# MODELS
# =============================================================================

class PriceItem(BaseModel):
    product_id: str = Field(..., min_length=1, max_length=64)
    new_price: float = Field(..., gt=0)
    product_barcode: Optional[str] = Field(default=None, max_length=64)
    product_name: Optional[str] = Field(default=None, max_length=255)
    old_price: Optional[float] = Field(default=None)
    price_name_id: Optional[int] = Field(default=None)
    price_name: Optional[str] = Field(default=None, max_length=100)


class CreatePriceUpdateRequest(BaseModel):
    items: List[PriceItem] = Field(..., min_length=1, max_length=2000)
    password: str = Field(..., min_length=1)  # 4c: password protection
    notes: Optional[str] = Field(default=None, max_length=500)
    source: str = Field(default="mobile")

    @validator('source')
    def src_v(cls, v):
        if v not in ('mobile', 'bulk', 'api', 'web'):
            return 'mobile'
        return v


class BulkAdjustItem(BaseModel):
    product_id: str
    product_barcode: Optional[str] = None
    product_name: Optional[str] = None
    old_price: float = Field(..., gt=0)


class BulkAdjustRequest(BaseModel):
    """Toplu yüzdelik veya sabit miktar artış/indirim."""
    items: List[BulkAdjustItem] = Field(..., min_length=1, max_length=2000)
    adjustment_type: str = Field(..., pattern="^(percent|amount|fixed_price)$")
    value: float
    password: str = Field(..., min_length=1)
    notes: Optional[str] = Field(default=None, max_length=500)


class MarkAppliedRequest(BaseModel):
    error_message: Optional[str] = None


class MarkBulkAppliedRequest(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=2000)
    error_message: Optional[str] = None


# =============================================================================
# HELPERS
# =============================================================================

async def _verify_password(user_id: int, password: str):
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT password FROM users WHERE user_id = %s", (user_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
            if row[0] != sha1_hash(password):
                raise HTTPException(status_code=401, detail="Şifre hatalı")


def _calc_new_price(old: float, adj_type: str, value: float) -> float:
    if adj_type == 'percent':
        new = old * (1 + value / 100.0)
    elif adj_type == 'amount':
        new = old + value
    elif adj_type == 'fixed_price':
        new = value
    else:
        raise HTTPException(status_code=400, detail=f"Geçersiz ayarlama tipi: {adj_type}")
    new = round(new, 2)
    if new <= 0:
        raise HTTPException(status_code=400, detail=f"Hesaplanan fiyat 0 veya negatif olamaz ({new})")
    return new


def _row_to_dict(row, cols):
    d = {}
    for i, c in enumerate(cols):
        v = row[i]
        if isinstance(v, Decimal):
            v = float(v)
        elif isinstance(v, datetime):
            v = v.isoformat()
        d[c] = v
    return d


# =============================================================================
# ENDPOINTS — Mobile
# =============================================================================

@router.post("")
async def create_price_updates(
    data: CreatePriceUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Tek veya birden fazla ürün için pending fiyat güncellemesi oluşturur.

    İş kuralı (4c): kullanıcı şifresi DOĞRULANIR.
    """
    await ensure_table_exists()
    user_id = current_user["user_id"]
    tenant_id = current_user.get("tenant_id") or ""
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID bulunamadı. Önce veri kaynağı tanımlayın.")
    await _verify_password(user_id, data.password)

    import uuid
    batch_id = uuid.uuid4().hex[:32]
    now = datetime.utcnow()

    pool = await get_data_pool()
    inserted_ids = []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for item in data.items:
                await cur.execute(
                    """INSERT INTO pending_price_updates
                       (user_id, tenant_id, product_id, product_barcode, product_name,
                        price_name_id, price_name,
                        old_price, new_price, status, source, batch_id, created_at, notes)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s,%s,%s)""",
                    (
                        user_id, tenant_id, item.product_id, item.product_barcode, item.product_name,
                        item.price_name_id, item.price_name,
                        item.old_price, item.new_price, data.source, batch_id, now, data.notes,
                    ),
                )
                inserted_ids.append(cur.lastrowid)

    logger.info(f"price_update: user={user_id} tenant={tenant_id} created {len(inserted_ids)} pending updates batch={batch_id}")
    return {
        "success": True,
        "batch_id": batch_id,
        "count": len(inserted_ids),
        "ids": inserted_ids,
        "message": f"{len(inserted_ids)} fiyat güncellemesi sıraya alındı",
    }


@router.post("/bulk-adjust")
async def bulk_adjust(
    data: BulkAdjustRequest,
    current_user: dict = Depends(get_current_user),
):
    """Seçilen ürünlere yüzdelik / sabit miktar / sabit fiyat uygula."""
    await ensure_table_exists()
    user_id = current_user["user_id"]
    tenant_id = current_user.get("tenant_id") or ""
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID bulunamadı.")
    await _verify_password(user_id, data.password)

    import uuid
    batch_id = uuid.uuid4().hex[:32]
    now = datetime.utcnow()

    pool = await get_data_pool()
    inserted_ids = []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for item in data.items:
                new_price = _calc_new_price(item.old_price, data.adjustment_type, data.value)
                await cur.execute(
                    """INSERT INTO pending_price_updates
                       (user_id, tenant_id, product_id, product_barcode, product_name,
                        old_price, new_price, status, source, batch_id, created_at, notes)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,'pending','bulk',%s,%s,%s)""",
                    (
                        user_id, tenant_id, item.product_id, item.product_barcode, item.product_name,
                        item.old_price, new_price, batch_id, now, data.notes,
                    ),
                )
                inserted_ids.append(cur.lastrowid)

    logger.info(f"price_update bulk: user={user_id} tenant={tenant_id} {data.adjustment_type}={data.value} count={len(inserted_ids)} batch={batch_id}")
    return {
        "success": True,
        "batch_id": batch_id,
        "count": len(inserted_ids),
        "adjustment_type": data.adjustment_type,
        "value": data.value,
        "ids": inserted_ids,
    }


@router.get("")
async def list_price_updates(
    status: Optional[str] = Query(default=None, regex="^(pending|applied|failed|cancelled)$"),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """Kullanıcının kendi tenant'ına ait güncellemeleri listeler."""
    await ensure_table_exists()
    user_id = current_user["user_id"]
    tenant_id = current_user.get("tenant_id") or ""

    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Total counts per status (always returned for UI badges)
            await cur.execute(
                """SELECT status, COUNT(*) FROM pending_price_updates
                   WHERE tenant_id = %s GROUP BY status""",
                (tenant_id,),
            )
            counts = {r[0]: r[1] for r in await cur.fetchall()}

            sql = """SELECT id, user_id, tenant_id, product_id, product_barcode, product_name,
                            price_name_id, price_name,
                            old_price, new_price, status, source, batch_id,
                            created_at, applied_at, error_message, notes
                     FROM pending_price_updates
                     WHERE tenant_id = %s"""
            params = [tenant_id]
            if status:
                sql += " AND status = %s"
                params.append(status)
            sql += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
            await cur.execute(sql, params)
            cols = ["id", "user_id", "tenant_id", "product_id", "product_barcode", "product_name",
                    "price_name_id", "price_name",
                    "old_price", "new_price", "status", "source", "batch_id",
                    "created_at", "applied_at", "error_message", "notes"]
            rows = await cur.fetchall()
            items = [_row_to_dict(r, cols) for r in rows]

    return {
        "success": True,
        "items": items,
        "counts": {
            "pending": counts.get("pending", 0),
            "applied": counts.get("applied", 0),
            "failed": counts.get("failed", 0),
            "cancelled": counts.get("cancelled", 0),
        },
        "limit": limit,
        "offset": offset,
    }


@router.delete("/{update_id}")
async def cancel_price_update(
    update_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Sadece pending durumdaki kaydı iptal eder."""
    await ensure_table_exists()
    user_id = current_user["user_id"]
    tenant_id = current_user.get("tenant_id") or ""
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """UPDATE pending_price_updates SET status='cancelled', applied_at=%s
                   WHERE id=%s AND tenant_id=%s AND status='pending'""",
                (datetime.utcnow(), update_id, tenant_id),
            )
            affected = cur.rowcount
    if not affected:
        raise HTTPException(status_code=404, detail="Bekleyen güncelleme bulunamadı veya zaten uygulanmış")
    return {"success": True, "id": update_id}


@router.delete("/batch/{batch_id}")
async def cancel_batch(
    batch_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Aynı batch içindeki tüm pending kayıtları iptal eder."""
    await ensure_table_exists()
    tenant_id = current_user.get("tenant_id") or ""
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """UPDATE pending_price_updates SET status='cancelled', applied_at=%s
                   WHERE batch_id=%s AND tenant_id=%s AND status='pending'""",
                (datetime.utcnow(), batch_id, tenant_id),
            )
            affected = cur.rowcount
    return {"success": True, "batch_id": batch_id, "cancelled_count": affected}


# =============================================================================
# ENDPOINTS — Windows POS Client (polling)
# =============================================================================

@router.post("/poll")
async def poll_pending(
    limit: int = Query(default=200, le=1000),
    current_user: dict = Depends(get_current_user),
):
    """Windows POS client tarafından çağrılır. Bu tenant için bekleyen tüm
    güncellemeleri eski tarihten yeniye doğru döndürür."""
    await ensure_table_exists()
    tenant_id = current_user.get("tenant_id") or ""
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT id, product_id, product_barcode, product_name,
                          price_name_id, price_name,
                          old_price, new_price, batch_id, created_at
                   FROM pending_price_updates
                   WHERE tenant_id=%s AND status='pending'
                   ORDER BY created_at ASC LIMIT %s""",
                (tenant_id, limit),
            )
            cols = ["id", "product_id", "product_barcode", "product_name",
                    "price_name_id", "price_name",
                    "old_price", "new_price", "batch_id", "created_at"]
            rows = await cur.fetchall()
            items = [_row_to_dict(r, cols) for r in rows]
    return {"success": True, "tenant_id": tenant_id, "count": len(items), "items": items}


@router.post("/{update_id}/mark-applied")
async def mark_applied(
    update_id: int,
    data: Optional[MarkAppliedRequest] = None,
    current_user: dict = Depends(get_current_user),
):
    """Windows client uyguladıktan sonra başarılı/başarısız işaretler."""
    await ensure_table_exists()
    tenant_id = current_user.get("tenant_id") or ""
    err = (data.error_message if data else None)
    new_status = "failed" if err else "applied"
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """UPDATE pending_price_updates SET status=%s, applied_at=%s, error_message=%s
                   WHERE id=%s AND tenant_id=%s AND status='pending'""",
                (new_status, datetime.utcnow(), err, update_id, tenant_id),
            )
            affected = cur.rowcount
    if not affected:
        raise HTTPException(status_code=404, detail="Bekleyen güncelleme bulunamadı")
    return {"success": True, "id": update_id, "status": new_status}


@router.post("/mark-applied-bulk")
async def mark_applied_bulk(
    data: MarkBulkAppliedRequest,
    current_user: dict = Depends(get_current_user),
):
    """Toplu olarak birden fazla ID'yi applied/failed olarak işaretler."""
    await ensure_table_exists()
    tenant_id = current_user.get("tenant_id") or ""
    new_status = "failed" if data.error_message else "applied"
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ",".join(["%s"] * len(data.ids))
            params = [new_status, datetime.utcnow(), data.error_message] + list(data.ids) + [tenant_id]
            await cur.execute(
                f"""UPDATE pending_price_updates SET status=%s, applied_at=%s, error_message=%s
                    WHERE id IN ({placeholders}) AND tenant_id=%s AND status='pending'""",
                params,
            )
            affected = cur.rowcount
    return {"success": True, "applied_count": affected, "status": new_status}
