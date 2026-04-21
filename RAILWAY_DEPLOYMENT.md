# 🚂 Railway Deployment Rehberi — Barkodcu Cepte

Bu rehber, projeyi sıfırdan Railway'e deploy etmek için hazırlandı.

## 📋 Ön Koşullar

- ✅ GitHub hesabı (kodunuz zaten Github'da)
- ✅ Railway hesabı — https://railway.app → **"Start a New Project"** → GitHub ile giriş yap
- ✅ Gmail App Password (SMTP için) — https://myaccount.google.com/apppasswords

---

## 🚀 Adım 1: Railway Projesi Oluştur

1. Railway'e giriş yap → **"+ New Project"**
2. **"Deploy from GitHub repo"** seç
3. Projenizin reposunu seç (Railway otomatik GitHub erişimi ister)
4. Railway bir servis oluşturur — **ilk başta başarısız olacak, normal.** Çünkü Railway tüm repo'yu root'tan build etmeye çalışıyor. Önce Dockerfile'ı gösterelim.

---

## 🐳 Adım 2: Backend Servisini Yapılandır

Service panelinde:

### 2.1 Settings → Build
- **Builder**: `Dockerfile`
- **Dockerfile Path**: `backend/Dockerfile`
- **Root Directory**: `backend` ← çok önemli
- **Watch Paths**: `backend/**`

### 2.2 Settings → Deploy
- **Start Command**: (boş bırakın, Dockerfile CMD zaten var)
- **Healthcheck Path**: `/api/`
- **Restart Policy**: `On Failure`

### 2.3 Settings → Networking
- **"Generate Domain"** butonuna bas → Railway size şöyle bir URL verir:
  ```
  https://barkodcu-cepte-backend-production.up.railway.app
  ```
- Bu URL'yi kopyalayın — frontend için lazım olacak.

---

## 🗄️ Adım 3: MongoDB Database Ekle

**(Eğer MongoDB kullanıyorsanız; MySQL zaten 185.223.77.132 üzerinde kalacak)**

1. Aynı projede **"+ New"** → **"Database"** → **"Add MongoDB"**
2. Railway otomatik olarak bir MongoDB instance açar ve `MONGO_URL` değişkenini servisinize otomatik enjekte eder.

> **Not**: Eğer MongoDB'yi hiç kullanmıyorsanız (sadece MySQL ile çalışıyorsa) bu adımı atlayın.

---

## 🔐 Adım 4: Environment Variables Ekle

Backend servisin **"Variables"** sekmesine girin, şu değişkenleri tek tek ekleyin:

| Variable | Value |
|---|---|
| `MONGO_URL` | `${{MongoDB.MONGO_URL}}` (MongoDB eklediyseniz) |
| `DB_NAME` | `barkodcucepte_prod` |
| `MYSQL_PATRON_HOST` | `185.223.77.132` |
| `MYSQL_PATRON_DB` | `patron` |
| `MYSQL_PATRON_USER` | `patron` |
| `MYSQL_PATRON_PASS` | `gO8j79d8$` |
| `MYSQL_DATA_HOST` | `185.223.77.132` |
| `MYSQL_DATA_DB` | `kasacepteweb` |
| `MYSQL_DATA_USER` | `kceptetransfer` |
| `MYSQL_DATA_PASS` | `wV013$zh3` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `cakmak.ebubekir29@gmail.com` |
| `SMTP_PASSWORD` | `jdwd oqfp juae vnkq` |
| `SMTP_FROM` | `destek@berkyazilim.com` |
| `JWT_SECRET` | (32+ karakterli rastgele string — `openssl rand -hex 32` ile üretin) |
| `POS_SYNC_URL` | `https://kasaceptetransfer.berkyazilim.com/api/sync.php` |

> ⚠️ **`$` içeren şifreler için**: Railway UI'de normal şekilde girin, otomatik escape olur. Alternatif: "Raw Editor" kullanabilirsiniz.

---

## 🔄 Adım 5: Deploy Et

Variables'ı kaydettikten sonra Railway otomatik yeniden deploy başlatır. **"Deployments"** sekmesinden logu izleyin:

```
[Builder] Building with Dockerfile...
[Builder] Installing dependencies...
[Deployer] INFO: Uvicorn running on http://0.0.0.0:PORT
```

Yeşil ✅ olduğunda hazır. Domain'i aç ve kontrol et:
```
https://your-app.up.railway.app/api/
```
`{"message":"Hello World"}` gibi bir cevap görmelisin.

---

## 📱 Adım 6: Frontend'i Production Backend'e Bağla

### 6.1 `frontend/.env` dosyasını güncelle:

```env
EXPO_PUBLIC_BACKEND_URL=https://your-app.up.railway.app
```

⚠️ **Önizleme URL'lerini (emergentagent.com) silmeyi unutmayın**.

### 6.2 Frontend build'i (EAS) bu URL'yi gömecektir
`eas build --platform all --profile production` ile yeni build alın.

---

## 🧪 Adım 7: Test Et

Backend deploy edildikten sonra:

```bash
# Terminal'de test et:
curl https://your-app.up.railway.app/api/
# ✅ Response: {"message": "Hello World"}

# Login endpoint:
curl -X POST https://your-app.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin","password":"admin"}'
```

---

## 🔁 Otomatik Deploy

Railway GitHub'a bağlı olduğu için, **`main` branch'e her push**'ta otomatik yeniden deploy yapar. Ekstra işlem gerekmez.

---

## 💰 Fiyatlandırma

- **Free Trial**: $5 kredi (yaklaşık 1 ay küçük trafik yeter)
- **Hobby Plan**: $5/ay (önerilen)
- **MongoDB plugin**: Dahili ücretsiz kota, sonrası kullanım bazlı (~$1-3/ay)

**Tahmini aylık maliyet**: $5-8

---

## 🐛 Sık Yaşanan Sorunlar

| Sorun | Çözüm |
|---|---|
| Build fail: "Cannot find module" | `requirements.txt` eksik paket var → commitle |
| Deploy OK ama 502 error | `PORT` env. değişkenini Railway otomatik atar, manuel girmeyin |
| CORS error (frontend'den istek düşüyor) | Backend'de `allow_origins=["*"]` açık mı kontrol et |
| MongoDB connection refused | `MONGO_URL=${{MongoDB.MONGO_URL}}` formatıyla yazın (Railway interpolation) |
| MySQL bağlanamıyor | `185.223.77.132` sunucusunda Railway IP'lerine izin olduğundan emin olun |
| Push notification çalışmıyor | Expo dev build (EAS) gerekli, Expo Go'da çalışmaz |

---

## 🧰 Yardımcı Komutlar

### Railway CLI (isteğe bağlı)
```bash
npm install -g @railway/cli
railway login
railway link       # mevcut projeye bağlan
railway logs       # canlı log izle
railway run bash   # container'a gir
```

### GitHub'da Gizli Dosyalar
`.gitignore`'da şunlar olmalı:
```
backend/.env
frontend/.env
node_modules/
__pycache__/
.expo/
```

---

## ✅ Deployment Checklist

- [ ] Railway hesabı açıldı
- [ ] GitHub repo bağlandı
- [ ] Root Directory: `backend` ayarlandı
- [ ] Dockerfile build başarılı
- [ ] Tüm env variables eklendi
- [ ] Domain oluşturuldu (`xxx.up.railway.app`)
- [ ] `/api/` endpoint 200 dönüyor
- [ ] Login endpoint çalışıyor
- [ ] `frontend/.env`'deki `EXPO_PUBLIC_BACKEND_URL` güncellendi
- [ ] Frontend `eas build` ile yeni production build alındı

---

Sorular/hatalar için: logları `railway logs` ile takip edin ve hata mesajlarını paylaşın.
