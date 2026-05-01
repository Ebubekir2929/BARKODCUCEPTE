"""Check how report results are stored in dataset_cache."""
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
            # 1. Is result_cache_id used? Check non-null
            await cur.execute("""
                SELECT id, dataset_key, request_uid, result_cache_id, status
                FROM sync_requests
                WHERE dataset_key LIKE 'rap_%' AND status='done' AND result_cache_id IS NOT NULL
                ORDER BY id DESC LIMIT 5
            """)
            reports = await cur.fetchall()
            for r in reports:
                print(f"  req_id={r['id']}  key={r['dataset_key']}  rcid={r['result_cache_id']}  uid={r['request_uid']}")
                # Look for the dataset_cache entry
                await cur.execute("SELECT * FROM dataset_cache WHERE id=%s", (r['result_cache_id'],))
                dc = await cur.fetchone()
                if dc:
                    print(f"    -> dataset_cache: key={dc['dataset_key']}  params_hash={dc['params_hash']}  row_count={dc['row_count']}  params_preview={str(dc['params_json'])[:100]}")
                    print(f"    -> data_json preview: {str(dc['data_json'])[:300]}")
                else:
                    print(f"    (not in dataset_cache)")

            # Are there chunk entries for these?
            print("\n=== Checking chunks for latest reports ===")
            for r in reports[:2]:
                await cur.execute("SELECT COUNT(*) AS cnt FROM sync_request_result_chunks WHERE request_uid=%s", (r['request_uid'],))
                print(f"  req_id={r['id']} uid={r['request_uid']}: {(await cur.fetchone())['cnt']} chunks")

            # Check a cari_hesap_ekstresi specifically
            print("\n=== rap_cari_hesap_ekstresi_web cache ===")
            await cur.execute("""
                SELECT tenant_id, params_json, row_count, synced_at, LEFT(data_json, 400) as preview
                FROM dataset_cache
                WHERE dataset_key='rap_cari_hesap_ekstresi_web'
                ORDER BY synced_at DESC LIMIT 3
            """)
            for r in await cur.fetchall():
                print(f"  tenant={r['tenant_id'][:10]}  rows={r['row_count']}  synced={r['synced_at']}")
                print(f"    params: {r['params_json']}")
                print(f"    preview: {r['preview']}")

    await close_pools()

asyncio.run(main())
