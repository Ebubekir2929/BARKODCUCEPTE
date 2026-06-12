from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from datetime import datetime, timedelta, date
from pydantic import BaseModel
from models.user import (
    UserRegister, UserLogin, UserResponse,
    TenantSource, TenantAdd, TenantUpdate, TokenResponse, LicenseStatus,
    ForgotPasswordRequest, ChangePasswordRequest,
)
from services import get_patron_pool, get_data_pool
import os
import hashlib
import json
import logging
import secrets
import string
from services.mailer import send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# JWT settings
SECRET_KEY = os.environ.get("JWT_SECRET", "barkodcu-cepte-secret-key-2025")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 30  # 30 gün — mobile uygulamalar için endüstri standardı (önceden 72 saat = 3 gündü)

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
                "SELECT user_id, username, email, full_name, VergiNo, tenant_id, has_tables, BaslangicTarih, BitisTarih, active, COALESCE(must_change_password, 0) FROM users WHERE user_id = %s",
                (user_id,)
            )
            row = await cur.fetchone()
    
    if not row:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
    
    return {
        "user_id": row[0], "username": row[1], "email": row[2], "full_name": row[3],
        "tax_number": row[4] or "", "tenant_id": row[5], "has_tables": row[6],
        "start_date": row[7], "end_date": row[8], "active": row[9],
        "must_change_password": bool(row[10]),
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
        must_change_password=bool(user_dict.get("must_change_password", False)),
    )


@router.post("/register", response_model=TokenResponse)
async def register(data: UserRegister):
    if not data.terms_accepted:
        raise HTTPException(status_code=400, detail="Şartlar ve koşulları kabul etmelisiniz")

    # 2026-05-20 — Apple App Store rejection 5.1.1(v): Vergi Numarası is now
    # OPTIONAL. Only validate format IF user provided a value.
    tax_number_clean = (data.tax_number or "").strip()
    if tax_number_clean:
        if not tax_number_clean.isdigit() or len(tax_number_clean) not in [10, 11]:
            raise HTTPException(status_code=400, detail="Vergi numarası geçersiz (boş bırakabilir veya 10-11 haneli girebilirsiniz)")
    
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
                today, end_date, tax_number_clean, 'on', 1,
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
        "full_name": data.full_name, "tax_number": tax_number_clean,
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
    identifier = (data.email or "").strip()
    if not identifier or not data.password:
        raise HTTPException(status_code=401, detail="E-posta/kullanıcı adı ve şifre gerekli")

    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Fetch ALL candidates — username may be duplicated in this legacy DB
            await cur.execute("""
                SELECT user_id, username, email, full_name, password, VergiNo, tenant_id, has_tables,
                       BaslangicTarih, BitisTarih, active, COALESCE(must_change_password, 0)
                FROM users WHERE email = %s OR username = %s
                ORDER BY (email = %s) DESC, active DESC, user_id DESC
            """, (identifier, identifier, identifier))
            rows = await cur.fetchall()

    if not rows:
        raise HTTPException(status_code=401, detail="Kullanıcı adı/e-posta veya şifre hatalı")

    provided_hash = sha1_hash(data.password)

    # Iterate through all candidates and find one whose password matches
    matched = None
    for row in rows:
        stored_hash = row[4]
        if stored_hash and provided_hash == stored_hash.lower():
            matched = row
            break

    if not matched:
        raise HTTPException(status_code=401, detail="Kullanıcı adı/e-posta veya şifre hatalı")

    user_id, username, email, full_name, _stored_hash, vergi_no, tenant_id, has_tables, start_date, end_date, active, must_change_password = matched

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
        "must_change_password": bool(must_change_password),
    }

    token = create_access_token({"user_id": user_id, "email": email})
    user_resp = await build_user_response(user_dict)

    logger.info(f"User logged in via MySQL: {email} (identifier={identifier})")

    # Re-activate any push tokens this user had on previous sessions so the
    # background notification watcher can deliver push notifications again.
    try:
        pool = await get_patron_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE user_push_tokens SET active=1, updated_at=UTC_TIMESTAMP() WHERE user_id=%s",
                    (user_id,),
                )
                await conn.commit()
    except Exception as e:
        logger.warning(f"Failed to reactivate push tokens for user {user_id}: {e}")

    return TokenResponse(access_token=token, user=user_resp, license=license_status)


    return TokenResponse(access_token=token, user=user_resp, license=license_status)


@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest):
    identifier = (data.email or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="E-posta veya kullanıcı adı girin")

    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT user_id, username, email, full_name FROM users WHERE (email = %s OR username = %s) AND active = 1 LIMIT 1",
                (identifier, identifier),
            )
            row = await cur.fetchone()

    if not row or not row[2]:
        logger.info(f"Forgot password requested for unknown/inactive: {identifier}")
        return {"ok": True, "message": "Eğer kayıtlı bir hesap varsa, şifre sıfırlama e-postası gönderildi."}

    user_id, username, email, full_name = row

    alphabet = string.ascii_letters + string.digits
    new_password = ''.join(secrets.choice(alphabet) for _ in range(10))
    new_hash = sha1_hash(new_password)

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE users SET password = %s, must_change_password = 1 WHERE user_id = %s", (new_hash, user_id))
            await conn.commit()

    subject = "Barkodcu Cepte - Şifre Sıfırlama"
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.08)">
    <div style="background:#0EA5E9;padding:20px;text-align:center;color:#fff">
      <h1 style="margin:0;font-size:22px">Barkodcu Cepte</h1>
    </div>
    <div style="padding:24px;color:#333;line-height:1.55">
      <p>Merhaba <b>{full_name or username or 'Kullanıcı'}</b>,</p>
      <p>Şifre sıfırlama talebiniz alınmıştır. Yeni geçici şifreniz aşağıdadır:</p>
      <div style="background:#F1F5F9;border:2px dashed #0EA5E9;padding:14px;text-align:center;border-radius:8px;font-size:22px;font-weight:700;letter-spacing:2px;color:#0369A1;margin:16px 0">{new_password}</div>
      <p>Lütfen uygulamaya giriş yaptıktan sonra bu şifreyi <b>hemen değiştirin</b>.</p>
      <p style="margin-top:20px"><b>Hesap:</b> {email}<br/><b>Kullanıcı Adı:</b> {username or '-'}</p>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0"/>
      <p style="font-size:12px;color:#888">Bu talebi siz yapmadıysanız, lütfen hemen bizimle iletişime geçin.</p>
    </div>
  </div>
</body></html>"""
    text = f"Merhaba {full_name or username},\n\nYeni şifreniz: {new_password}\n\nGiriş yaptıktan sonra lütfen değiştirin.\n\nBarkodcu Cepte"

    sent = send_email(email, subject, html, text)
    if not sent:
        logger.warning(f"Password updated but email send failed for user {user_id}")
        raise HTTPException(status_code=500, detail="Şifre sıfırlandı ancak e-posta gönderilemedi. Lütfen yöneticinizle iletişime geçin.")

    logger.info(f"Password reset email sent for user_id={user_id}, email={email}")
    return {"ok": True, "message": "Şifre sıfırlama e-postası gönderildi. Gelen kutunuzu kontrol edin."}


@router.post("/change-password")
async def change_password(data: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    old_pw = (data.old_password or "")
    new_pw = (data.new_password or "")
    if not old_pw or not new_pw:
        raise HTTPException(status_code=400, detail="Mevcut ve yeni şifre gerekli")
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="Yeni şifre en az 6 karakter olmalı")
    if old_pw == new_pw:
        raise HTTPException(status_code=400, detail="Yeni şifre mevcut şifre ile aynı olamaz")

    user_id = current_user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Oturum geçersiz")

    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT password FROM users WHERE user_id = %s", (user_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
            stored_hash = row[0]
            if sha1_hash(old_pw) != (stored_hash or "").lower():
                raise HTTPException(status_code=401, detail="Mevcut şifre hatalı")
            new_hash = sha1_hash(new_pw)
            await cur.execute("UPDATE users SET password = %s, must_change_password = 0 WHERE user_id = %s", (new_hash, user_id))
            await conn.commit()

    logger.info(f"Password changed for user_id={user_id}")
    return {"ok": True, "message": "Şifre başarıyla değiştirildi"}


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

    # 🧹 Cleanup related collections so the watcher doesn't keep referencing
    # this stale tenant_id (would cause empty POS queries forever).
    try:
        await mongo_db.tenant_names.delete_many({
            "user_id": current_user["user_id"], "tenant_id": tenant_id
        })
    except Exception as e:
        logger.warning(f"tenant_names cleanup failed for {tenant_id}: {e}")

    # Clean per-tenant notification dedup state in patron MariaDB so future
    # re-adds get a clean slate.
    try:
        from services import get_patron_pool
        pool = await get_patron_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM notification_events_seen WHERE tenant_id = %s",
                    (tenant_id,),
                )
                await conn.commit()
    except Exception as e:
        logger.warning(f"notification_events_seen cleanup failed for {tenant_id}: {e}")

    logger.info(f"Tenant removed for user {current_user['email']}: {tenant_id} (with cleanup)")
    return await build_user_response(current_user)


# 2026-05-20 — Apple App Store rejection 5.1.1(v) — in-app account deletion
# is mandatory for apps that support account creation.
class DeleteAccountRequest(BaseModel):
    password: str
    confirm: str = ""  # user types "SİL" to confirm


@router.delete("/account")
@router.post("/account/delete")
async def delete_account(
    data: DeleteAccountRequest,
    current_user: dict = Depends(get_current_user),
):
    """Permanently delete the authenticated user's account and all related data.

    Steps:
      1. Re-verify password (extra safety).
      2. Delete MongoDB tenant/name records owned by this user.
      3. Delete patron MariaDB rows (users + push tokens + notification settings).
      4. Done — client must clear its local token after a 200 response.
    """
    if data.confirm and data.confirm.strip().upper() not in ("SİL", "SIL", "DELETE"):
        raise HTTPException(status_code=400, detail="Onay metni hatalı. 'SİL' yazmalısınız.")

    if not data.password:
        raise HTTPException(status_code=400, detail="Hesabınızı silmek için şifrenizi girin")

    user_id = current_user["user_id"]
    email = current_user["email"]

    pool = await get_patron_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 1) Verify password
            await cur.execute("SELECT password FROM users WHERE user_id = %s", (user_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
            stored_hash = row[0] or ""
            if stored_hash != sha1_hash(data.password):
                raise HTTPException(status_code=401, detail="Şifre hatalı")

    # 2) Mongo cleanup
    if mongo_db is not None:
        try:
            await mongo_db.tenant_names.delete_many({"user_id": user_id})
        except Exception as e:
            logger.warning(f"delete_account: mongo tenant_names cleanup failed for {user_id}: {e}")
        try:
            await mongo_db.user_tenants.delete_many({"user_id": user_id})
        except Exception as e:
            logger.warning(f"delete_account: mongo user_tenants cleanup failed for {user_id}: {e}")

    # 3) Patron MariaDB cleanup — push tokens, notification settings, user row.
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for tbl, where in [
                ("push_tokens", "user_id = %s"),
                ("notification_settings", "user_id = %s"),
                ("notification_events_seen", "user_id = %s"),
            ]:
                try:
                    await cur.execute(f"DELETE FROM {tbl} WHERE {where}", (user_id,))
                except Exception as e:
                    # table may not exist on some installations; log and continue
                    logger.warning(f"delete_account: cleanup {tbl} skipped: {e}")
            # Finally, delete the user row itself.
            await cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
            await conn.commit()

    logger.info(f"Account deleted: user_id={user_id} email={email}")
    return {"success": True, "message": "Hesabınız ve tüm verileriniz silindi"}
