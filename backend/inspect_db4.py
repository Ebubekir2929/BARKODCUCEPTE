"""Check params_hash variations and ensure query strategy."""
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
            # 1. Check if multiple params_hash exist per tenant+dataset
            print("="*80)
            print("dataset_cache - all entries grouped by (tenant,dataset)")
            print("="*80)
            await cur.execute("""
                SELECT tenant_id, dataset_key, params_hash, params_json, row_count, synced_at
                FROM dataset_cache
                WHERE dataset_key IN ('stock_list','cari_bakiye_liste')
                ORDER BY dataset_key, tenant_id, synced_at DESC
            """)
            for r in await cur.fetchall():
                print(f"  {r['dataset_key']}  tenant={r['tenant_id'][:10]}...  params_hash={r['params_hash']}  params={r['params_json']}  rows={r['row_count']}  synced={r['synced_at']}")

            # 2. Check all distinct params_hash in dataset_cache_rows for stock_list
            print("\n" + "="*80)
            print("dataset_cache_rows - distinct params_hash per tenant+dataset")
            print("="*80)
            await cur.execute("""
                SELECT tenant_id, dataset_key, params_hash, COUNT(*) as cnt
                FROM dataset_cache_rows
                WHERE dataset_key IN ('stock_list','cari_bakiye_liste') AND deleted_at IS NULL
                GROUP BY tenant_id, dataset_key, params_hash
            """)
            for r in await cur.fetchall():
                print(f"  {r['dataset_key']}  tenant={r['tenant_id'][:10]}...  params_hash={r['params_hash']}  cnt={r['cnt']}")

            # 3. Check indices on the rows table
            print("\n" + "="*80)
            print("dataset_cache_rows indices")
            print("="*80)
            await cur.execute("SHOW INDEX FROM dataset_cache_rows")
            for r in await cur.fetchall():
                print(f"  {r.get('Key_name')}  col={r.get('Column_name')}  seq={r.get('Seq_in_index')}  unique={r.get('Non_unique')==0}")

            # 4. Test a typical query speed: WHERE tenant+dataset, with JSON_EXTRACT filter
            print("\n" + "="*80)
            print("Speed test: fetch first 50 stock rows for Gümüşhane")
            print("="*80)
            import time
            gumus = '4d9b503a96f5430aad34c430301a8aa1'
            t0 = time.time()
            await cur.execute("""
                SELECT row_json FROM dataset_cache_rows
                WHERE tenant_id=%s AND dataset_key='stock_list' AND deleted_at IS NULL
                ORDER BY id ASC LIMIT 50
            """, (gumus,))
            rows = await cur.fetchall()
            print(f"  Got {len(rows)} rows in {(time.time()-t0)*1000:.1f}ms")

            # 5. Test JSON filter speed
            t0 = time.time()
            await cur.execute("""
                SELECT COUNT(*) AS cnt FROM dataset_cache_rows
                WHERE tenant_id=%s AND dataset_key='stock_list' AND deleted_at IS NULL
                  AND JSON_EXTRACT(row_json, '$.STOK_GRUP') = 'GENEL'
            """, (gumus,))
            cnt = (await cur.fetchone())['cnt']
            print(f"  JSON filter STOK_GRUP='GENEL' -> {cnt} rows in {(time.time()-t0)*1000:.1f}ms")

            # 6. Test search query speed
            t0 = time.time()
            await cur.execute("""
                SELECT COUNT(*) AS cnt FROM dataset_cache_rows
                WHERE tenant_id=%s AND dataset_key='stock_list' AND deleted_at IS NULL
                  AND (row_json LIKE %s)
            """, (gumus, '%BORU%'))
            cnt = (await cur.fetchone())['cnt']
            print(f"  LIKE search '%BORU%' -> {cnt} rows in {(time.time()-t0)*1000:.1f}ms")

            # 7. Check distinct STOK_GRUP values for the Gümüşhane tenant
            t0 = time.time()
            await cur.execute("""
                SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(row_json, '$.STOK_GRUP')) AS grp
                FROM dataset_cache_rows
                WHERE tenant_id=%s AND dataset_key='stock_list' AND deleted_at IS NULL
            """, (gumus,))
            groups = [r['grp'] for r in await cur.fetchall()]
            print(f"  {len(groups)} distinct STOK_GRUP (ms={(time.time()-t0)*1000:.1f}): {groups[:10]}")

    await close_pools()


asyncio.run(main())
