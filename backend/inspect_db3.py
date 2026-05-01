"""Detailed schema inspection - fixing column names."""
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
            # Check cache counts per tenant+dataset
            print("="*80)
            print("dataset_cache counts")
            print("="*80)
            await cur.execute("""
                SELECT tenant_id, dataset_key, params_json, row_count, 
                       revision_no, synced_at, updated_at
                FROM dataset_cache
                WHERE dataset_key IN ('stock_list','cari_bakiye_liste','stok_fiyat_adlari')
                ORDER BY dataset_key, tenant_id
            """)
            for r in await cur.fetchall():
                print(f"  key={r['dataset_key']}  tenant={r['tenant_id']}  row_count={r['row_count']}  rev={r['revision_no']}  synced={r['synced_at']}  params={r['params_json']}")

            # Check dataset_cache_pages for stock_list
            print("\n" + "="*80)
            print("dataset_cache_pages - stock_list")
            print("="*80)
            await cur.execute("""
                SELECT tenant_id, dataset_key, params_hash, COUNT(*) as pages, SUM(row_count) as total_rows
                FROM dataset_cache_pages
                WHERE dataset_key IN ('stock_list','cari_bakiye_liste')
                GROUP BY tenant_id, dataset_key, params_hash
            """)
            for r in await cur.fetchall():
                print(f"  key={r['dataset_key']}  tenant={r['tenant_id']}  pages={r['pages']}  total_rows={r['total_rows']}  params_hash={r['params_hash']}")

            # dataset_cache_rows for stock_list
            print("\n" + "="*80)
            print("dataset_cache_rows - counts")
            print("="*80)
            await cur.execute("""
                SELECT tenant_id, dataset_key, COUNT(*) as cnt
                FROM dataset_cache_rows
                WHERE dataset_key IN ('stock_list','cari_bakiye_liste')
                  AND deleted_at IS NULL
                GROUP BY tenant_id, dataset_key
            """)
            for r in await cur.fetchall():
                print(f"  key={r['dataset_key']}  tenant={r['tenant_id']}  cnt={r['cnt']}")

            # Sample a stock_list row_json
            print("\n" + "="*80)
            print("SAMPLE stock_list row_json (first 3)")
            print("="*80)
            await cur.execute("""
                SELECT row_json FROM dataset_cache_rows
                WHERE dataset_key='stock_list' AND deleted_at IS NULL
                LIMIT 3
            """)
            for r in await cur.fetchall():
                try:
                    obj = json.loads(r['row_json'])
                    print(f"  KEYS: {list(obj.keys())}")
                    print(f"  SAMPLE: {json.dumps(obj, ensure_ascii=False)[:400]}")
                except Exception as e:
                    print(f"  ERR: {e} raw={r['row_json'][:200]}")

            # Sample a cari row_json
            print("\n" + "="*80)
            print("SAMPLE cari_bakiye_liste row_json (first 3)")
            print("="*80)
            await cur.execute("""
                SELECT row_json FROM dataset_cache_rows
                WHERE dataset_key='cari_bakiye_liste' AND deleted_at IS NULL
                LIMIT 3
            """)
            for r in await cur.fetchall():
                try:
                    obj = json.loads(r['row_json'])
                    print(f"  KEYS: {list(obj.keys())}")
                    print(f"  SAMPLE: {json.dumps(obj, ensure_ascii=False)[:400]}")
                except Exception as e:
                    print(f"  ERR: {e}")

            # Check DISTINCT STOK_GRUP values for a tenant (Gümüşhane = 4d9b503a96f5430aad34c430301a8aa1)
            print("\n" + "="*80)
            print("Sample STOK_GRUP, KDV values (Gümüşhane)")
            print("="*80)
            gumus = '4d9b503a96f5430aad34c430301a8aa1'
            merkez = 'd5587c87a7f9476fa82b83f40accd6c7'
            for tn, tid in [('Gümüşhane', gumus), ('Merkez', merkez)]:
                await cur.execute("""
                    SELECT COUNT(*) as cnt FROM dataset_cache_rows
                    WHERE dataset_key='stock_list' AND tenant_id=%s AND deleted_at IS NULL
                """, (tid,))
                c = (await cur.fetchone())['cnt']
                print(f"  {tn} ({tid}): {c} stock rows")
                await cur.execute("""
                    SELECT COUNT(*) as cnt FROM dataset_cache_rows
                    WHERE dataset_key='cari_bakiye_liste' AND tenant_id=%s AND deleted_at IS NULL
                """, (tid,))
                c = (await cur.fetchone())['cnt']
                print(f"  {tn} ({tid}): {c} cari rows")

    await close_pools()


asyncio.run(main())
