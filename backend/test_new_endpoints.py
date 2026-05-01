"""Quick end-to-end test of the refactored stock-list/cari-list endpoints."""
import asyncio
import httpx
import time
import json

BASE = "http://localhost:8001/api"

async def login():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE}/auth/login", json={
            "email": "cakmak_ebubekir@hotmail.com",
            "password": "admin",
        })
        r.raise_for_status()
        d = r.json()
        return d.get("access_token")

async def list_tenants(token):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {token}"})
        return r.json()

async def stock_list(token, tenant_id, page=1, force=False, **filters):
    async with httpx.AsyncClient(timeout=60) as c:
        payload = {
            "tenant_id": tenant_id,
            "fiyat_ad": 0,
            "page": page,
            "page_size": 200,
            "force_refresh": force,
            **filters,
        }
        r = await c.post(f"{BASE}/data/stock-list", headers={"Authorization": f"Bearer {token}"}, json=payload)
        r.raise_for_status()
        return r.json()

async def cari_list(token, tenant_id, page=1, force=False, **filters):
    async with httpx.AsyncClient(timeout=60) as c:
        payload = {"tenant_id": tenant_id, "page": page, "page_size": 200, "force_refresh": force, **filters}
        r = await c.post(f"{BASE}/data/cari-list", headers={"Authorization": f"Bearer {token}"}, json=payload)
        r.raise_for_status()
        return r.json()

async def fiyat_names(token, tenant_id):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE}/data/stock-price-names", headers={"Authorization": f"Bearer {token}"}, json={"tenant_id": tenant_id})
        r.raise_for_status()
        return r.json()

async def main():
    print("Logging in...")
    token = await login()
    print(f"  token={token[:30]}...")

    me = await list_tenants(token)
    tenants = me.get("tenants", [])
    print(f"\nTenants: {tenants}")

    gumus = "4d9b503a96f5430aad34c430301a8aa1"
    merkez = "d5587c87a7f9476fa82b83f40accd6c7"

    print("\n=== FIYAT ADLARI ===")
    for name, tid in [("Gümüşhane", gumus), ("Merkez", merkez)]:
        t0 = time.time()
        r = await fiyat_names(token, tid)
        elapsed = (time.time() - t0) * 1000
        print(f"  {name}: {len(r.get('data', []))} fiyat adı  ({elapsed:.0f}ms)")
        for f in (r.get("data") or [])[:3]:
            print(f"    - {f}")

    print("\n=== STOCK-LIST (page 1) — cold load ===")
    for name, tid in [("Gümüşhane", gumus), ("Merkez", merkez)]:
        t0 = time.time()
        r = await stock_list(token, tid, page=1)
        elapsed = (time.time() - t0) * 1000
        print(f"  {name}: total={r.get('total_count')}  pages={r.get('total_pages')}  returned={len(r.get('data',[]))}  ({elapsed:.0f}ms)  source={r.get('_source')}  load_ms={r.get('_load_ms')}")

    print("\n=== STOCK-LIST (page 1) — warm (cache hit) ===")
    for name, tid in [("Gümüşhane", gumus), ("Merkez", merkez)]:
        t0 = time.time()
        r = await stock_list(token, tid, page=1)
        elapsed = (time.time() - t0) * 1000
        print(f"  {name}: returned={len(r.get('data',[]))}  ({elapsed:.0f}ms)  load_ms={r.get('_load_ms')}")

    print("\n=== STOCK-LIST (last page for Gümüşhane) ===")
    t0 = time.time()
    r = await stock_list(token, gumus, page=1)
    total_pages = r.get("total_pages")
    t0 = time.time()
    r = await stock_list(token, gumus, page=total_pages)
    elapsed = (time.time() - t0) * 1000
    print(f"  page {total_pages}: returned={len(r.get('data',[]))}  ({elapsed:.0f}ms)")

    print("\n=== STOCK-LIST with search filter (Gümüşhane) ===")
    t0 = time.time()
    r = await stock_list(token, gumus, page=1, search="BORU")
    elapsed = (time.time() - t0) * 1000
    print(f"  filter search='BORU': total_count={r.get('total_count')}  returned={len(r.get('data',[]))}  ({elapsed:.0f}ms)")

    print("\n=== STOCK-LIST with aktif=True, qty=high ===")
    t0 = time.time()
    r = await stock_list(token, gumus, page=1, aktif=True, qty="high")
    elapsed = (time.time() - t0) * 1000
    print(f"  aktif=True qty=high: total={r.get('total_count')} returned={len(r.get('data',[]))} ({elapsed:.0f}ms)")

    print("\n=== CARI-LIST (page 1) ===")
    for name, tid in [("Gümüşhane", gumus), ("Merkez", merkez)]:
        t0 = time.time()
        r = await cari_list(token, tid, page=1)
        elapsed = (time.time() - t0) * 1000
        print(f"  {name}: total={r.get('total_count')}  pages={r.get('total_pages')}  returned={len(r.get('data',[]))}  ({elapsed:.0f}ms)")

    print("\n=== CARI-LIST filter bakiye=borclu (Gümüşhane) ===")
    t0 = time.time()
    r = await cari_list(token, gumus, page=1, bakiye="borclu")
    elapsed = (time.time() - t0) * 1000
    print(f"  bakiye=borclu: total={r.get('total_count')} returned={len(r.get('data',[]))} ({elapsed:.0f}ms)")


asyncio.run(main())
