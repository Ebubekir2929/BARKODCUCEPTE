# Test Credentials

## MySQL Users (patron database - LIVE)

### Ana hesap (restoran)
- **Email**: cakmak.ebubekir29@gmail.com
- **Password**: 1234567
- **Tenant ID**: d5587c87a7f9476fa82b83f40accd6c7 (Merkez)
- **Business Type**: restoran

### İkinci hesap (normal)
- **Email**: cakmak_ebubekir@hotmail.com
- **Username**: berk
- **Password**: admin
- **Business Type**: normal

## DB Erişim Notu (2026-06)
- Poyraz Hosting DDoS koruması (SYN-proxy) bazı IP'lerden 3306'yı bozuyor.
- Backend otomatik: önce direkt 3306 dener (greeting probe), olmazsa TLS tüneli
  (sunucuda stunnel :3308 → 127.0.0.1:3306) kullanır. Bkz: services/tls_tunnel.py
