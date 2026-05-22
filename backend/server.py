from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime

# Import routes
from routes.auth import router as auth_router, set_db as set_auth_db
from routes.data import router as data_router
from routes.notifications import router as notifications_router, ensure_tokens_table
from routes.price_update import router as price_update_router
from services import init_patron_pool, init_data_pool, close_pools


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (for tenant names + additional tenants)
# Varsayılan değerler: env yoksa da app başlasın (ör. Railway'de MONGO_URL set edilmemişse)
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'barkodcucepte_prod')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Set MongoDB for auth routes (tenant management)
set_auth_db(db)

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Include auth and data routes under /api
api_router.include_router(auth_router)
api_router.include_router(data_router)
api_router.include_router(notifications_router)
api_router.include_router(price_update_router)

# Include the router in the main app
app.include_router(api_router)


# 2026-05-12 — Gizlilik Politikası (Play Store zorunluluğu, /api PREFIX'siz)
from fastapi.responses import FileResponse, HTMLResponse  # noqa: E402
from pathlib import Path  # noqa: E402

@app.get("/privacy-policy", response_class=HTMLResponse, include_in_schema=False)
@app.get("/api/privacy-policy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_policy():
    """Public privacy policy page for Google Play / App Store compliance."""
    path = Path("/app/docs/privacy-policy.html")
    if path.exists():
        return FileResponse(str(path), media_type="text/html")
    return HTMLResponse("<h1>Gizlilik Politikası</h1><p>Yakında.</p>")


# 2026-05-13 — Play Store asset serving (temporary helper for owner downloads)
@app.get("/api/play-assets/{filename:path}", include_in_schema=False)
async def play_assets(filename: str):
    """Serve files under /app/docs/play-assets (feature graphic, screenshots, zip)."""
    safe = filename.replace("..", "").lstrip("/")
    fp = Path("/app/docs/play-assets") / safe
    if not fp.exists() or not fp.is_file():
        return HTMLResponse(f"<h3>Bulunamadı: {safe}</h3>", status_code=404)
    media = "application/octet-stream"
    s = safe.lower()
    if s.endswith(".png"): media = "image/png"
    elif s.endswith(".jpg") or s.endswith(".jpeg"): media = "image/jpeg"
    elif s.endswith(".zip"): media = "application/zip"
    return FileResponse(str(fp), media_type=media, filename=fp.name)


@app.get("/api/play-assets", response_class=HTMLResponse, include_in_schema=False)
async def play_assets_index():
    """Tiny HTML index page listing all play-assets files."""
    root = Path("/app/docs/play-assets")
    items: list[str] = []
    for f in sorted(root.rglob("*.*")):
        rel = f.relative_to(root).as_posix()
        size_kb = f.stat().st_size // 1024
        items.append(f'<li><a href="/api/play-assets/{rel}">{rel}</a> <small>({size_kb} KB)</small></li>')
    html = (
        '<html><head><meta charset="utf-8"><title>Play Store Assets</title>'
        '<style>body{font-family:system-ui;padding:24px;max-width:720px;margin:auto}'
        'li{padding:6px 0;border-bottom:1px solid #eee}a{color:#0a7}</style></head>'
        f'<body><h2>Barkodcu Cepte — Play Store Assets</h2><ul>{"".join(items)}</ul></body></html>'
    )
    return HTMLResponse(html)


# 2026-05-22 — Fiyat Güncelleme Dokümantasyonu (Windows POS developer için)
@app.get("/api/docs/price-update", response_class=HTMLResponse, include_in_schema=False)
async def price_update_doc_html():
    """Tarayıcıdan erişilebilir HTML formatında dokümantasyon."""
    md_path = Path("/app/docs/PRICE_UPDATE_INTEGRATION.md")
    if not md_path.exists():
        return HTMLResponse("<h1>Doc bulunamadı</h1>", status_code=404)
    md_content = md_path.read_text(encoding="utf-8")
    # Markdown'ı basit bir HTML viewer'la render et (CDN üzerinden marked.js)
    html = f'''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fiyat Güncelleme — Windows POS Entegrasyonu</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #222; background: #fafafa; }}
  h1, h2, h3 {{ color: #1a1a1a; border-bottom: 1px solid #ddd; padding-bottom: 6px; }}
  h1 {{ font-size: 28px; }} h2 {{ font-size: 22px; margin-top: 36px; }} h3 {{ font-size: 18px; }}
  code {{ background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 14px; color: #c7254e; }}
  pre {{ background: #2d2d2d; color: #f8f8f2; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }}
  pre code {{ background: transparent; color: inherit; padding: 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
  th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
  th {{ background: #f5f5f5; }}
  blockquote {{ border-left: 4px solid #0a7; background: #f0fdf4; padding: 8px 16px; margin: 16px 0; color: #166534; }}
  a {{ color: #0a7; }}
  .download-bar {{ position: sticky; top: 0; background: #fff; padding: 12px 0; margin: -24px -24px 24px; padding: 16px 24px; border-bottom: 2px solid #0a7; z-index: 10; }}
  .download-bar a {{ display: inline-block; background: #0a7; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-right: 8px; }}
  .download-bar a:hover {{ background: #086; }}
</style>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
<div class="download-bar">
  <a href="/api/docs/price-update.md" download="PRICE_UPDATE_INTEGRATION.md">⬇️ Markdown İndir</a>
  <a href="javascript:window.print()">🖨 Yazdır / PDF</a>
</div>
<div id="content"></div>
<script>
  const md = {repr(md_content)};
  document.getElementById('content').innerHTML = marked.parse(md);
</script>
</body></html>'''
    return HTMLResponse(html)


@app.get("/api/docs/price-update.md", include_in_schema=False)
async def price_update_doc_raw():
    """Ham Markdown — Windows developer indirebilir."""
    md_path = Path("/app/docs/PRICE_UPDATE_INTEGRATION.md")
    if not md_path.exists():
        return HTMLResponse("Doc bulunamadı", status_code=404)
    return FileResponse(str(md_path), media_type="text/markdown; charset=utf-8", filename="PRICE_UPDATE_INTEGRATION.md")


@app.on_event("startup")
async def startup():
    # MySQL pool init'leri ARKA PLANDA başlasın ki uygulama port'a anında bağlansın
    # (Railway healthcheck / port probe 10-30s içinde timeout olur)
    async def _init_pools_bg():
        try:
            await init_patron_pool()
            logging.info("patron MySQL pool ready")
        except Exception as e:
            logging.error(f"Failed to init patron pool: {e}")
        try:
            await init_data_pool()
            logging.info("kasacepteweb MySQL pool ready")
        except Exception as e:
            logging.error(f"Failed to init data pool: {e}")
        try:
            await ensure_tokens_table()
        except Exception as e:
            logging.error(f"Failed to init push tokens table: {e}")

        # Start background notification watcher
        try:
            from services.notification_watcher import start_watcher
            start_watcher()
        except Exception as e:
            logging.error(f"Failed to start notification watcher: {e}")

    asyncio.create_task(_init_pools_bg())
    logging.info("App startup complete; DB pools initializing in background.")


@app.on_event("shutdown")
async def shutdown():
    try:
        from services.notification_watcher import stop_watcher
        stop_watcher()
    except Exception:
        pass
    try:
        await close_pools()
    except Exception:
        pass

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
