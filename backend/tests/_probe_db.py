import asyncio, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
from services import get_data_pool, get_patron_pool

TID = 'd5587c87a7f9476fa82b83f40accd6c7'

async def main():
    pool = await (get_patron_pool() if os.environ.get("PATRON") else get_data_pool())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for sql in sys.argv[1:]:
                await cur.execute(sql.replace('{TID}', TID))
                for r in await cur.fetchall():
                    print(r)
                print('---')

asyncio.run(main())
