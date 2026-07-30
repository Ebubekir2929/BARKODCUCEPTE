"""
routes/islem.py — Mobil İşlem Kuyruğu (Faz 1: Finans İşlemleri) — 2026-07

Akış:
  Uygulama → POST /api/islem/create → MySQL `mobil_islem_kuyrugu` (durum=bekliyor)
  POS istemcisi (Windows) → MySQL'den bekliyor kayıtları okur →
    EXEC SEQUENS_VER @TABLO=FINANS / FINANS_DETAY → ERP12'ye INSERT →
    durum=aktarildi + erp_id yazar (hata olursa durum=hata + hata_mesaji).

EXTERNAL_ID alanına kuyruk kaydının `id`si yazılmalı → mükerrer aktarım önlenir.

FINANS_ISLEM_TURU yön tablosu (kullanıcının ERP12 dökümünden):
  ilk harf = KART_BORCLU tipi, ikinci harf = KART_ALACAKLI tipi
  (K=Kasa, B=Banka, C=Cari, Ç=Çek, S=Senet, KK=Kredi Kartı, M=Masraf)
  Örn. 1 Nakit tahsilat: K C → borçlu=KASA, alacaklı=CARİ
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
import logging

from routes.auth import get_current_user
from services.dataset_cache import get_data_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/islem", tags=["islem"])

# Uygulamada desteklenen işlem türleri (Faz 1)
# borclu/alacakli: 'kasa' → kasa/banka kartı seçiminden, 'cari' → cari seçiminden
ISLEM_TURLERI = {
    1:  {"ad": "Nakit Tahsilat",        "borclu": "kasa", "alacakli": "cari", "cek_senet": False},
    15: {"ad": "Pos Kartı ile Tahsilat", "borclu": "kasa", "alacakli": "cari", "cek_senet": False},
    2:  {"ad": "Nakit Ödeme",           "borclu": "cari", "alacakli": "kasa", "cek_senet": False},
    8:  {"ad": "Bankadan Havale Yollama", "borclu": "cari", "alacakli": "kasa", "cek_senet": False},
    7:  {"ad": "Bankadan Havale Alma",  "borclu": "kasa", "alacakli": "cari", "cek_senet": False},
    21: {"ad": "Çek Girişi (Alınan)",   "borclu": "kasa", "alacakli": "cari", "cek_senet": True},
    17: {"ad": "Çek Çıkışı (Verilen)",  "borclu": "cari", "alacakli": "kasa", "cek_senet": True},
    35: {"ad": "Senet Girişi (Alınan)", "borclu": "kasa", "alacakli": "cari", "cek_senet": True},
    31: {"ad": "Senet Çıkışı (Verilen)", "borclu": "cari", "alacakli": "kasa", "cek_senet": True},
}

_tables_ready = False


async def _ensure_tables():
    global _tables_ready
    if _tables_ready:
        return
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS mobil_islem_kuyrugu (
                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                  tenant_id VARCHAR(64) NOT NULL,
                  islem_grubu VARCHAR(20) NOT NULL DEFAULT 'finans',
                  islem_turu INT NOT NULL,
                  islem_turu_ad VARCHAR(100) DEFAULT NULL,
                  kart_borclu BIGINT DEFAULT NULL,
                  kart_borclu_ad VARCHAR(255) DEFAULT NULL,
                  kart_alacakli BIGINT DEFAULT NULL,
                  kart_alacakli_ad VARCHAR(255) DEFAULT NULL,
                  tutar DECIMAL(18,2) NOT NULL DEFAULT 0,
                  aciklama TEXT,
                  vade_tarihi DATE DEFAULT NULL,
                  cek_no VARCHAR(50) DEFAULT NULL,
                  vergi_no VARCHAR(20) DEFAULT NULL,
                  cek_resmi LONGTEXT,
                  detay_json LONGTEXT,
                  olusturan VARCHAR(150) DEFAULT NULL,
                  durum VARCHAR(20) NOT NULL DEFAULT 'bekliyor',
                  erp_id BIGINT DEFAULT NULL,
                  hata_mesaji TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  processed_at TIMESTAMP NULL DEFAULT NULL,
                  INDEX idx_tenant_durum (tenant_id, durum),
                  INDEX idx_tenant_created (tenant_id, created_at)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS mobil_kasa_kartlari (
                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                  tenant_id VARCHAR(64) NOT NULL,
                  kart_id BIGINT NOT NULL,
                  ad VARCHAR(255) NOT NULL,
                  tip VARCHAR(4) NOT NULL DEFAULT 'K',
                  UNIQUE KEY uq_tenant_kart (tenant_id, kart_id)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci
            """)
        await conn.commit()
    _tables_ready = True


class IslemCreate(BaseModel):
    tenant_id: str
    islem_turu: int
    cari_id: int
    cari_ad: Optional[str] = None
    kasa_id: int
    kasa_ad: Optional[str] = None
    tutar: float
    aciklama: Optional[str] = ""
    vade_tarihi: Optional[str] = None   # YYYY-MM-DD (çek/senet)
    cek_no: Optional[str] = None
    vergi_no: Optional[str] = None
    cek_resmi: Optional[str] = None     # base64


class KasaCreate(BaseModel):
    tenant_id: str
    kart_id: int
    ad: str
    tip: str = "K"  # K=Kasa B=Banka Ç=Çek kasası S=Senet kasası


@router.get("/turler")
async def islem_turleri(current_user: dict = Depends(get_current_user)):
    return {"ok": True, "turler": [
        {"kod": k, **v} for k, v in ISLEM_TURLERI.items()
    ]}


@router.post("/create")
async def islem_create(body: IslemCreate, current_user: dict = Depends(get_current_user)):
    await _ensure_tables()
    tur = ISLEM_TURLERI.get(body.islem_turu)
    if not tur:
        raise HTTPException(status_code=400, detail="Geçersiz işlem türü")
    if body.tutar <= 0:
        raise HTTPException(status_code=400, detail="Tutar 0'dan büyük olmalı")
    if tur["cek_senet"] and not body.vade_tarihi:
        raise HTTPException(status_code=400, detail="Çek/Senet için vade tarihi zorunlu")

    # Yön tablosuna göre borçlu/alacaklı kartları yerleştir
    if tur["borclu"] == "kasa":
        borclu_id, borclu_ad = body.kasa_id, body.kasa_ad
        alacakli_id, alacakli_ad = body.cari_id, body.cari_ad
    else:
        borclu_id, borclu_ad = body.cari_id, body.cari_ad
        alacakli_id, alacakli_ad = body.kasa_id, body.kasa_ad

    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO mobil_islem_kuyrugu
                   (tenant_id, islem_grubu, islem_turu, islem_turu_ad,
                    kart_borclu, kart_borclu_ad, kart_alacakli, kart_alacakli_ad,
                    tutar, aciklama, vade_tarihi, cek_no, vergi_no, cek_resmi, olusturan)
                   VALUES (%s,'finans',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (body.tenant_id, body.islem_turu, tur["ad"],
                 borclu_id, borclu_ad, alacakli_id, alacakli_ad,
                 round(body.tutar, 2), (body.aciklama or "")[:2000],
                 body.vade_tarihi or None, body.cek_no, body.vergi_no,
                 body.cek_resmi, current_user.get("email", "")),
            )
            islem_id = cur.lastrowid
        await conn.commit()
    logger.info(f"[islem] created id={islem_id} tur={body.islem_turu} tutar={body.tutar} tenant={body.tenant_id[:8]}")
    return {"ok": True, "id": islem_id, "durum": "bekliyor"}


@router.get("/list")
async def islem_list(tenant_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)):
    await _ensure_tables()
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT id, islem_turu, islem_turu_ad, kart_borclu_ad, kart_alacakli_ad,
                          tutar, aciklama, vade_tarihi, cek_no, durum, erp_id, hata_mesaji,
                          created_at, processed_at, (cek_resmi IS NOT NULL) AS resim_var
                   FROM mobil_islem_kuyrugu
                   WHERE tenant_id=%s AND islem_grubu='finans'
                   ORDER BY id DESC LIMIT %s""",
                (tenant_id, min(int(limit), 200)),
            )
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in await cur.fetchall()]
    for r in rows:
        for k in ("created_at", "processed_at", "vade_tarihi"):
            if r.get(k) is not None:
                r[k] = str(r[k])
        r["tutar"] = float(r["tutar"] or 0)
        r["resim_var"] = bool(r.get("resim_var"))
    return {"ok": True, "data": rows}


@router.get("/kasalar")
async def kasa_list(tenant_id: str, current_user: dict = Depends(get_current_user)):
    await _ensure_tables()
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT kart_id, ad, tip FROM mobil_kasa_kartlari WHERE tenant_id=%s ORDER BY ad",
                (tenant_id,),
            )
            rows = [{"kart_id": r[0], "ad": r[1], "tip": r[2]} for r in await cur.fetchall()]
    return {"ok": True, "data": rows}


@router.post("/kasa-ekle")
async def kasa_ekle(body: KasaCreate, current_user: dict = Depends(get_current_user)):
    await _ensure_tables()
    if not body.ad.strip():
        raise HTTPException(status_code=400, detail="Kasa adı gerekli")
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO mobil_kasa_kartlari (tenant_id, kart_id, ad, tip)
                   VALUES (%s,%s,%s,%s)
                   ON DUPLICATE KEY UPDATE ad=VALUES(ad), tip=VALUES(tip)""",
                (body.tenant_id, body.kart_id, body.ad.strip(), (body.tip or "K")[:4]),
            )
        await conn.commit()
    return {"ok": True}
