from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from datetime import datetime, timedelta, date
from models.user import (
    UserRegister, UserLogin, UserResponse,
    TenantSource, TenantAdd, TenantUpdate, TokenResponse, LicenseStatus
)
from services import get_patron_pool, get_data_pool
import os
import hashlib
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# JWT settings
SECRET_KEY = os.environ.get("JWT_SECRET", "barkodcu-cepte-secret-key-2025")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

security = HTTPBearer()

# MongoDB reference (for tenant management)
mongo_db = None

def set_db(database):
    global mongo_db
    mongo_db = database


def sha1_hash(password: str) -> str:
    return hashlib.sha1(password.encode('utf-8')).hexdigest()


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Geçersiz veya süresi dolmuş token")


def get_license_status(start_date, end_date) -> LicenseStatus:
    if end_date is None:
        return LicenseStatus(is_valid=False, days_remaining=0, expiry_date=None, warning=False)
    
    today = date.today()
    if isinstance(end_date, datetime):
        end_date = end_date.date()
    if isinstance(start_date, datetime):
        start_date = start_date.date()
    
    days_remaining = (end_date - today).days
    expiry_dt = datetime.combine(end_date, datetime.min.time())
    
    return LicenseStatus(
        is_valid=days_remaining > 0,
        days_remaining=max(0, days_remaining),
        expiry_date=expiry_dt,
        warning=0 < days_remaining <= 7,
    )


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = verify_token(credentials.credentials)
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Geçersiz token")
    
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT user_id, username, email, full_name, VergiNo, tenant_id, has_tables, BaslangicTarih, BitisTarih, active FROM users WHERE user_id = %s",
                (user_id,)
            )
            row = await cur.fetchone()
    
    if not row:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
    
    return {
        "user_id": row[0], "username": row[1], "email": row[2], "full_name": row[3],
        "tax_number": row[4] or "", "tenant_id": row[5], "has_tables": row[6],
        "start_date": row[7], "end_date": row[8], "active": row[9],
    }


async def build_user_response(user_dict: dict) -> UserResponse:
    """Build UserResponse with tenants from both MySQL and MongoDB"""
    tenants = []
    
    # Primary tenant from MySQL
    if user_dict.get("tenant_id"):
        # Get tenant name from MongoDB if exists
        tenant_name = None
        if mongo_db is not None:
            tenant_doc = await mongo_db.tenant_names.find_one({
                "user_id": user_dict["user_id"],
                "tenant_id": user_dict["tenant_id"]
            })
            if tenant_doc:
                tenant_name = tenant_doc.get("name")
        
        tenants.append(TenantSource(
            tenant_id=user_dict["tenant_id"],
            name=tenant_name or "Ana Veri",
        ))
    
    # Additional tenants from MongoDB
    if mongo_db is not None:
        extra_tenants = await mongo_db.user_tenants.find({
            "user_id": user_dict["user_id"]
        }).to_list(10)
        for et in extra_tenants:
            tenants.append(TenantSource(
                tenant_id=et["tenant_id"],
                name=et.get("name", et["tenant_id"]),
            ))
    
    business_type = "restoran" if user_dict.get("has_tables") == 1 else "normal"
    
    return UserResponse(
        id=str(user_dict["user_id"]),
        full_name=user_dict.get("full_name", ""),
        username=user_dict.get("username", ""),
        email=user_dict.get("email", ""),
        tax_number=user_dict.get("tax_number", ""),
        business_type=business_type,
        tenants=tenants,
        role="user",
        license_expiry=datetime.combine(user_dict["end_date"], datetime.min.time()) if user_dict.get("end_date") else None,
        created_at=datetime.combine(user_dict.get("start_date", date.today()), datetime.min.time()),
    )


@router.post("/register", response_model=TokenResponse)
async def register(data: UserRegister):
    if not data.terms_accepted:
        raise HTTPException(status_code=400, detail="Şartlar ve koşulları kabul etmelisiniz")
    
    # Validate tax number
    if not data.tax_number.isdigit() or len(data.tax_number) not in [10, 11]:
        raise HTTPException(status_code=400, detail="Vergi numarası 10 veya 11 haneli olmalıdır")
    
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Check email
            await cur.execute("SELECT user_id FROM users WHERE email = %s", (data.email,))
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail="Bu e-posta adresi zaten kayıtlı")
            
            # Check username
            await cur.execute("SELECT user_id FROM users WHERE username = %s", (data.username,))
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten kullanılıyor")
            
            # Check tenant_id uniqueness
            if data.tenant_id:
                await cur.execute("SELECT user_id FROM users WHERE tenant_id = %s", (data.tenant_id,))
                if await cur.fetchone():
                    raise HTTPException(status_code=400, detail="Bu Tenant ID zaten kullanımda")
            
            # Hash password with SHA1
            password_hash = sha1_hash(data.password)
            has_tables = 1 if data.business_type == "restoran" else 0
            today = date.today()
            end_date = today + timedelta(days=365)  # 1 year default
            
            await cur.execute("""
                INSERT INTO users (username, email, full_name, password, Ip, Port, VtAdi, VtKullaniciAd, VtSifre,
                    BaslangicTarih, BitisTarih, VergiNo, agreement, active, tenant_id, has_tables)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                data.username, data.email, data.full_name, password_hash,
                '', '', '', '', '',  # Ip, Port, VtAdi, VtKullaniciAd, VtSifre - set by admin later
                today, end_date, data.tax_number, 'on', 1,
                data.tenant_id if data.tenant_id else None, has_tables,
            ))
            
            # Get inserted user_id
            await cur.execute("SELECT LAST_INSERT_ID()")
            user_id = (await cur.fetchone())[0]
    
    # Save tenant name in MongoDB
    if mongo_db is not None and data.tenant_id and data.tenant_name:
        await mongo_db.tenant_names.update_one(
            {"user_id": user_id, "tenant_id": data.tenant_id},
            {"$set": {"name": data.tenant_name, "user_id": user_id, "tenant_id": data.tenant_id}},
            upsert=True,
        )
    
    user_dict = {
        "user_id": user_id, "username": data.username, "email": data.email,
        "full_name": data.full_name, "tax_number": data.tax_number,
        "tenant_id": data.tenant_id, "has_tables": has_tables,
        "start_date": today, "end_date": end_date, "active": 1,
    }
    
    token = create_access_token({"user_id": user_id, "email": data.email})
    user_resp = await build_user_response(user_dict)
    license_status = get_license_status(today, end_date)
    
    logger.info(f"New user registered in MySQL: {data.email} ({data.username})")
    
    return TokenResponse(access_token=token, user=user_resp, license=license_status)


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin):
    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT user_id, username, email, full_name, password, VergiNo, tenant_id, has_tables, 
                       BaslangicTarih, BitisTarih, active
                FROM users WHERE email = %s OR username = %s
            """, (data.email, data.email))
            row = await cur.fetchone()
    
    if not row:
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    
    user_id, username, email, full_name, stored_hash, vergi_no, tenant_id, has_tables, start_date, end_date, active = row
    
    # Verify password (SHA1)
    if sha1_hash(data.password) != stored_hash.lower():
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    
    # Check active
    if not active:
        raise HTTPException(status_code=403, detail="Hesabınız aktif değil. Lütfen yöneticinize başvurun.")
    
    # Check license
    license_status = get_license_status(start_date, end_date)
    if not license_status.is_valid:
        raise HTTPException(status_code=403, detail="Lisans süreniz dolmuştur. Lütfen lisansınızı yenileyin.")
    
    user_dict = {
        "user_id": user_id, "username": username, "email": email,
        "full_name": full_name, "tax_number": vergi_no or "",
        "tenant_id": tenant_id, "has_tables": has_tables,
        "start_date": start_date, "end_date": end_date, "active": active,
    }
    
    token = create_access_token({"user_id": user_id, "email": email})
    user_resp = await build_user_response(user_dict)
    
    logger.info(f"User logged in via MySQL: {email}")
    
    return TokenResponse(access_token=token, user=user_resp, license=license_status)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return await build_user_response(current_user)


# === Tenant Management (MongoDB for additional tenants) ===

@router.post("/tenants", response_model=UserResponse)
async def add_tenant(data: TenantAdd, current_user: dict = Depends(get_current_user)):
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="Tenant yönetimi şu anda kullanılamıyor")
    
    # Check max 10 additional tenants
    existing = await mongo_db.user_tenants.count_documents({"user_id": current_user["user_id"]})
    if existing >= 9:
        raise HTTPException(status_code=400, detail="En fazla 10 veri kaynağı ekleyebilirsiniz")
    
    # Check if already exists
    exists = await mongo_db.user_tenants.find_one({
        "user_id": current_user["user_id"], "tenant_id": data.tenant_id
    })
    if exists or data.tenant_id == current_user.get("tenant_id"):
        raise HTTPException(status_code=400, detail="Bu Tenant ID zaten ekli")
    
    await mongo_db.user_tenants.insert_one({
        "user_id": current_user["user_id"],
        "tenant_id": data.tenant_id,
        "name": data.name,
        "added_at": datetime.utcnow(),
    })
    
    logger.info(f"Tenant added for user {current_user['email']}: {data.tenant_id} ({data.name})")
    return await build_user_response(current_user)


@router.put("/tenants/{tenant_id}", response_model=UserResponse)
async def update_tenant_name(tenant_id: str, data: TenantUpdate, current_user: dict = Depends(get_current_user)):
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="Tenant yönetimi şu anda kullanılamıyor")
    
    # Check if it's the primary tenant
    if tenant_id == current_user.get("tenant_id"):
        await mongo_db.tenant_names.update_one(
            {"user_id": current_user["user_id"], "tenant_id": tenant_id},
            {"$set": {"name": data.name, "user_id": current_user["user_id"], "tenant_id": tenant_id}},
            upsert=True,
        )
    else:
        result = await mongo_db.user_tenants.update_one(
            {"user_id": current_user["user_id"], "tenant_id": tenant_id},
            {"$set": {"name": data.name}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Tenant bulunamadı")
    
    logger.info(f"Tenant renamed for user {current_user['email']}: {tenant_id} -> {data.name}")
    return await build_user_response(current_user)


@router.delete("/tenants/{tenant_id}", response_model=UserResponse)
async def remove_tenant(tenant_id: str, current_user: dict = Depends(get_current_user)):
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="Tenant yönetimi şu anda kullanılamıyor")
    
    # Can't delete primary tenant
    if tenant_id == current_user.get("tenant_id"):
        raise HTTPException(status_code=400, detail="Ana veri kaynağı silinemez")
    
    result = await mongo_db.user_tenants.delete_one({
        "user_id": current_user["user_id"], "tenant_id": tenant_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tenant bulunamadı")
    
    logger.info(f"Tenant removed for user {current_user['email']}: {tenant_id}")
    return await build_user_response(current_user)
