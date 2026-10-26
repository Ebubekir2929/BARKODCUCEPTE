# KasaCepte Köprü (railway_kopru) — Hosting erişim engeli için acil bypass

**Sorun (2026-10-26):** Türkiye'deki POS bilgisayarları `kasaceptetransfer.berkyazilim.com:443`'e
TCP bağlantısı kuramıyor (`connect timeout`), aynı sunucu yurt dışından ve mobil veriden açık.
Hosting tarafı (DDoS/flood koruması) POS'ların çıkış IP'lerini düşürüyor.

**Çözüm:** Railway'de çalışan ince nginx yönlendirici. İstemciler köprüye bağlanır, köprü isteği
hosting'deki `sync.php`'ye aynen iletir. Hosting'e yalnızca birkaç **kalıcı (keep-alive)** TLS bağlantısı
açılır → istemci sayısı ne olursa olsun bağlantı fırtınası olmaz. İstemci kodunda değişiklik YOK.

## Kurulum (5 dakika)
1. Railway → **New Service → GitHub Repo** (bu repo).
2. Service **Settings → Root Directory:** `pos_entegrasyon`
3. **Variables:** `RAILWAY_DOCKERFILE_PATH` = `railway_kopru/Dockerfile`
   (isteğe bağlı `HEDEF_HOST` = `kasaceptetransfer.berkyazilim.com` — varsayılan zaten bu)
4. **Settings → Networking → Generate Domain** → ör. `kasacepte-kopru-production.up.railway.app`
5. Doğrulama: tarayıcıda `https://<domain>/kopru-saglik` → `{"ok":true,...}`;
   `POST https://<domain>/api/sync.php` gövde `{"action":"surum"}` → hosting'in sürüm yanıtı.

## İstemcide yapılacak (müşteri başına 10 sn)
KasaCepte Transfer Client → Ayarlar → **Sunucu URL**:
`https://kasaceptetransfer.berkyazilim.com/api/sync.php` → `https://<domain>/api/sync.php` → Kaydet.
(Tenant ID ve Client Secret aynen kalır; hosting hâlâ aynı veritabanını kullanır.)

## İstemcilere DOKUNMADAN geçiş — DNS yöntemi (önerilen)
İstemciler alan adına (`kasaceptetransfer.berkyazilim.com`) bağlanır; alan adını köprüye çevirince
hepsi kendiliğinden köprüden geçer. Köprü hosting'e **IP ile** (`HEDEF_UPSTREAM=185.223.77.132`) gider,
Host/SNI başlığı alan adı kalır → döngü oluşmaz, hosting isteği aynı siteye ait sayar.
1. Railway köprü servisi → **Settings → Networking → Custom Domain** → `kasaceptetransfer.berkyazilim.com`
   ekleyin. Railway size bir **CNAME hedefi** gösterir (ör. `xxxx.up.railway.app`) ve sertifikayı kendisi üretir.
2. Plesk → berkyazilim.com → **DNS Ayarları**: `kasaceptetransfer` için mevcut **A** kaydını (185.223.77.132) silin,
   yerine **CNAME** → Railway'in verdiği hedef. TTL'yi **300** yapın (ileride hızlı geri dönüş için).
3. Yayılma: eski A kaydının TTL'si 21600 sn (6 saat) → müşteriler en geç 6 saat içinde kendiliğinden köprüye geçer
   (kendi bilgisayarınızda hemen denemek için `ipconfig /flushdns`). Backend (Railway) ve web sitesi de aynı
   alan adını kullanıyorsa onlar da otomatik olarak köprüden geçer; ek ayar gerekmez.
4. Geri dönüş: CNAME'i silip A kaydını geri koyun (TTL 300 ise ~5 dakikada eski hâle döner).
Not: Hosting'deki Let's Encrypt sertifikası bu alan adı için yenilenemez olur (doğrulama köprüye gider);
köprü hosting sertifikasını doğrulamadığı için (nginx varsayılanı) bu bir sorun yaratmaz.

## Notlar
- Köprü hiçbir veri saklamaz, sadece iletir. Hosting engeli kalkınca istemciler eski adrese
  döndürülebilir ya da köprüde kalabilir (ek gecikme ~150-250 ms/istek).
- Backend (Railway) hosting'e zaten keep-alive ile ulaşıyor; onda değişiklik gerekmez.
- `/sync.php` yolu hosting'de yok (404) — istemcilerde her zaman `/api/sync.php` kullanın.
- Yerel test: `default.conf.template` içindeki `${PORT}`/`${HEDEF_HOST}` doldurulup nginx ile
  çalıştırıldığında `surum` ve 401 (yanlış secret) yanıtları birebir geçti; 30 istekte hosting'e
  yalnızca 3 TCP bağlantısı açıldı.
