from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from datetime import datetime
import uuid


class TenantSource(BaseModel):
    tenant_id: str
    name: str  # User-given name like "Merkez Şube"
    added_at: datetime = Field(default_factory=datetime.utcnow)


class UserRegister(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)  # Firma Yetkilisi
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)
    tax_number: str = Field(..., min_length=10, max_length=11)  # Vergi Numarası
    tenant_id: str = Field(..., min_length=1)  # Primary Tenant ID
    tenant_name: str = Field(default="Data 1")  # Name for the first tenant
    business_type: str = Field(..., pattern="^(normal|restoran)$")  # İşletme Tipi
    terms_accepted: bool = Field(default=False)


class UserLogin(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class UserInDB(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    full_name: str
    username: str
    email: str
    password_hash: str
    tax_number: str
    business_type: str  # 'normal' or 'restoran'
    tenants: List[TenantSource] = []
    terms_accepted: bool = True
    role: str = "user"
    license_expiry: Optional[datetime] = None  # None = no license set yet
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class UserResponse(BaseModel):
    id: str
    full_name: str
    username: str
    email: str
    tax_number: str
    business_type: str
    tenants: List[TenantSource]
    role: str
    license_expiry: Optional[datetime] = None
    created_at: datetime


class LicenseStatus(BaseModel):
    is_valid: bool
    days_remaining: Optional[int] = None
    expiry_date: Optional[datetime] = None
    warning: bool = False  # True if less than 7 days remaining


class TenantAdd(BaseModel):
    tenant_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=100)


class TenantUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    license: LicenseStatus
