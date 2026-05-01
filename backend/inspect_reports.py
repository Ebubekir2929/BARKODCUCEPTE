"""Inspect sync_requests and sync_request_result_chunks for reports."""
import asyncio, sys, json
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
            print("=== sync_requests schema ===")
            await cur.execute("DESCRIBE sync_requests")
            for c in await cur.fetchall():
                print(f"  {c['Field']:30s} {c['Type']}")

            print("\n=== sync_request_result_chunks schema ===")
            await cur.execute("DESCRIBE sync_request_result_chunks")
            for c in await cur.fetchall():
                print(f"  {c['Field']:30s} {c['Type']}")

            print("\n=== Recent sync_requests (last 20) ===")
            await cur.execute("""
                SELECT id, tenant_id, request_uid, dataset_key, status,
                       created_at, finished_at, params_json, result_cache_id
                FROM sync_requests
                ORDER BY id DESC LIMIT 20
            """)
            for r in await cur.fetchall():
                print(f"  id={r['id']}  tenant={r['tenant_id'][:10]}  key={r['dataset_key']}  status={r['status']}  rcid={r.get('result_cache_id')}  params={str(r.get('params_json'))[:80]}")

            # Count by dataset_key
            print("\n=== Count per dataset_key ===")
            await cur.execute("""
                SELECT dataset_key, COUNT(*) as cnt, MAX(created_at) as last
                FROM sync_requests GROUP BY dataset_key ORDER BY cnt DESC LIMIT 30
            """)
            for r in await cur.fetchall():
                print(f"  {r['dataset_key']:40s}  cnt={r['cnt']}  last={r['last']}")

            # Sample result chunk
            print("\n=== Sample result chunk for latest report ===")
            await cur.execute("""
                SELECT id, request_uid, dataset_key, tenant_id
                FROM sync_requests
                WHERE status='done' AND dataset_key LIKE 'rap_%'
                ORDER BY id DESC LIMIT 2
            """)
            for r in await cur.fetchall():
                print(f"\n  REQUEST: id={r['id']} key={r['dataset_key']} uid={r['request_uid']}")
                await cur.execute("""
                    SELECT part_no, total_parts, LENGTH(chunk_text) as len,
                           LEFT(chunk_text, 400) as preview
                    FROM sync_request_result_chunks
                    WHERE request_uid=%s
                    ORDER BY part_no
                    LIMIT 3
                """, (r['request_uid'],))
                for chk in await cur.fetchall():
                    print(f"    part={chk['part_no']}/{chk['total_parts']}  len={chk['len']}")
                    print(f"    preview: {chk['preview']}")

    await close_pools()

asyncio.run(main())
