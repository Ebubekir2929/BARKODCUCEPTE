#!/usr/bin/env python3
"""
mysql_tasima.py — Paylaşımlı hosting (MariaDB 5.5) → Railway MariaDB KESİNTİSİZ veri taşıma aracı.

Kullanım (backend klasöründen):
  HEDEF_MYSQL_URL='mysql://kullanici:sifre@host:port' python3 tools/mysql_tasima.py sema      # şema (CREATE TABLE) kopyala
  HEDEF_MYSQL_URL=... python3 tools/mysql_tasima.py tam                                      # tüm tablolar, kaldığı yerden devam
  HEDEF_MYSQL_URL=... python3 tools/mysql_tasima.py delta                                    # son turdan beri değişenler
  HEDEF_MYSQL_URL=... python3 tools/mysql_tasima.py dogrula                                  # satır sayısı karşılaştırması
  HEDEF_MYSQL_URL=... python3 tools/mysql_tasima.py durum                                    # ilerleme

Özellikler
  - Kaynak canlı kalır (yalnızca SELECT); parçalar arası bekleme ile hostingi yormaz.
  - PK aralığıyla parça parça kopya (~8 MB/parça), durum dosyasıyla KALDIĞI YERDEN DEVAM.
  - Hedefe INSERT ... ON DUPLICATE KEY UPDATE → tekrar çalıştırmak güvenli (idempotent).
  - `delta`: updated_at/created_at > son tur zamanı olan satırlar (son geçiş gecesi 1-2 dk).
  - Atlanan tablolar (yeniden üretilir / geçici): sync_logs, dataset_upload_chunks,
    sync_request_result_chunks, stok_arama_* (arama indeksi backend tarafından yeniden kurulur).

Hedef DB adları kaynakla aynı tutulur (patron, kasacepteweb) → backend/sync.php'de yalnızca host değişir.
"""
import asyncio
import json
import os
import sys
import time
from datetime import datetime
from urllib.parse import urlparse, unquote

import aiomysql
from dotenv import load_dotenv

BURASI = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BURASI, "..", ".env"))

DURUM_DOSYASI = os.path.join(BURASI, "tasima_durum.json")
PARCA_HEDEF_BAYT = 8 * 1024 * 1024
PARCA_ARASI_SN = float(os.environ.get("TASIMA_BEKLEME_SN", "0.3"))
ATLA = {"sync_logs", "dataset_upload_chunks", "sync_request_result_chunks", "stok_arama_kelime", "stok_arama_konum", "stok_arama_sayfa"}
# Delta için zaman kolonu tercihi
ZAMAN_KOLONLARI = ("updated_at", "last_success_at", "created_at")

KAYNAKLAR = {
    "patron": dict(host=os.environ["MYSQL_PATRON_HOST"], db=os.environ["MYSQL_PATRON_DB"], user=os.environ["MYSQL_PATRON_USER"], password=os.environ["MYSQL_PATRON_PASS"]),
    "kasacepteweb": dict(host=os.environ["MYSQL_DATA_HOST"], db=os.environ["MYSQL_DATA_DB"], user=os.environ["MYSQL_DATA_USER"], password=os.environ["MYSQL_DATA_PASS"]),
}


def hedef_baglanti_bilgisi() -> dict:
    url = os.environ.get("HEDEF_MYSQL_URL", "").strip()
    if not url:
        sys.exit("HEDEF_MYSQL_URL tanımlı değil (mysql://kullanici:sifre@host:port)")
    u = urlparse(url)
    return dict(host=u.hostname, port=u.port or 3306, user=unquote(u.username or ""), password=unquote(u.password or ""))


def durum_oku() -> dict:
    if os.path.exists(DURUM_DOSYASI):
        with open(DURUM_DOSYASI, encoding="utf-8") as f:
            return json.load(f)
    return {"tablolar": {}, "son_delta": None}


def durum_yaz(d: dict):
    tmp = DURUM_DOSYASI + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DURUM_DOSYASI)


def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


async def baglan(**kw):
    return await aiomysql.connect(autocommit=True, charset="utf8mb4", connect_timeout=20, **kw)


async def tablo_bilgisi(kaynak, db: str):
    async with kaynak.cursor() as cur:
        await cur.execute(
            "SELECT t.table_name, t.avg_row_length, t.table_rows, "
            "(SELECT GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position) FROM information_schema.key_column_usage k "
            " WHERE k.table_schema=t.table_schema AND k.table_name=t.table_name AND k.constraint_name='PRIMARY') pk "
            "FROM information_schema.tables t WHERE t.table_schema=%s AND t.table_type='BASE TABLE' ORDER BY t.data_length",
            (db,),
        )
        tablolar = []
        for ad, avg, rows, pk in await cur.fetchall():
            await cur.execute(f"SHOW COLUMNS FROM `{ad}`")
            kol_satir = await cur.fetchall()
            kolonlar = [r[0] for r in kol_satir]
            tipler = {r[0]: str(r[1]).lower() for r in kol_satir}
            pk_l = (pk or "").split(",") if pk else []
            pk_int = len(pk_l) == 1 and tipler.get(pk_l[0], "").split("(")[0] in ("int", "bigint", "smallint", "mediumint", "tinyint")
            tablolar.append({"ad": ad, "avg": int(avg or 512), "tahmini_satir": int(rows or 0), "pk": pk_l, "pk_int": pk_int, "kolonlar": kolonlar})
        return tablolar


async def sema_kopyala(kaynak, hedef, db: str, tablolar):
    async with hedef.cursor() as hcur:
        await hcur.execute(f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        await hcur.execute(f"USE `{db}`")
        await hcur.execute("SHOW TABLES")
        mevcut = {r[0] for r in await hcur.fetchall()}
    async with kaynak.cursor() as kcur:
        for t in tablolar:
            if t["ad"] in mevcut:
                continue
            await kcur.execute(f"SHOW CREATE TABLE `{t['ad']}`")
            ddl = (await kcur.fetchone())[1]
            # MariaDB 5.5 → 10/11 uyumu: eski ROW_FORMAT/ENGINE seçenekleri olduğu gibi kalabilir
            async with hedef.cursor() as hcur:
                await hcur.execute(ddl)
            log(f"  şema: {db}.{t['ad']} oluşturuldu")


def _ust_sinir(parca: int, tahmini_satir: int) -> int:
    return max(20, min(parca, 5000))


async def tablo_kopyala(kaynak, hedef, db: str, t: dict, durum: dict, delta_zaman: str | None = None):
    ad, kolonlar, pk = t["ad"], t["kolonlar"], t["pk"]
    kol_liste = ", ".join(f"`{c}`" for c in kolonlar)
    yer = ", ".join(["%s"] * len(kolonlar))
    guncelle = ", ".join(f"`{c}`=VALUES(`{c}`)" for c in kolonlar if c not in pk) or f"`{pk[0]}`=`{pk[0]}`"
    upsert = f"INSERT INTO `{db}`.`{ad}` ({kol_liste}) VALUES ({yer}) ON DUPLICATE KEY UPDATE {guncelle}"
    parca = _ust_sinir(PARCA_HEDEF_BAYT // max(t["avg"], 64), t["tahmini_satir"])
    td = durum["tablolar"].setdefault(f"{db}.{ad}", {"son_pk": 0, "kopyalanan": 0, "bitti": False})
    toplam = 0
    zaman_kolonu = next((z for z in ZAMAN_KOLONLARI if z in kolonlar), None)

    async def _yaz(satirlar):
        if not satirlar:
            return
        async with hedef.cursor() as hcur:
            await hcur.executemany(upsert, satirlar)

    # ── Delta modu: zaman kolonu + tamsayı PK → son turdan beri değişenler; aksi hâlde küçük tabloyu baştan kopyala
    if delta_zaman and zaman_kolonu and t["pk_int"]:
        son = 0
        while True:
            async with kaynak.cursor() as kcur:
                await kcur.execute(f"SELECT {kol_liste} FROM `{ad}` WHERE `{zaman_kolonu}` >= %s AND `{pk[0]}` > %s ORDER BY `{pk[0]}` LIMIT %s", (delta_zaman, son, parca))
                satirlar = await kcur.fetchall()
            if not satirlar:
                break
            await _yaz(satirlar)
            son = satirlar[-1][kolonlar.index(pk[0])]
            toplam += len(satirlar)
            await asyncio.sleep(PARCA_ARASI_SN)
        log(f"  delta {db}.{ad}: {toplam} satır")
        return toplam
    if delta_zaman:
        td["son_pk"], td["bitti"], td["kopyalanan"] = 0, False, 0  # zaman kolonu yok → baştan (küçük tablolar)

    # ── Tam kopya: tamsayı PK → aralıkla (kaldığı yerden); değilse OFFSET'le (küçük tablolar)
    if td.get("bitti"):
        log(f"  {db}.{ad}: zaten bitti (atlandı)")
        return 0
    if t["pk_int"]:
        son = td["son_pk"] or 0
        while True:
            async with kaynak.cursor() as kcur:
                await kcur.execute(f"SELECT {kol_liste} FROM `{ad}` WHERE `{pk[0]}` > %s ORDER BY `{pk[0]}` LIMIT %s", (son, parca))
                satirlar = await kcur.fetchall()
            if not satirlar:
                break
            await _yaz(satirlar)
            son = satirlar[-1][kolonlar.index(pk[0])]
            toplam += len(satirlar)
            td["son_pk"] = son
            td["kopyalanan"] += len(satirlar)
            durum_yaz(durum)
            if td["kopyalanan"] % (parca * 20) < parca:
                log(f"  {db}.{ad}: {td['kopyalanan']} satır (son pk {son})")
            await asyncio.sleep(PARCA_ARASI_SN)
    else:
        ofset = 0
        while True:
            async with kaynak.cursor() as kcur:
                await kcur.execute(f"SELECT {kol_liste} FROM `{ad}` LIMIT %s OFFSET %s", (parca, ofset))
                satirlar = await kcur.fetchall()
            if not satirlar:
                break
            await _yaz(satirlar)
            ofset += len(satirlar)
            toplam += len(satirlar)
            td["kopyalanan"] = ofset
            await asyncio.sleep(PARCA_ARASI_SN)
    td["bitti"] = True
    durum_yaz(durum)
    log(f"  {db}.{ad}: TAMAM ({td['kopyalanan']} satır)")
    return toplam


async def calistir(mod: str):
    hedef_bilgi = hedef_baglanti_bilgisi()
    durum = durum_oku()
    hedef = await baglan(**hedef_bilgi)
    async with hedef.cursor() as c:
        await c.execute("SELECT VERSION(), @@max_connections")
        log(f"HEDEF: {hedef_bilgi['host']}:{hedef_bilgi['port']} → {await c.fetchone()}")
    delta_zaman = None
    tur_baslangic = None
    if mod == "delta":
        delta_zaman = durum.get("son_delta") or durum.get("tam_baslangic")
        if not delta_zaman:
            sys.exit("Önce 'tam' çalıştırılmalı (delta başlangıcı yok)")
        log(f"DELTA: {delta_zaman} sonrası değişenler")
    if mod == "tam" and not durum.get("tam_baslangic"):
        durum["tam_baslangic"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        durum_yaz(durum)
    for db, kb in KAYNAKLAR.items():
        kaynak = await baglan(**kb)
        async with kaynak.cursor() as c:
            await c.execute("SELECT NOW()")
            if tur_baslangic is None:
                tur_baslangic = (await c.fetchone())[0].strftime("%Y-%m-%d %H:%M:%S")  # KAYNAK saatiyle (delta için)
        tum_tablolar = await tablo_bilgisi(kaynak, kb["db"])
        tablolar = [t for t in tum_tablolar if t["ad"] not in ATLA]
        sadece = {s.strip() for s in os.environ.get("TASIMA_TABLOLAR", "").split(",") if s.strip()}
        if sadece:
            tablolar = [t for t in tablolar if t["ad"] in sadece]
        log(f"KAYNAK {db}: {len(tum_tablolar)} tablo (veri kopyası: {len(tablolar)})")
        if mod in ("sema", "tam", "delta"):
            # ŞEMA: atlanan tablolar dahil HEPSİ (sync.php sync_logs/upload_chunks tablolarına yazar; boş olmaları yeter)
            await sema_kopyala(kaynak, hedef, db, tum_tablolar)
        if mod in ("tam", "delta"):
            for t in tablolar:
                try:
                    await tablo_kopyala(kaynak, hedef, db, t, durum, delta_zaman)
                except Exception as e:
                    log(f"  !! {db}.{t['ad']} hata: {e!r} — tekrar çalıştırınca kaldığı yerden devam eder")
        if mod == "dogrula":
            for t in tablolar:
                async with kaynak.cursor() as kc, hedef.cursor() as hc:
                    await kc.execute(f"SELECT COUNT(*) FROM `{t['ad']}`")
                    await hc.execute(f"SELECT COUNT(*) FROM `{db}`.`{t['ad']}`")
                    k, h = (await kc.fetchone())[0], (await hc.fetchone())[0]
                    isaret = "✓" if k == h else ("~" if abs(k - h) <= max(5, k * 0.001) else "✗")
                    log(f"  {isaret} {db}.{t['ad']}: kaynak {k} / hedef {h}")
        kaynak.close()
    if mod in ("tam", "delta") and tur_baslangic:
        # Bir sonraki delta, bu turun BAŞLANGICINDAN itibaren (tur sırasında değişenler kaçmasın) — 2 dk pay
        durum["son_delta"] = tur_baslangic
        durum_yaz(durum)
        log(f"Tur bitti. Sonraki delta başlangıcı: {tur_baslangic}")
    hedef.close()


def durum_goster():
    d = durum_oku()
    print(json.dumps({k: v for k, v in d.items() if k != "tablolar"}, ensure_ascii=False, indent=1))
    for ad, t in d.get("tablolar", {}).items():
        print(f"  {'✓' if t.get('bitti') else '…'} {ad}: {t.get('kopyalanan', 0)} satır (son pk {t.get('son_pk')})")


if __name__ == "__main__":
    mod = (sys.argv[1] if len(sys.argv) > 1 else "durum").lower()
    if mod == "durum":
        durum_goster()
    elif mod in ("sema", "tam", "delta", "dogrula"):
        asyncio.run(calistir(mod))
    else:
        sys.exit(__doc__)
