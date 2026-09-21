"""
routes/rapor_mail.py — v23 Haftalık Rapor Maili ayarları

  GET  /api/rapor-mail/ayar          → {aktif, email, sonraki, son_gonderim}
  PUT  /api/rapor-mail/ayar {aktif}  → kaydet
  GET  /api/rapor-mail/onizleme      → geçen haftanın rapor verisi (JSON, e-posta gönderilmez)
  POST /api/rapor-mail/gonder-simdi  → raporu hemen kullanıcının e-postasına gönder (test)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routes.auth import get_current_user
from services import haftalik_rapor as hr

router = APIRouter(prefix="/rapor-mail", tags=["rapor-mail"])


@router.get("/ayar")
async def ayar_getir(current_user: dict = Depends(get_current_user)):
    return {
        "ok": True,
        "data": {
            "aktif": await hr.ayar_getir(current_user["user_id"]),
            "email": current_user.get("email") or "",
            "gonderim_saati": f"Pazartesi {hr.RAPOR_SAATI_ISTANBUL:02d}:00",
            "sonraki": hr.sonraki_gonderim_metni(),
            "son_gonderim": await hr.son_gonderim(current_user["user_id"]),
        },
    }


class AyarBody(BaseModel):
    aktif: bool


@router.put("/ayar")
async def ayar_kaydet(body: AyarBody, current_user: dict = Depends(get_current_user)):
    await hr.ayar_kaydet(current_user["user_id"], body.aktif)
    return {"ok": True, "aktif": body.aktif}


@router.get("/onizleme")
async def onizleme(current_user: dict = Depends(get_current_user)):
    return {"ok": True, "data": await hr.rapor_verisi(current_user)}


@router.post("/gonder-simdi")
async def gonder_simdi(current_user: dict = Depends(get_current_user)):
    if not (current_user.get("email") or "").strip():
        raise HTTPException(status_code=400, detail="Hesabınızda kayıtlı e-posta adresi yok")
    r = await hr.kullaniciya_gonder(current_user, hafta_eki="-manuel", zorla=True)
    if r["durum"] != "gonderildi":
        # 502 KULLANMA — Cloudflare 502'yi kendi HTML sayfasıyla değiştiriyor (detail kayboluyor)
        raise HTTPException(status_code=500, detail="E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.")
    return {"ok": True, **r}
