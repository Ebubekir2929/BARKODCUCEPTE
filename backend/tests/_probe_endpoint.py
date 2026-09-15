import asyncio, sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
import routes.data as d

TID = sys.argv[1] if len(sys.argv) > 1 else 'b9f4d960e43f462d9b77915577add71a'
SD = sys.argv[2] if len(sys.argv) > 2 else '2026-09-01'
ED = sys.argv[3] if len(sys.argv) > 3 else '2026-09-15'

_orig = d.fetch_dataset
async def timed(pool, tenant_id, key, fd=None):
    t = time.time()
    r = await _orig(pool, tenant_id, key, fd)
    print(f"  fetch_dataset {key} {fd} -> {len(r.get('data') or [])} satır {time.time()-t:.2f}s", flush=True)
    return r
d.fetch_dataset = timed

_orig_stream = d.stream_rows
async def timed_stream(pool, sql, params=None, chunk=1000):
    t = time.time(); n = 0
    async for r in _orig_stream(pool, sql, params, chunk):
        n += 1
        yield r
    print(f"  stream_rows {n} satır {time.time()-t:.2f}s", flush=True)
d.stream_rows = timed_stream

async def main():
    t = time.time()
    res = await d.get_dashboard_data(tenant_id=TID, sdate=SD, edate=ED, current_user={"user_id": 0})
    print(f"TOPLAM {time.time()-t:.1f}s")
    fl = res['financial_data_location']['data']
    print("loc rows:", len(fl), [(r.get('LOKASYON'), r.get('GENELTOPLAM'), r.get('NAKIT'), r.get('KREDI_KARTI')) for r in fl])
    print("last_week:", res.get('last_week', {}).get('total'), "all_locations:", res.get('all_locations'))

asyncio.run(asyncio.wait_for(main(), 270))
