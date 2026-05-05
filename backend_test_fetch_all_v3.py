"""
Final verification:
 (A) Pagination across multiple pages works (force PageSize=100 so fis_kalem
     219 rows splits into 3 pages and we observe pages>1 with all data).
 (B) Fiyat_listeleri with FiyatAd as STRING ("1016") — the cache row that
     returned 500 rows used string typing.
"""
import time
import json
import requests

BASE = "https://report-filter-fix.preview.emergentagent.com/api"
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"

STOK_FILTER_DEFAULTS = {
    "Stoklar": "", "StokGrup": "", "StokCinsi": "", "StokMarka": "", "StokVergi": "",
    "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "",
    "StokOzelKod5": "", "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
}


def login():
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": "cakmak.ebubekir29@gmail.com", "password": "123456"}, timeout=30)
    return r.json()["access_token"]


def run(token, body, label):
    print(f"\n--- {label} ---")
    t0 = time.time()
    r = requests.post(f"{BASE}/data/report-run", json=body,
                      headers={"Authorization": f"Bearer {token}"}, timeout=300)
    dt = (time.time() - t0) * 1000
    print(f"HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        print(f"BODY: {r.text[:400]}")
        return None
    j = r.json()
    n = len(j.get("data") or [])
    pages = j.get("pages")
    cache = j.get("_cache")
    print(f"ok={j.get('ok')} rows={n} pages={pages} _cache={cache}")
    return j


def main():
    token = login()

    # (A) PAGINATION ACROSS PAGES — fis_kalem with PageSize=100 (219 total)
    print("=" * 78)
    print(" (A) PAGINATION ACROSS MULTIPLE PAGES — PageSize=100, 219 expected")
    print("=" * 78)
    fis_params = {
        "BASTARIH": "2026-04-01", "BITTARIH": "2026-05-05",
        "FisTuru": "", "FisAltTuru": "", "Lokasyon": "", "Proje": "", "BelgeNo": "",
        "Personel": "", "Cariler": "", "CariTur": "", "CariGrup": "", "Adresler": "", "Temsilci": "",
        "CariOzelKod1": "", "CariOzelKod2": "", "CariOzelKod3": "", "CariOzelKod4": "", "CariOzelKod5": "",
        "FisOzelKod1": "", "FisOzelKod2": "", "FisOzelKod3": "", "FisOzelKod4": "", "FisOzelKod5": "",
        "MinTutar": -99999999, "MaxTutar": 99999999,
        "Detayli": 0, "Page": 1, "PageSize": 100,  # ← force pagination
        **STOK_FILTER_DEFAULTS,
    }
    j_fis = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fis_kalem_listesi_web",
        "params": fis_params,
        "fetch_all": True,
        "force_refresh": True,
    }, "fis_kalem_listesi fetch_all=true PageSize=100")

    # Compare with single-page (no fetch_all) at PageSize=100
    j_fis_single = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fis_kalem_listesi_web",
        "params": fis_params,
        "force_refresh": True,
    }, "fis_kalem_listesi NO fetch_all PageSize=100 (expect 100)")

    # (B) Fiyat listeleri with FiyatAd as STRING "1016" (the cache had this)
    print("\n" + "=" * 78)
    print(" (B) FIYAT LISTELERI FiyatAd as STRING (matches cache schema)")
    print("=" * 78)
    fiyat_params = {
        "Aktif": 1, "Durum": 0, "Resimli": 0, "Page": 1, "PageSize": 500,
        "FiyatAd": "1016",  # ← STRING
        "BirimAd": "", "DovizAd": "", "Lokasyon": "",
        "StokCinsi": "", "StokGrup": "", "StokMarka": "", "StokVergi": "", "Stoklar": "",
        "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "", "StokOzelKod5": "",
        "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
    }
    j_fiyat_str = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fiyat_listeleri_web",
        "params": fiyat_params,
        "fetch_all": True,
        "force_refresh": True,
    }, "fiyat_listeleri FiyatAd='1016' (str) fetch_all=true")

    # (B2) try tiny PageSize to force pagination if there are many rows
    fiyat_params_tiny = dict(fiyat_params); fiyat_params_tiny["PageSize"] = 50
    j_fiyat_50 = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fiyat_listeleri_web",
        "params": fiyat_params_tiny,
        "fetch_all": True,
        "force_refresh": True,
    }, "fiyat_listeleri FiyatAd='1016' PageSize=50 fetch_all=true")

    # === SUMMARY ===
    print("\n" + "=" * 78)
    print(" SUMMARY")
    print("=" * 78)
    print(f"{'TEST':<60} {'ROWS':>6} {'PAGES':>6}")
    for label, j in [
        ("fis_kalem fetch_all PageSize=100", j_fis),
        ("fis_kalem single PageSize=100", j_fis_single),
        ("fiyat FiyatAd='1016' (str) PS=500 fetch_all", j_fiyat_str),
        ("fiyat FiyatAd='1016' (str) PS=50  fetch_all", j_fiyat_50),
    ]:
        n = len(j.get("data") or []) if j else "ERR"
        pg = (j or {}).get("pages")
        print(f"{label:<60} {str(n):>6} {str(pg):>6}")

    print()
    if j_fis:
        n = len(j_fis.get("data") or [])
        pages = j_fis.get("pages")
        if n > 100 and pages and pages > 1:
            print(f"✅ PAGINATION CONFIRMED: fetch_all+PageSize=100 returned {n} rows across {pages} pages.")
            print("   The pagination loop in routes/data.py L1932-1971 IS working correctly.")
        elif n == 100:
            print(f"❌ PAGINATION CAPPED: returned exactly 100 rows on 1 page despite 219 expected.")
        else:
            print(f"ℹ️  fis_kalem fetch_all returned {n} rows over {pages} pages.")


if __name__ == "__main__":
    main()
