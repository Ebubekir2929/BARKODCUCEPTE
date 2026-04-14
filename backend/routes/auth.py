from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
from models.user import (
    UserRegister, UserLogin, UserInDB, UserResponse,
    TenantSource, TenantAdd, TenantUpdate, TokenResponse, LicenseStatus
)
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
SECRET_KEY = os.environ.get("JWT_SECRET", "barkodcu-cepte-secret-key-2025")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

security = HTTPBearer()

# Will be set from server.py
db = None

def set_db(database):
    global db
    db = database


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


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = verify_token(credentials.credentials)
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Geçersiz token")
    
    user_doc = await db.users.find_one({"id": user_id})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
    
    return UserInDB(**user_doc)


def user_to_response(user: UserInDB) -> UserResponse:
    return UserResponse(
        id=user.id,
        full_name=user.full_name,
        username=user.username,
        email=user.email,
        tax_number=user.tax_number,
        business_type=user.business_type,
        tenants=user.tenants,
        role=user.role,
        license_expiry=user.license_expiry,
        created_at=user.created_at,
    )


def get_license_status(user: UserInDB) -> LicenseStatus:
    if user.license_expiry is None:
        # No license set - give 30 day trial from creation
        trial_expiry = user.created_at + timedelta(days=30)
        now = datetime.utcnow()
        days_remaining = (trial_expiry - now).days
        return LicenseStatus(
            is_valid=days_remaining > 0,
            days_remaining=max(0, days_remaining),
            expiry_date=trial_expiry,
            warning=0 < days_remaining <= 7,
        )
    
    now = datetime.utcnow()
    days_remaining = (user.license_expiry - now).days
    return LicenseStatus(
        is_valid=days_remaining > 0,
        days_remaining=max(0, days_remaining),
        expiry_date=user.license_expiry,
        warning=0 < days_remaining <= 7,
    )


@router.post("/register", response_model=TokenResponse)
async def register(data: UserRegister):
    # Check terms
    if not data.terms_accepted:
        raise HTTPException(status_code=400, detail="Şartlar ve koşulları kabul etmelisiniz")
    
    # Check if email already exists
    existing_email = await db.users.find_one({"email": data.email})
    if existing_email:
        raise HTTPException(status_code=400, detail="Bu e-posta adresi zaten kayıtlı")
    
    # Check if username already exists
    existing_username = await db.users.find_one({"username": data.username})
    if existing_username:
        raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten kullanılıyor")
    
    # Validate tax number (10 or 11 digits)
    if not data.tax_number.isdigit() or len(data.tax_number) not in [10, 11]:
        raise HTTPException(status_code=400, detail="Vergi numarası 10 veya 11 haneli olmalıdır")
    
    # Create user
    password_hash = pwd_context.hash(data.password)
    
    first_tenant = TenantSource(
        tenant_id=data.tenant_id,
        name=data.tenant_name if data.tenant_name else "Data 1",
    )
    
    user = UserInDB(
        full_name=data.full_name,
        username=data.username,
        email=data.email,
        password_hash=password_hash,
        tax_number=data.tax_number,
        business_type=data.business_type,
        tenants=[first_tenant],
        terms_accepted=True,
    )
    
    await db.users.insert_one(user.dict())
    logger.info(f"New user registered: {user.email} ({user.username})")
    
    # Create token
    token = create_access_token({"user_id": user.id, "email": user.email})
    
    return TokenResponse(
        access_token=token,
        user=user_to_response(user),
        license=get_license_status(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin):
    # Find user by email or username
    user_doc = await db.users.find_one({
        "$or": [
            {"email": data.email},
            {"username": data.email}  # Allow login with username too
        ]
    })
    
    if not user_doc:
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    
    user = UserInDB(**user_doc)
    
    # Verify password
    if not pwd_context.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    
    # Check license
    license_status = get_license_status(user)
    if not license_status.is_valid:
        raise HTTPException(status_code=403, detail="Lisans süreniz dolmuştur. Lütfen lisansınızı yenileyin.")
    
    # Create token
    token = create_access_token({"user_id": user.id, "email": user.email})
    logger.info(f"User logged in: {user.email}")
    
    return TokenResponse(
        access_token=token,
        user=user_to_response(user),
        license=license_status,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: UserInDB = Depends(get_current_user)):
    return user_to_response(current_user)


# === Tenant Management ===

@router.post("/tenants", response_model=UserResponse)
async def add_tenant(data: TenantAdd, current_user: UserInDB = Depends(get_current_user)):
    # Check max 10 tenants
    if len(current_user.tenants) >= 10:
        raise HTTPException(status_code=400, detail="En fazla 10 veri kaynağı ekleyebilirsiniz")
    
    # Check if tenant_id already exists for this user
    for t in current_user.tenants:
        if t.tenant_id == data.tenant_id:
            raise HTTPException(status_code=400, detail="Bu Tenant ID zaten ekli")
    
    new_tenant = TenantSource(
        tenant_id=data.tenant_id,
        name=data.name,
    )
    
    await db.users.update_one(
        {"id": current_user.id},
        {
            "$push": {"tenants": new_tenant.dict()},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    current_user.tenants.append(new_tenant)
    logger.info(f"Tenant added for user {current_user.email}: {data.tenant_id} ({data.name})")
    return user_to_response(current_user)


@router.put("/tenants/{tenant_id}", response_model=UserResponse)
async def update_tenant_name(tenant_id: str, data: TenantUpdate, current_user: UserInDB = Depends(get_current_user)):
    # Find the tenant
    found = False
    for i, t in enumerate(current_user.tenants):
        if t.tenant_id == tenant_id:
            found = True
            break
    
    if not found:
        raise HTTPException(status_code=404, detail="Tenant bulunamadı")
    
    await db.users.update_one(
        {"id": current_user.id, "tenants.tenant_id": tenant_id},
        {
            "$set": {
                "tenants.$.name": data.name,
                "updated_at": datetime.utcnow()
            }
        }
    )
    
    current_user.tenants[i].name = data.name
    logger.info(f"Tenant renamed for user {current_user.email}: {tenant_id} -> {data.name}")
    return user_to_response(current_user)


@router.delete("/tenants/{tenant_id}", response_model=UserResponse)
async def remove_tenant(tenant_id: str, current_user: UserInDB = Depends(get_current_user)):
    # Must have at least 1 tenant
    if len(current_user.tenants) <= 1:
        raise HTTPException(status_code=400, detail="En az 1 veri kaynağı olmalıdır")
    
    # Check if tenant exists
    found = False
    for t in current_user.tenants:
        if t.tenant_id == tenant_id:
            found = True
            break
    
    if not found:
        raise HTTPException(status_code=404, detail="Tenant bulunamadı")
    
    await db.users.update_one(
        {"id": current_user.id},
        {
            "$pull": {"tenants": {"tenant_id": tenant_id}},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    current_user.tenants = [t for t in current_user.tenants if t.tenant_id != tenant_id]
    logger.info(f"Tenant removed for user {current_user.email}: {tenant_id}")
    return user_to_response(current_user)
