# POS Entegrasyonu — Mobil İşlem Kuyruğu (2026-07)

Mobil uygulamadaki **Finans İşlemleri** (Tahsilat/Ödeme/Çek/Senet) ve **Fatura/Fiş Girişi**
kayıtlarının ERP12'ye aktarımı — fiyat güncelleme akışıyla birebir aynı desen.

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
   dosya başındaki kurulum notlarını uygulayın (timer + cfg anahtarları:
   `islem_kod_pc`, `islem_kullanici`, `islem_proje`, `islem_lokasyon`).
3. **SEQUENS_VER doğrulaması**: `sequens_ver()` yeni ID'yi `SELECT` sonucu olarak
   bekliyor — prosedürünüz farklı döndürüyorsa uyarlayın.
4. **FIS_TURU eşlemesi**: `fis_turu_map = {47:2, 45:1, 71:4, 69:3}` varsayımını
   kendi kurulumunuza göre doğrulayın (örneğinizde satış faturası FIS_TURU=2 idi).

## Kasa/Banka Listesi Dataset'i
client.py `DATASETS` listesine ekleyin (backend `%kasa%` / `%banka%` anahtar
adlarını otomatik tanır, alanlar: ID + AD yeterli):
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
| islem_grubu | 'finans' \| 'fis' |
| islem_turu | FINANS_ISLEM_TURU kodu (1,2,15,17,21,31,35,45,47,69,71...) |
| kart_borclu / kart_alacakli | Yön tablonuza göre yerleştirilmiş kart ID'leri |
| tutar, aciklama, vade_tarihi, cek_no, vergi_no | Finans alanları |
| detay_json | Fişlerde: {odeme_tipi, kasa_id, satirlar:[{stok_id,barkod,kod,ad,miktar,fiyat}], geneltoplam} |
| cek_resmi | base64 (yalnız `islem_poll`'a `{"include_resim":1}` eklerseniz gelir) |
