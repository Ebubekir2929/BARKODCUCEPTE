"""Quick schema inspector for kasacepteweb DB.
Finds stock and customer tables for a given tenant."""
import asyncio
import os
import sys
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
            # 1. List all tables
            print("=" * 80)
            print("ALL TABLES in kasacepteweb")
            print("=" * 80)
            await cur.execute("SHOW TABLES")
            rows = await cur.fetchall()
            all_tables = [list(r.values())[0] for r in rows]
            for t in all_tables:
                print(f"  - {t}")

            # 2. Filter stock/cari related
            print("\n" + "=" * 80)
            print("STOCK/CARI CANDIDATES")
            print("=" * 80)
            cand = [t for t in all_tables if any(k in t.lower() for k in ['stok', 'stock', 'cari', 'customer', 'musteri', 'urun', 'product'])]
            for t in cand:
                print(f"  ▶ {t}")

            # 3. For each candidate, show columns and row count
            for t in cand:
                print(f"\n--- TABLE: {t} ---")
                await cur.execute(f"DESCRIBE `{t}`")
                cols = await cur.fetchall()
                for c in cols:
                    print(f"    {c['Field']:30s} {c['Type']:25s} {c.get('Null','')} {c.get('Key','')}")
                try:
                    await cur.execute(f"SELECT COUNT(*) as cnt FROM `{t}`")
                    cnt = (await cur.fetchone())['cnt']
                    print(f"    TOTAL ROWS: {cnt}")
                    # sample row
                    await cur.execute(f"SELECT * FROM `{t}` LIMIT 1")
                    sample = await cur.fetchone()
                    if sample:
                        print(f"    SAMPLE: {dict(list(sample.items())[:8])}")
                except Exception as e:
                    print(f"    ERROR counting: {e}")

    await close_pools()


asyncio.run(main())
