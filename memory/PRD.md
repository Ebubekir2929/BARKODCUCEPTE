# PRD — Barkodçu Cepte (ERP12 Mobil Yardımcı Uygulama)

## Ürün Özeti
Türkçe ERP (ERP12) kullanıcıları için mobil yardımcı uygulama.
Stack: Expo React Native (frontend) + FastAPI (backend) + MySQL `kasacepteweb` (cache/kuyruk).
Veri akışı: Windows POS istemcisi (kullanıcının `client.py` + `sync.php`) ERP12 verilerini
MySQL'e basar (dataset_cache); mobil yazma işlemleri `mobil_islem_kuyrugu` tablosuna girer,
POS istemcisi çekip ERP12'ye INSERT eder. Uygulama ERP'ye ASLA doğrudan yazmaz.

## Tamamlanan Özellikler
- Dashboard (satış/ciro grafikleri, saatlik detay, PDF export — expo-print)
- Cari listesi + Ekstre (SWR cache, "Son Güncelleme" rozetleri, FlatList — FlashList KALDIRILDI)
- Stok yönetimi + fiyat güncelleme akışı (POS entegrasyonlu)
- Push bildirimleri (Firebase FCM v1): yüksek satış, satır iptali (deep link düzeltildi), eksi stok özeti
- İptal & Yüksek Satış modalları (SWR cache)
- **Faz 1 — Finans İşlemleri** (`finans-islem.tsx` + `POST /api/islem/create`):
  Tahsilat/Ödeme/Çek/Senet → kuyruk (islem_grubu='finans'). Test: iterasyon 8 ✅
- **Faz 2 — Fatura/Fiş Girişi** (`fis-giris.tsx` + `POST /api/islem/fis-create`):
  Satış/Alış faturası-fişi, barkod kamera + ürün arama, satır düzenleme, ödeme tipi
  (nakit/kart/açık hesap + kasa), PDF çıktı → kuyruk (islem_grubu='fis'). Test: iterasyon 9 + E2E ✅
- **Faz 3 — Sayım Fişi** (`sayim-giris.tsx` + `POST /api/islem/sayim-create`):
  Sürekli barkod tarama (kamera açık kalır, her okuma +1, barkod önbelleği), manuel arama,
  +/- stepper, PDF → kuyruk (islem_grubu='sayim', islem_turu=0). Test: iterasyon 10 ✅
- **Kuyruk Durumu Ekranı** (`kuyruk-durum.tsx` + `GET /api/islem/list?islem_grubu=&durum=` + `POST /api/islem/yeniden-dene`):
  bekliyor/aktarıldı/hata rozetleri, özet sayaçlar, grup filtresi, detay genişletme, hata kaydını yeniden kuyruğa alma.
  Giriş: finans-islem / fis-giris / sayim-giris header'larındaki list ikonu.
- POS entegrasyon rehberleri: `/app/pos_entegrasyon/` (README + client_islem_ek.py + sync_php_islem_ek.php)
  — sayım aktarımı POS tarafında kullanıcının Profiler doğrulamasıyla uyarlanacak (şablon bilerek hata fırlatır).

## Önemli Teknik Kurallar
- iOS'ta RN `<Modal>` KULLANMA (donma) → absoluteFillObject overlay kullan.
- Cari listede FlashList'e GERİ DÖNME (boşluk hatası) → FlatList.
- MySQL CANLI üretim DB'si: test sonrası `mobil_islem_kuyrugu` test kayıtlarını SİL.
- Kamera lazy-require (web crash önleme deseni).
- Tüm backend rotaları `/api` önekli; kimlik: JWT Bearer (login body alanı `email`).

## API Uçları (islem)
- POST /api/islem/create (finans) · POST /api/islem/fis-create · POST /api/islem/sayim-create
- GET /api/islem/list?tenant_id&islem_grubu · GET /api/islem/kasalar · POST /api/islem/kasa-ekle

## Bekleyen / Gelecek İşler
- (P3) `dashboard.tsx` (>3500 satır) refactor — inline bileşenleri ayır.
- Kullanıcı tarafı: POS istemcisine islem kuyruğu entegrasyonu (rehberler hazır);
  sayım için ERP12 Profiler dökümü ile `apply_sayim_islem_to_erp` uyarlaması.
- iOS/Android build: Emergent Publish butonu üzerinden.

## Tam Ön Yükleme / Prefetch — 2026-06 (TAMAMLANDI)
"Instagram tarzı" anında açılış için cache ısıtma sistemi:
- **client.py**: `run_full_prefetch()` — 500 cari ekstresi (kart_extre_cari, ay başı→bugün),
  2000 stok (stok_extre + stok_bilgi_miktar), bu ayın 3000 fiş detayı (fis_detay_toplam)
  ve 6 raporun mobil-varsayılan parametreleri partiler halinde (25'lik, 1.5sn ara) web cache'e basılır.
  Tetikleyiciler: uygulama açılışı (+3dk) ve her gece 03:00 (günde 1 kez, snapshot ile takip).
  Manuel: Senkron sekmesinde "Tam Ön Yükleme (Prefetch)" / "Prefetch Durdur" butonları.
  request_poll (mobil kullanıcı istekleri) HER ZAMAN önceliklidir (`_prefetch_wait_for_user_requests`).
  Sabitler: `FULL_PREFETCH_*` (client.py ~satır 137).
- **backend/services/dataset_cache.py**: `lookup_cached_report` Fallback A — params'ta
  ID/FisId/POS_ID/IPTAL_ID varsa `params_json LIKE '%"ID":N,%'` filtresiyle hedef satır bulunur
  (500+ cache satırında eski top-20 fuzzy taraması hedefi kaçırıyordu). Test edildi ✅
- **backend/routes/data.py**: (1) `/cari-extre` tarih-agnostik fallback artık LIMIT 40 yerine
  ID'ye LIKE filtreli sorgu; (2) `/report-run` cache_only artık memory-cache boşsa MySQL
  dataset_cache'e bakar (`_cache: "mysql-prefetch"`). Curl E2E test edildi ✅
- ÖNEMLİ: Mobil `reports.tsx` defaultParams değişirse client.py `_report_prefetch_definitions()`
  da güncellenmeli (parametreler birebir eşleşmeli, boş/0 değerler norm'da düşer).

## Tazelik Rozeti (FreshnessBadge) — 2026-06 (TAMAMLANDI)- `src/components/FreshnessBadge.tsx`: standart "Son güncelleme: X önce" rozeti
  (<90sn → yeşil ⚡ "az önce", aksi → mavi 🕒). `fmtAge` buradan export edilir.
- Kullanım yerleri: cari ekstre (compact, Güncel Bakiye yanı), stok ekstre,
  fiş detayı modalları (customers + stock), rapor sonuç başlığı (reports.tsx).
- Backend: `/fis-detail` artık `age_sec` döner (cache HIT → gerçek yaş, feed/POS → 0).
  `/report-run` yanıtındaki `_age` frontend'te `reportAgeSec` state'ine bağlandı.
- UI doğrulandı: cari ekstre "az önce" ✅, fiş detayı "3 sa önce" ✅.

## İşlem Ekranları Büyük Güncelleme — 2026-06 (TAMAMLANDI, v1.0.41 / build 45)
1) **FK hataları düzeltildi (client.py)**: `islem_proje`/`islem_lokasyon` (vars. 0)
   PROJE/LOKASYON tablosunda yoksa `_erp_resolve_fk_id` en küçük geçerli ID'yi kullanır
   → FK_FINANS_PROJE / FK_FIS_LOKASYON / FK_SAYIM_LOKASYON ihlalleri çözüldü.
   Kuyruktaki hatalı kayıtlar "Yeniden Dene" ile aktarılabilir.
2) **Klavye deneyimi**: `react-native-keyboard-controller@1.18.5` eklendi (Expo Go SDK 54
   destekli). Root `_layout.tsx` KeyboardProvider ile sarıldı. finans-islem, fis-giris,
   sayim-giris: KeyboardAwareScrollView + sheet'ler KC KeyboardAvoidingView ile sarıldı
   → inputlar klavye altında kalmıyor.
3) **Fiş girişi iskonto/KDV**: satır bazlı İSK% ve KDV% alanları, satır altında brüt/isk/KDV
   bilgisi; toplam paneli: Ara Toplam, Satır İskontoları, Genel İskonto % (tutarı otomatik),
   Toplam KDV (dahil), DÜZENLENEBİLİR Genel Toplam (manuel toplam → otomatik genel iskonto).
   Hesap zinciri doğrulandı (467,50 → %10 satır + %5 genel = 399,71; KDV 66,62 ✓).
   Backend `fis-create`: fis_iskonto_oran/tutar, kdv_toplam, satır iskonto/kdv alanları;
   client.py FIS/FIS_DETAY insert'leri iskonto+KDV kolonlarını dolduruyor
   (SATIR_ISKONTO_TOPLAM, FIS_ISKONTO_ORAN/TOPLAM, KDV_TOPLAM, ISKONTO_HESAP, TOPLAM_KDV...).
4) **Sayım**: ürün seçince MİKTAR SORAN dialog (+/-, autofocus, Ekle/Vazgeç); arama sheet'i
   açık kalır. PDF çıktısı fiş tarafında iskonto/KDV kolonlarıyla güncellendi.
   NOT: Kullanıcı Windows'ta YENİ client.py kurmalı (FK fix + prefetch birlikte).

## İşlem Akışı Geliştirmeleri 2 — 2026-06 (TAMAMLANDI)
1) **Aktarım sonrası anında bakiye tazeleme**: client.py `_islem_refresh_after_apply` —
   başarılı aktarım sonrası cari_bakiye_liste + stock_list + etkilenen carilerin ekstresi
   + etkilenen stokların ekstre/miktarı hemen web cache'e basılır.
2) **Lokasyon seçimi**: POS client `lokasyon_list` push eder (10 dk'da bir,
   `_push_islem_kaynaklar_if_due`). Backend `GET /api/islem/kaynak-liste?key=`.
   Mobil `LokasyonSecici` bileşeni sayım + fiş ekranlarında chip'lerle sorar;
   payload `lokasyon` → client.py apply_fis/apply_sayim mobil lokasyonu kullanır (FK doğrulamalı).
3) **Banka kartları otomatik**: Havale (7/8) → `banka_hesap_list`, Pos (15) → `banka_pos_list`
   (BANKA join'li SELECT, fallback'li). finans-islem türe göre otomatik liste gösterir;
   kart_id sezgisi: KART→KART_ID→FK_KART→KASA→ID. Kullanıcı gerçek POS verisiyle DOĞRULAMALI.
4) **Fiş + Finans birlikte**: apply_fis'te nakit→FINANS tur 1 (satış/alış iade) veya 2 (alış/satış iade),
   kart→tur 15; borçlu/alacaklı ISLEM_TURLERI eşlemesiyle; apply_finans yeniden kullanılır
   (fis_ref=FIS id, EXTERNAL_ID=queue id → mükerrer korumalı). Açık hesapta finans yazılmaz.
   Eski hatalı inline FINANS bloğu kaldırıldı (KART_ALACAKLI=fis_id ve tür=47 yazıyordu).
DİKKAT: search_replace bazı düzenlemeleri sessizce kaybetti bu oturumda — kritik
değişikliklerden sonra grep ile doğrulama yapıldı; gelecekte de doğrulayın.

## Erişim Kesintisi RCA — 2026-08-08 (Iteration 13)
KÖK NEDEN: Kullanıcının MySQL VPS'i (185.223.77.132:3306) TCP kabul edip MySQL
greeting paketini GÖNDERMİYOR (sunucu tarafı arıza — kullanıcı VPS'te mysqld'yi
yeniden başlatmalı). Bunu kötüleştiren 2 backend bug'ı düzeltildi:
1) server.py startup: referanssız `asyncio.create_task(_init_pools_bg())` GC
   tarafından yok ediliyordu ("Task was destroyed") → `app.state.init_pools_task`.
2) services/__init__.py: pool init'e kilit + `asyncio.wait_for(8s)` +
   `connect_timeout=5` + 20 sn devre kesici (`_FAIL_CACHE_SEC`) eklendi;
   `DBUnreachableError` → server.py global handler HTTP 503 `kod: DB_UNREACHABLE`
   ("Veritabanı sunucusuna şu anda ulaşılamıyor..."). MySQL dönünce otomatik
   toparlar (restart gerekmez). Test: iteration_13.json ✓ (login 503 ~0.04-0.15s,
   frontend hızlı hata modali, sonsuz spinner yok).

## Test Kimlikleri
Bkz. /app/memory/test_credentials.md (admin şifresi kullanıcı tarafından 1234567 yapıldı).

## 2026-06 (Fork) — DB Erişim Krizi Çözümü + client.py düzeltmesi
- client.py: eksik `_push_islem_kaynaklar_if_due` metodu eklendi (lokasyon_list/banka_hesap_list/banka_pos_list'i 30 dk'da bir dataset_cache'e basar). İndirme: `/api/pos-dosya/client.py`
- KÖK NEDEN BULUNDU: Poyraz Hosting DDoS koruması (SYN-proxy) workspace IP'sinden gelen sunucu-önce-konuşan protokolleri (MySQL 3306, SSH 22) bozuyordu; HTTP çalışıyordu. Fail2Ban/max_connections/iptables DEĞİLDİ.
- B PLANI UYGULANDI: Sunucuda stunnel (:3308 TLS → 127.0.0.1:3306, systemd: stunnel-mysql, ciphers AES256-SHA TLS1.2). Backend'de `services/tls_tunnel.py` — otomatik: direkt 3306 greeting-probe başarısızsa yerel 127.0.0.1:13306 TLS tüneli. .env: MYSQL_TLS_HOST/MYSQL_TLS_PORT=3308.
- Doğrulandı: login (her iki hesap), /api/islem/list gerçek veri, frontend yükleniyor. Kuyruk #21 "aktarildi" (FK sorunları da çözülmüş).

## 2026-06 (Fork) — client.py: Aktif Kullanıcı İsteği Önceliği TAMAMLANDI
- `_bekle_istek_bitsin` güçlendirildi: aktif istek + istek bitiminden sonra REQUEST_PRIORITY_GRACE_SEC (8 sn) grace süresi boyunca arka plan işleri bekler ("⏸ Arka plan işleri bekletiliyor" / "▶ ... devam ediyor" logları).
- `process_pending_requests` finally: grace süresi işlemin BİTİŞİNDEN itibaren sayılır (`_last_request_activity_ts` yenilenir).
- Kesme kontrolü eklenen döngüler: `prewarm_fis_detail_cache`, `run_full_prefetch` (kayıt başına), `_prefetch_reports` (sayfa başına), `sync_tracked_ondemand_queries` (kayıt başına). Mevcuttu: prewarm_stok_bilgi_miktar, sync_current_month_extre/fis_detail, sync_push_datasets, sync_direct_cache.
- `_prefetch_wait_for_user_requests` artık `_request_poll_busy` yerine `_bekle_istek_bitsin`e delege (yanlış sinyal düzeltildi).
- Doğrulama: py_compile OK + AST tabanlı davranış testi (4 senaryo geçti) + `/api/pos-dosya/client.py` indirmesi güncel dosyayı veriyor.
- NOT: Aynı dosyaya paralel search_replace yapma — dosya sonu bozuldu, truncate ile düzeltildi.
- Bekleyen: Brevo IP beyaz listesi (kullanıcı aksiyonu, Railway IP 152.55.185.96). Gelecek: dashboard.tsx refactor (P3).

## 2026-06 (Fork) — Brevo E-posta ÇÖZÜLDÜ ✅
- Kullanıcı Railway IP'sini (152.55.185.96) Brevo Authorized IPs beyaz listesine ekledi.
- Kullanıcı production'da "Şifremi Unuttum" akışını test etti: "şuan çalıştı" — e-posta teslim ediliyor.
- Not: BREVO_API_KEY yalnızca Railway (production) env'de tanımlı; dev workspace'te yok (dev SMTP Gmail fallback kullanır).
- Kalan açık iş: dashboard.tsx refactor (P3).

## 2026-06 (Fork) — İstek Önceliği TÜM arka plan işlerine genişletildi
- Kullanıcı logu: request işlenirken "islem kaynak: banka_pos_list güncellendi" araya giriyordu → rapor gecikiyordu.
- _bekle_istek_bitsin guard'ı eklenen ek fonksiyonlar: _push_islem_kaynaklar_if_due (giriş+dataset başına), sync_direct_acik_masa_detay (liste+POS başına), sync_direct_rap_filtre_lookup (kaynak başına), sync_direct_rap_acik_hesap_ozet (sayfa başına), sync_direct_fis_gunluk_bildirim_feed, detect_changed_dependencies (watcher başına), _run_backfill_job (dataset/gün başına).
- process_pending_requests / process_pending_islemler / process_pending_price_updates KASITLI olarak guard'sız (kullanıcı eylemleri + deadlock önleme).
- Toplam 21 guard noktası; py_compile OK; /api/pos-dosya/client.py güncel (288KB).

## 2026-06 (Fork) — Request HIZ: Paralel İstek İşleme (10 sn hedefi)
- Sorun: request_poll worker istekleri SIRALI işliyordu; ağır bir rapor hem yeni poll'ları ("request_poll: zaten çalışıyor" spam) hem diğer istekleri blokluyordu.
- Çözüm: process_pending_requests artık DISPATCHER — her istek `_process_single_request` ile AYRI thread'de paralel çalışır. `_request_begin/_request_end` sayaçlı bayrak yönetir (son istek bitince _request_active=False). `_inflight_request_uids` seti stale-reset duplicate'larını önler. record_success kilitlendi (thread-safe). on_request_tick "zaten çalışıyor" spam'i kaldırıldı.
- sync.php request_poll kayıtları 'running' işaretlediği için çift dispatch yok (120s stale reset hariç — set ile korunuyor).
- Süre logu: "✓ Request işlendi: X (N kayıt, SQL Y sn, toplam Z sn)".
- Test: AST tabanlı simülasyon — paralel çalışma, duplicate atlama, arka plan bekletme, süre logları ✅. py_compile OK.

## 2026-06 (Fork) — client.py UÇTAN UCA TEST EDİLDİ + sürüm damgası
- Kullanıcı "hiç veri gelmiyor / client kesmiyor" dedi → gerçek client.py Linux'ta PySide6 offscreen + sahte sync.php + sahte SQL ile UÇTAN UCA test edildi (/tmp/kc_e2e_test.py): T1 paralel (hızlı rapor ağır rapor sürerken 0.4sn), T2 arka plan bekletme + log, T3 istek yokken bekleme yok, T4 sonuç push, T5 bilinmeyen dataset error, T6 sürüm logu — HEPSİ GEÇTİ.
- Thread güvenliği: paralel request thread'leri artık Qt widget OKUMUYOR (tenant/server_url poll thread'inden parametreyle geçiyor; send_request_result imzası genişletildi).
- CLIENT_BUILD sabiti eklendi: başlangıçta "🔧 Client sürümü: 2026-06-13 v3" loglanır — kullanıcının hangi build'i çalıştırdığı artık doğrulanabilir.
- Kod repo'da doğru çalışıyor; kullanıcı tarafında sorun büyük olasılıkla ESKİ BUILD çalışması (Windows'ta eski process/eski exe). Kullanıcıdan log başındaki sürüm satırını doğrulaması istendi.

## 2026-08 (Fork) — "Bağlantı hatası" KÖK NEDENİ ÇÖZÜLDÜ + 4 UI düzeltmesi
### sync.php performans krizi (rapor bağlantı hataları)
- KÖK NEDEN: sync_logs (275K satır) created_at İNDEKSİ YOKTU; auto_cleanup_old_logs HER HTTP isteğinde tam tablo taraması yapan DELETE çalıştırıyordu + ensure_dataset_cache_rows her istekte ALTER/SHA2 backfill deniyordu → tüm PHP worker'ları doldu → sync.php 30sn+ timeout → rapor bağlantı hataları + 629 bayat istek birikti.
- ACİL MÜDAHALE (canlı MySQL'e): idx_sync_logs_created indeksi eklendi (8sn), 629 bayat queued istek expire edildi → sync.php 30sn timeout'tan 0.7-1.8sn'ye düştü.
- KALICI FİX (sync.php v-yeni): maintenance_due() (sync_maintenance marker tablosu + GET_LOCK, saatte 1 kez, kilidi alamayan atlar) → auto_cleanup_old_logs LIMIT'li partiler + ensure_dataset_cache_rows saatlik; request_poll'da 15dk+ queued otomatik expire (LIMIT 500). php -l OK. KULLANICI sync.php'yi hostinge YÜKLEMELİ (/api/pos-dosya/sync.php).
### UI düzeltmeleri (test edildi, ekran görüntülü)
- dashboard.tsx: userName büyütüldü (ios 17→20, minScale 0.9), header butonları kompakt.
- stock.tsx: header sıkışıklığı çözüldü (başlık 17 + flexShrink, iconBtn 34, ikon 18, gap 6).
- Premium kamera izin kartı: src/components/KameraIzinKarti.tsx (absolute overlay, MODAL DEĞİL) — fiyat-gor + stock scanner kullanıyor; canAskAgain=false → "Ayarları Aç" modu.
- Fiyat Gör isimle arama: backend barcode-price'a Türkçe duyarsız AD araması eklendi; tek eşleşme → direkt sonuç, çoklu → candidates listesi (app'te seçim listesi). Test: "kola"→tek ürün, "me"→25 aday ✅.

## 2026-08 (Fork) — Fiyat Gör "Son Bakılan Ürünler" + sürüm 1.0.44
- fiyat-gor.tsx: AsyncStorage tabanlı geçmiş (fiyat_gor_gecmis_v1, max 10, ürün bazında dedupe). Başarılı sorguda otomatik eklenir; ad+kod+barkod+ilk fiyat gösterilir; dokununca yeniden sorgular; "Temizle" butonu var. Ekran testi ✅.
- app.json: version 1.0.44, iOS buildNumber 48, Android versionCode 48 (kullanıcı store güncellemesi yapacak).

## 2026-08 (Fork) — Railway OOM (Deploy Ran Out of Memory) FIX
- KÖK NEDEN: 2 sınırsız RAM cache — (1) services/dataset_cache.py _DATASET_MEM_CACHE: stock_list gibi 60K parse edilmiş satır tenant başına RAM'de SONSUZA DEK kalıyordu (_CACHE_MAX_AGE tanımlıydı ama hiç uygulanmamıştı); (2) routes/data.py _GLOBAL_CACHE: tarih/filtre kombinasyonlu payload'lar günlerce birikiyordu.
- FIX: _sweep_mem_cache() her get_dataset_items çağrısında 900sn+ boşta girdileri düşürür; _global_cache_set() TTL 30dk + max 200 girdi (en eskiler düşer) — 4 yazım noktası değiştirildi.
- İzleme: /api/sistem-durum artık bellek_mb (VmRSS) + ram_cache {dataset_girdi, dataset_satir, global_girdi} döndürür.
- Testler: birim (sweep+boyut sınırı) ✅, e2e (barcode-price cache doldurma, 87MB) ✅.
- KULLANICI AKSIYONU: Backend'i Railway'e yeniden deploy etmeli (fix ancak deploy sonrası production'da etkin olur).

## 2026-08 — SON KONTROL (tümü geçti)
- client.py py_compile ✅ (v3, indirme 290KB güncel), sync.php php -l ✅ (maintenance_due + expire mevcut, indirme 128KB güncel), canlı sync.php 0.48sn yanıt ✅.
- Backend derleme ✅, login ✅, isimle arama ("kola"→Meral Kolasayın) ✅, çoklu aday (25) ✅, bellek izleme (120MB, sweep aktif) ✅.
- app.json 1.0.44 / iOS 48 / Android 48 ✅. Fiyat Gör ekranı: sonuç + SON BAKILAN ÜRÜNLER ekran testi ✅.

## 2026-08 (Fork) — 5 Yeni Özellik Paketi
1. Sistem Sağlığı bellek göstergesi: sistem-saglik.tsx "Sunucu Belleği" satırı (bellek_mb + önbellek satır sayısı, 300/450MB renk eşikleri).
2. Giderler ekranı (/app/frontend/app/giderler.tsx): rap_lm_gelir_tablosu'ndan GRUP='GİDERLER' kalemleri; Bugün/Son7/BuAy/GeçenAy aralıkları + lokasyon seçici (report-filter-options); toplam gider kartı + net satış/brüt kâr/kâr-zarar özeti + kalem başına % pay barı; SWR (önce cache_only sonra taze). Dashboard header'a kırmızı trending-down butonu eklendi. Ekran testi ✅ (canlı POS verisiyle).
3. Offline açılış (2b): ZATEN VARDI — authStore.checkAuth ağ hatasında cihazdaki oturumla girer; dashboard dash_offline:{tenant} AsyncStorage yedeğiyle açılır (isOffline bandı).
4. Tenant ID düzenleme: PUT /api/auth/tenants/{id}/change-id (şifre SHA1 doğrulama; ana kaynak→MySQL users.tenant_id + tenant_names taşıma, ek kaynak→Mongo user_tenants; duplicate koruması). authStore.changeTenantId + settings.tsx edit modalında ID alanı düzenlenebilir + ID değişince şifre alanı çıkar. Güvenlik testleri ✅ (401 yanlış şifre / 400 aynı id).
5. Market+Restoran çoklu kaynak açık masalar: POST /api/data/acik-masalar-coklu (tenant_ids→masalar); dashboard business_type='restoran' kısıtı KALDIRILDI; digerMasalar state 30sn'de bir diğer tenant'ların masalarını çekip kaynak adıyla ayrı kart gösterir. API testi ✅ (2 kaynak, 3+4 masa).
- NOT: dashboard userName minimumFontScale 0.72 (5 buton sıkışması); adjustsFontSizeToFit web'de çalışmaz, native'de küçülür.
- Dashboard lint hataları (liveDot dupe, unescaped ') ÖNCEDEN VARDI, dokunulmadı.

## 2026-08 — Karar + sürüm
- Açık masalar gösterimi: VERİ ODAKLI davranış kesinleşti (masa verisi olan her kaynak görünür, aktif kaynak "diğer kaynaklar" sorgusundan hariç → çift gösterim yok). Kullanıcı kararı ajana bıraktı.
- app.json: 1.0.45 / iOS 49 / Android 49.

## 2026-08 (Fork) — Railway OOM 2. tur sertleştirme (3 katman)
- Kullanıcı OOM'un TEKRAR olduğunu bildirdi (büyük olasılıkla eski build hâlâ deployda — doğrulama: prod /api/sistem-durum yanıtında bellek_mb VARSA yeni build).
- Katman 1 (önceki): idle eviction (900sn) + _GLOBAL_CACHE TTL/200 girdi.
- Katman 2 (yeni): Dockerfile ENV MALLOC_ARENA_MAX=2; bellek_iade_et() = gc.collect + libc malloc_trim(0) (eviction sonrası otomatik) — Python'un OS'a bellek iade etmemesi sorununu çözer.
- Katman 3 (yeni): server.py startup'ta _bellek_bekcisi task: 60sn'de bir VmRSS kontrol; > MEM_KORUMA_MB (env, varsayılan 400) ise TÜM cache'leri boşaltıp trim yapar, warning loglar. dataset_cache.tum_cache_bosalt() eklendi.
- Testler: py_compile ✅, sistem-durum 76MB ✅, acil boşaltma birim testi ✅.
- KULLANICI: Railway'e MUTLAKA redeploy + Railway plan bellek limitini bildirmesi istendi (512MB ise MEM_KORUMA_MB=400 uygun; farklıysa env'den ayarlanabilir).
