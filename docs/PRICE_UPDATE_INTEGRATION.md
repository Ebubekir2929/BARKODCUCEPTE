# 🔁 Fiyat Güncelleme — Windows POS Client Entegrasyonu

## Genel Akış

```
┌─────────────┐      POST       ┌──────────────────────────┐
│  Mobil App  │ ───────────────> │ patron.pending_price_    │
│ (kullanıcı)  │ /api/stock/...   │ updates                  │
└─────────────┘                  └────────┬─────────────────┘
                                          │ Windows client
                                          ▼ her N saniyede bir
                                  GET /api/stock/price-update/poll
                                          │
                                          ▼
                                  Yerel POS DB'sine UPDATE
                                          │
                                          ▼
                                  POST /api/stock/price-update/
                                       mark-applied-bulk
```

## API Endpoint'leri (Windows Client için)

### 1. Önce Login (token al)
```http
POST https://pos-app-store.preview.emergentagent.com/api/auth/login
Content-Type: application/json

{
  "email": "kullanici@email.com",
  "password": "şifre"
}
```
Response:
```json
{ "access_token": "eyJhbGciOiJI...", "token_type": "bearer", "user": {...} }
```
> Token 72 saat geçerli. Süresi dolunca yeniden login olun.

### 2. Bekleyen Güncellemeleri Çek (POLLING)
Her N saniyede bir (önerilen: 30-60 sn):
```http
POST https://pos-app-store.preview.emergentagent.com/api/stock/price-update/poll
Authorization: Bearer <access_token>
```
Response:
```json
{
  "success": true,
  "tenant_id": "d5587c87a7f9476fa82b83f40accd6c7",
  "count": 3,
  "items": [
    {
      "id": 17,
      "product_id": "443226",
      "product_barcode": "9998000007895",
      "product_name": "Sade Çay",
      "old_price": 25.00,
      "new_price": 27.50,
      "batch_id": "abc123...",
      "created_at": "2026-05-21T10:30:00"
    }
  ]
}
```

### 3. POS DB'sine Uygula
Aldığınız her item için **kendi POS yazılımınızda** UPDATE yapın:
```sql
UPDATE stoklar SET satis_fiyat = ? WHERE stok_id = ?;
```
- `product_id` = sizin POS sisteminizdeki ürün ID'si (mobile uygulamadaki `ID` field'i)
- `new_price` = uygulanacak yeni fiyat
- Hata olursa `error_message` alanına yazın

### 4. Uygulananları İşaretle (mark-applied)
**Toplu** (önerilen):
```http
POST https://pos-app-store.preview.emergentagent.com/api/stock/price-update/mark-applied-bulk
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "ids": [17, 18, 19]
}
```
**Tek tek** (hata olduğunda):
```http
POST https://pos-app-store.preview.emergentagent.com/api/stock/price-update/17/mark-applied
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "error_message": "Ürün bulunamadı: STK-XXX"
}
```
Hata varsa `error_message` gönderin → status `'failed'` olur, mobil ekranda görünür.

---

## Örnek C# (.NET) Implementation

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

public class PriceSyncService
{
    private const string BASE = "https://pos-app-store.preview.emergentagent.com";
    private string _token;
    private readonly HttpClient _http = new HttpClient();

    public async Task LoginAsync(string email, string password)
    {
        var body = JsonConvert.SerializeObject(new { email, password });
        var resp = await _http.PostAsync($"{BASE}/api/auth/login",
            new StringContent(body, Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        dynamic j = JsonConvert.DeserializeObject(await resp.Content.ReadAsStringAsync());
        _token = (string)j.access_token;
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);
    }

    public async Task PollAndApplyAsync()
    {
        var resp = await _http.PostAsync($"{BASE}/api/stock/price-update/poll", null);
        resp.EnsureSuccessStatusCode();
        dynamic j = JsonConvert.DeserializeObject(await resp.Content.ReadAsStringAsync());

        var appliedIds = new System.Collections.Generic.List<int>();
        foreach (var item in j.items)
        {
            int productId = (int)item.product_id;
            decimal newPrice = (decimal)item.new_price;
            // !!! Burada yerel POS DB'nize bağlanıp UPDATE atın
            // var cmd = new SqlCommand("UPDATE STOKLAR SET FIYAT=@p WHERE ID=@id", conn);
            // cmd.Parameters.AddWithValue("@p", newPrice);
            // cmd.Parameters.AddWithValue("@id", productId);
            // cmd.ExecuteNonQuery();
            appliedIds.Add((int)item.id);
        }

        if (appliedIds.Count > 0)
        {
            var body = JsonConvert.SerializeObject(new { ids = appliedIds });
            await _http.PostAsync($"{BASE}/api/stock/price-update/mark-applied-bulk",
                new StringContent(body, Encoding.UTF8, "application/json"));
            Console.WriteLine($"Applied: {appliedIds.Count} price updates");
        }
    }
}

// Timer ile periyodik:
//   var svc = new PriceSyncService();
//   await svc.LoginAsync("user@x", "pass");
//   var timer = new System.Timers.Timer(30000);
//   timer.Elapsed += async (s,e) => await svc.PollAndApplyAsync();
//   timer.Start();
```

## Örnek PHP Implementation

```php
<?php
$BASE = "https://pos-app-store.preview.emergentagent.com";

// 1. Login
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

// 2. Poll & Apply
function syncPrices($base, $token, $pdo) {
    // Poll
    $ch = curl_init("$base/api/stock/price-update/poll");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer $token"],
    ]);
    $r = json_decode(curl_exec($ch), true);
    curl_close($ch);

    $appliedIds = [];
    foreach (($r['items'] ?? []) as $item) {
        $pid = $item['product_id'];
        $newPrice = $item['new_price'];
        // !!! Yerel POS DB UPDATE
        $stmt = $pdo->prepare("UPDATE stoklar SET satis_fiyat = :p WHERE id = :id");
        if ($stmt->execute([':p' => $newPrice, ':id' => $pid])) {
            $appliedIds[] = $item['id'];
        }
    }

    // 3. Mark applied
    if (count($appliedIds) > 0) {
        $ch = curl_init("$base/api/stock/price-update/mark-applied-bulk");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer $token",
                "Content-Type: application/json",
            ],
            CURLOPT_POSTFIELDS => json_encode(['ids' => $appliedIds]),
        ]);
        curl_exec($ch);
        curl_close($ch);
        echo "Applied " . count($appliedIds) . " price updates\n";
    }
}

// Daemon
$token = login($BASE, 'user@email.com', 'pass');
$pdo = new PDO('mysql:host=localhost;dbname=pos', 'user', 'pass');
while (true) {
    syncPrices($BASE, $token, $pdo);
    sleep(30);
}
```

---

## Database Schema (zaten oluşturuldu)

Tablo: `patron.pending_price_updates`

| Kolon | Tip | Açıklama |
|-------|-----|----------|
| id | BIGINT | Auto increment |
| user_id | INT | Hangi mobil kullanıcı yazdı |
| tenant_id | VARCHAR(64) | Müşteri tenant'ı (filtre için) |
| product_id | VARCHAR(64) | POS ürün ID'si |
| product_barcode | VARCHAR(64) | Referans (opsiyonel) |
| product_name | VARCHAR(255) | Referans (opsiyonel) |
| old_price | DECIMAL(15,2) | Son bilinen fiyat |
| **new_price** | DECIMAL(15,2) | **Uygulanacak yeni fiyat** ⭐ |
| status | ENUM | `pending` / `applied` / `failed` / `cancelled` |
| source | VARCHAR(20) | `mobile` / `bulk` / `api` |
| batch_id | VARCHAR(40) | Aynı işlemde gönderilenleri grupla |
| created_at | DATETIME | Oluşturma zamanı |
| applied_at | DATETIME | Uygulama / iptal zamanı |
| error_message | VARCHAR(500) | Hata mesajı |

### Direkt MySQL Sorgusu (HTTP yerine SQL kullanmak isterseniz)

Aynı zamanda Windows client'tan MariaDB'ye direkt SELECT atabilirsiniz:

```sql
-- Bekleyenleri çek
SELECT id, product_id, new_price, batch_id
FROM patron.pending_price_updates
WHERE tenant_id = 'SİZİN_TENANT_ID'
  AND status = 'pending'
ORDER BY created_at ASC;

-- Uygulananları işaretle
UPDATE patron.pending_price_updates
SET status = 'applied', applied_at = NOW()
WHERE id IN (17, 18, 19);
```

---

## Test Adımları

1. Mobil uygulamada Stok ekranını açın → sağ üstte **"Fiyat Güncelle"** butonuna tıklayın
2. **"+ Yeni Güncelleme"** → Tek Ürün modu → bir ürün seçin → yeni fiyat girin → **Sıraya Al**
3. Şifre onayından geçirin → "Sıraya alındı" mesajı görüldüğünde Bekleyen listesinde görünür
4. Windows client'ta polling endpoint'i çağırarak bekleyenleri çekin
5. Yerel UPDATE atın → `mark-applied-bulk` ile onaylayın
6. Mobilde tab değiştirip "Uygulandı" listesinde olduğunu doğrulayın

## Hata Durumları

| Durum | Çözüm |
|-------|-------|
| `401 Şifre hatalı` | Token expired → tekrar login |
| `400 Tenant ID bulunamadı` | User'ın tenant_id'si yok, ayarlardan veri kaynağı tanımlasın |
| `404 Bekleyen güncelleme bulunamadı` | ID zaten uygulanmış veya iptal edilmiş |
| Network timeout | 30 sn sonra tekrar dene |
