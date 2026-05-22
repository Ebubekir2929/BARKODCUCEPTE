# 🔁 Fiyat Güncelleme — Windows POS Client Dokümantasyonu

> **Versiyon**: 2.0 (Çoklu fiyat adı desteği eklendi)
> **Son güncelleme**: 2026-05-22

---

## 📋 İçindekiler

1. [Genel Akış](#genel-akış)
2. [API Endpoint Özeti](#api-endpoint-özeti)
3. [Authentication (Login)](#1-authentication-login)
4. [Polling — Bekleyenleri Çek](#2-polling--bekleyenleri-çek)
5. [Yerel POS DB'sine Uygula](#3-yerel-pos-dbsine-uygula)
6. [Mark Applied — Onayla](#4-mark-applied--onayla)
7. [Çoklu Fiyat Adı Senaryosu](#çoklu-fiyat-adı-senaryosu)
8. [Tam C# Örneği](#tam-c-örneği)
9. [Tam PHP Örneği](#tam-php-örneği)
10. [DB Schema Referansı](#db-schema-referansı)
11. [Hata Kodları](#hata-kodları)

---

## Genel Akış

```
┌─────────────┐      POST       ┌──────────────────────────┐
│   Mobil     │ ───────────────> │ patron.pending_price_    │
│ Kullanıcı   │ /api/stock/...   │ updates  (status=pending)│
└─────────────┘                  └──────────┬───────────────┘
                                            │
                                            │ Windows client (her 30-60sn)
                                            ▼
                              POST /api/stock/price-update/poll
                                            │
                                            ▼
                                  Bekleyen kayıt listesi
                                            │
                                            ▼
                                  Yerel POS DB'sine UPDATE
                                            │
                                            ▼
                       POST /api/stock/price-update/mark-applied-bulk
                                            │
                                            ▼
                              patron.pending_price_updates
                                  (status=applied)
                                            │
                                            ▼
                              Mobilde "Uygulandı" sekmesinde görünür
```

🔒 **Önemli**: Mobil uygulama HİÇBİR ZAMAN canlı POS API kredisi yakmaz. Her şey `pending_price_updates` MariaDB tablosu üzerinden asenkron olarak işler. Windows client çalışmadığı sürece kayıtlar `pending` durumunda bekler.

---

## API Endpoint Özeti

**Base URL**: `https://price-update-test.preview.emergentagent.com`
(Kendi domain'iniz farklıysa değiştirin.)

| Yön | Endpoint | Kim Çağırır |
|---|---|---|
| `POST` | `/api/auth/login` | Windows client (token almak için) |
| `POST` | `/api/stock/price-update/poll` | Windows client (bekleyenleri çek) |
| `POST` | `/api/stock/price-update/mark-applied-bulk` | Windows client (toplu onay) |
| `POST` | `/api/stock/price-update/{id}/mark-applied` | Windows client (tek onay/hata) |
| `GET`  | `/api/stock/price-update` | Mobil app (listeleme) |
| `POST` | `/api/stock/price-update` | Mobil app (oluşturma) |

Windows client SADECE üst 3 endpoint'i kullanır. Auth zorunludur.

---

## 1. Authentication (Login)

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "kullanici@email.com",
  "password": "sifre"
}
```

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "user_id": 55,
    "tenant_id": "d5587c87a7f9476fa82b83f40accd6c7",
    "email": "...",
    ...
  }
}
```

🕒 Token **72 saat** geçerli. Süresi dolunca yeniden login olun. Tüm sonraki çağrılarda:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## 2. Polling — Bekleyenleri Çek

Windows client'ı **her 30-60 saniyede** bir bunu çağırın:

```http
POST /api/stock/price-update/poll?limit=200
Authorization: Bearer <access_token>
```

`limit` parametresi opsiyonel (default=200, max=1000).

**Response** (200 OK):
```json
{
  "success": true,
  "tenant_id": "d5587c87a7f9476fa82b83f40accd6c7",
  "count": 4,
  "items": [
    {
      "id": 127,
      "product_id": "443226",
      "product_barcode": "9998000007895",
      "product_name": "Sade Çay",
      "price_name_id": 1016,
      "price_name": "Parekende",
      "old_price": 25.00,
      "new_price": 27.50,
      "batch_id": "a3f8c1d2e4...",
      "created_at": "2026-05-22T10:30:00"
    },
    {
      "id": 128,
      "product_id": "443226",
      "product_barcode": "9998000007895",
      "product_name": "Sade Çay",
      "price_name_id": 1017,
      "price_name": "Bayi",
      "old_price": 20.00,
      "new_price": 22.00,
      "batch_id": "a3f8c1d2e4...",
      "created_at": "2026-05-22T10:30:00"
    }
  ]
}
```

> 📌 **Aynı ürün** için aynı batch_id ile birden çok kayıt gelebilir (her fiyat adı için bir kayıt). Bu nedenle `(product_id, price_name_id)` birlikte ele alınmalıdır.

### Önemli Alanlar

| Alan | Açıklama |
|------|---------|
| `id` | Pending kaydın benzersiz ID'si — `mark-applied` için gereklidir |
| `product_id` | POS sisteminizdeki ürün ID (mobile uygulamadaki `ID`) |
| `product_barcode` | Çift kontrol için barkod (opsiyonel ama önerilir) |
| `price_name_id` | **Hangi fiyat listesi** (örn. 1016=Parekende, 1017=Bayi). NULL ise eski tek-fiyat kaydı. |
| `price_name` | Fiyat listesi adı (insan okuyabilir) |
| `old_price` | Mobilden çekildiği andaki bilinen son fiyat (referans, zorunlu değil) |
| `new_price` | **Uygulanacak yeni fiyat** ⭐ |
| `batch_id` | Aynı işlemde gönderilenleri gruplar — UI'da topluca göstermek için kullanışlı |

---

## 3. Yerel POS DB'sine Uygula

Her item için POS sisteminizde `(product_id, price_name_id)` çiftine göre UPDATE atın.

### Tek Fiyat Tablosu (eski POS şeması)
Eğer POS sisteminizde tek bir fiyat kolonu varsa:
```sql
UPDATE STOK
SET FIYAT = @new_price
WHERE STOK_ID = @product_id;
```
`price_name_id` alanını yok sayabilirsiniz (NULL gelebilir).

### Çoklu Fiyat Tablosu (yeni POS şeması)
Eğer POS sisteminizde her ürün için birden fazla fiyat (Parekende, Bayi, vb.) tutuluyorsa:
```sql
UPDATE STOK_FIYAT
SET FIYAT = @new_price
WHERE STOK_ID = @product_id
  AND FIYAT_AD_ID = @price_name_id;
```

> ⚠️ `price_name_id` NULL gelirse, default fiyat listesini (genelde Parekende) güncelleyin.

### Pseudo-kod
```
for item in response.items:
    if item.price_name_id is not None:
        UPDATE local_pos.STOK_FIYAT
        SET FIYAT = item.new_price
        WHERE STOK_ID = item.product_id
          AND FIYAT_AD_ID = item.price_name_id
    else:
        # Eski tek fiyat senaryosu
        UPDATE local_pos.STOK
        SET FIYAT = item.new_price
        WHERE STOK_ID = item.product_id

    if rows_affected > 0:
        success_ids.append(item.id)
    else:
        # Ürün bulunamadı — failed olarak işaretle
        failed_ids.append((item.id, "Ürün bulunamadı"))
```

---

## 4. Mark Applied — Onayla

### 4a. Başarılı Olanları Toplu Onayla (Önerilen)

```http
POST /api/stock/price-update/mark-applied-bulk
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "ids": [127, 128, 129, 130]
}
```

**Response**:
```json
{ "success": true, "applied_count": 4, "status": "applied" }
```

### 4b. Başarısız Olanları Tek Tek İşaretle

```http
POST /api/stock/price-update/127/mark-applied
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "error_message": "Ürün POS sisteminde bulunamadı: STK-443226"
}
```

`error_message` GÖNDERİLİRSE → status `failed` olur, mobilde kırmızı ⚠ ile görünür.
`error_message` GÖNDERİLMEZSE → status `applied` olur.

### 4c. Toplu Hata İşaretleme

```http
POST /api/stock/price-update/mark-applied-bulk
{
  "ids": [131, 132],
  "error_message": "POS DB yazma hatası: timeout"
}
```

---

## Çoklu Fiyat Adı Senaryosu

Mobil uygulama 2026-05-21'den itibaren, kullanıcının bir ürün için birden fazla fiyat adı (Parekende + Bayi + Dağıtıcı) için aynı anda güncelleme göndermesine izin verir.

**Örnek**: Kullanıcı 2 ürün seçer, "Diğer fiyat adlarına da uygula" tikler, 3 fiyat adı vardır. Backend `2 ürün × 3 fiyat adı = 6 kayıt` üretir. Hepsi aynı `batch_id` ile.

Polling endpoint'i bunları tek tek döner. Sizin client'ınız her birini doğru kolon/tabloya yazar.

### batch_id Kullanımı (opsiyonel)

Aynı batch'in **hepsi başarılı olmadıkça** hiçbirini uygulamak istemiyorsanız, transaction içinde işleyin:

```sql
BEGIN;
UPDATE ... -- her item için
-- hepsi başarılı?
COMMIT;
-- veya
ROLLBACK;
```

---

## Tam C# Örneği

```csharp
using System;
using System.Collections.Generic;
using System.Data.SqlClient;          // veya MySqlConnector
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class PriceSyncService
{
    private const string BASE = "https://price-update-test.preview.emergentagent.com";
    private const string LOCAL_CONN = "Server=.;Database=POS;Trusted_Connection=True;";

    private string _token;
    private readonly HttpClient _http = new HttpClient();

    public async Task<bool> LoginAsync(string email, string password)
    {
        var body = JsonConvert.SerializeObject(new { email, password });
        var resp = await _http.PostAsync($"{BASE}/api/auth/login",
            new StringContent(body, Encoding.UTF8, "application/json"));
        if (!resp.IsSuccessStatusCode) return false;
        var j = JObject.Parse(await resp.Content.ReadAsStringAsync());
        _token = j["access_token"]?.ToString();
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        return !string.IsNullOrEmpty(_token);
    }

    public async Task PollAndApplyAsync()
    {
        // 1) Bekleyenleri çek
        var resp = await _http.PostAsync($"{BASE}/api/stock/price-update/poll?limit=200", null);
        resp.EnsureSuccessStatusCode();
        var j = JObject.Parse(await resp.Content.ReadAsStringAsync());
        var items = (JArray)j["items"];

        if (items.Count == 0) return;
        Console.WriteLine($"Çekildi: {items.Count} bekleyen güncelleme");

        var success = new List<int>();
        var failed  = new List<(int id, string msg)>();

        // 2) Yerel DB UPDATE
        using (var conn = new SqlConnection(LOCAL_CONN))
        {
            conn.Open();
            foreach (var item in items)
            {
                int id          = (int)item["id"];
                string productId= (string)item["product_id"];
                decimal newPrice= (decimal)item["new_price"];
                int? priceNameId= item["price_name_id"]?.Type == JTokenType.Null ? null : (int?)item["price_name_id"];

                try
                {
                    string sql;
                    if (priceNameId.HasValue)
                    {
                        sql = @"UPDATE STOK_FIYAT SET FIYAT=@p
                                WHERE STOK_ID=@id AND FIYAT_AD_ID=@pn";
                    }
                    else
                    {
                        sql = @"UPDATE STOK SET FIYAT=@p WHERE STOK_ID=@id";
                    }

                    using (var cmd = new SqlCommand(sql, conn))
                    {
                        cmd.Parameters.AddWithValue("@p", newPrice);
                        cmd.Parameters.AddWithValue("@id", productId);
                        if (priceNameId.HasValue)
                            cmd.Parameters.AddWithValue("@pn", priceNameId.Value);
                        int affected = cmd.ExecuteNonQuery();

                        if (affected > 0)
                            success.Add(id);
                        else
                            failed.Add((id, $"Ürün bulunamadı: {productId}"));
                    }
                }
                catch (Exception ex)
                {
                    failed.Add((id, ex.Message));
                }
            }
        }

        // 3a) Başarılıları toplu onayla
        if (success.Count > 0)
        {
            var body = JsonConvert.SerializeObject(new { ids = success });
            await _http.PostAsync($"{BASE}/api/stock/price-update/mark-applied-bulk",
                new StringContent(body, Encoding.UTF8, "application/json"));
            Console.WriteLine($"✅ Uygulandı: {success.Count}");
        }

        // 3b) Başarısızları tek tek
        foreach (var (id, msg) in failed)
        {
            var body = JsonConvert.SerializeObject(new { error_message = msg });
            await _http.PostAsync($"{BASE}/api/stock/price-update/{id}/mark-applied",
                new StringContent(body, Encoding.UTF8, "application/json"));
        }
        if (failed.Count > 0)
            Console.WriteLine($"❌ Başarısız: {failed.Count}");
    }
}

// === Daemon kullanımı ===
class Program
{
    static async Task Main()
    {
        var svc = new PriceSyncService();
        if (!await svc.LoginAsync("kullanici@email.com", "sifre"))
        {
            Console.WriteLine("Login başarısız!");
            return;
        }

        // Her 30 saniyede bir poll et
        var timer = new System.Timers.Timer(30_000);
        timer.Elapsed += async (s, e) =>
        {
            try { await svc.PollAndApplyAsync(); }
            catch (Exception ex) { Console.WriteLine($"Hata: {ex.Message}"); }
        };
        timer.Start();

        Console.WriteLine("Sync başladı. Çıkış için ENTER...");
        Console.ReadLine();
    }
}
```

---

## Tam PHP Örneği

```php
<?php
$BASE = "https://price-update-test.preview.emergentagent.com";

// === 1. Login ===
function login($base, $email, $password) {
    $ch = curl_init("$base/api/auth/login");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(compact('email', 'password')),
    ]);
    $r = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $r['access_token'] ?? null;
}

// === 2 + 3. Poll & Apply ===
function syncPrices($base, $token, $pdo) {
    // Poll
    $ch = curl_init("$base/api/stock/price-update/poll?limit=200");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer $token"],
    ]);
    $r = json_decode(curl_exec($ch), true);
    curl_close($ch);

    if (empty($r['items'])) return;
    echo "Bekleyen: " . count($r['items']) . "\n";

    $success = [];
    $failed  = [];

    foreach ($r['items'] as $item) {
        $id          = $item['id'];
        $productId   = $item['product_id'];
        $newPrice    = $item['new_price'];
        $priceNameId = $item['price_name_id'] ?? null;

        try {
            if ($priceNameId !== null) {
                $stmt = $pdo->prepare(
                    "UPDATE STOK_FIYAT SET FIYAT = :p
                     WHERE STOK_ID = :id AND FIYAT_AD_ID = :pn"
                );
                $stmt->execute([
                    ':p'  => $newPrice,
                    ':id' => $productId,
                    ':pn' => $priceNameId,
                ]);
            } else {
                $stmt = $pdo->prepare(
                    "UPDATE STOK SET FIYAT = :p WHERE STOK_ID = :id"
                );
                $stmt->execute([':p' => $newPrice, ':id' => $productId]);
            }

            if ($stmt->rowCount() > 0)
                $success[] = $id;
            else
                $failed[$id] = "Ürün bulunamadı: $productId";
        } catch (Exception $e) {
            $failed[$id] = $e->getMessage();
        }
    }

    // 4a. Başarılı olanları toplu onayla
    if (count($success) > 0) {
        $ch = curl_init("$base/api/stock/price-update/mark-applied-bulk");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer $token",
                "Content-Type: application/json",
            ],
            CURLOPT_POSTFIELDS => json_encode(['ids' => $success]),
        ]);
        curl_exec($ch);
        curl_close($ch);
        echo "✅ Uygulandı: " . count($success) . "\n";
    }

    // 4b. Hatalıları tek tek
    foreach ($failed as $id => $msg) {
        $ch = curl_init("$base/api/stock/price-update/$id/mark-applied");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer $token",
                "Content-Type: application/json",
            ],
            CURLOPT_POSTFIELDS => json_encode(['error_message' => $msg]),
        ]);
        curl_exec($ch);
        curl_close($ch);
    }
}

// === Daemon ===
$token = login($BASE, 'kullanici@email.com', 'sifre');
$pdo   = new PDO('mysql:host=localhost;dbname=POS', 'kullanici', 'sifre',
                 [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
while (true) {
    try { syncPrices($BASE, $token, $pdo); }
    catch (Exception $e) { echo "Hata: " . $e->getMessage() . "\n"; }
    sleep(30);
}
```

---

## Direkt SQL ile Çekme (HTTP'siz alternatif)

Eğer Windows client backend'in MariaDB'sine DIREKT erişebiliyorsa (aynı network'te), HTTP yerine SQL ile de çekebilirsiniz:

```sql
-- Bekleyenleri çek
SELECT id, product_id, product_barcode, product_name,
       price_name_id, price_name,
       old_price, new_price, batch_id, created_at
FROM patron.pending_price_updates
WHERE tenant_id = 'SIZIN_TENANT_ID'
  AND status = 'pending'
ORDER BY created_at ASC;

-- Uygulananları işaretle
UPDATE patron.pending_price_updates
SET status = 'applied', applied_at = NOW()
WHERE id IN (127, 128, 129);

-- Hatalı olanları işaretle
UPDATE patron.pending_price_updates
SET status = 'failed', applied_at = NOW(), error_message = 'Ürün bulunamadı'
WHERE id = 130;
```

**Tenant ID**'nizi bulmak için**:
- Mobil uygulamada Settings → Veri Kaynakları → ilgili tenantın altındaki 🔑 ile başlayan hex string

---

## DB Schema Referansı

**Tablo**: `patron.pending_price_updates`

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | BIGINT | Auto-increment PK |
| `user_id` | INT | Mobil kullanıcı |
| `tenant_id` | VARCHAR(64) | Müşteri tenant'ı (filtre için ⭐) |
| `product_id` | VARCHAR(64) | POS ürün ID'si |
| `product_barcode` | VARCHAR(64) | Referans (opsiyonel) |
| `product_name` | VARCHAR(255) | Referans (opsiyonel) |
| `price_name_id` | INT | Hangi fiyat adı (1016=Parekende, vb.). NULL=tek fiyat |
| `price_name` | VARCHAR(100) | Fiyat adı (insan okuyabilir) |
| `old_price` | DECIMAL(15,2) | Son bilinen fiyat |
| `new_price` | DECIMAL(15,2) | **Uygulanacak yeni fiyat** ⭐ |
| `status` | ENUM | `pending` / `applied` / `failed` / `cancelled` |
| `source` | VARCHAR(20) | `mobile` / `bulk` / `api` / `web` |
| `batch_id` | VARCHAR(40) | Aynı işlemde gönderilenleri gruplar |
| `created_at` | DATETIME | Mobilde oluşturma zamanı |
| `applied_at` | DATETIME | Client işleme zamanı |
| `error_message` | VARCHAR(500) | Hata mesajı (failed olduğunda) |
| `notes` | VARCHAR(500) | Opsiyonel kullanıcı notu |

**Index'ler**:
- `idx_tenant_status (tenant_id, status)` — polling sorgusu için
- `idx_user_created (user_id, created_at)` — mobil listeleme için
- `idx_batch (batch_id)` — batch iptal için

---

## Hata Kodları

| HTTP | Hata | Çözüm |
|------|------|-------|
| `401` | Şifre hatalı / token geçersiz | Yeniden login, token yenile |
| `403` | Authorization header eksik | `Bearer <token>` ekleyin |
| `400` | Tenant ID bulunamadı | Kullanıcı için veri kaynağı tanımlı değil |
| `404` | Bekleyen güncelleme bulunamadı | ID zaten applied/cancelled olmuş |
| `422` | Geçersiz body alanları | JSON formatı / required alanları kontrol edin |
| `500` | Sunucu hatası | Backend log'unu kontrol edin |

### Hata Durumu Davranışları

```
Network timeout       → 30 sn bekle, tekrar dene
Token expired (401)   → Yeniden login, token güncelle
Tenant_id eksik (400) → Kullanıcıya bildir, sync'i durdur
Item already applied  → Yok say (idempotent davranış)
DB write error        → mark-applied (error_message ile) → status=failed
```

---

## Test Senaryosu (End-to-End)

1. **Mobile**: Stok ekranında "Fiyat Güncelle" → 2 ürün seç → "Diğer fiyat adlarına da uygula" tikle → Devam Et → 3 ürünün 3 fiyat adına da farklı fiyatlar gir → Sıraya Al → Şifre onayla → "9 kayıt sıraya alındı" mesajı.

2. **Windows Client**: 30 sn sonra polling → 9 bekleyen kayıt gelir (`(product_id, price_name_id)` çiftleri farklı).

3. **Windows Client**: Yerel POS DB'sine 9 UPDATE atar → 8 tanesi başarılı, 1 tanesi ürün bulunamaz.

4. **Windows Client**: 
   - 8 ID için → `mark-applied-bulk` (success listesi)
   - 1 ID için → `/{id}/mark-applied` (error_message ile)

5. **Mobile**: Otomatik yenilenir → "Uygulandı (8)" + "Bekleyen (0)" + 1 kayıt kırmızı ⚠ ile pending listesinde (failed olarak).

---

## Sıkça Sorulan Sorular

**S: Aynı ürünün birden fazla pending kaydı varsa ne olur?**
C: Hepsi sıralı olarak uygulanır (eski → yeni). Genelde sadece sonuncusu geçerli olur. İsterseniz client tarafında dedup yapabilirsiniz: aynı `(product_id, price_name_id)` için sadece en yeni kaydı uygulayın, eskileri `mark-applied` ile pas geçin.

**S: Windows client kapalıyken biriken kayıtlar ne olur?**
C: `pending` durumunda bekler. Client açıldığında hepsi sırayla işlenir. Limit 1000'dir, daha fazlası varsa birden çok poll gerekir.

**S: Tenant filtresi nasıl çalışıyor?**
C: Login eden kullanıcının primary `tenant_id`'si üzerinden tüm sorgular filtrelenir. Her client kendi tenant'ının kayıtlarını görür.

**S: Aynı anda 2 Windows client çalışırsa?**
C: İkisi de aynı `pending` listesini görür. Aynı kaydı 2 kez güncelleyebilirler ama `mark-applied` ilki başarılı olduktan sonra ikincisi 404 alır (idempotent). Tek client tavsiye edilir.

---

📞 **Backend developer iletişim**: Sorularınız için kullanıcıya iletin → backend Python kodu `/app/backend/routes/price_update.py` dosyasındadır.
