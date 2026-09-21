"""
routes/hedef.py — v22 Hedef Takibi (aylık satış hedefi + ilerleme)

  GET /api/hedef?tenant_id=…&ay=YYYY-MM   → hedef, gerçekleşen, oran, tempo
  PUT /api/hedef  {tenant_id, ay, hedef}  → hedefi kaydet/güncelle (0 → sil)
  GET /api/hedef/gecmis?tenant_id=…       → son 6 ayın hedef/gerçekleşen listesi

Gerçekleşen: dashboard'daki "Toplam" ile aynı kaynak — her günün en güncel
`financial_data` blobu (`_finans_gun_toplamlari`, lokasyon filtresiz).
Hedef girilmemiş ayda en son girilen hedef DEVRALINIR (kaynak_ay ile işaretlenir).
"""
import calendar
import logging
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from routes.auth import get_current_user
from services.dataset_cache import get_data_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/hedef", tags=["hedef"])

_tables_ready = False
_AY_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


async def _ensure_tables():
    global _tables_ready
    if _tables_ready:
        return
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS satis_hedefleri (
                  tenant_id VARCHAR(64) NOT NULL,
                  yil_ay CHAR(7) NOT NULL,
                  hedef DECIMAL(18,2) NOT NULL DEFAULT 0,
                  olusturan VARCHAR(150) DEFAULT NULL,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  PRIMARY KEY (tenant_id, yil_ay)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci
            """)
    _tables_ready = True


def _ay_dogrula(ay: Optional[str]) -> str:
    if not ay:
        return date.today().strftime("%Y-%m")
    if not _AY_RE.match(ay):
        raise HTTPException(status_code=422, detail="ay YYYY-MM biçiminde olmalı")
    return ay


async def _hedef_bul(cur, tenant_id: str, ay: str):
    """(hedef, kaynak_ay) — bu ay yoksa en son girilen önceki ayın hedefi devralınır."""
    await cur.execute(
        "SELECT hedef, yil_ay FROM satis_hedefleri WHERE tenant_id=%s AND yil_ay<=%s ORDER BY yil_ay DESC LIMIT 1",
        (tenant_id, ay),
    )
    r = await cur.fetchone()
    if not r or float(r[0] or 0) <= 0:
        return 0.0, None
    return float(r[0]), (None if r[1] == ay else r[1])


async def _ay_gerceklesen(tenant_id: str, ay: str) -> dict:
    from routes.data import _finans_gun_toplamlari
    gunler = await _finans_gun_toplamlari(tenant_id, [f'%"sdate":"{ay}-%'], limit=400)
    gun_toplam = {g: v["toplam"] for g, v in gunler.items() if g.startswith(ay)}
    return gun_toplam


@router.get("")
async def hedef_getir(
    tenant_id: str = Query(...),
    ay: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    ay = _ay_dogrula(ay)
    await _ensure_tables()
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            hedef, kaynak_ay = await _hedef_bul(cur, tenant_id, ay)

    gun_toplam = await _ay_gerceklesen(tenant_id, ay)
    gerceklesen = round(sum(gun_toplam.values()), 2)

    yil, ayno = int(ay[:4]), int(ay[5:7])
    ay_gun = calendar.monthrange(yil, ayno)[1]
    bugun = date.today()
    if ay == bugun.strftime("%Y-%m"):
        gecen_gun, kalan_gun = bugun.day, ay_gun - bugun.day
    elif ay < bugun.strftime("%Y-%m"):
        gecen_gun, kalan_gun = ay_gun, 0
    else:
        gecen_gun, kalan_gun = 0, ay_gun

    oran = round(gerceklesen / hedef * 100, 1) if hedef > 0 else None
    kalan = round(max(hedef - gerceklesen, 0.0), 2) if hedef > 0 else None
    gunluk_ort = round(gerceklesen / gecen_gun, 2) if gecen_gun > 0 else 0.0
    gunluk_gereken = round(kalan / kalan_gun, 2) if (kalan is not None and kalan_gun > 0) else None
    tahmin = round(gunluk_ort * ay_gun, 2) if gecen_gun > 0 else None
    beklenen_oran = round(gecen_gun / ay_gun * 100, 1)  # takvimsel ilerleme (tempo kıyası)
    return {
        "ok": True,
        "data": {
            "ay": ay,
            "hedef": round(hedef, 2),
            "kaynak_ay": kaynak_ay,       # devralındıysa hangi aydan
            "gerceklesen": gerceklesen,
            "oran": oran,
            "kalan": kalan,
            "gecen_gun": gecen_gun,
            "kalan_gun": kalan_gun,
            "ay_gun": ay_gun,
            "gunluk_ortalama": gunluk_ort,
            "gunluk_gereken": gunluk_gereken,
            "tahmini_ay_sonu": tahmin,
            "beklenen_oran": beklenen_oran,
            "durum": (
                None if oran is None else
                "tamamlandi" if oran >= 100 else
                "onde" if oran >= beklenen_oran else
                "geride"
            ),
        },
    }


class HedefBody(BaseModel):
    tenant_id: str
    ay: Optional[str] = None
    hedef: float


@router.put("")
async def hedef_kaydet(body: HedefBody, current_user: dict = Depends(get_current_user)):
    ay = _ay_dogrula(body.ay)
    if body.hedef < 0 or body.hedef > 10_000_000_000:
        raise HTTPException(status_code=422, detail="hedef 0 ile 10 milyar arasında olmalı")
    await _ensure_tables()
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if body.hedef == 0:
                await cur.execute("DELETE FROM satis_hedefleri WHERE tenant_id=%s AND yil_ay=%s", (body.tenant_id, ay))
            else:
                await cur.execute(
                    """INSERT INTO satis_hedefleri (tenant_id, yil_ay, hedef, olusturan)
                       VALUES (%s,%s,%s,%s)
                       ON DUPLICATE KEY UPDATE hedef=VALUES(hedef), olusturan=VALUES(olusturan)""",
                    (body.tenant_id, ay, round(body.hedef, 2), str(current_user.get("email") or current_user.get("full_name") or "")[:150]),
                )
    return {"ok": True, "ay": ay, "hedef": round(body.hedef, 2)}


@router.get("/gecmis")
async def hedef_gecmis(tenant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    """Son 6 ay: hedef vs gerçekleşen (hedef ekranındaki mini liste)."""
    await _ensure_tables()
    bugun = date.today()
    aylar = []
    y, m = bugun.year, bugun.month
    for _ in range(6):
        aylar.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    from routes.data import _finans_gun_toplamlari
    gunler = await _finans_gun_toplamlari(tenant_id, [f'%"sdate":"{ay}-%' for ay in aylar], limit=1500)
    ay_toplam = {ay: 0.0 for ay in aylar}
    for g, v in gunler.items():
        if g[:7] in ay_toplam:
            ay_toplam[g[:7]] += v["toplam"]
    pool = await get_data_pool()
    out = []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for ay in aylar:
                hedef, kaynak = await _hedef_bul(cur, tenant_id, ay)
                gercek = round(ay_toplam[ay], 2)
                out.append({
                    "ay": ay, "hedef": round(hedef, 2), "kaynak_ay": kaynak, "gerceklesen": gercek,
                    "oran": round(gercek / hedef * 100, 1) if hedef > 0 else None,
                })
    return {"ok": True, "data": out}
