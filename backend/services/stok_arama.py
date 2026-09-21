"""v22 — HIZLI ÜRÜN ARAMA İNDEKSİ (büyük stok listeleri için).

734K satırlık stok listesinde arama, sayfaların LONGTEXT JSON'unda LIKE taraması
yapıyordu (370 MB, 5-18 sn). Bu servis MySQL'de üç küçük tablo tutar:

  stok_arama_kelime (tenant_id, kelime, stok_key)      — ad kelimeleri + barkod + kod (ASCII katlanmış, BÜYÜK)
  stok_arama_konum  (tenant_id, stok_key, fiyat_ad, page_no, satir_idx) — ürünün hangi sayfada/satırda olduğu
  stok_arama_sayfa  (tenant_id, page_no, data_hash)    — indekslenmiş sayfa hash'leri (artımlı yenileme)

Arama: her terim `kelime LIKE 'TERIM%'` (PK öneki → indeksli, ms düzeyi) → stok_key
kesişimi → konum → yalnızca ilgili sayfalar okunur → satırlar Python süzgeciyle
doğrulanır (eski/kalıntı kelime eşleşmesi zararsız).

Yenileme: sayfa senkronu yalnızca değişen sayfaların data_hash'ini değiştirir →
`indeksi_yenile` sadece o sayfaları yeniden indeksler. Sayfaların yarısından
fazlası değiştiyse (tam kurulum) tenant indeksi sıfırdan kurulur.
"""
import asyncio
import json
import logging
import re
import time
import warnings

import pymysql

# INSERT IGNORE'un her yinelenen anahtar için ürettiği MySQL uyarıları aiomysql
# tarafından Python Warning olarak yükseltilir → log şişer. Bu modülde susturulur.
warnings.filterwarnings("ignore", category=pymysql.Warning)
from typing import Any, Dict, List, Optional, Set, Tuple

from services import get_data_pool

logger = logging.getLogger(__name__)

KELIME_MAX = 48
STOK_KEY_MAX = 40
INSERT_DILIM = 800
TOPLU_YENIDEN_KURULUM_ORANI = 0.5  # değişen sayfa oranı bunu aşarsa sıfırdan kur
MIN_TERIM_UZUNLUK = 2
MAX_ADAY = 600  # kesişimden sonra en fazla bu kadar ürün okunur

_TR_MAP = str.maketrans({
    "ç": "C", "Ç": "C", "ğ": "G", "Ğ": "G", "ı": "I", "I": "I", "i": "I", "İ": "I",
    "ö": "O", "Ö": "O", "ş": "S", "Ş": "S", "ü": "U", "Ü": "U", "â": "A", "Â": "A", "î": "I", "Î": "I", "û": "U", "Û": "U",
})
_BOLUCU = re.compile(r"[^A-Z0-9]+")

# tenant_id → durum sözlüğü (kuruluyor / hazır / hata)
_DURUM: Dict[str, Dict[str, Any]] = {}
_KILIT: Dict[str, asyncio.Lock] = {}
_TABLOLAR_HAZIR = False


def katla(metin: str) -> str:
    """Türkçe harfleri ASCII'ye katlar, BÜYÜK harfe çevirir."""
    return str(metin or "").translate(_TR_MAP).upper()


def kelimeler(metin: str) -> List[str]:
    return [k[:KELIME_MAX] for k in _BOLUCU.split(katla(metin)) if len(k) >= MIN_TERIM_UZUNLUK]


def terimler(arama: str) -> List[str]:
    """Kullanıcı aramasını indeks terimlerine çevirir (boş → [])."""
    return [t for t in kelimeler(arama) if t]


def stok_key(row: dict) -> str:
    for k in ("ID", "STOK_ID", "id", "stok_id"):
        v = row.get(k)
        if v not in (None, ""):
            return str(v)[:STOK_KEY_MAX]
    for k in ("KOD", "BARKOD"):
        v = row.get(k)
        if v not in (None, ""):
            return f"{k}:{str(v).strip()}"[:STOK_KEY_MAX]
    return ""


def fiyat_ad(row: dict) -> int:
    try:
        return int(row.get("FIYAT_AD") or row.get("FIYAT_AD_ID") or 0)
    except (TypeError, ValueError):
        return 0


def satir_kelimeleri(row: dict) -> Set[str]:
    out: Set[str] = set(kelimeler(str(row.get("AD") or "")))
    for k in ("BARKOD", "KOD"):
        v = str(row.get(k) or "").strip()
        if v:
            out.add(katla(v)[:KELIME_MAX])
            out.update(kelimeler(v))
    return {k for k in out if k}


def eslesir(row: dict, arama: str) -> bool:
    """İndeks semantiğiyle doğrulama: tüm terimler katlanmış AD/KOD/BARKOD içinde geçer."""
    metin = katla(f"{row.get('AD') or ''} {row.get('KOD') or ''} {row.get('BARKOD') or ''}")
    return all(t in metin for t in terimler(arama))


def durum(tenant_id: str) -> Dict[str, Any]:
    return dict(_DURUM.get(tenant_id) or {"asama": "yok"})


def _kilit(tenant_id: str) -> asyncio.Lock:
    if tenant_id not in _KILIT:
        _KILIT[tenant_id] = asyncio.Lock()
    return _KILIT[tenant_id]


async def tablolari_hazirla() -> None:
    global _TABLOLAR_HAZIR
    if _TABLOLAR_HAZIR:
        return
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """CREATE TABLE IF NOT EXISTS stok_arama_kelime (
                       tenant_id CHAR(32) NOT NULL,
                       kelime VARCHAR(48) NOT NULL,
                       stok_key VARCHAR(40) NOT NULL,
                       PRIMARY KEY (tenant_id, kelime, stok_key)
                   ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin"""
            )
            await cur.execute(
                """CREATE TABLE IF NOT EXISTS stok_arama_konum (
                       tenant_id CHAR(32) NOT NULL,
                       stok_key VARCHAR(40) NOT NULL,
                       fiyat_ad INT NOT NULL,
                       page_no INT NOT NULL,
                       satir_idx INT NOT NULL,
                       PRIMARY KEY (tenant_id, stok_key, fiyat_ad),
                       KEY idx_konum_sayfa (tenant_id, page_no)
                   ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin"""
            )
            await cur.execute(
                """CREATE TABLE IF NOT EXISTS stok_arama_sayfa (
                       tenant_id CHAR(32) NOT NULL,
                       page_no INT NOT NULL,
                       data_hash CHAR(64) NOT NULL,
                       satir INT NOT NULL DEFAULT 0,
                       indexed_at DATETIME NOT NULL,
                       PRIMARY KEY (tenant_id, page_no)
                   ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin"""
            )
    _TABLOLAR_HAZIR = True


async def _son_params_hash(cur, tenant_id: str) -> Optional[str]:
    await cur.execute(
        """SELECT params_hash FROM dataset_cache_pages
           WHERE tenant_id=%s AND dataset_key='stock_list' ORDER BY updated_at DESC LIMIT 1""",
        (tenant_id,),
    )
    r = await cur.fetchone()
    return r[0] if r else None


_HAZIR_CACHE: Dict[str, Tuple[float, bool]] = {}
HAZIR_CACHE_SN = 60


async def indeks_hazir_mi(tenant_id: str) -> bool:
    """Hazır = indekslenmiş sayfa sayısı, mevcut stok sayfası sayısını (≥%98) karşılıyor.
    Yarım kalmış kurulum (yeniden başlatma vb.) 'hazır' sayılmaz → eksik sonuç dönmez.
    Artımlı yenileme sürerken önceki tam indeks kullanılmaya devam eder."""
    d = _DURUM.get(tenant_id) or {}
    if d.get("asama") == "kuruluyor":
        return bool(d.get("onceden_hazir"))
    c = _HAZIR_CACHE.get(tenant_id)
    if c and time.monotonic() - c[0] < HAZIR_CACHE_SN:
        return c[1]
    hazir = False
    try:
        await tablolari_hazirla()
        pool = await get_data_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                ph = await _son_params_hash(cur, tenant_id)
                if ph:
                    await cur.execute(
                        "SELECT COUNT(*) FROM dataset_cache_pages WHERE tenant_id=%s AND dataset_key='stock_list' AND params_hash=%s",
                        (tenant_id, ph),
                    )
                    n_sayfa = int((await cur.fetchone())[0])
                    await cur.execute("SELECT COUNT(*) FROM stok_arama_sayfa WHERE tenant_id=%s", (tenant_id,))
                    n_idx = int((await cur.fetchone())[0])
                    hazir = n_sayfa > 0 and n_idx >= n_sayfa * 0.98
                    if d.get("asama") not in ("kuruluyor", "hata"):
                        _DURUM[tenant_id] = {"asama": "hazir" if hazir else "eksik", "sayfa": n_sayfa, "indeksli_sayfa": n_idx}
    except Exception as e:
        logger.warning(f"[stok_arama] hazır kontrolü: {e}")
    _HAZIR_CACHE[tenant_id] = (time.monotonic(), hazir)
    return hazir


async def _sayfa_indeksle(pool, tenant_id: str, page_no: int, data_hash: str, metin: str) -> int:
    rows = json.loads(metin)
    if not isinstance(rows, list):
        rows = []
    konumlar: List[Tuple] = []
    kelime_satirlari: List[Tuple] = []
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        sk = stok_key(row)
        if not sk:
            continue
        konumlar.append((tenant_id, sk, fiyat_ad(row), page_no, idx))
        for k in satir_kelimeleri(row):
            kelime_satirlari.append((tenant_id, k, sk))
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM stok_arama_konum WHERE tenant_id=%s AND page_no=%s", (tenant_id, page_no)
            )
            for i in range(0, len(konumlar), INSERT_DILIM):
                dilim = konumlar[i:i + INSERT_DILIM]
                await cur.execute(
                    "INSERT INTO stok_arama_konum (tenant_id, stok_key, fiyat_ad, page_no, satir_idx) VALUES "
                    + ",".join(["(%s,%s,%s,%s,%s)"] * len(dilim))
                    + " ON DUPLICATE KEY UPDATE page_no=VALUES(page_no), satir_idx=VALUES(satir_idx)",
                    [v for t in dilim for v in t],
                )
            for i in range(0, len(kelime_satirlari), INSERT_DILIM):
                dilim = kelime_satirlari[i:i + INSERT_DILIM]
                await cur.execute(
                    "INSERT IGNORE INTO stok_arama_kelime (tenant_id, kelime, stok_key) VALUES "
                    + ",".join(["(%s,%s,%s)"] * len(dilim)),
                    [v for t in dilim for v in t],
                )
            await cur.execute(
                """INSERT INTO stok_arama_sayfa (tenant_id, page_no, data_hash, satir, indexed_at)
                   VALUES (%s,%s,%s,%s,NOW())
                   ON DUPLICATE KEY UPDATE data_hash=VALUES(data_hash), satir=VALUES(satir), indexed_at=NOW()""",
                (tenant_id, page_no, data_hash, len(konumlar)),
            )
    return len(konumlar)


async def indeksi_yenile(tenant_id: str, zorla_tam: bool = False) -> Dict[str, Any]:
    """Değişen sayfaları (data_hash farkı) yeniden indeksler; gerekirse sıfırdan kurar."""
    kilit = _kilit(tenant_id)
    if kilit.locked():
        return durum(tenant_id)
    async with kilit:
        t0 = time.monotonic()
        onceki = _DURUM.get(tenant_id) or {}
        onceden_hazir = bool(_HAZIR_CACHE.get(tenant_id, (0, False))[1]) and not zorla_tam
        _DURUM[tenant_id] = {"asama": "kuruluyor", "baslangic": time.strftime("%H:%M:%S"), "islenen": 0, "toplam": 0,
                             "onceden_hazir": onceden_hazir}
        try:
            await tablolari_hazirla()
            pool = await get_data_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    ph = await _son_params_hash(cur, tenant_id)
                    if not ph:
                        _DURUM[tenant_id] = {"asama": "yok", "neden": "stok sayfası yok"}
                        return durum(tenant_id)
                    await cur.execute(
                        """SELECT page_no, data_hash FROM dataset_cache_pages
                           WHERE tenant_id=%s AND dataset_key='stock_list' AND params_hash=%s""",
                        (tenant_id, ph),
                    )
                    mevcut = {int(r[0]): (r[1] or "") for r in await cur.fetchall()}
                    await cur.execute(
                        "SELECT page_no, data_hash FROM stok_arama_sayfa WHERE tenant_id=%s", (tenant_id,)
                    )
                    indeksli = {int(r[0]): (r[1] or "") for r in await cur.fetchall()}

            degisen = [pn for pn, h in mevcut.items() if indeksli.get(pn) != h]
            silinen = [pn for pn in indeksli if pn not in mevcut]
            # Yalnızca HASH'İ DEĞİŞEN (daha önce indekslenmiş) sayfa oranı tam kurulumu tetikler;
            # eksik sayfalar (yarım kalmış kurulum) artımlı olarak tamamlanır.
            hash_degisen = [pn for pn in degisen if pn in indeksli]
            tam = zorla_tam or (bool(indeksli) and len(hash_degisen) > TOPLU_YENIDEN_KURULUM_ORANI * len(indeksli))
            if tam:
                _DURUM[tenant_id]["onceden_hazir"] = False
                # Kalıntı kelimeler (ad değişimleri) de temizlensin → sıfırdan
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        for tablo in ("stok_arama_kelime", "stok_arama_konum", "stok_arama_sayfa"):
                            # büyük tablo: dilimli sil
                            while True:
                                await cur.execute(f"DELETE FROM {tablo} WHERE tenant_id=%s LIMIT 20000", (tenant_id,))
                                if (cur.rowcount or 0) < 20000:
                                    break
                                await asyncio.sleep(0.2)
                degisen = sorted(mevcut.keys())
                silinen = []
            elif silinen:
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        for pn in silinen:
                            await cur.execute("DELETE FROM stok_arama_konum WHERE tenant_id=%s AND page_no=%s", (tenant_id, pn))
                            await cur.execute("DELETE FROM stok_arama_sayfa WHERE tenant_id=%s AND page_no=%s", (tenant_id, pn))

            _DURUM[tenant_id].update(toplam=len(degisen), tam=bool(tam), silinen=len(silinen))
            satir_toplam = 0
            for i, pn in enumerate(sorted(degisen), start=1):
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """SELECT data_json, data_hash FROM dataset_cache_pages
                               WHERE tenant_id=%s AND dataset_key='stock_list' AND params_hash=%s AND page_no=%s""",
                            (tenant_id, ph, pn),
                        )
                        r = await cur.fetchone()
                if not r:
                    continue
                metin = r[0].decode("utf-8") if isinstance(r[0], (bytes, bytearray)) else (r[0] or "[]")
                satir_toplam += await _sayfa_indeksle(pool, tenant_id, pn, r[1] or "", metin)
                del metin
                _DURUM[tenant_id].update(islenen=i, satir=satir_toplam)
                if i % 5 == 0:
                    await asyncio.sleep(0.05)  # olay döngüsüne nefes
            _DURUM[tenant_id] = {
                "asama": "hazir", "sayfa": len(mevcut), "yenilenen_sayfa": len(degisen), "silinen_sayfa": len(silinen),
                "satir": satir_toplam, "tam": bool(tam), "sure_sn": round(time.monotonic() - t0, 1),
                "bitis": time.strftime("%H:%M:%S"),
            }
            _HAZIR_CACHE[tenant_id] = (time.monotonic(), True)
            if degisen or silinen:
                logger.info(f"[stok_arama] {tenant_id}: {len(degisen)} sayfa indekslendi ({satir_toplam} satır, tam={bool(tam)}) {time.monotonic() - t0:.1f}s")
        except Exception as e:
            logger.exception(f"[stok_arama] {tenant_id} indeks hatası")
            _DURUM[tenant_id] = {"asama": "hata", "hata": str(e)[:300], "onceki": onceki.get("asama")}
            _HAZIR_CACHE.pop(tenant_id, None)
        return durum(tenant_id)


async def ara(
    tenant_id: str, arama: str, fiyat_ad_id: Optional[int] = None, max_aday: int = MAX_ADAY
) -> Optional[List[dict]]:
    """İndeksten arama. None → indeks kullanılamadı (çağıran eski yola düşer).
    Dönen satırlar ham stok satırlarıdır (süzgeç/sıralama çağırana ait)."""
    terim_listesi = terimler(arama)
    if not terim_listesi:
        return None
    pool = await get_data_pool()
    t0 = time.monotonic()
    MAX_SAYFA = 30  # en fazla bu kadar sayfa okunur (~450 KB/sayfa) → kısa terimlerde 80 sn → <10 sn

    async def _anahtarlar(cur, tam_eslesme: bool) -> Optional[Set[str]]:
        """Tüm terimlerin kesişimi. tam_eslesme=True → kelime = TERIM (öncelikli, hızlı)."""
        kume: Optional[Set[str]] = None
        for t in sorted(terim_listesi, key=len, reverse=True):
            if tam_eslesme:
                await cur.execute(
                    "SELECT stok_key FROM stok_arama_kelime WHERE tenant_id=%s AND kelime=%s LIMIT 20000", (tenant_id, t))
            else:
                await cur.execute(
                    "SELECT stok_key FROM stok_arama_kelime WHERE tenant_id=%s AND kelime LIKE %s LIMIT 20000",
                    (tenant_id, t.replace("%", "").replace("_", "") + "%"))
            bulunan = {r[0] for r in await cur.fetchall()}
            kume = bulunan if kume is None else (kume & bulunan)
            if not kume:
                return set()
        return kume or set()

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 1) Önce TAM kelime eşleşmesi (COCA → "COCA COLA"); sonuç varsa onunla yetin,
            #    yoksa ÖNEK eşleşmesine düş (SUT → SUTAS, SUTLU…)
            anahtarlar = await _anahtarlar(cur, True)
            if not anahtarlar:
                anahtarlar = await _anahtarlar(cur, False)
            if not anahtarlar:
                return []
            adaylar = sorted(anahtarlar)[:max(max_aday, 3000)]
            konum_sql = (
                "SELECT stok_key, fiyat_ad, page_no, satir_idx FROM stok_arama_konum WHERE tenant_id=%s AND stok_key IN ("
                + ",".join(["%s"] * len(adaylar)) + ")"
            )
            args: List[Any] = [tenant_id, *adaylar]
            if fiyat_ad_id is not None:
                konum_sql += " AND fiyat_ad=%s"
                args.append(int(fiyat_ad_id))
            await cur.execute(konum_sql, args)
            konumlar = await cur.fetchall()
            if not konumlar:
                return []
            sayfa_satirlari: Dict[int, List[int]] = {}
            for _, _, pn, idx in konumlar:
                sayfa_satirlari.setdefault(int(pn), []).append(int(idx))
            # En çok eşleşme barındıran sayfalar önce; en fazla MAX_SAYFA sayfa okunur
            secilen_sayfalar = sorted(sayfa_satirlari, key=lambda pn: (-len(sayfa_satirlari[pn]), pn))[:MAX_SAYFA]
            ph = await _son_params_hash(cur, tenant_id)
            sonuc: List[dict] = []
            for pn in secilen_sayfalar:
                await cur.execute(
                    """SELECT data_json FROM dataset_cache_pages
                       WHERE tenant_id=%s AND dataset_key='stock_list' AND params_hash=%s AND page_no=%s""",
                    (tenant_id, ph, pn),
                )
                r = await cur.fetchone()
                if not r:
                    continue
                metin = r[0].decode("utf-8") if isinstance(r[0], (bytes, bytearray)) else (r[0] or "[]")
                rows = json.loads(metin)
                del metin
                for idx in sayfa_satirlari[pn]:
                    if 0 <= idx < len(rows) and isinstance(rows[idx], dict):
                        sonuc.append(rows[idx])
                del rows
                if len(sonuc) >= max_aday * 4:
                    break
    logger.info(f"[stok_arama] '{arama}' → {len(sonuc)} satır, {len(secilen_sayfalar)}/{len(sayfa_satirlari)} sayfa, {(time.monotonic() - t0) * 1000:.0f} ms")
    return sonuc


# ── Arka plan yenileyici: büyük tenant'ların indeksini periyodik günceller ──
_yenileyici_task = None
YENILEME_ARALIGI_SN = 600


async def _buyuk_tenantlar() -> List[str]:
    from services.dataset_cache import BUYUK_VERI_ESIGI
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT tenant_id FROM dataset_cache WHERE dataset_key='stock_list' AND row_count > %s",
                (BUYUK_VERI_ESIGI,),
            )
            return [r[0] for r in await cur.fetchall()]


async def _yenileyici_dongu():
    await asyncio.sleep(90)  # açılışta havuzlar otursun
    while True:
        try:
            for tid in await _buyuk_tenantlar():
                await indeksi_yenile(tid)
        except Exception as e:
            logger.warning(f"[stok_arama] yenileyici: {e}")
        await asyncio.sleep(YENILEME_ARALIGI_SN)


def start_yenileyici():
    global _yenileyici_task
    if _yenileyici_task is None or _yenileyici_task.done():
        _yenileyici_task = asyncio.get_event_loop().create_task(_yenileyici_dongu())
        logger.info("🔎 Stok arama indeksi yenileyicisi başladı (10 dk)")
