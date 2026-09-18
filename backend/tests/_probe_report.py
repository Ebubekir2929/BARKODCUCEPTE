"""Rapor zinciri zamanlayıcı: her sync.php çağrısını ve MySQL cache adımını ölçer."""
import asyncio, sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
import routes.data as d

TID = sys.argv[1] if len(sys.argv) > 1 else 'b9f4d960e43f462d9b77915577add71a'
KEY = sys.argv[2] if len(sys.argv) > 2 else 'rap_satis_adet_kar_web'
BAS = sys.argv[3] if len(sys.argv) > 3 else '2026-09-01'
BIT = sys.argv[4] if len(sys.argv) > 4 else '2026-09-15'

_orig_sync = d.sync_post
_calls = []
async def timed_sync(payload, tenant_id):
    t = time.time()
    act = payload.get('action')
    try:
        r = await _orig_sync(dict(payload), tenant_id)
        st = r.get('status') if isinstance(r, dict) else None
        n = len(r.get('data') or []) if isinstance(r, dict) and isinstance(r.get('data'), list) else (len((r.get('cache') or {}).get('data') or []) if isinstance(r, dict) and isinstance(r.get('cache'), dict) else '-')
        _calls.append((act, st, round(time.time()-t, 2)))
        print(f"  sync {act:16s} {str(st or ''):8s} rows={n} {time.time()-t:.2f}s  page={payload.get('params',{}).get('Page') if isinstance(payload.get('params'),dict) else ''}", flush=True)
        return r
    except Exception as e:
        _calls.append((act, 'EXC', round(time.time()-t, 2)))
        print(f"  sync {act} EXC {e} {time.time()-t:.2f}s", flush=True)
        raise
d.sync_post = timed_sync

for name in ('lookup_cached_report', 'lookup_rows_dataset'):
    _o = getattr(d, name)
    async def _mk(_o=_o, name=name):
        async def w(*a, **k):
            t = time.time()
            r = await _o(*a, **k)
            hit = bool(r and (r.get('data') if isinstance(r, dict) else r))
            print(f"  {name} hit={hit} {time.time()-t:.2f}s", flush=True)
            return r
        return w
    setattr(d, name, asyncio.get_event_loop().run_until_complete(_mk()))

PARAMS = {
    'rap_satis_adet_kar_web': {"BASTARIH": BAS + " 00:00:00", "BITTARIH": BIT + " 23:59:59", "KdvDahil": 1, "FisTipi": 0, "Pc_Ad": "", "Lokasyon": "75919", "MaliyetYoksaSatisGelsin": 0, "SarfFireGelmesin": 0, "Page": 1, "PageSize": 500,
                               "Stoklar": "", "StokGrup": "", "StokCinsi": "", "StokMarka": "", "StokVergi": "", "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "", "StokOzelKod5": "", "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": ""},
}

async def main():
    params = PARAMS.get(KEY, {"BASTARIH": BAS, "BITTARIH": BIT, "Page": 1, "PageSize": 500})
    body = {"tenant_id": TID, "dataset_key": KEY, "params": params, "fetch_all": True, "force_refresh": bool(os.environ.get("FORCE"))}
    t = time.time()
    try:
        res = await d.run_report(body, current_user={"user_id": 0})
        print(f"TOPLAM {time.time()-t:.1f}s rows={len(res.get('data') or [])} pages={res.get('pages')} cache={res.get('_cache')} src={res.get('_source')}")
    except Exception as e:
        print(f"HATA {time.time()-t:.1f}s {e!r}")
    from collections import Counter
    c = Counter(a for a, _, _ in _calls)
    print("çağrı sayıları:", dict(c), "toplam sync süresi:", round(sum(x for _, _, x in _calls), 1))

asyncio.get_event_loop().run_until_complete(asyncio.wait_for(main(), 280))
