"""
fetch_all=true verification using the CORRECT frontend param schemas.

The first test run revealed that the review-request param shapes were wrong
(e.g. BTarih/STarih instead of BASTARIH/BITTARIH; missing FiyatId/Lokasyon
 on stok_envanter; missing many fields on fiyat_listeleri/fis_kalem).
The upstream POS silently ignores unknown keys and returns 0 rows.
Schemas below are copied verbatim from /app/frontend/app/(tabs)/reports.tsx
defaultParams (lines 71, 284, 498, 578).
"""
import time
import json
import requests

BASE = "https://report-filter-fix.preview.emergentagent.com/api"
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"
TENANT = "d5587c87a7f9476fa82b83f40accd6c7"  # Merkez

STOK_FILTER_DEFAULTS = {
    "Stoklar": "", "StokGrup": "", "StokCinsi": "", "StokMarka": "", "StokVergi": "",
    "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "",
    "StokOzelKod5": "", "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
}


def login():
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def run(token, body, label):
    print(f"\n--- {label} ---")
    print(f"PARAMS: {json.dumps(body['params'], ensure_ascii=False)[:300]}")
    print(f"fetch_all={body.get('fetch_all', False)}  force_refresh={body.get('force_refresh', False)}")
    t0 = time.time()
    r = requests.post(f"{BASE}/data/report-run", json=body,
                      headers={"Authorization": f"Bearer {token}"}, timeout=300)
    dt = (time.time() - t0) * 1000
    print(f"HTTP {r.status_code} in {dt:.0f}ms")
    if r.status_code != 200:
        print(f"BODY: {r.text[:500]}")
        return None
    j = r.json()
    n = len(j.get("data") or [])
    pages = j.get("pages")
    cache = j.get("_cache")
    print(f"ok={j.get('ok')} rows={n} pages={pages} _cache={cache}")
    if n > 0 and isinstance(j["data"][0], dict):
        sample_keys = list(j["data"][0].keys())[:6]
        print(f"sample row keys: {sample_keys}")
    return j


def main():
    print("=" * 78)
    print(" LOGIN")
    print("=" * 78)
    token = login()
    print("✓ logged in")

    # === 3) FIYAT LISTELERI fetch_all=true ===
    print("\n" + "=" * 78)
    print(" 3) FIYAT LISTELERI fetch_all=true (CORRECT schema, FiyatAd=1016)")
    print("=" * 78)
    fiyat_params_full = {
        "Aktif": 1, "Durum": 0, "Resimli": 0, "Page": 1, "PageSize": 500,
        "FiyatAd": 1016,  # Parekende
        "BirimAd": "", "DovizAd": "", "Lokasyon": "",
        "StokCinsi": "", "StokGrup": "", "StokMarka": "", "StokVergi": "", "Stoklar": "",
        "StokOzelKod1": "", "StokOzelKod2": "", "StokOzelKod3": "", "StokOzelKod4": "", "StokOzelKod5": "",
        "StokOzelKod6": "", "StokOzelKod7": "", "StokOzelKod8": "", "StokOzelKod9": "",
    }
    j_1016 = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fiyat_listeleri_web",
        "params": fiyat_params_full,
        "fetch_all": True,
        "force_refresh": True,
    }, "fiyat_listeleri FiyatAd=1016 fetch_all=true")

    # repeat for FiyatAd=1017 + 1018
    fiyat_params_full["FiyatAd"] = 1017
    j_1017 = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fiyat_listeleri_web",
        "params": fiyat_params_full,
        "fetch_all": True,
        "force_refresh": True,
    }, "fiyat_listeleri FiyatAd=1017 fetch_all=true")

    fiyat_params_full["FiyatAd"] = 1018
    j_1018 = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fiyat_listeleri_web",
        "params": fiyat_params_full,
        "fetch_all": True,
        "force_refresh": True,
    }, "fiyat_listeleri FiyatAd=1018 fetch_all=true")

    # === 4) STOK ENVANTER ===
    print("\n" + "=" * 78)
    print(" 4) STOK ENVANTER fetch_all=true (CORRECT schema)")
    print("=" * 78)
    envanter_params = {
        "SONTARIH": "2026-05-05",
        "Lokasyon": "75919",  # from existing MySQL cache (Merkez has lokasyon 75919)
        "Durum": 0, "FiyatId": 0, "Aktif": "",
        "Tedarikci": "", "KdvDahil": 1, "LokasyonDagilim": 0,
        "Page": 1, "PageSize": 500,
        **STOK_FILTER_DEFAULTS,
    }
    j_env = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_stok_envanter_web",
        "params": envanter_params,
        "fetch_all": True,
        "force_refresh": True,
    }, "stok_envanter fetch_all=true")

    # === 5) FIS KALEM LISTESI ===
    print("\n" + "=" * 78)
    print(" 5) FIS KALEM LISTESI fetch_all=true (CORRECT schema, BASTARIH/BITTARIH)")
    print("=" * 78)
    fis_params = {
        "BASTARIH": "2026-04-01", "BITTARIH": "2026-05-05",
        "FisTuru": "", "FisAltTuru": "", "Lokasyon": "", "Proje": "", "BelgeNo": "",
        "Personel": "", "Cariler": "", "CariTur": "", "CariGrup": "", "Adresler": "", "Temsilci": "",
        "CariOzelKod1": "", "CariOzelKod2": "", "CariOzelKod3": "", "CariOzelKod4": "", "CariOzelKod5": "",
        "FisOzelKod1": "", "FisOzelKod2": "", "FisOzelKod3": "", "FisOzelKod4": "", "FisOzelKod5": "",
        "MinTutar": -99999999, "MaxTutar": 99999999,
        "Detayli": 0, "Page": 1, "PageSize": 500,
        **STOK_FILTER_DEFAULTS,
    }
    j_fis = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fis_kalem_listesi_web",
        "params": fis_params,
        "fetch_all": True,
        "force_refresh": True,
    }, "fis_kalem_listesi fetch_all=true")

    # === 6) REGRESSION single-page (no fetch_all) ===
    print("\n" + "=" * 78)
    print(" 6) REGRESSION fiyat_listeleri WITHOUT fetch_all (single page, FiyatAd=1016)")
    print("=" * 78)
    fiyat_params_full["FiyatAd"] = 1016
    j_single = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_fiyat_listeleri_web",
        "params": fiyat_params_full,
        "force_refresh": True,
    }, "fiyat_listeleri WITHOUT fetch_all")

    # === 7) REGRESSION cari_hesap_ekstresi (CORRECT schema BASTARIH/BITTARIH/...) ===
    print("\n" + "=" * 78)
    print(" 7) REGRESSION rap_cari_hesap_ekstresi_web (CORRECT schema)")
    print("=" * 78)
    cari_params = {
        "BASTARIH": "2026-01-01", "BITTARIH": "2026-05-05 23:59:59",
        "BakiyeTip": 0, "Proje": "", "Lokasyon": "", "AktifDurum": "",
        "Cariler": "", "CariKodu": "", "CariAdi": "",
        "CariTur": "", "CariGrup": "", "Temsilci": "", "Sehir": "", "CariRut": "",
        "CariOzelKod1": "", "CariOzelKod2": "", "CariOzelKod3": "", "CariOzelKod4": "", "CariOzelKod5": "",
        "Detayli": 0, "BakiyeVermeyenHareketsizDevirlerGelmesin": 0,
        "MinBakiye": -99999999, "MaxBakiye": 99999999,
        "Page": 1, "PageSize": 500,
    }
    j_cari = run(token, {
        "tenant_id": TENANT,
        "dataset_key": "rap_cari_hesap_ekstresi_web",
        "params": cari_params,
        "force_refresh": True,
    }, "cari_hesap_ekstresi single-page")

    # === SUMMARY ===
    print("\n" + "=" * 78)
    print(" FINAL VERDICT (CORRECT param schemas)")
    print("=" * 78)
    rows = []
    for label, j in [
        ("fiyat_listeleri[1016] fetch_all", j_1016),
        ("fiyat_listeleri[1017] fetch_all", j_1017),
        ("fiyat_listeleri[1018] fetch_all", j_1018),
        ("stok_envanter fetch_all", j_env),
        ("fis_kalem_listesi fetch_all", j_fis),
        ("fiyat_listeleri[1016] single (no fetch_all)", j_single),
        ("cari_hesap_ekstresi single", j_cari),
    ]:
        n = len(j.get("data") or []) if j else 0
        pages = (j or {}).get("pages")
        rows.append((label, n, pages))
    print(f"{'TEST':<55} {'ROWS':>8}  {'PAGES':>5}")
    for label, n, pages in rows:
        print(f"{label:<55} {n:>8}  {str(pages):>5}")

    # Critical verdict
    print()
    big = [
        (lbl, n, pg) for lbl, n, pg in rows
        if "fetch_all" in lbl and lbl != "fiyat_listeleri[1016] single (no fetch_all)"
    ]
    over_500 = [(lbl, n, pg) for lbl, n, pg in big if n > 500]
    exactly_500 = [(lbl, n, pg) for lbl, n, pg in big if n == 500]
    if over_500:
        print("✅ CRITICAL VERDICT: fetch_all=true RETURNS > 500 ROWS:")
        for lbl, n, pg in over_500:
            print(f"   • {lbl}: {n} rows across {pg} pages")
    else:
        print("⚠️  CRITICAL VERDICT: fetch_all=true did NOT return > 500 rows for any report.")
        if exactly_500:
            print("   Exactly 500 rows seen — pagination may be capped:")
            for lbl, n, pg in exactly_500:
                print(f"   • {lbl}: {n} rows ({pg} pages)")


if __name__ == "__main__":
    main()
