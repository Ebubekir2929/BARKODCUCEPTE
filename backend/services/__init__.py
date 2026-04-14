import aiomysql
import os
import logging
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / '.env')
logger = logging.getLogger(__name__)

# Connection pools
patron_pool = None
data_pool = None


async def init_patron_pool():
    global patron_pool
    patron_pool = await aiomysql.create_pool(
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
    )
    logger.info("patron MySQL pool initialized")
    return patron_pool


async def init_data_pool():
    global data_pool
    data_pool = await aiomysql.create_pool(
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
    )
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
