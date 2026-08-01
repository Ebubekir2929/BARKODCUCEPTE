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

## Test Kimlikleri
Bkz. /app/memory/test_credentials.md (admin şifresi kullanıcı tarafından 1234567 yapıldı).
