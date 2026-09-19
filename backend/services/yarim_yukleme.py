"""v20 — Yarım kalan sayfalı yüklemeleri (dataset_upload_chunks) tamamlama.

Arka plan: 200K ürünlü müşteride POS istemcisi 830 parçanın hepsini
sync.php'ye başarıyla gönderiyor, ancak `dataset_page_commit` PHP tarafında
tüm parçaları tek seferde belleğe aldığı için (≈370 MB) çöküyordu. Sonuç:
her 45 dk'da bir 370 MB'lık yeni bir "yarım yükleme" birikiyor (28 adet ≈ 10 GB),
stok listesi web'e hiç gelmiyor.

Bu servis aynı işi Python tarafında PARÇA PARÇA yapar (RAM'de tek parça):
  1. tamamlanmış (gelen == toplam) en güncel upload seçilir,
  2. parçalar geçici (staging) params_hash ile dataset_cache_pages'e yazılır,
  3. tek transaction'da eski sayfalar silinir, staging gerçek hash'e çevrilir,
     dataset_cache üst kaydı güncellenir,
  4. tenant+dataset'e ait TÜM upload parçaları küçük dilimlerle silinir.
"""
import asyncio
import hashlib
import json
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# İş durumu (tenant|dataset → durum sözlüğü); senkron-tani içinde döner
_DURUM: Dict[str, Dict[str, Any]] = {}

SIL_DILIM = 200  # her DELETE'te en fazla bu kadar parça (parça ≈ 450 KB)


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def durum(tenant_id: str, dataset_key: str) -> Optional[Dict[str, Any]]:
    return _DURUM.get(f"{tenant_id}|{dataset_key}")


def _guncelle(anahtar: str, **kw) -> None:
    d = _DURUM.setdefault(anahtar, {})
    d.update(kw)
    d["guncelleme"] = time.strftime("%H:%M:%S")


async def _tamamlanmis_yuklemeler(pool, tenant_id: str, dataset_key: str):
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT upload_id, COUNT(*), MAX(total_parts), MAX(created_at), MAX(params_hash)
                   FROM dataset_upload_chunks
                   WHERE tenant_id=%s AND dataset_key=%s
                   GROUP BY upload_id
                   HAVING COUNT(*) = MAX(total_parts)
                   ORDER BY MAX(created_at) DESC""",
                (tenant_id, dataset_key),
            )
            return await cur.fetchall()


async def parcalari_sil(pool, tenant_id: str, dataset_key: str, haric_upload: Optional[str] = None) -> int:
    """tenant+dataset'e ait upload parçalarını küçük dilimlerle siler (DB'yi boğmaz)."""
    toplam = 0
    while True:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                if haric_upload:
                    await cur.execute(
                        f"DELETE FROM dataset_upload_chunks WHERE tenant_id=%s AND dataset_key=%s AND upload_id<>%s LIMIT {SIL_DILIM}",
                        (tenant_id, dataset_key, haric_upload),
                    )
                else:
                    await cur.execute(
                        f"DELETE FROM dataset_upload_chunks WHERE tenant_id=%s AND dataset_key=%s LIMIT {SIL_DILIM}",
                        (tenant_id, dataset_key),
                    )
                n = cur.rowcount or 0
        toplam += n
        if n < SIL_DILIM:
            return toplam
        await asyncio.sleep(0.5)


async def tamamla(pool, tenant_id: str, dataset_key: str, upload_id: Optional[str] = None, temizle: bool = True) -> Dict[str, Any]:
    anahtar = f"{tenant_id}|{dataset_key}"
    if (_DURUM.get(anahtar) or {}).get("asama") in ("yaziliyor", "degistiriliyor", "temizleniyor"):
        return _DURUM[anahtar]
    _DURUM[anahtar] = {}
    _guncelle(anahtar, asama="seciliyor", baslangic=time.strftime("%H:%M:%S"))
    t0 = time.monotonic()
    try:
        adaylar = await _tamamlanmis_yuklemeler(pool, tenant_id, dataset_key)
        secim = None
        for a in adaylar:
            if upload_id is None or a[0] == upload_id:
                secim = a
                break
        if not secim:
            _guncelle(anahtar, asama="bitti", sonuc="tamamlanmis_yukleme_yok", aday=len(adaylar))
            return _DURUM[anahtar]
        upload_id, toplam_parca, _, _, params_hash = secim[0], int(secim[1]), secim[2], secim[3], secim[4]
        staging = _sha256(f"staging|{tenant_id}|{dataset_key}|{params_hash}|{upload_id}")
        _guncelle(anahtar, asama="yaziliyor", upload_id=upload_id, toplam_parca=toplam_parca, yazilan=0, satir=0)

        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM dataset_cache_pages WHERE tenant_id=%s AND dataset_key=%s AND params_hash=%s",
                    (tenant_id, dataset_key, staging),
                )
                await cur.execute(
                    "SELECT part_no FROM dataset_upload_chunks WHERE tenant_id=%s AND upload_id=%s AND dataset_key=%s ORDER BY part_no",
                    (tenant_id, upload_id, dataset_key),
                )
                parca_nolar = [int(r[0]) for r in await cur.fetchall()]

        toplam_satir = 0
        for i, pn in enumerate(parca_nolar, start=1):
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT chunk_text FROM dataset_upload_chunks WHERE tenant_id=%s AND upload_id=%s AND dataset_key=%s AND part_no=%s",
                        (tenant_id, upload_id, dataset_key, pn),
                    )
                    r = await cur.fetchone()
                    metin = r[0] if r else None
                    if metin is None:
                        raise RuntimeError(f"parça {pn} okunamadı")
                    if isinstance(metin, (bytes, bytearray)):
                        metin = metin.decode("utf-8")
                    satirlar = json.loads(metin)
                    if not isinstance(satirlar, list):
                        raise RuntimeError(f"parça {pn} JSON listesi değil")
                    adet = len(satirlar)
                    del satirlar
                    toplam_satir += adet
                    await cur.execute(
                        """INSERT INTO dataset_cache_pages
                               (tenant_id, dataset_key, params_hash, page_no, row_count, data_hash, data_json, created_at, updated_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())""",
                        (tenant_id, dataset_key, staging, pn, adet, _sha256(metin), metin),
                    )
                    del metin
            if i % 10 == 0 or i == len(parca_nolar):
                _guncelle(anahtar, yazilan=i, satir=toplam_satir)

        # Güvenli takas — tek transaction
        _guncelle(anahtar, asama="degistiriliyor")
        veri_hash = _sha256(f"{dataset_key}|{params_hash}|{toplam_satir}|{toplam_parca}")
        meta_json = json.dumps(
            {"meta": {"actual_rows": toplam_satir, "safe_swap": True, "total_parts": toplam_parca,
                      "upload_id": upload_id, "web_tamamlama": True},
             "paged": True, "row_count": toplam_satir},
            ensure_ascii=False, separators=(",", ":"),
        )
        async with pool.acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "DELETE FROM dataset_cache_pages WHERE tenant_id=%s AND dataset_key=%s AND params_hash=%s",
                        (tenant_id, dataset_key, params_hash),
                    )
                    await cur.execute(
                        "UPDATE dataset_cache_pages SET params_hash=%s, updated_at=NOW() WHERE tenant_id=%s AND dataset_key=%s AND params_hash=%s",
                        (params_hash, tenant_id, dataset_key, staging),
                    )
                    await cur.execute(
                        "SELECT id, revision_no, data_hash FROM dataset_cache WHERE tenant_id=%s AND dataset_key=%s AND params_hash=%s LIMIT 1",
                        (tenant_id, dataset_key, params_hash),
                    )
                    mevcut = await cur.fetchone()
                    if mevcut:
                        rev = int(mevcut[1] or 0) + (0 if (mevcut[2] or "") == veri_hash else 1)
                        await cur.execute(
                            """UPDATE dataset_cache SET data_json=%s, row_count=%s, data_hash=%s, revision_no=%s,
                                      synced_at=NOW(), updated_at=NOW() WHERE id=%s""",
                            (meta_json, toplam_satir, veri_hash, rev, mevcut[0]),
                        )
                    else:
                        await cur.execute(
                            """INSERT INTO dataset_cache
                                   (tenant_id, dataset_key, params_hash, params_json, data_json, row_count, data_hash, revision_no, synced_at, created_at, updated_at)
                               VALUES (%s, %s, %s, '{}', %s, %s, %s, 1, NOW(), NOW(), NOW())""",
                            (tenant_id, dataset_key, params_hash, meta_json, toplam_satir, veri_hash),
                        )
                    await cur.execute(
                        """INSERT INTO sync_logs (tenant_id, dataset_key, action_name, status, params_json, meta_json, created_at)
                           VALUES (%s, %s, 'dataset_page_commit', 'ok', '{}', %s, NOW())""",
                        (tenant_id, dataset_key, json.dumps({"upload_id": upload_id, "row_count": toplam_satir,
                                                             "total_parts": toplam_parca, "web_tamamlama": True})),
                    )
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise

        # RAM önbelleğini düşür — yeni liste hemen görünsün
        try:
            from services.dataset_cache import clear_dataset_cache
            clear_dataset_cache(tenant_id, dataset_key)
        except Exception:
            pass

        silinen = 0
        if temizle:
            _guncelle(anahtar, asama="temizleniyor")
            silinen = await parcalari_sil(pool, tenant_id, dataset_key)

        _guncelle(anahtar, asama="bitti", sonuc="ok", satir=toplam_satir, yazilan=len(parca_nolar),
                  silinen_parca=silinen, sure_sn=round(time.monotonic() - t0, 1))
        logger.info(f"[yarim_yukleme] {tenant_id}/{dataset_key} tamamlandı: {toplam_satir} satır, {len(parca_nolar)} sayfa, {silinen} parça silindi")
    except Exception as e:
        logger.exception(f"[yarim_yukleme] {tenant_id}/{dataset_key} HATA")
        _guncelle(anahtar, asama="bitti", sonuc="hata", hata=str(e)[:300], sure_sn=round(time.monotonic() - t0, 1))
    return _DURUM[anahtar]
