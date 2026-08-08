"""2026-06 — MySQL TLS tüneli (B Planı).

Hosting sağlayıcısının DDoS koruması (SYN-proxy) sunucu-önce-konuşan
protokolleri (MySQL greeting) bozduğu için, MySQL trafiği TLS içine
sarılarak (istemci-önce-konuşan ClientHello) korumadan geçirilir.

Sunucu tarafında stunnel 3308 portunda TLS dinler ve 127.0.0.1:3306'ya
iletir. Burada ise yerel 127.0.0.1:13306 dinleyicisi her bağlantıyı
TLS ile uzak 3308'e taşır. aiomysql yerel porta bağlanır.
"""
import asyncio
import logging
import socket
import ssl

logger = logging.getLogger(__name__)

LOCAL_TUNNEL_PORT = 13306
_server = None
_lock = asyncio.Lock()


def _make_uplink_socket() -> socket.socket:
    """DPI/DDoS korumasına dayanıklı uplink soketi:
    - SO_KEEPALIVE: ölü bağlantıyı 60 sn içinde tespit eder (sonsuz askı yerine hata)
    - TCP_NODELAY: küçük MySQL paketlerinde gecikmeyi azaltır"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    for opt, val in (("TCP_KEEPIDLE", 30), ("TCP_KEEPINTVL", 10),
                     ("TCP_KEEPCNT", 3), ("TCP_NODELAY", 1)):
        try:
            s.setsockopt(socket.IPPROTO_TCP, getattr(socket, opt), val)
        except (AttributeError, OSError):
            pass
    s.setblocking(False)
    return s


async def _pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter):
    try:
        while True:
            chunk = await src.read(65536)
            if not chunk:
                break
            dst.write(chunk)
            await dst.drain()
    except Exception:
        pass
    finally:
        try:
            dst.close()
        except Exception:
            pass


async def ensure_tunnel(remote_host: str, remote_port: int) -> int:
    """Yerel tünel dinleyicisini (idempotent) başlatır, yerel portu döndürür."""
    global _server
    async with _lock:
        if _server is not None:
            return LOCAL_TUNNEL_PORT

        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # sunucudaki self-signed stunnel sertifikası
        # Sunucudaki stunnel 4.56 (OpenSSL 1.0.2) ile ortak şifre: TLS1.2 + RSA-AES
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        ctx.set_ciphers("AES256-SHA:AES128-SHA:@SECLEVEL=1")

        async def handle(client_r, client_w):
            sock = _make_uplink_socket()
            try:
                loop = asyncio.get_running_loop()
                await asyncio.wait_for(loop.sock_connect(sock, (remote_host, remote_port)), timeout=10)
                remote_r, remote_w = await asyncio.wait_for(
                    asyncio.open_connection(sock=sock, ssl=ctx, server_hostname="mysql-tls"),
                    timeout=10,
                )
            except Exception as exc:
                logger.error(f"TLS tünel uplink hatası {remote_host}:{remote_port} -> {exc!r}")
                try:
                    sock.close()
                except Exception:
                    pass
                try:
                    client_w.close()
                except Exception:
                    pass
                return
            await asyncio.gather(_pipe(client_r, remote_w), _pipe(remote_r, client_w))

        _server = await asyncio.start_server(handle, "127.0.0.1", LOCAL_TUNNEL_PORT)
        logger.warning(
            f"MySQL TLS tüneli aktif: 127.0.0.1:{LOCAL_TUNNEL_PORT} -> tls://{remote_host}:{remote_port}"
        )
        return LOCAL_TUNNEL_PORT
