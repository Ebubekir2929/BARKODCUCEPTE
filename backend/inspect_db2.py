"""Inspect dataset_cache tables which contain stock_list / cari_bakiye_liste data."""
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
            for t in ['dataset_cache', 'dataset_cache_pages', 'dataset_cache_rows', 'dataset_registry', 'firms']:
                print(f"\n{'='*80}\nTABLE: {t}\n{'='*80}")
                await cur.execute(f"DESCRIBE `{t}`")
                cols = await cur.fetchall()
                for c in cols:
                    print(f"    {c['Field']:30s} {c['Type']:30s}")

            # Show registry content
            print("\n" + "="*80)
            print("dataset_registry rows")
            print("="*80)
            await cur.execute("SELECT * FROM dataset_registry")
            regs = await cur.fetchall()
            for r in regs:
                print(f"  {r}")

            # Show dataset_cache counts per dataset_key
            print("\n" + "="*80)
            print("dataset_cache summary (counts by dataset_key/firm)")
            print("="*80)
            await cur.execute("""
                SELECT dataset_key, firm_id, total_count, total_pages, 
                       updated_at, version
                FROM dataset_cache
                ORDER BY dataset_key, firm_id
            """)
            rows = await cur.fetchall()
            for r in rows:
                print(f"  key={r.get('dataset_key')}  firm={r.get('firm_id')}  total={r.get('total_count')}  pages={r.get('total_pages')}  updated={r.get('updated_at')}")

            # Firms
            print("\n" + "="*80)
            print("firms")
            print("="*80)
            await cur.execute("SELECT * FROM firms LIMIT 20")
            for r in await cur.fetchall():
                print(f"  {r}")

            # Inspect a single stock_list cache — sample one row from dataset_cache_rows
            print("\n" + "="*80)
            print("SAMPLE stock_list data from dataset_cache_rows")
            print("="*80)
            # pick any firm that has stock_list
            await cur.execute("""
                SELECT dataset_key, firm_id, total_count 
                FROM dataset_cache 
                WHERE dataset_key='stock_list' AND total_count>0
                LIMIT 2
            """)
            stock_firms = await cur.fetchall()
            for sf in stock_firms:
                print(f"\n  firm={sf['firm_id']} total={sf['total_count']}")
                await cur.execute(
                    "SELECT * FROM dataset_cache_rows WHERE dataset_key=%s AND firm_id=%s LIMIT 2",
                    (sf['dataset_key'], sf['firm_id'])
                )
                sample = await cur.fetchall()
                for s in sample:
                    # `data` column likely JSON
                    print("   row keys:", list(s.keys()))
                    for k, v in s.items():
                        vs = str(v)[:200]
                        print(f"     {k}: {vs}")

            # Also try dataset_cache_pages
            print("\n" + "="*80)
            print("SAMPLE stock_list data from dataset_cache_pages")
            print("="*80)
            await cur.execute("""
                SELECT * FROM dataset_cache_pages
                WHERE dataset_key='stock_list'
                LIMIT 1
            """)
            pages = await cur.fetchall()
            for p in pages:
                print("   page keys:", list(p.keys()))
                for k, v in p.items():
                    vs = str(v)[:300]
                    print(f"     {k}: {vs}")

            # Cari check
            print("\n" + "="*80)
            print("SAMPLE cari_bakiye_liste row data")
            print("="*80)
            await cur.execute("""
                SELECT dataset_key, firm_id, total_count 
                FROM dataset_cache 
                WHERE dataset_key='cari_bakiye_liste' AND total_count>0
                LIMIT 2
            """)
            cari_firms = await cur.fetchall()
            for sf in cari_firms:
                print(f"\n  firm={sf['firm_id']} total={sf['total_count']}")
                await cur.execute(
                    "SELECT * FROM dataset_cache_rows WHERE dataset_key=%s AND firm_id=%s LIMIT 2",
                    (sf['dataset_key'], sf['firm_id'])
                )
                sample = await cur.fetchall()
                for s in sample:
                    print("   row keys:", list(s.keys()))
                    for k, v in s.items():
                        vs = str(v)[:200]
                        print(f"     {k}: {vs}")
    await close_pools()


asyncio.run(main())
