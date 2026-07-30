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

## Akış
```
Mobil App ──POST──> backend ──INSERT──> MySQL kasacepteweb.mobil_islem_kuyrugu (durum=bekliyor)
POS client ──sync.php islem_poll──> bekleyen kayıtlar
POS client ──pyodbc──> ERP12 (SEQUENS_VER + FINANS/FINANS_DETAY | FIS/FIS_DETAY)
POS client ──sync.php islem_mark──> durum=aktarildi + erp_id  (hata: durum=hata + mesaj)
```

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
