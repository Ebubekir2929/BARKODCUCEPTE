from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
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
from services import init_patron_pool, init_data_pool, close_pools


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (for tenant names + additional tenants)
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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

# Include the router in the main app
app.include_router(api_router)


@app.on_event("startup")
async def startup():
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
