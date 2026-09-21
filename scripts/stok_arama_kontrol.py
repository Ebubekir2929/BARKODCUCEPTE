"""Kullanım: python3 scripts/stok_arama_kontrol.py [durum|kur|ara TERIM...]"""
import requests, time, sys
B="http://localhost:8001/api"
rr=requests.post(f"{B}/auth/login",json={"email":"cakmak.ebubekir29@gmail.com","password":"1234567"},timeout=60)
H={"Authorization":f"Bearer {rr.json()['access_token']}"}
tid="a6491c78291643e6b08e518e1de8e498"
cmd = sys.argv[1] if len(sys.argv)>1 else "durum"
if cmd=="kur": print(requests.post(f"{B}/data/stok-arama-indeksle",json={"tenant_id":tid},headers=H,timeout=60).json())
elif cmd=="durum": print(requests.get(f"{B}/data/stok-arama-durum",params={"tenant_id":tid},headers=H,timeout=60).json())
elif cmd=="ara":
    for q in sys.argv[2:]:
        t0=time.time(); r=requests.post(f"{B}/data/stock-list",json={"tenant_id":tid,"page":1,"page_size":20,"search":q},headers=H,timeout=170).json()
        print(f"'{q}' → {r.get('total_count')} sonuç, src={r.get('_source')}, {r.get('_load_ms')} ms, wall {time.time()-t0:.1f}s |", [x.get('AD','')[:28] for x in r.get('data',[])[:3]])
    t0=time.time(); r=requests.post(f"{B}/data/barcode-price",json={"tenant_id":tid,"barkod":sys.argv[2] if len(sys.argv)>2 else "1"},headers=H,timeout=170)
    print("barkod-price:", r.status_code, f"{time.time()-t0:.1f}s", str(r.json())[:160])
