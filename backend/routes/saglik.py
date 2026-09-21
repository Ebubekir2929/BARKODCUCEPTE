"""
routes/saglik.py — v22 Senkron Sağlık Ekranı

  GET /api/senkron/saglik?tenant_id=…  → POS bağlantısı, veri seti tazeliği,
      son hatalar, yarım yüklemeler, bekleyen istekler, arama indeksi; genel durum.

Tüm sorgular indeksli/küçük: `firms` (tek satır), `dataset_cache` (tenant+key),
`sync_logs` (created_at indeksi, son 24 saat), `dataset_upload_chunks` (tenant),
`sync_requests` (tenant+status).
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query

from routes.auth import get_current_user
from services.dataset_cache import get_data_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/senkron", tags=["senkron"])

# dataset_key → (etiket, beklenen tazelik sn, kritik eşik sn)
IZLENEN_SETLER = [
    ("financial_data", "Satış özeti (dashboard)", 15 * 60, 60 * 60),
    ("acik_masalar", "Açık masalar (canlı)", 5 * 60, 30 * 60),
    ("fis_gunluk_bildirim_feed", "Günlük fişler", 15 * 60, 60 * 60),
    ("stock_list", "Stok listesi", 24 * 3600, 3 * 24 * 3600),
    ("cari_bakiye_liste", "Cari bakiyeler", 24 * 3600, 3 * 24 * 3600),
    ("rap_filtre_lookup", "Rapor filtreleri", 24 * 3600, 7 * 24 * 3600),
]


def _durum_secimi(yas: Optional[int], uyari: int, kritik: int) -> str:
    if yas is None:
        return "yok"
    if yas <= uyari:
        return "iyi"
    if yas <= kritik:
        return "uyari"
    return "kritik"


@router.get("/saglik")
async def senkron_saglik(tenant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    pool = await get_data_pool()
    out: Dict[str, Any] = {"tenant_id": tenant_id, "zaman": datetime.now().isoformat(timespec="seconds")}
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 1) POS istemcisi kalp atışı
            await cur.execute("SELECT firma_adi, last_seen_at, is_active, TIMESTAMPDIFF(SECOND, last_seen_at, NOW()) FROM firms WHERE tenant_id=%s LIMIT 1", (tenant_id,))
            f = await cur.fetchone()
            yas = (max(0, int(f[3])) if f[3] is not None else None) if f else None
            out["pos"] = {
                "firma": f[0] if f else None,
                "aktif": bool(f[2]) if f else False,
                "son_gorulme": f[1].isoformat(timespec="seconds") if (f and f[1]) else None,
                "yas_sn": yas,
                "durum": _durum_secimi(yas, 3 * 60, 15 * 60),
            }

            # 2) Veri seti tazeliği (dataset_cache üst kayıtları; financial/feed için bugünün günü)
            bugun = datetime.now().strftime("%Y-%m-%d")
            setler: List[Dict[str, Any]] = []
            for key, etiket, uyari, kritik in IZLENEN_SETLER:
                if key in ("financial_data", "fis_gunluk_bildirim_feed"):
                    await cur.execute(
                        """SELECT row_count, updated_at, TIMESTAMPDIFF(SECOND, updated_at, NOW()) FROM dataset_cache
                           WHERE tenant_id=%s AND dataset_key=%s AND params_json LIKE %s
                           ORDER BY updated_at DESC LIMIT 1""",
                        (tenant_id, key, f'%"sdate":"{bugun}%' if key == "financial_data" else f'%{bugun}%'),
                    )
                else:
                    await cur.execute(
                        "SELECT row_count, updated_at, TIMESTAMPDIFF(SECOND, updated_at, NOW()) FROM dataset_cache WHERE tenant_id=%s AND dataset_key=%s ORDER BY updated_at DESC LIMIT 1",
                        (tenant_id, key),
                    )
                r = await cur.fetchone()
                y = (max(0, int(r[2])) if r[2] is not None else None) if r else None
                setler.append({
                    "key": key, "etiket": etiket,
                    "satir": int(r[0] or 0) if r else 0,
                    "guncelleme": r[1].isoformat(timespec="seconds") if (r and r[1]) else None,
                    "yas_sn": y,
                    "durum": _durum_secimi(y, uyari, kritik),
                })
            out["veri_setleri"] = setler

            # 3) Son 6 saatte hatalar — sync_logs günde ~1 M satır; 24 saatlik sayım 6-7 sn sürüyordu.
            # Tek sorgu: son 6 saatin hataları (en fazla 200) çekilir; sayı ve son 5 buradan.
            HATA_PENCERE_SAAT = 6
            await cur.execute(
                """SELECT action_name, dataset_key, LEFT(error_text, 200), created_at FROM sync_logs
                   WHERE tenant_id=%s AND status<>'ok' AND created_at > NOW() - INTERVAL %s HOUR
                   ORDER BY created_at DESC LIMIT 200""",
                (tenant_id, HATA_PENCERE_SAAT),
            )
            hata_satirlari = await cur.fetchall()
            hata_sayisi = len(hata_satirlari)
            out["hatalar"] = {
                "sayi": hata_sayisi,
                "sayi_ust_sinir": hata_sayisi >= 200,
                "pencere_saat": HATA_PENCERE_SAAT,
                "son": [
                    {"islem": r[0], "veri_seti": r[1], "hata": r[2], "zaman": r[3].isoformat(timespec="seconds") if r[3] else None}
                    for r in hata_satirlari[:5]
                ],
            }
            await cur.execute(
                "SELECT COUNT(*), MAX(created_at) FROM sync_logs WHERE tenant_id=%s AND created_at > NOW() - INTERVAL 1 HOUR",
                (tenant_id,),
            )
            r = await cur.fetchone()
            out["islem_1s"] = {"sayi": int(r[0] or 0), "son": r[1].isoformat(timespec="seconds") if (r and r[1]) else None}

            # 4) Yarım yüklemeler (commit edilmemiş sayfalı yükleme parçaları)
            await cur.execute(
                """SELECT upload_id, dataset_key, COUNT(*), MAX(total_parts), MIN(created_at), MAX(created_at),
                          TIMESTAMPDIFF(SECOND, MAX(created_at), NOW())
                   FROM dataset_upload_chunks WHERE tenant_id=%s GROUP BY upload_id, dataset_key ORDER BY MAX(created_at) DESC LIMIT 10""",
                (tenant_id,),
            )
            yarim = []
            for r in await cur.fetchall():
                y = max(0, int(r[6])) if r[6] is not None else None
                yarim.append({
                    "upload_id": r[0], "veri_seti": r[1], "gelen": int(r[2]), "toplam": int(r[3] or 0),
                    "baslangic": r[4].isoformat(timespec="seconds") if r[4] else None, "yas_sn": y,
                    "durum": "suruyor" if (y is not None and y < 15 * 60) else "takili",
                })
            out["yarim_yuklemeler"] = yarim

            # 5) Bekleyen kullanıcı rapor istekleri
            await cur.execute(
                """SELECT COUNT(*), MIN(created_at), TIMESTAMPDIFF(SECOND, MIN(created_at), NOW()) FROM sync_requests
                   WHERE tenant_id=%s AND status IN ('pending','processing')""",
                (tenant_id,),
            )
            r = await cur.fetchone()
            en_eski = (max(0, int(r[2])) if r[2] is not None else None) if r else None
            out["bekleyen_istekler"] = {
                "sayi": int(r[0] or 0) if r else 0,
                "en_eski_yas_sn": en_eski,
                "durum": "iyi" if not r or int(r[0] or 0) == 0 else ("uyari" if (en_eski or 0) < 5 * 60 else "kritik"),
            }

    # 6) Arama indeksi (büyük stok listesi)
    try:
        from services import stok_arama as _sa
        out["arama_indeksi"] = _sa.durum(tenant_id)
    except Exception:
        out["arama_indeksi"] = {"asama": "yok"}

    # Genel durum
    puanlar = [out["pos"]["durum"], out["bekleyen_istekler"]["durum"]] + [s["durum"] for s in setler if s["durum"] != "yok"]
    if any(y["durum"] == "takili" for y in yarim):
        puanlar.append("uyari")
    if hata_sayisi >= 50:
        puanlar.append("kritik")
    elif hata_sayisi > 0:
        puanlar.append("uyari")
    genel = "kritik" if "kritik" in puanlar else ("uyari" if "uyari" in puanlar else "iyi")
    if out["pos"]["durum"] == "kritik" or out["pos"]["durum"] == "yok":
        genel = "kritik"
    out["genel"] = genel
    return {"ok": True, "data": out}
