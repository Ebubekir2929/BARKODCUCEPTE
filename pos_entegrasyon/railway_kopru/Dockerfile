# KasaCepte KÖPRÜ — Railway'de çalışan ince nginx yönlendirici.
#
# NE İŞE YARAR: Hosting (185.223.77.132) Türkiye'deki POS bilgisayarlarının IP'lerini
# düşürdüğünde (DDoS/flood koruması), istemciler bu köprüye bağlanır; köprü isteği
# hosting'deki sync.php'ye AYNEN iletir (yurt dışı IP'den, az sayıda kalıcı bağlantıyla).
# İstemcide kod değişikliği YOK — yalnızca "Sunucu URL" alanı köprü adresine çevrilir:
#     https://<köprü-domaini>/api/sync.php
#
# Railway kurulumu (en sade yol — ek değişken GEREKMEZ):
#   New Service → GitHub repo → Settings → Root Directory: pos_entegrasyon/railway_kopru
#   (Dockerfile bu klasörün kökünde; yanındaki railway.json builder'ı DOCKERFILE yapar)
#   Settings → Networking → Generate Domain  → istemcilere verilecek adres
#   (isteğe bağlı Variables) HEDEF_HOST / HEDEF_UPSTREAM — varsayılanlar aşağıda
FROM nginx:1.27-alpine

# nginx imajı /etc/nginx/templates/*.template dosyalarını envsubst ile işler (PORT, HEDEF_HOST)
COPY default.conf.template /etc/nginx/templates/default.conf.template

ENV PORT=8080
ENV HEDEF_HOST=kasaceptetransfer.berkyazilim.com
# Hosting sunucusunun IP'si (Host/SNI başlığı HEDEF_HOST kalır). Hosting IP değişirse Variables'tan güncelleyin.
ENV HEDEF_UPSTREAM=185.223.77.132
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
EXPOSE 8080
