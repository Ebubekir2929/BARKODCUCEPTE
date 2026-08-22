"""2026-08 — Eski veri temizlik görevi (Railway OOM sonrası bakım).

Canlı MySQL'de biriken ve HİÇBİR ekranın kullanmadığı veriyi periyodik siler:

1. `dataset_cache_rows` — soft-delete edilmiş satırlar (deleted_at doldurulmuş):
   POS delta senkronu satırı siler ama fiziksel kayıt kalır. 7 günden eski
   soft-deleted satırlar kalıcı silinir.

2. `dataset_cache_rows` / `hourly_stock_detail` — saatlik satış detayı en çok
   şişen dataset (bir tenant'ta 139K satır = 2.7GB görüldü). Uygulamada en
   uzun geriye bakış 45 gün (tarih push-down sınırı); 60 günden eski satırlar
   silinir.

3. `dataset_cache_pages` — sayfalı dataset'lerde (stock_list, cari_bakiye_liste)
   yalnızca EN GÜNCEL params_hash okunur; eski hash'lerin sayfaları ölü veridir.
   7 günden eski, güncel-olmayan hash sayfaları silinir.

NOT: `dataset_cache` blob tablosuna DOKUNULMAZ — tarih aralıklı dashboard
geçmişi oradan okunuyor.

Silmeler LIMIT'li parçalar halinde yapılır (uzun kilit/replikasyon baskısı
olmasın); parçalar arasında beklenir. Sonuçlar `son_calisma` içinde tutulur ve
/api/sistem-durum -> "temizlik" alanında görünür.
"""
import asyncio
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)

# Ayarlar (env ile değiştirilebilir)
HOURLY_SAKLAMA_GUN = int(os.environ.get("TEMIZLIK_HOURLY_GUN", "60"))
SOFT_DELETE_SAKLAMA_GUN = int(os.environ.get("TEMIZLIK_SOFT_GUN", "7"))
ESKI_SAYFA_SAKLAMA_GUN = int(os.environ.get("TEMIZLIK_SAYFA_GUN", "7"))
PARCA_BOYU = 5000          # her DELETE'te en fazla bu kadar satır
PARCA_ARASI_SN = 1.0       # parçalar arası bekleme (DB'yi boğmamak için)
CALISMA_ARALIGI_SN = 24 * 3600  # günde bir
ILK_CALISMA_GECIKME_SN = int(os.environ.get("TEMIZLIK_ILK_GECIKME_SN", "600"))  # başlangıçtan 10 dk sonra

# Son çalışma istatistiği (sistem-durum'da gösterilir)
son_calisma: dict = {}

_task = None


async def _parcali_sil(pool, sql: str, params: tuple) -> int:
    """LIMIT'li DELETE'i satır kalmayana dek tekrarlar; toplam silineni döndürür.
    MySQL 1213 (deadlock) / 1205 (lock timeout) durumunda kısa bekleyip yeniden dener."""
    toplam = 0
    while True:
        n = 0
        for deneme in range(3):
            try:
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute(sql, params)
                        n = cur.rowcount or 0
                break
            except Exception as e:
                kod = getattr(e, "args", [None])[0]
                if kod in (1213, 1205) and deneme < 2:
                    await asyncio.sleep(2.0 * (deneme + 1))
                    continue
                raise
        toplam += n
        if n < PARCA_BOYU:
            break
        await asyncio.sleep(PARCA_ARASI_SN)
    return toplam


async def _superseded_hourly_temizle(pool) -> int:
    """Aynı (TARIH, SAAT_ADI, STOK_ID, LOKASYON_ID) kombinasyonunun eski
    kopyalarını soft-delete eder (en güncel push kalır).

    MariaDB 5.5'te JSON fonksiyonu yok → alanlar SQL'de LOCATE+SUBSTRING ile
    çıkarılır (ağ trafiği satır başı ~100B). ÖNEMLİ: STOK_ID iç içe URUNLER
    dizisinde de geçer; CASE ile yalnızca URUNLER'den ÖNCE geçen (üst düzey)
    değer alınır, yoksa '' (parent satır). TARIH veya SAAT bulunamayan satıra
    DOKUNULMAZ.
    """
    import re
    from services import stream_rows

    re_tarih = re.compile(r'"TARIH"\s*:\s*"(\d{4}-\d{2}-\d{2})')
    re_saat = re.compile(r'"SAAT_ADI"\s*:\s*"([^"]+)"')
    re_stok = re.compile(r'"STOK_ID"\s*:\s*"?(\d+)')
    re_lok = re.compile(r'"LOKASYON_ID"\s*:\s*"?(\d+)')

    def _alan(sql_key: str, uzunluk: int) -> str:
        """Üst düzey alan parçası: URUNLER'den önce geçiyorsa al, yoksa ''."""
        loc = f"LOCATE('\"{sql_key}\":', row_json)"
        urun = "LOCATE('\"URUNLER\"', row_json)"
        return (
            f"CASE WHEN {loc} > 0 AND ({urun} = 0 OR {loc} < {urun}) "
            f"THEN SUBSTRING(row_json, {loc}, {uzunluk}) ELSE '' END"
        )

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT DISTINCT tenant_id FROM dataset_cache_rows "
                "WHERE dataset_key='hourly_stock_detail' AND deleted_at IS NULL"
            )
            tenantlar = [r[0] for r in await cur.fetchall()]

    toplam = 0
    for tid in tenantlar:
        seen: set = set()
        olu_idler: list = []
        # En güncel önce — ilk görülen key CANLI, sonrakiler ölü kopya
        async for rid, p_t, p_s, p_st, p_l in stream_rows(
            pool,
            f"""SELECT id, {_alan('TARIH', 22)}, {_alan('SAAT_ADI', 30)},
                       {_alan('STOK_ID', 25)}, {_alan('LOKASYON_ID', 30)}
               FROM dataset_cache_rows
               WHERE tenant_id=%s AND dataset_key='hourly_stock_detail'
                 AND deleted_at IS NULL
               ORDER BY updated_at DESC, id DESC""",
            (tid,),
            chunk=2000,
        ):
            m_t = re_tarih.search(p_t or "")
            m_s = re_saat.search(p_s or "")
            if not m_t or not m_s:
                continue  # emin olamıyorsak dokunma
            m_st = re_stok.search(p_st or "")
            m_l = re_lok.search(p_l or "")
            key = f"{m_t.group(1)}|{m_s.group(1).strip()}|{m_st.group(1) if m_st else ''}|{m_l.group(1) if m_l else ''}"
            if key in seen:
                olu_idler.append(rid)
            else:
                seen.add(key)
        # Parçalı soft-delete
        for i in range(0, len(olu_idler), PARCA_BOYU):
            parca = olu_idler[i:i + PARCA_BOYU]
            ph = ",".join(["%s"] * len(parca))
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        f"UPDATE dataset_cache_rows SET deleted_at=NOW() WHERE id IN ({ph})",
                        tuple(parca),
                    )
            await asyncio.sleep(PARCA_ARASI_SN)
        if olu_idler:
            logger.info(f"[temizlik] superseded hourly: tenant={tid[:12]} {len(olu_idler)} kopya soft-del ({len(seen)} canlı)")
        toplam += len(olu_idler)
    return toplam


async def temizlik_calistir() -> dict:
    """Tek temizlik turu. İstatistik dict'i döndürür (sistem-durum için)."""
    from services import get_data_pool
    pool = await get_data_pool()
    stat = {"baslangic": datetime.utcnow().isoformat(timespec="seconds") + "Z"}

    # 1) Soft-deleted satırların kalıcı silinmesi
    try:
        stat["soft_deleted_silinen"] = await _parcali_sil(
            pool,
            f"""DELETE FROM dataset_cache_rows
                WHERE deleted_at IS NOT NULL
                  AND deleted_at < NOW() - INTERVAL %s DAY
                LIMIT {PARCA_BOYU}""",
            (SOFT_DELETE_SAKLAMA_GUN,),
        )
    except Exception as e:
        stat["soft_deleted_hata"] = str(e)[:200]

    # 2) Eski hourly_stock_detail satırları (en büyük şişme kaynağı)
    try:
        stat["hourly_silinen"] = await _parcali_sil(
            pool,
            f"""DELETE FROM dataset_cache_rows
                WHERE dataset_key='hourly_stock_detail'
                  AND updated_at < NOW() - INTERVAL %s DAY
                LIMIT {PARCA_BOYU}""",
            (HOURLY_SAKLAMA_GUN,),
        )
    except Exception as e:
        stat["hourly_hata"] = str(e)[:200]

    # 3) dataset_cache_pages — güncel olmayan eski hash sayfaları.
    # Her (tenant, dataset) için en güncel params_hash korunur.
    try:
        sayfa_silinen = 0
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT DISTINCT tenant_id, dataset_key FROM dataset_cache_pages"
                )
                ciftler = await cur.fetchall()
                guncel_hashler = []
                for tid, dkey in ciftler or []:
                    await cur.execute(
                        """SELECT params_hash FROM dataset_cache_pages
                           WHERE tenant_id=%s AND dataset_key=%s
                           ORDER BY updated_at DESC LIMIT 1""",
                        (tid, dkey),
                    )
                    r = await cur.fetchone()
                    if r:
                        guncel_hashler.append((tid, dkey, r[0]))
        for tid, dkey, guncel_hash in guncel_hashler:
            sayfa_silinen += await _parcali_sil(
                pool,
                f"""DELETE FROM dataset_cache_pages
                    WHERE tenant_id=%s AND dataset_key=%s AND params_hash <> %s
                      AND updated_at < NOW() - INTERVAL %s DAY
                    LIMIT {PARCA_BOYU}""",
                (tid, dkey, guncel_hash, ESKI_SAYFA_SAKLAMA_GUN),
            )
        stat["eski_sayfa_silinen"] = sayfa_silinen
    except Exception as e:
        stat["sayfa_hata"] = str(e)[:200]

    # 4) hourly_stock_detail SUPERSEDED kopyalar — EN BÜYÜK şişme kaynağı.
    # POS aynı (TARIH, SAAT, STOK, LOKASYON) kombinasyonunu her push'ta yeniden
    # yazar; okuma tarafı (dedupe) yalnızca EN GÜNCEL satırı kullanır — eski
    # kopyalar ölü veridir (bir tenant'ta 140K satır / 2.7GB görüldü).
    # GÜVENLİK: hard delete DEĞİL soft-delete (deleted_at=NOW()) yapılır;
    # 7 gün karantinadan sonra adım 1 kalıcı siler. Yanlışlık halinde
    # deleted_at=NULL ile geri alınabilir.
    try:
        stat["superseded_soft_del"] = await _superseded_hourly_temizle(pool)
    except Exception as e:
        stat["superseded_hata"] = str(e)[:200]

    stat["bitis"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    logger.info(f"[temizlik] tur tamamlandı: {stat}")
    son_calisma.clear()
    son_calisma.update(stat)
    return stat


async def _dongu():
    await asyncio.sleep(ILK_CALISMA_GECIKME_SN)
    while True:
        try:
            await temizlik_calistir()
        except Exception as e:
            logger.error(f"[temizlik] tur hatası: {e}")
        await asyncio.sleep(CALISMA_ARALIGI_SN)


def start_temizlik():
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_event_loop().create_task(_dongu())
        logger.info(
            f"🧹 Veri temizlik görevi başladı (ilk tur {ILK_CALISMA_GECIKME_SN}s sonra, "
            f"hourly>{HOURLY_SAKLAMA_GUN}g, soft-del>{SOFT_DELETE_SAKLAMA_GUN}g, "
            f"eski sayfa>{ESKI_SAYFA_SAKLAMA_GUN}g)"
        )
