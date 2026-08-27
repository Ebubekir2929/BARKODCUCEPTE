import aiomysql
import asyncio
import os
import logging
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / '.env')
logger = logging.getLogger(__name__)

# Connection pools
patron_pool = None
data_pool = None
# 2026-08 — Eşzamanlı init yarışını ve yarım kalan init'i önlemek için kilitler
_patron_lock = asyncio.Lock()
_data_lock = asyncio.Lock()
# Devre kesici: son init denemesi kısa süre önce başarısız olduysa hemen hata ver
# (watcher'lar + istekler kilitte sıraya girip 15'er sn beklemesin).
import time as _time
_FAIL_CACHE_SEC = 20
_patron_last_fail = 0.0
_data_last_fail = 0.0


class DBUnreachableError(RuntimeError):
    """MySQL sunucusuna ulaşılamadığında fırlatılır (503 handler yakalar)."""


# ── 2026-06 — B Planı: direkt 3306 engelliyse otomatik TLS tüneli ──
# Sağlayıcının SYN-proxy'si TCP'yi kabul edip MySQL greeting'i düşürüyor;
# bu yüzden probe TCP connect ile yetinmez, greeting baytını da bekler.
_endpoint_cache: dict = {}  # host -> (host, port, expires_monotonic)
_ENDPOINT_TTL_SEC = 300


async def _mysql_greeting_ok(host: str, port: int, timeout: float = 4.0) -> bool:
    try:
        r, w = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        try:
            data = await asyncio.wait_for(r.read(5), timeout)
            # MySQL greeting: payload[0] = protokol sürümü (0x0a). Hata paketi
            # (örn. ER_HOST_IS_BLOCKED) 0xFF ile başlar → sağlıklı DEĞİL.
            return len(data) >= 5 and data[4] != 0xFF
        finally:
            w.close()
    except Exception:
        return False


async def _resolve_mysql_endpoint(host: str) -> tuple:
    """(host, port) döndürür: direkt 3306 sağlıklıysa onu, değilse TLS tünelini."""
    cached = _endpoint_cache.get(host)
    if cached and _time.monotonic() < cached[2]:
        return cached[0], cached[1]
    if await _mysql_greeting_ok(host, 3306):
        ep = (host, 3306)
    else:
        tls_port = int(os.environ.get('MYSQL_TLS_PORT', '0') or 0)
        if tls_port:
            from .tls_tunnel import ensure_tunnel, LOCAL_TUNNEL_PORT
            await ensure_tunnel(os.environ.get('MYSQL_TLS_HOST', host), tls_port)
            logger.warning(f"MySQL direkt 3306 erişilemiyor — TLS tüneli kullanılıyor ({host})")
            ep = ('127.0.0.1', LOCAL_TUNNEL_PORT)
        else:
            ep = (host, 3306)
    _endpoint_cache[host] = (ep[0], ep[1], _time.monotonic() + _ENDPOINT_TTL_SEC)
    return ep


async def init_patron_pool():
    global patron_pool, _patron_last_fail
    async with _patron_lock:
        if patron_pool is not None:
            return patron_pool
        if (_time.monotonic() - _patron_last_fail) < _FAIL_CACHE_SEC:
            raise DBUnreachableError("MySQL (patron) sunucusuna ulaşılamıyor — kısa süre önce deneme başarısız oldu")
        # 2026-08 — wait_for: MySQL sunucusu TCP kabul edip el sıkışmayı
        # yanıtlamazsa istekler sonsuza dek asılı kalmasın (net hata dönsün).
        try:
            _p_host, _p_port = await _resolve_mysql_endpoint(
                os.environ.get('MYSQL_PATRON_HOST', '185.223.77.132'))
            patron_pool = await asyncio.wait_for(aiomysql.create_pool(
                host=_p_host,
                port=_p_port,
                user=os.environ.get('MYSQL_PATRON_USER', 'patron'),
                password=os.environ.get('MYSQL_PATRON_PASS', ''),
                db=os.environ.get('MYSQL_PATRON_DB', 'patron'),
                charset='utf8',
                autocommit=True,
                minsize=1,
                maxsize=10,
                pool_recycle=280,
                connect_timeout=5,
            ), timeout=8)
        except (asyncio.TimeoutError, OSError) as exc:
            _patron_last_fail = _time.monotonic()
            logger.error(f"patron MySQL pool init BAŞARISIZ: {exc!r}")
            raise DBUnreachableError("MySQL (patron) sunucusuna ulaşılamıyor") from exc
    logger.info("patron MySQL pool initialized")
    return patron_pool


async def init_data_pool():
    global data_pool, _data_last_fail
    async with _data_lock:
        if data_pool is not None:
            return data_pool
        if (_time.monotonic() - _data_last_fail) < _FAIL_CACHE_SEC:
            raise DBUnreachableError("MySQL (kasacepteweb) sunucusuna ulaşılamıyor — kısa süre önce deneme başarısız oldu")
        try:
            _d_host, _d_port = await _resolve_mysql_endpoint(
                os.environ.get('MYSQL_DATA_HOST', '185.223.77.132'))
            data_pool = await asyncio.wait_for(aiomysql.create_pool(
            host=_d_host,
            port=_d_port,
            user=os.environ.get('MYSQL_DATA_USER', 'kceptetransfer'),
            password=os.environ.get('MYSQL_DATA_PASS', ''),
            db=os.environ.get('MYSQL_DATA_DB', 'kasacepteweb'),
            charset='utf8mb4',
            autocommit=True,
            minsize=1,
            maxsize=15,
            pool_recycle=280,
            connect_timeout=5,
        ), timeout=8)
        except (asyncio.TimeoutError, OSError) as exc:
            _data_last_fail = _time.monotonic()
            logger.error(f"kasacepteweb MySQL pool init BAŞARISIZ: {exc!r}")
            raise DBUnreachableError("MySQL (kasacepteweb) sunucusuna ulaşılamıyor") from exc
    logger.info("kasacepteweb MySQL pool initialized")
    return data_pool


async def get_patron_pool():
    global patron_pool
    if patron_pool is None:
        await init_patron_pool()
    return patron_pool


async def get_data_pool():
    global data_pool
    if data_pool is None:
        await init_data_pool()
    return data_pool


async def stream_rows(pool, sql: str, params=None, chunk: int = 1000):
    """2026-08 v13-buffer-fix — Satırları SSCursor (sunucu taraflı, TAMPONSUZ)
    ile akış halinde döndürür.

    Normal aiomysql Cursor'ı TÜM sonuç kümesini execute() anında RAM'e okur
    (connection.py okuma tamponu) — fetchmany kullanılsa bile. Büyük rapor
    bloblarında bu yüzlerce MB tampon demek → Railway OOM. SSCursor satırları
    sunucudan parça parça çeker; bellek düz kalır.

    NOT: Döngüden erken çıkılacaksa (break/return) çağıran taraf
    `contextlib.aclosing` ile sarmalıdır — cursor kalan satırları drenajlar.
    """
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.SSCursor) as cur:
            await cur.execute(sql, params or ())
            while True:
                batch = await cur.fetchmany(chunk)
                if not batch:
                    break
                for row in batch:
                    yield row


async def close_pools():
    global patron_pool, data_pool
    if patron_pool:
        patron_pool.close()
        await patron_pool.wait_closed()
    if data_pool:
        data_pool.close()
        await data_pool.wait_closed()
    logger.info("MySQL pools closed")


async def _havuz_bekcisi():
    """2026-08 — BAĞLANTI BEKÇİSİ (canlıdaki login askıda kalma sorunu).

    Endpoint kararı (direkt 3306 vs TLS tüneli) yalnızca AÇILIŞTA veriliyordu.
    Hosting'in DDoS koruması çalışma SIRASINDA direkt 3306'yı bloklarsa mevcut
    havuz bağlantıları sonsuza dek askıda kalıyor, login/tüm sorgular zaman
    aşımına uğruyordu (Railway'de yaşandı: tunel_aktif=False, login 45s+ askı).

    Her 60 sn'de havuzlara SELECT 1 atılır (8 sn sınır). Üst üste 2 başarısızlıkta
    havuz kapatılır ve endpoint önbelleği temizlenir → bir sonraki istek probe'u
    yeniden çalıştırır; 3306 bloksa TLS tüneline otomatik düşer.
    """
    global patron_pool, data_pool
    hata = {"patron": 0, "data": 0}
    while True:
        await asyncio.sleep(60)
        for ad in ("patron", "data"):
            pool = patron_pool if ad == "patron" else data_pool
            if pool is None:
                continue
            try:
                async def _ping(p=pool):
                    async with p.acquire() as conn:
                        async with conn.cursor() as cur:
                            await cur.execute("SELECT 1")
                            await cur.fetchone()
                await asyncio.wait_for(_ping(), timeout=8)
                hata[ad] = 0
            except Exception as exc:
                hata[ad] += 1
                logger.error(f"[havuz_bekcisi] {ad} ping hatası #{hata[ad]}: {exc!r}")
                if hata[ad] >= 2:
                    logger.error(f"[havuz_bekcisi] {ad} havuzu SIFIRLANIYOR — endpoint yeniden çözülecek (gerekirse TLS tüneli)")
                    _endpoint_cache.clear()
                    try:
                        pool.close()
                    except Exception:
                        pass
                    if ad == "patron":
                        patron_pool = None
                    else:
                        data_pool = None
                    hata[ad] = 0


_bekci_task = None


def start_havuz_bekcisi():
    global _bekci_task
    if _bekci_task is None or _bekci_task.done():
        _bekci_task = asyncio.get_event_loop().create_task(_havuz_bekcisi())
        logger.info("🔌 Havuz bekçisi başladı (60 sn'de bir MySQL ping, 2 hatada endpoint yeniden çözümü)")
