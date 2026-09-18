"""
Rapor Kullanım Kaydı → Gece Ön Yükleme (2026-09 v17)

Mobil uygulamadan çalıştırılan her rapor (dataset_key + parametreler) burada
ŞABLON olarak kaydedilir: tarih değerleri bugüne göre göreli belirteçlere
çevrilir ({TODAY}, {MONTH_START}, {DAYS_AGO:7} ...). Böylece "bu ay" raporu her
gün farklı tarihlerle çalıştırılsa da TEK şablon altında sayılır.

POS istemcisi gece tam ön yüklemede sync.php `report_prefetch_list` ile bu
tenant'ın EN ÇOK kullanılan şablonlarını alır (belirteçler o günün tarihine
çözülmüş halde), raporları çalıştırır ve dataset_cache'e basar → sabah rapor
anında açılır (backend MySQL cache HIT).

Tablo: kasacepteweb.report_usage (ilk kayıtta otomatik oluşturulur)
"""
import asyncio
import calendar
import hashlib
import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from . import get_data_pool

logger = logging.getLogger(__name__)

_TARIH_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})( \d{2}:\d{2}:\d{2})?$")
_BELIRTEC_RE = re.compile(r"^\{([A-Z_]+)(?::(\d+))?\}( \d{2}:\d{2}:\d{2})?$")
AZAMI_GUN_ONCE = 90  # {DAYS_AGO:N} için üst sınır; daha eski sabit tarihler şablonlanmaz

_tablo_hazir = False
_TABLO_SQL = """
CREATE TABLE IF NOT EXISTS report_usage (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    dataset_key VARCHAR(80) NOT NULL,
    template_hash CHAR(32) NOT NULL,
    params_template_json TEXT NOT NULL,
    hit_count INT UNSIGNED NOT NULL DEFAULT 1,
    first_used_at DATETIME NOT NULL,
    last_used_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_sablon (tenant_id, template_hash),
    KEY ix_tenant_son (tenant_id, last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


# ---------------------------------------------------------------- belirteçler
def _belirtecler(bugun: date) -> Dict[str, date]:
    ay_son = date(bugun.year, bugun.month, calendar.monthrange(bugun.year, bugun.month)[1])
    onceki_ay_son = date(bugun.year, bugun.month, 1) - timedelta(days=1)
    return {
        "TODAY": bugun,
        "YESTERDAY": bugun - timedelta(days=1),
        "MONTH_START": date(bugun.year, bugun.month, 1),
        "MONTH_END": ay_son,
        "PREV_MONTH_START": date(onceki_ay_son.year, onceki_ay_son.month, 1),
        "PREV_MONTH_END": onceki_ay_son,
        "YEAR_START": date(bugun.year, 1, 1),
        "WEEK_START": bugun - timedelta(days=bugun.weekday()),
    }


def _tarihi_belirtece(tarih: date, bugun: date) -> Optional[str]:
    for ad, deger in _belirtecler(bugun).items():
        if deger == tarih:
            return "{" + ad + "}"
    fark = (bugun - tarih).days
    if 0 < fark <= AZAMI_GUN_ONCE:
        return "{DAYS_AGO:%d}" % fark
    return None


def sablonlastir(params: Dict[str, Any], bugun: Optional[date] = None) -> Optional[Dict[str, Any]]:
    """Parametrelerdeki tarihleri göreli belirteçlere çevirir. Page=1'e sabitlenir.
    Şablonlanamayan (90 günden eski sabit) tarih varsa None döner."""
    bugun = bugun or date.today()
    out: Dict[str, Any] = {}
    for k, v in (params or {}).items():
        if k == "Page":
            out[k] = 1
            continue
        if isinstance(v, str):
            m = _TARIH_RE.match(v.strip())
            if m:
                try:
                    t = datetime.strptime(m.group(1), "%Y-%m-%d").date()
                except ValueError:
                    return None
                bel = _tarihi_belirtece(t, bugun)
                if bel is None:
                    return None
                out[k] = bel + (m.group(2) or "")
                continue
        out[k] = v
    return out


def coz(sablon: Dict[str, Any], bugun: Optional[date] = None) -> Dict[str, Any]:
    """Şablondaki belirteçleri verilen güne göre gerçek tarihlere çevirir."""
    bugun = bugun or date.today()
    tablo = _belirtecler(bugun)
    out: Dict[str, Any] = {}
    for k, v in (sablon or {}).items():
        if isinstance(v, str):
            m = _BELIRTEC_RE.match(v)
            if m:
                ad, n, saat = m.group(1), m.group(2), m.group(3) or ""
                if ad == "DAYS_AGO" and n is not None:
                    t = bugun - timedelta(days=int(n))
                elif ad in tablo:
                    t = tablo[ad]
                else:
                    out[k] = v
                    continue
                out[k] = t.strftime("%Y-%m-%d") + saat
                continue
        out[k] = v
    return out


def sablon_hash(dataset_key: str, sablon: Dict[str, Any]) -> str:
    ham = dataset_key + "|" + json.dumps(sablon, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.md5(ham.encode("utf-8")).hexdigest()


def bugunu_kapsar(params: Dict[str, Any], bugun: Optional[date] = None) -> bool:
    """Parametrelerdeki herhangi bir tarih bugün veya sonrası ise True
    (rapor sonucu gün içinde değişebilir → kısa cache ömrü)."""
    bugun = bugun or date.today()
    for v in (params or {}).values():
        if isinstance(v, str):
            m = _TARIH_RE.match(v.strip())
            if m:
                try:
                    if datetime.strptime(m.group(1), "%Y-%m-%d").date() >= bugun:
                        return True
                except ValueError:
                    continue
    return False


# ------------------------------------------------------------------ DB katmanı
async def _tabloyu_hazirla(pool) -> None:
    global _tablo_hazir
    if _tablo_hazir:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(_TABLO_SQL)
        await conn.commit()
    _tablo_hazir = True


async def kaydet(tenant_id: str, dataset_key: str, params: Dict[str, Any]) -> bool:
    """Kullanımı sayar (upsert). Hata akışı bozmaz — arka planda çağrılır."""
    try:
        sablon = sablonlastir(params)
        if sablon is None:
            return False
        h = sablon_hash(dataset_key, sablon)
        pool = await get_data_pool()
        await _tabloyu_hazirla(pool)
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Zaman damgaları DB saatiyle (NOW()) — sunucu UTC, MySQL Istanbul.
                await cur.execute(
                    """
                    INSERT INTO report_usage
                        (tenant_id, dataset_key, template_hash, params_template_json, hit_count, first_used_at, last_used_at)
                    VALUES (%s, %s, %s, %s, 1, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE hit_count = hit_count + 1, last_used_at = NOW()
                    """,
                    (tenant_id, dataset_key, h, json.dumps(sablon, ensure_ascii=False, sort_keys=True)),
                )
            await conn.commit()
        return True
    except Exception as e:
        logger.debug(f"[rapor_kullanim] kayıt başarısız {dataset_key}: {e}")
        return False


def kaydet_arka_planda(tenant_id: str, dataset_key: str, params: Dict[str, Any]) -> None:
    try:
        asyncio.get_running_loop().create_task(kaydet(tenant_id, dataset_key, params))
    except RuntimeError:
        pass


async def liste(
    tenant_id: str,
    limit: int = 10,
    min_kullanim: int = 2,
    gun_penceresi: int = 45,
    bugun: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """Tenant'ın en çok kullanılan rapor şablonları (belirteçler çözülmüş).
    Seçim: son `gun_penceresi` gün içinde kullanılmış ve (hit_count ≥ min_kullanim
    veya son 7 günde kullanılmış). sync.php'deki `report_prefetch_list` ile aynı kural."""
    pool = await get_data_pool()
    await _tabloyu_hazirla(pool)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT dataset_key, params_template_json, hit_count, last_used_at
                FROM report_usage
                WHERE tenant_id = %s
                  AND last_used_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
                  AND (hit_count >= %s OR last_used_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
                ORDER BY hit_count DESC, last_used_at DESC
                LIMIT %s
                """,
                (tenant_id, gun_penceresi, min_kullanim, limit),
            )
            satirlar = await cur.fetchall()
    out = []
    for dk, sj, hc, son in satirlar:
        try:
            sablon = json.loads(sj or "{}")
        except Exception:
            continue
        out.append({
            "dataset_key": dk,
            "template": sablon,
            "params": coz(sablon, bugun),
            "hit_count": int(hc or 0),
            "last_used_at": son.strftime("%Y-%m-%d %H:%M:%S") if isinstance(son, datetime) else str(son),
        })
    return out
