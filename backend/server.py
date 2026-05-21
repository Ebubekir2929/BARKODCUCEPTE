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
