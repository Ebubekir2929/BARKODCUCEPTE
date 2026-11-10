# Probe: which tenant/report combos return cached data (cache_only) — helps pick fast reports for UI tests
import os, requests, json
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "cakmak.ebubekir29@gmail.com", "password": "1234567"}, timeout=30)
print("login", r.status_code)
j = r.json()
tok = j.get("access_token") or j.get("token")
s.headers["Authorization"] = f"Bearer {tok}"
tenants = j.get("user", {}).get("tenants") or j.get("tenants") or []
print("tenants:", [(t.get("tenant_id") or t.get("id"), t.get("name") or t.get("tenant_name")) for t in tenants] if tenants else list(j.keys()))

# Probe a quick report on each tenant (today) with cache_only and then live, short timeout
import ast, time, sys
params = ast.literal_eval(open("/tmp/pso_params.txt").read()) if os.path.exists("/tmp/pso_params.txt") else {}
params["BASTARIH"] = "2026-11-10 00:00:00"
for tid, name in [(t.get("tenant_id") or t.get("id"), t.get("name") or t.get("tenant_name")) for t in tenants]:
    for co in (True, False):
        t0 = time.time()
        try:
            rr = s.post(f"{BASE}/api/data/report-run", json={"tenant_id": tid, "dataset_key": "rap_personel_satis_ozet_web", "params": params, "fetch_all": True, "cache_only": co}, timeout=40)
            jj = rr.json()
            print(name, "cache_only" if co else "live", rr.status_code, round(time.time()-t0,1), "ok=", jj.get("ok"), "rows=", len(jj.get("data") or []), {k: jj.get(k) for k in ("pending","status","detail","_age") if k in jj})
        except Exception as e:
            print(name, co, "EXC", e)
