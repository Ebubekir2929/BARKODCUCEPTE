"""v24 — Açık Hesap GÜN SONU DONDURMA.

RAP_ACIK_HESAP_KISI_OZET_WEB prosedürü ANLIK (hâlâ ödenmemiş) bakiyeleri döndürür;
gün bitip hesap kapanınca aynı tarih için [] döner ve geçmiş günün listesi kaybolur.
Bu servis her gece İstanbul 23:55'te günün son açık hesap listesini
`acik_hesap_gun_sonu` tablosuna kopyalar (tenant + gün başına 1 satır), 00:03'te
gece yarısına kadar gelen son push'la tamamlar. /acik-hesap-kisi geçmiş gün için
önce bu kaydı okur → geçmiş günler hep görünür.

Kurallar:
  - Dolu bir gün-sonu kaydı boş veriyle EZİLMEZ.
  - Açılışta: dünün kaydı yoksa ve cache'te dünün dolu satırı duruyorsa yakalama turu.
  - 400 günden eski kayıtlar silinir (diyet).
"""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DONDURMA_SAAT, DONDURMA_DAKIKA = 23, 55
TAMAMLAMA_SAAT, TAMAMLAMA_DAKIKA = 0, 3
SAKLAMA_GUN = 400
DATASET_KEY = "rap_acik_hesap_kisi_ozet_web"
_IST = timezone(timedelta(hours=3))

son_calisma: Dict[str, Any] = {}
_task = None
_tables_ready = False


def istanbul_simdi() -> datetime:
    return datetime.now(_IST)


async def _ensure_table():
    global _tables_ready
    if _tables_ready:
        return
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS acik_hesap_gun_sonu (
                  tenant_id VARCHAR(64) NOT NULL,
                  gun DATE NOT NULL,
                  row_count INT NOT NULL DEFAULT 0,
                  data_json LONGTEXT NULL,
                  kaynak_updated_at DATETIME NULL,
                  dondurma_at DATETIME NOT NULL,
                  PRIMARY KEY (tenant_id, gun)
                ) CHARACTER SET utf8mb4
            """)
    _tables_ready = True


async def gun_sonu_oku(tenant_id: str, gun: str) -> Optional[Dict[str, Any]]:
    """Geçmiş gün için dondurulmuş liste: {rows, row_count, dondurma_at} ya da None."""
    await _ensure_table()
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT row_count, data_json, dondurma_at, kaynak_updated_at FROM acik_hesap_gun_sonu WHERE tenant_id=%s AND gun=%s",
                (tenant_id, gun),
            )
            r = await cur.fetchone()
    if not r:
        return None
    try:
        rows = json.loads(r[1] or "[]")
    except Exception:
        rows = []
    return {
        "rows": rows if isinstance(rows, list) else [],
        "row_count": int(r[0] or 0),
        "dondurma_at": r[2].isoformat(timespec="seconds") if r[2] else None,
        "kaynak_updated_at": r[3].isoformat(timespec="seconds") if r[3] else None,
    }


async def gun_dondur(gun: str, sadece_dolu: bool = False) -> Dict[str, Any]:
    """Verilen günün (YYYY-MM-DD) cache'teki son açık hesap listesini tüm tenant'lar için dondurur.
    sadece_dolu=True → yalnızca dolu (row_count>0) cache satırları yazılır (tamamlama/yakalama turu)."""
    await _ensure_table()
    from services import get_data_pool
    pool = await get_data_pool()
    stat = {"gun": gun, "tenant": 0, "yazildi": 0, "korundu": 0, "bos": 0, "atlandi": 0}
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT tenant_id, row_count, data_json, updated_at FROM dataset_cache
                   WHERE dataset_key=%s AND params_json LIKE %s ORDER BY updated_at ASC""",
                (DATASET_KEY, f'%"sdate":"{gun} 00:00:00%'),
            )
            # Aynı tenant için birden çok satır varsa en güncel (ASC → son yazılan kazanır)
            kaynak: Dict[str, tuple] = {}
            for r in await cur.fetchall():
                kaynak[r[0]] = r
            stat["tenant"] = len(kaynak)
            await cur.execute("SELECT tenant_id, row_count, kaynak_updated_at FROM acik_hesap_gun_sonu WHERE gun=%s", (gun,))
            mevcut = {r[0]: (int(r[1] or 0), r[2]) for r in await cur.fetchall()}
            simdi = istanbul_simdi().replace(tzinfo=None)
            for tenant_id, (_, row_count, data_json, updated_at) in kaynak.items():
                row_count = int(row_count or 0)
                if row_count <= 0:
                    stat["bos"] += 1
                    if sadece_dolu or (tenant_id in mevcut and mevcut[tenant_id][0] > 0):
                        stat["korundu" if tenant_id in mevcut else "atlandi"] += 1
                        continue
                if tenant_id in mevcut:
                    onceki_rc, onceki_ts = mevcut[tenant_id]
                    if onceki_ts and updated_at and updated_at <= onceki_ts:
                        stat["atlandi"] += 1  # daha yeni veri yok
                        continue
                    if onceki_rc > 0 and row_count <= 0:
                        stat["korundu"] += 1
                        continue
                await cur.execute(
                    """INSERT INTO acik_hesap_gun_sonu (tenant_id, gun, row_count, data_json, kaynak_updated_at, dondurma_at)
                       VALUES (%s,%s,%s,%s,%s,%s)
                       ON DUPLICATE KEY UPDATE row_count=VALUES(row_count), data_json=VALUES(data_json),
                                               kaynak_updated_at=VALUES(kaynak_updated_at), dondurma_at=VALUES(dondurma_at)""",
                    (tenant_id, gun, row_count, data_json or "[]", updated_at, simdi),
                )
                stat["yazildi"] += 1
            # Diyet
            await cur.execute("DELETE FROM acik_hesap_gun_sonu WHERE gun < %s", ((date.fromisoformat(gun) - timedelta(days=SAKLAMA_GUN)).isoformat(),))
    stat["zaman"] = istanbul_simdi().isoformat(timespec="seconds")
    son_calisma.clear()
    son_calisma.update(stat)
    logger.info(f"[acik_hesap_gun_sonu] {stat}")
    return stat


def _sonraki_calisma(simdi: datetime) -> tuple[datetime, str]:
    """Bir sonraki tetik: bugün 23:55 (dondur) ya da yarın 00:03 (tamamla)."""
    adaylar = []
    for gun_kaydir in (0, 1):
        g = simdi.date() + timedelta(days=gun_kaydir)
        adaylar.append((datetime.combine(g, datetime.min.time(), tzinfo=_IST).replace(hour=DONDURMA_SAAT, minute=DONDURMA_DAKIKA), "dondur"))
        adaylar.append((datetime.combine(g, datetime.min.time(), tzinfo=_IST).replace(hour=TAMAMLAMA_SAAT, minute=TAMAMLAMA_DAKIKA), "tamamla"))
    gelecek = sorted((a for a in adaylar if a[0] > simdi), key=lambda a: a[0])
    return gelecek[0]


async def _dongu():
    await asyncio.sleep(240)
    # Yakalama: dünün kaydı yoksa cache'teki dolu satırdan dondur (backend 23:55'te kapalıysa)
    try:
        dun = (istanbul_simdi().date() - timedelta(days=1)).isoformat()
        await gun_dondur(dun, sadece_dolu=True)
    except Exception as e:
        logger.error(f"[acik_hesap_gun_sonu] yakalama hatası: {e}")
    while True:
        simdi = istanbul_simdi()
        hedef, tur = _sonraki_calisma(simdi)
        bekle = max(5.0, (hedef - simdi).total_seconds())
        logger.info(f"[acik_hesap_gun_sonu] sonraki tur '{tur}' {bekle / 60:.0f} dk sonra ({hedef.strftime('%d.%m %H:%M')})")
        await asyncio.sleep(bekle)
        try:
            if tur == "dondur":
                await gun_dondur(istanbul_simdi().date().isoformat())
            else:
                await gun_dondur((istanbul_simdi().date() - timedelta(days=1)).isoformat(), sadece_dolu=True)
        except Exception as e:
            logger.error(f"[acik_hesap_gun_sonu] tur hatası ({tur}): {e}")
        await asyncio.sleep(90)


def start_gun_sonu():
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_event_loop().create_task(_dongu())
        logger.info(f"🧊 Açık hesap gün sonu dondurma zamanlandı (İstanbul {DONDURMA_SAAT:02d}:{DONDURMA_DAKIKA:02d})")
