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

## Notlar
- Köprü hiçbir veri saklamaz, sadece iletir. Hosting engeli kalkınca istemciler eski adrese
  döndürülebilir ya da köprüde kalabilir (ek gecikme ~150-250 ms/istek).
- Backend (Railway) hosting'e zaten keep-alive ile ulaşıyor; onda değişiklik gerekmez.
- `/sync.php` yolu hosting'de yok (404) — istemcilerde her zaman `/api/sync.php` kullanın.
- Yerel test: `default.conf.template` içindeki `${PORT}`/`${HEDEF_HOST}` doldurulup nginx ile
  çalıştırıldığında `surum` ve 401 (yanlış secret) yanıtları birebir geçti; 30 istekte hosting'e
  yalnızca 3 TCP bağlantısı açıldı.
