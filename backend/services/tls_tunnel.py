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
import ssl

logger = logging.getLogger(__name__)

LOCAL_TUNNEL_PORT = 13306
_server = None
_lock = asyncio.Lock()


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

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # sunucudaki self-signed stunnel sertifikası

        async def handle(client_r, client_w):
            try:
                remote_r, remote_w = await asyncio.wait_for(
                    asyncio.open_connection(remote_host, remote_port, ssl=ctx), timeout=10
                )
            except Exception as exc:
                logger.error(f"TLS tünel uplink hatası {remote_host}:{remote_port} -> {exc!r}")
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
