# POS Entegrasyonu — Mobil İşlem Kuyruğu (2026-07)

Mobil uygulamadaki **Finans İşlemleri** (Tahsilat/Ödeme/Çek/Senet), **Fatura/Fiş Girişi**
ve **Sayım Fişi** kayıtlarının ERP12'ye aktarımı — fiyat güncelleme akışıyla birebir aynı desen.

## ⚡ HAZIR DOSYALAR (2026-07-30)
Bu klasörde entegrasyonu **hazır olarak içeren** tam dosyalar var:
- **`client.py`** — sizin yüklediğiniz client.py'nin işlem kuyruğu EKLENMİŞ hali.
  Mevcut client.py'nizin yerine koyun (ayarlarınız cfg dosyasından okunduğu için korunur).
- **`sync.php`** — sizin yüklediğiniz sync.php'nin `islem_poll` + `islem_mark`
  case'leri EKLENMİŞ hali. Sunucudaki sync.php ile değiştirin.

Yapılan eklemeler:
- Timer otomatik: "Otomatik senkron" başlatıldığında işlem kuyruğu da 30 sn'de bir kontrol edilir
  (watchdog dahil). KOD_PC/KULLANICI, mevcut fiyat güncelleme ayarlarınızdan okunur.
- **ÖNEMLİ AYAR**: `islem_lokasyon` cfg değerini gerçek LOKASYON ID'nizle doldurun
  (Profiler dökümünüzde 75919 idi). Ayar dosyanıza (cfg json) elle ekleyebilirsiniz:
  `"islem_lokasyon": 75919` — girilmezse 0 gönderilir.
- Sayım aktarımı Profiler dökümünüzle birebir: `SAYIM` + `SAYIM_DETAY` insert'leri,
  SEQUENS_VER ile ID, her insert sonrası SEQUNCES_DEGISIKLIK_AD.

`client_islem_ek.py` ve `sync_php_islem_ek.php` aynı eklemelerin yalnız-ek (snippet)
versiyonlarıdır — dosyaları kendiniz elle birleştirmek isterseniz kullanın.

## 🕓 Geçmiş Veri Basma (Backfill) — 2026-07-30
`client.py`'ye eklendi: **4) Senkron** sekmesinde "Geçmiş Tarih Aralığı" satırı.
Başlangıç/bitiş tarihi seçin → **Geçmiş Veriyi Bas (Backfill)** → seçilen aralıktaki
her gün için günlük raporlar ERP'den okunup sunucuya basılır (en yeni günden geriye).

- Basılan datasetler **otomatik seçilir**: tarih parametresi olan ({today_start} vb.)
  ve on-demand olmayan TÜM aktif datasetler. Sizin yapılandırmanızla: financial_data,
  financial_data_location, hourly_data, hourly_location_data, hourly_stock_detail,
  cancel_data, top10/down10_stock_movements, iptal_ozet, iptal_detay, garson_satis_ozet (11 adet).
  **HARİÇ**: raporlar (rap_*), fis_gunluk_bildirim_feed, acik_masalar, acik_masa_detay
  ve ID bazlı on-demand sorgular. İleride eklediğiniz tarih bazlı dataset otomatik dahil olur.
- **Güvenli**: sync.php her günü `sdate` gününe göre AYRI cache'te saklar —
  bugünün verisi ezilmez, mobil uygulama geçmiş tarih raporlarını anında cache'ten okur.
- İlerleme Senkron Logu'nda satır satır görünür; **Backfill Durdur** ile iptal edilebilir.
- En fazla 366 günlük aralık; her push arası 0.15 sn bekleme (ERP'yi yormaz).

## Akış
```
Mobil App ──POST──> backend ──INSERT──> MySQL kasacepteweb.mobil_islem_kuyrugu (durum=bekliyor)
POS client ──sync.php islem_poll──> bekleyen kayıtlar
POS client ──pyodbc──> ERP12 (SEQUENS_VER + FINANS/FINANS_DETAY | FIS/FIS_DETAY)
POS client ──sync.php islem_mark──> durum=aktarildi + erp_id  (hata: durum=hata + mesaj)
```

## 🔐 Mobil İşlem Yetkileri — 2026-07-31
Yeni özellikler (Finans/Fiş/Sayım) VE fiyat güncelleme **client'tan yetkiye bağlı**:
- client.py Ayarlar sekmesinde 4 kontrol: "Mobil fiyat güncellemelerini uygula"
  (mevcut kutu), "Mobil Finans İşlemleri", "Mobil Fatura/Fiş Girişi",
  "Mobil Sayım Fişi" — yeni 3 kutu **varsayılan KAPALI**, fiyat varsayılan AÇIK.
- "Kaydet" veya otomatik senkron başlangıcında yetkiler sunucuya bildirilir
  (`islem_yetki_set` → `mobil_islem_yetkileri` tablosu).
- Kapalı özellikte mobil ekran kilitlenir: "İşleme Yetkiniz Yok — POS
  istemcisinden açılmalıdır" + backend API de 403 döner (çift koruma).
- Client ayrıca kapalı grupların kuyruk kayıtlarını İŞLEMEZ (emniyet filtresi).
- NOT: Yeni client.py + sync.php kurulup checkbox'lar açılana dek mobildeki
  bu 3 ekran kilitli görünür.

## Kurulum Adımları
1. **sync.php**: `sync_php_islem_ek.php` içindeki `islem_poll` ve `islem_mark`
   case'lerini switch bloğuna ekleyin (price_update case'lerinin yanına).
2. **client.py**: `client_islem_ek.py` içindeki metotları sınıfa ekleyin,
   dosya başındaki kurulum notlarını uygulayın. KOD_PC/KULLANICI varsayılan
   olarak mevcut `price_update_kod_pc` / `price_update_kullanici`
   ayarlarınızdan okunur — ek ayar gerekmez.
3. **Yeni ID + değişiklik bildirimi**: Fiyat güncellemede çalışan mevcut
   `_erp_next_sequence_id` (SEQUENS_VER) ve `_exec_sequence_change`
   (SEQUNCES_DEGISIKLIK_AD) metotlarınız aynen kullanılır — ek doğrulama gerekmez.
4. **FIS_TURU eşlemesi**: `fis_turu_map = {47:2, 45:1, 71:4, 69:3}` varsayımını
   kendi kurulumunuza göre doğrulayın (örneğinizde satış faturası FIS_TURU=2 idi).

## Kasa/Banka Listesi Dataset'i
client.py `DEFAULT_DATASET_DEFINITIONS` listesine ekleyin (backend `%kasa%` / `%banka%`
anahtar adlarını otomatik tanır, alanlar: ID + AD yeterli):
```python
{
    "dataset_key": "kasa_liste", "display_name": "Kasa Kartları",
    "enabled": True, "kind": "query", "mode": "push", "database": "",
    "sql": "SELECT ID, AD FROM KART WHERE <KASA KARTI KOŞULUNUZ>",
    "params_order": [], "params_template": {}, "push_enabled": True,
    "push_interval_sec": 3600, "snapshot": True, "guard_zero": True,
    "guard_mass_delete": True, "multi_result": False
},
{
    "dataset_key": "banka_liste", "display_name": "Banka Kartları",
    "enabled": True, "kind": "query", "mode": "push", "database": "",
    "sql": "SELECT ID, AD FROM KART WHERE <BANKA KARTI KOŞULUNUZ>",
    ... (aynı şablon)
},
```
Dataset basıldığı anda uygulamadaki kasa seçimi otomatik bu listeyi kullanır
(uygulamadan manuel eklenenler de korunur, ID çakışmasında dataset öncelikli).

## Kuyruk Kaydı Alanları (islem_poll çıktısı)
| Alan | Açıklama |
|---|---|
| id | Kuyruk ID — **FINANS_DETAY.EXTERNAL_ID'ye yazın (mükerrer önleme)** |
| islem_grubu | 'finans' \| 'fis' \| 'sayim' |
| islem_turu | FINANS_ISLEM_TURU kodu (1,2,15,17,21,31,35,45,47,69,71...) — sayımda 0 |
| kart_borclu / kart_alacakli | Yön tablonuza göre yerleştirilmiş kart ID'leri (sayımda NULL) |
| tutar, aciklama, vade_tarihi, cek_no, vergi_no | Finans alanları (sayımda tutar=toplam miktar) |
| detay_json | Fişlerde: {odeme_tipi, kasa_id, satirlar:[{stok_id,barkod,kod,ad,miktar,fiyat}], geneltoplam} — Sayımda: {lokasyon, satirlar:[{stok_id,barkod,kod,ad,miktar}], toplam_kalem, toplam_miktar} |
| cek_resmi | base64 (yalnız `islem_poll`'a `{"include_resim":1}` eklerseniz gelir) |

## Sayım Fişi (Faz 3)
Mobil sayım ekranı kayıtları `islem_grubu='sayim'` olarak kuyruğa yazar.
Aktarım hedefi (2026-07-30 Profiler dökümünüzden): **SAYIM + SAYIM_DETAY** tabloları.
`apply_sayim_islem_to_erp` bu dökümle birebir dolduruldu — ek uyarlama gerekmez.
Tek şart: `islem_lokasyon` ayarının gerçek LOKASYON ID'nizle dolu olması.
Hata durumuna düşen kayıtlar mobil uygulamadaki **Kuyruk Durumu** ekranından
"Yeniden Dene" ile tekrar kuyruğa alınabilir.
