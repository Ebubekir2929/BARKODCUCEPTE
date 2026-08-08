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


async def init_patron_pool():
    global patron_pool, _patron_last_fail
    async with _patron_lock:
        if patron_pool is not None:
            return patron_pool
        if (_time.monotonic() - _patron_last_fail) < _FAIL_CACHE_SEC:
            raise RuntimeError("MySQL (patron) sunucusuna ulaşılamıyor — kısa süre önce deneme başarısız oldu")
        # 2026-08 — wait_for: MySQL sunucusu TCP kabul edip el sıkışmayı
        # yanıtlamazsa istekler sonsuza dek asılı kalmasın (net hata dönsün).
        try:
            patron_pool = await asyncio.wait_for(aiomysql.create_pool(
                host=os.environ.get('MYSQL_PATRON_HOST', '185.223.77.132'),
                port=3306,
                user=os.environ.get('MYSQL_PATRON_USER', 'patron'),
                password=os.environ.get('MYSQL_PATRON_PASS', ''),
                db=os.environ.get('MYSQL_PATRON_DB', 'patron'),
                charset='utf8',
                autocommit=True,
                minsize=1,
                maxsize=5,
                connect_timeout=10,
            ), timeout=15)
        except (asyncio.TimeoutError, OSError) as exc:
            _patron_last_fail = _time.monotonic()
            logger.error(f"patron MySQL pool init BAŞARISIZ: {exc!r}")
            raise RuntimeError("MySQL (patron) sunucusuna ulaşılamıyor") from exc
    logger.info("patron MySQL pool initialized")
    return patron_pool


async def init_data_pool():
    global data_pool, _data_last_fail
    async with _data_lock:
        if data_pool is not None:
            return data_pool
        if (_time.monotonic() - _data_last_fail) < _FAIL_CACHE_SEC:
            raise RuntimeError("MySQL (kasacepteweb) sunucusuna ulaşılamıyor — kısa süre önce deneme başarısız oldu")
        try:
            data_pool = await asyncio.wait_for(aiomysql.create_pool(
            host=os.environ.get('MYSQL_DATA_HOST', '185.223.77.132'),
            port=3306,
            user=os.environ.get('MYSQL_DATA_USER', 'kceptetransfer'),
            password=os.environ.get('MYSQL_DATA_PASS', ''),
            db=os.environ.get('MYSQL_DATA_DB', 'kasacepteweb'),
            charset='utf8mb4',
            autocommit=True,
            minsize=1,
            maxsize=5,
            connect_timeout=10,
        ), timeout=15)
        except (asyncio.TimeoutError, OSError) as exc:
            _data_last_fail = _time.monotonic()
            logger.error(f"kasacepteweb MySQL pool init BAŞARISIZ: {exc!r}")
            raise RuntimeError("MySQL (kasacepteweb) sunucusuna ulaşılamıyor") from exc
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


async def close_pools():
    global patron_pool, data_pool
    if patron_pool:
        patron_pool.close()
        await patron_pool.wait_closed()
    if data_pool:
        data_pool.close()
        await data_pool.wait_closed()
    logger.info("MySQL pools closed")
