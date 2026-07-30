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

## Test Kimlikleri
Bkz. /app/memory/test_credentials.md (admin şifresi kullanıcı tarafından 1234567 yapıldı).
