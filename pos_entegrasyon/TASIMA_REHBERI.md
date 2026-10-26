# Veritabanı Taşıma Rehberi — Paylaşımlı Hosting (MariaDB 5.5) → Railway MariaDB

**Hedef:** 151 bağlantı sınırı ve yavaşlık sorununu kökten çözmek. **Kesinti:** POS verisi için sıfır
(istemciler çevrimdışı kuyruk kullanır); uygulama/web için gece 03:00'te ~5 dakikalık "eski veri" penceresi.

Kararlar: Railway **MariaDB** · sync.php **Railway'e taşınır**, hosting'deki sync.php **yönlendirici** olur ·
web sitesi hosting'de kalıp Railway MariaDB'ye **uzaktan bağlanır** · tüm geçmiş taşınır · geçiş gecesi 03:00–04:00.

Taşınacak veri ≈ 7 GB (dataset_cache 3,6 GB, dataset_cache_rows 1,5 GB, dataset_cache_pages 1 GB, dataset_snapshots 0,3 GB, küçük tablolar).
Atlananlar (yeniden üretilir): sync_logs, dataset_upload_chunks, sync_request_result_chunks, stok_arama_* (arama indeksi backend'de kendiliğinden kurulur).

---

## AŞAMA 0 — Hazırlık (kesintisiz, gündüz yapılabilir)

1. **Railway → New → Database → MariaDB.** Volume'ü **≥ 25 GB** yapın (Settings → Volume).
   Variables'tan şunları not edin: `MYSQLHOST` (özel ağ), `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`,
   ve **TCP Proxy** adresi (Settings → Networking → TCP Proxy: `xxxx.proxy.rlwy.net:PORT`).
2. **Hosting'den Railway'e erişim testi** (web sitesi için şart):
   `pos_entegrasyon/baglanti_test.php` dosyasını hosting'e yükleyip
   `https://SITENIZ/baglanti_test.php?host=xxxx.proxy.rlwy.net&port=PORT` açın.
   - **TCP AÇIK** → web sitesi uzaktan bağlanabilir, devam.
   - **TCP KAPALI** → hosting'den portun açılmasını isteyin (CSF TCP_OUT) ya da web sitesini de Railway'e taşıyın. Test sonrası dosyayı silin.
3. **Railway sync.php servisi:** Railway → New Service → GitHub repo → Settings → Root Directory `pos_entegrasyon`,
   Variables: `RAILWAY_DOCKERFILE_PATH=railway_sync/Dockerfile`, `DB_HOST=${{MariaDB.MYSQLHOST}}`, `DB_PORT=${{MariaDB.MYSQLPORT}}`,
   `DB_NAME=kasacepteweb`, `DB_USER=${{MariaDB.MYSQLUSER}}`, `DB_PASS=${{MariaDB.MYSQLPASSWORD}}`. Domain oluşturun
   (ör. `kasacepte-sync.up.railway.app`). Şema kopyalanmadan önce 500 verir — normal.
4. Emergent'te Railway MariaDB **TCP proxy** bilgisini `HEDEF_MYSQL_URL` olarak verin (güvenli kart):
   `mysql://KULLANICI:SIFRE@xxxx.proxy.rlwy.net:PORT`.

## AŞAMA 1 — Şema + büyük veri ön kopyası (kesintisiz, saatler sürebilir)

Geliştirme ortamında (backend klasörü):
```
HEDEF_MYSQL_URL=... python3 tools/mysql_tasima.py sema      # tüm tablolar oluşur (patron + kasacepteweb)
HEDEF_MYSQL_URL=... nohup python3 tools/mysql_tasima.py tam > /tmp/tasima.log 2>&1 &   # arka planda tam kopya
python3 tools/mysql_tasima.py durum                           # ilerleme (kaldığı yerden devam eder; kesilirse tekrar 'tam')
HEDEF_MYSQL_URL=... python3 tools/mysql_tasima.py dogrula     # satır sayıları
```
Kaynak canlı kalır; parçalar arası bekleme ile hosting yorulmaz. Bittikten sonra günde bir `delta` çalıştırılabilir
(aradaki değişenleri taşır), böylece geçiş gecesi delta 1–2 dakika sürer.

**Ön doğrulama:** Railway sync servisi adresine `{"action":"surum"}` POST edin → sürüm dönmeli.
Backend'in staging testi: Emergent dev `.env`'de MYSQL_*_HOST'u geçici olarak Railway proxy'ye çevirip
`/api/sistem-durum` + giriş + dashboard kontrol edin (sonra geri alın).

## AŞAMA 2 — Geçiş gecesi (03:00, ~5–10 dakika)

| # | Adım | Nerede | Süre |
|---|------|--------|------|
| 1 | Hosting'de sync.php yanına **`bakim.flag`** adlı boş dosya koyun → istemciler 503 alır, gönderimleri **kuyruğa** alır | cPanel/FTP | 10 sn |
| 2 | `python3 tools/mysql_tasima.py delta` → son değişenler Railway'e | Emergent dev | 1–3 dk |
| 3 | `python3 tools/mysql_tasima.py dogrula` → ✓ işaretleri | Emergent dev | 1 dk |
| 4 | **Backend (Railway) Variables:** `MYSQL_PATRON_HOST` ve `MYSQL_DATA_HOST` = `${{MariaDB.MYSQLHOST}}`, kullanıcı/şifre = MariaDB'ninkiler, `MYSQL_TLS_PORT` boş, `SYNC_URL=https://kasacepte-sync.up.railway.app/sync.php` → redeploy | Railway | 1–2 dk |
| 5 | Hosting'deki **sync.php'yi `sync_yonlendirici.php` ile değiştirin** (içindeki `HEDEF_SYNC_URL`'yi Railway adresiyle doldurun; dosya adı sync.php olacak; `/api/sync.php` kopyası varsa onu da) | cPanel/FTP | 1 dk |
| 6 | **Web sitesi `db.php`**: host = `xxxx.proxy.rlwy.net`, port = PORT, kullanıcı/şifre = MariaDB | cPanel/FTP | 1 dk |
| 7 | **`bakim.flag`'i silin** → istemciler kuyruklarını boşaltır (yönlendirici → Railway) | cPanel/FTP | 10 sn |
| 8 | Kontrol: `/api/sistem-durum` (surum, patron/data havuzları, mysql_baglanti.max_connections artık 151 değil), uygulamada giriş + dashboard, Senkron Sağlığı'nda "Web köprüsü" sürümü, web sitesinde bir rapor | — | 3 dk |

**Geri dönüş (rollback):** 4–6. adımlardaki ayarları eski değerlere alın. Hosting veritabanına dokunulmadığı için
veri kaybı olmaz (geçişten sonra Railway'e yazılan birkaç dakikalık veri istemcilerce yeniden gönderilir).
Hosting veritabanını **en az 2 hafta** silmeyin.

## AŞAMA 3 — Geçiş sonrası

- Arama indeksi (stok_arama_*) backend tarafından 10 dk içinde yeniden kurulmaya başlar (200K ürünlü müşteri için ~1 saat).
- Veritabanı diyeti ve zombi temizliği aynen çalışır; `max_connections` Railway MariaDB'de varsayılan 151 ise
  Variables → `MARIADB_MAX_CONNECTIONS` (ya da custom `my.cnf`) ile 500 yapın — artık sunucu **yalnızca bize ait**.
- Bir hafta sonra hosting'de MySQL'i küçültün/kapatın; `baglanti_test.php` ve eski yedekleri silin.

## Sık sorulanlar

- **Geçiş sırasında POS satışları kaybolur mu?** Hayır. 503 alan istemci gönderimi `offline_queue.json`'a yazar, bakım bitince sırayla yollar.
  Sayfalı/delta veri setleri bir sonraki döngüde kendiliğinden yeniden denenir.
- **Uygulama kullanıcıları ne görür?** 03:00'te 2–3 dakika "son veri" (önbellek); giriş ekranı backend redeploy sırasında ~1 dk gecikebilir.
- **Web sitesi yavaşlar mı?** Her sorgu internet üzerinden gider (+30–60 ms). Rapor sayfaları çok sorgu atıyorsa hissedilir;
  kalıcı çözüm web sitesini de Railway'e almak.
