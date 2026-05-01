"""Check stok_fiyat_adlari data."""
import asyncio
import sys
import json
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')
sys.path.insert(0, str(Path(__file__).parent))

from services import init_data_pool, get_data_pool, close_pools


async def main():
    await init_data_pool()
    pool = await get_data_pool()
    import aiomysql
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # How is stok_fiyat_adlari stored?
            await cur.execute("""
                SELECT tenant_id, dataset_key, params_hash, row_count, data_json
                FROM dataset_cache
                WHERE dataset_key='stok_fiyat_adlari'
            """)
            for r in await cur.fetchall():
                print(f"{r['tenant_id'][:10]}  rc={r['row_count']}  data_json_preview={str(r['data_json'])[:500]}")

            # Check if rows are in dataset_cache_rows
            await cur.execute("""
                SELECT COUNT(*) AS cnt FROM dataset_cache_rows WHERE dataset_key='stok_fiyat_adlari' AND deleted_at IS NULL
            """)
            print(f"\nrows in dataset_cache_rows: {(await cur.fetchone())['cnt']}")

    await close_pools()

asyncio.run(main())
