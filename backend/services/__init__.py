import aiomysql
import asyncio
from pymysql.err import OperationalError as _MySQLOpErr  # (2003) Can't connect — OSError DEĞİL
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


async def _mysql_greeting_ok(host: str, port: int, timeout: float = 4.0, deneme: int = 2) -> bool:
    """v20 — Sağlayıcının SYN-proxy'si bağlantıların bir kısmını rastgele düşürüyor
    (aynı anda 1 deneme 15 sn askıda, diğeri 0.3 sn'de yanıtlıyor). Tek yoklamayla
    '3306 ölü' demeyip `deneme` adet bağlantıyı PARALEL açar; biri greeting alırsa
    sağlıklı sayılır."""
    async def _bir():
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

    gorevler = [asyncio.ensure_future(_bir()) for _ in range(max(1, deneme))]
    try:
        for bitti in asyncio.as_completed(gorevler):
            if await bitti:
                return True
        return False
    finally:
        for g in gorevler:
            g.cancel()


async def _resolve_mysql_endpoint(host: str) -> tuple:
    """(host, port) döndürür: direkt 3306 sağlıklıysa onu, değilse TLS tünelini."""
    cached = _endpoint_cache.get(host)
    if cached and _time.monotonic() < cached[2]:
        return cached[0], cached[1]
    if await _mysql_greeting_ok(host, 3306):
        ep = (host, 3306)
    else:
        tls_port = int(os.environ.get('MYSQL_TLS_PORT', '0') or 0)
        tls_host = os.environ.get('MYSQL_TLS_HOST', host)
        # v20 — Tünel hedefi (3308) de kapalıysa tünele bağlanmak anlamsız; 5 dk
        # boyunca ölü tünelde takılı kalıyorduk (3306 toparlansa bile). Bu durumda
        # direkt 3306'ya dön ve kararı ÖNBELLEĞE ALMA → sonraki deneme yeniden yoklar.
        if tls_port and await _tcp_acik(tls_host, tls_port):
            from .tls_tunnel import ensure_tunnel, LOCAL_TUNNEL_PORT
            await ensure_tunnel(tls_host, tls_port)
            logger.warning(f"MySQL direkt 3306 erişilemiyor — TLS tüneli kullanılıyor ({host})")
            ep = ('127.0.0.1', LOCAL_TUNNEL_PORT)
        else:
            logger.warning(f"MySQL 3306 ve TLS {tls_port} şu an yanıt vermiyor — direkt 3306 deneniyor, karar önbelleğe alınmadı ({host})")
            return (host, 3306)
    _endpoint_cache[host] = (ep[0], ep[1], _time.monotonic() + _ENDPOINT_TTL_SEC)
    return ep


async def _tcp_acik(host: str, port: int, timeout: float = 4.0) -> bool:
    try:
        _, w = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        w.close()
        return True
    except Exception:
        return False


def _endpoint_unut(host: str) -> None:
    """Havuz açılamadıysa endpoint kararını unut → sonraki deneme yeniden yoklar."""
    _endpoint_cache.pop(host, None)


async def _havuz_ac(host_env: str, deneme: int = 2, **pool_kw):
    """v20 — Havuzu açar. Sağlayıcı el sıkışmaların bir kısmını rastgele düşürdüğü
    için `deneme` adet create_pool PARALEL yarışır; ilk başaran kalır, diğerleri
    kapatılır. Hepsi düşerse endpoint kararı unutulur ve hata fırlatılır."""
    host = os.environ.get(host_env, '185.223.77.132')
    h, p = await _resolve_mysql_endpoint(host)

    async def _bir():
        return await asyncio.wait_for(
            aiomysql.create_pool(host=h, port=p, autocommit=True, minsize=1,
                                 pool_recycle=280, connect_timeout=12, **pool_kw),
            timeout=16)  # v20 — IO yükü altındaki sunucuda el sıkışma 5 sn'yi aşabiliyor

    gorevler = [asyncio.ensure_future(_bir()) for _ in range(max(1, deneme))]
    kazanan = None
    son_hata: Exception = asyncio.TimeoutError()
    try:
        for bitti in asyncio.as_completed(gorevler):
            try:
                kazanan = await bitti
                break
            except (asyncio.TimeoutError, OSError, _MySQLOpErr) as exc:
                son_hata = exc
    finally:
        for g in gorevler:
            if g.done() and not g.cancelled() and g.exception() is None and g.result() is not kazanan:
                g.result().close()  # fazladan açılan havuz
            elif not g.done():
                g.cancel()
    if kazanan is None:
        _endpoint_unut(host)
        raise son_hata
    return kazanan


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
            patron_pool = await _havuz_ac(
                'MYSQL_PATRON_HOST',
                user=os.environ.get('MYSQL_PATRON_USER', 'patron'),
                password=os.environ.get('MYSQL_PATRON_PASS', ''),
                db=os.environ.get('MYSQL_PATRON_DB', 'patron'),
                charset='utf8',
                maxsize=10,
            )
        except (asyncio.TimeoutError, OSError, _MySQLOpErr) as exc:
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
            data_pool = await _havuz_ac(
                'MYSQL_DATA_HOST',
                user=os.environ.get('MYSQL_DATA_USER', 'kceptetransfer'),
                password=os.environ.get('MYSQL_DATA_PASS', ''),
                db=os.environ.get('MYSQL_DATA_DB', 'kasacepteweb'),
                charset='utf8mb4',
                maxsize=15,
            )
        except (asyncio.TimeoutError, OSError, _MySQLOpErr) as exc:
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
    """v18 — Kapanış askıda kalmasın: meşgul bağlantı (yarım kalan SSCursor akışı,
    arka plan görevi) varsa wait_closed sonsuza dek bekliyordu → uvicorn reload /
    Railway SIGTERM'de "Waiting for application shutdown" takılması. 3 sn içinde
    kapanmayan havuz terminate() ile zorla kapatılır."""
    global patron_pool, data_pool
    for ad in ("patron_pool", "data_pool"):
        havuz = globals().get(ad)
        if not havuz:
            continue
        try:
            havuz.close()
            await asyncio.wait_for(havuz.wait_closed(), timeout=3)
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning(f"[close_pools] {ad} 3 sn'de kapanmadı ({type(e).__name__}) — terminate")
            try:
                havuz.terminate()
                await asyncio.wait_for(havuz.wait_closed(), timeout=2)
            except Exception:
                pass
        globals()[ad] = None
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
