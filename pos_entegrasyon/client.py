# -*- coding: utf-8 -*-
"""
KasaCepte Transfer Client
- Çok firmalı tenant mimarisi
- SQL Server -> Web push / on-demand dataset motoru
- DPAPI ile parola ve client secret saklama
- Autorun / system tray / admin login
- Snapshot hash / zero-row / mass-delete koruması
- Büyük payload için chunked upload desteği
"""

import os
import sys
import json
import time
import uuid
import threading
import traceback
import base64
import hashlib
import ctypes
import ctypes.wintypes
from decimal import Decimal
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pyodbc
import requests

from PySide6.QtCore import Qt, QTimer, QSize, Signal, Slot
from PySide6.QtCore import QDate
from PySide6.QtGui import QAction, QClipboard
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QTextEdit, QMessageBox, QFormLayout, QComboBox, QCheckBox, QSpinBox,
    QTabWidget, QDialog, QDialogButtonBox, QSystemTrayIcon, QMenu, QProgressDialog, QStyle, QInputDialog, QDateEdit
)

try:
    import winreg  # type: ignore
except Exception:
    winreg = None

APP_NAME = "KasaCepteTransferClient"
CONFIG_DIR = os.path.join(os.getenv("APPDATA", os.path.expanduser("~")), APP_NAME)
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
SNAPSHOT_PATH = os.path.join(CONFIG_DIR, "snapshots.json")
WATCH_STATE_PATH = os.path.join(CONFIG_DIR, "watch_state.json")
OFFLINE_QUEUE_PATH = os.path.join(CONFIG_DIR, "offline_queue.json")
SUCCESS_STATE_PATH = os.path.join(CONFIG_DIR, "success_state.json")
LOG_PATH = os.path.join(CONFIG_DIR, "client.log")

DEFAULT_SERVER_URL = "https://kasaceptetransfer.berkyazilim.com/sync.php"

AUTORUN_START_DELAY_SEC = 8
# Normal datasetler için direkt POST sınırı.
# Büyük datasetlerde bu sınırı geçerse mevcut chunk upload kullanılır.
MAX_PAYLOAD_BYTES = 2_500_000
CHUNK_SIZE_CHARS = 350_000

# Web tarafında satır bazlı tutulacak datasetler.
# NET KARAR v38:
# - stock_list ve cari_bakiye_liste ROWS değildir; dataset_cache_pages içine sayfalı basılır.
# - hourly_stock_detail ise ürün ürün değil, saat/lokasyon bazlı özetlenip dataset_cache_rows içine yazılır.
# - açık masa / açık masa detay / lookup / iptal / rapor özetleri normal dataset_cache yapısında kalır.
ROWS_CACHE_DATASET_KEYS = {
    "hourly_stock_detail",
}
DELTA_PUSH_DATASET_KEYS = ROWS_CACHE_DATASET_KEYS

# Stok ve cari büyük listedir; tek tek row/delta değil, maksimum paket boyutuna göre sayfalı gönderilir.
PAGED_PUSH_DATASET_KEYS = {"stock_list", "cari_bakiye_liste"}

def is_paged_push_dataset_key(dataset_key: str) -> bool:
    return str(dataset_key or "").strip() in PAGED_PUSH_DATASET_KEYS

def normalize_paged_push_definition(defn: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(defn or {})
    key = str(d.get("dataset_key", "")).strip()
    if key in PAGED_PUSH_DATASET_KEYS:
        d["mode"] = "push" if key == "cari_bakiye_liste" else d.get("mode", "hybrid")
        d["push_enabled"] = True
        d["snapshot"] = True
        d["guard_zero"] = True
        d["guard_mass_delete"] = True
    return d

def is_rows_cache_dataset_key(dataset_key: str) -> bool:
    return str(dataset_key or "").strip() in ROWS_CACHE_DATASET_KEYS

DELTA_PUSH_TARGET_BYTES = 180_000
DELTA_PUSH_MAX_ROWS_PER_BATCH = 300
# Stok/cari sayfalı gönderimde paket MySQL max_allowed_packet sınırına takılmasın diye
# byte hedefi korunur; satır küçükse tek sayfada mümkün olan maksimum kayıt gider.
PAGED_PUSH_TARGET_BYTES = 450_000
PAGED_PUSH_FALLBACK_BYTES = [450_000, 220_000, 100_000]
PAGED_PUSH_MAX_ROWS_PER_PAGE = 10_000

MASS_DELETE_RATIO_BLOCK = 0.60
MASS_DELETE_MIN_PREV = 50

LIVE_OPEN_TABLES_INTERVAL_SEC = 10
REQUEST_POLL_INTERVAL_SEC = 1
REQUEST_POLL_LIMIT = 5
ONDEMAND_TRACK_REFRESH_INTERVAL_SEC = 15

# Stok/Cari ekstre ön ısıtma:
# Bu ay hareket görmüş stok ve carilerin ekstreleri request beklenmeden dataset_cache'e hazırlanır.
# Limit yüksek tutulursa ERP12 tarafında çok sayıda prosedür çalışacağı için kontrollü işlenir.
PREWARM_EXTRE_INTERVAL_SEC = 300
PREWARM_EXTRE_STOCK_LIMIT = 200
PREWARM_EXTRE_CARI_LIMIT = 200
PREWARM_EXTRE_BALANCE_CARI_LIMIT = 200
PREWARM_EXTRE_MAX_PER_RUN = 40
# Ekstre satırındaki fiş içeriği tamamen push edilmez; sadece son fişler küçük limitlerle ısıtılır.
PREWARM_FIS_DETAIL_ENABLED = True
PREWARM_FIS_DETAIL_MAX_PER_RUN = 20
PREWARM_FIS_DETAIL_PER_EXTRE = 5
# Stok bilgi/miktar ön cache:
# Stok detay ekranında bekleme olmasın diye bu ay hareket gören stoklar + miktar/bakiye veren stoklar
# için STOK_BILGI_MIKTAR sonucu request beklemeden cache'e hazırlanır.
# LOKASYON=0 genel stok/miktar bilgisidir; farklı lokasyon seçilirse mevcut ondemand akış çalışır.
PREWARM_STOK_BILGI_MIKTAR_ENABLED = True
PREWARM_STOK_BILGI_MIKTAR_MAX_PER_RUN = 40
PREWARM_STOK_BILGI_MIKTAR_BALANCE_STOCK_LIMIT = 10000
PREWARM_STOK_BILGI_MIKTAR_LOKASYON_IDS = [0]

# Bu ayki fişlerin ürün/satır detayları da webde fiş açılırken bekletmesin diye
# FIS tablosundan bu ayki satış/iade fiş ID'leri alınır ve fis_detay_toplam cache'i
# cursor ile parça parça hazırlanır. Böylece tek turda SQL Server/web DB şişirilmez.
PREWARM_MONTHLY_FIS_DETAIL_ENABLED = True
PREWARM_MONTHLY_FIS_DETAIL_INTERVAL_SEC = 300
PREWARM_MONTHLY_FIS_DETAIL_FIS_LIMIT = 10000
PREWARM_MONTHLY_FIS_DETAIL_MAX_PER_RUN = 60
PREWARM_MONTHLY_FIS_DETAIL_FIS_TURU = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 21, 22)

# Request beklemeden dataset_cache'e yazılacak özel dataset.
# Açık masa detay ürün satırı satırı rows'a düşmez; POS_ID bazlı normal cache kaydı olarak tutulur.
DIRECT_CACHE_ONDEMAND_KEYS = {"acik_masa_detay", "rap_acik_hesap_kisi_ozet_web", "rap_filtre_lookup", "fis_gunluk_bildirim_feed"}
DIRECT_CACHE_PAGE_DATASET_KEYS = set()

# RAP_FILTRE_LOOKUP prosedürü Kaynak boş gelince veri döndürmez.
# Bu yüzden lookup cache'i hazırlanırken tüm bilinen kaynaklar tek tek okunup
# Kaynak alanı satırın içine yazılır. Web tarafı sonradan Kaynak/Q ile filtreler.
RAP_FILTER_LOOKUP_SOURCES = [
    "LOKASYON", "PROJE",
    "CARI", "CARI_TUR", "CARI_GRUP",
    "CARI_OZEL_KOD_1", "CARI_OZEL_KOD_2", "CARI_OZEL_KOD_3", "CARI_OZEL_KOD_4", "CARI_OZEL_KOD_5",
    "TEMSILCI", "SEHIR", "CARI_RUT",
    "STOK_FIYAT_AD", "DOVIZ_AD", "STOK_BIRIM", "PC_AD",
    "STOK", "STOK_CINSI", "STOK_GRUP", "STOK_MARKA", "STOK_VERGI",
    "STOK_OZEL_KOD_1", "STOK_OZEL_KOD_2", "STOK_OZEL_KOD_3", "STOK_OZEL_KOD_4", "STOK_OZEL_KOD_5",
    "STOK_OZEL_KOD_6", "STOK_OZEL_KOD_7", "STOK_OZEL_KOD_8", "STOK_OZEL_KOD_9",
    "TEDARIKCI", "FIS_TURU", "FIS_ALT_TIPI", "PERSONEL", "ADRESLER",
    "FIS_OZEL_KOD_1", "FIS_OZEL_KOD_2", "FIS_OZEL_KOD_3", "FIS_OZEL_KOD_4", "FIS_OZEL_KOD_5",
]
LIVE_DATASET_KEYS = {"acik_masalar"}

FAST_REACTIVE_INTERVAL_SEC = 5
FAST_REACTIVE_WATCH_KEYS = {"daily_reports_watch", "iptal_reports_watch", "garson_sales_watch"}

# Canlı/rapor ekranında bekleme olmaması gereken öncelikli datasetler.
# Bunlar reactive timer içinde hızlı çalışır; ağır prewarm işleri bunların arkasına bırakılır.
PRIORITY_REPORT_DATASET_KEYS = {
    "acik_masalar",
    "acik_masa_detay",
    "rap_acik_hesap_kisi_ozet_web",
    "financial_data",
    "financial_data_location",
    "hourly_data",
    "hourly_location_data",
    "cancel_data",
    "top10_stock_movements",
    "down10_stock_movements",
    "iptal_ozet",
    "iptal_detay",
    "garson_satis_ozet",
    "hourly_stock_detail",
    "fis_gunluk_bildirim_feed",
}

# Öncelikli turda direkt cache'e basılacak ondemand datasetler.
# rap_filtre_lookup lookup büyük olduğu için artık arka plan tarafında tutulur.
PRIORITY_DIRECT_CACHE_KEYS = {
    "acik_masa_detay",
    "rap_acik_hesap_kisi_ozet_web",
    "fis_gunluk_bildirim_feed",
}

# Büyük liste/lookup ve master veriler arka planda yenilenir.
BACKGROUND_PUSH_DATASET_KEYS = {
    "firma_sabitleri",
    "stok_fiyat_adlari",
    "stock_list",
    "cari_bakiye_liste",
}
BACKGROUND_DIRECT_CACHE_KEYS = {"rap_filtre_lookup"}

FAST_REACTIVE_DATASET_KEYS = set(PRIORITY_REPORT_DATASET_KEYS)

# Request kuyruğunu beklemeden web cache'i güncel tutması gereken küçük/hızlı feedler.
# force=False ile çalışır: SQL sonucu değişmediyse snapshot yüzünden tekrar göndermez.
FORCE_EVERY_REACTIVE_DATASET_KEYS = set()


class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', ctypes.wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


def _to_blob(data: bytes):
    blob = DATA_BLOB()
    buf = ctypes.create_string_buffer(data)
    blob.cbData = len(data)
    blob.pbData = ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))
    blob._buffer = buf
    return blob


def dpapi_protect(data: bytes) -> str:
    out_blob = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(_to_blob(data), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise RuntimeError("CryptProtectData failed")
    try:
        enc = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        return base64.b64encode(enc).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)


def dpapi_unprotect(value: str) -> bytes:
    if not value:
        return b""
    raw = base64.b64decode(value.encode("ascii"))
    out_blob = DATA_BLOB()
    in_blob = _to_blob(raw)
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise RuntimeError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)


def ensure_dirs():
    os.makedirs(CONFIG_DIR, exist_ok=True)


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str):
    ensure_dirs()
    ts = now_str()
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 5 * 1024 * 1024:
            os.replace(LOG_PATH, LOG_PATH + ".1")
    except Exception:
        pass
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(f"{ts} {msg}\n")


def canonical(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_obj(obj: Any) -> str:
    return sha256_text(canonical(obj))

def normalize_row_count(data: Any) -> int:
    return len(data) if isinstance(data, list) else 1



def sanitize_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        # Bilimsel gösterimi (örn: 0E-8) istemiyoruz; düz sayısal metin gönder.
        try:
            return format(value, 'f')
        except Exception:
            return str(value)
    if isinstance(value, (datetime, )):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return "0x" + raw.hex()
    return value


def sanitize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {str(k): sanitize_value(v) for k, v in row.items()}


def load_snapshots() -> Dict[str, Any]:
    ensure_dirs()
    if os.path.exists(SNAPSHOT_PATH):
        try:
            with open(SNAPSHOT_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}


def save_snapshots(data: Dict[str, Any]):
    ensure_dirs()
    with open(SNAPSHOT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_watch_state() -> Dict[str, Any]:
    ensure_dirs()
    if os.path.exists(WATCH_STATE_PATH):
        try:
            with open(WATCH_STATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}


def save_watch_state(data: Dict[str, Any]):
    ensure_dirs()
    with open(WATCH_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_offline_queue() -> List[Dict[str, Any]]:
    ensure_dirs()
    if os.path.exists(OFFLINE_QUEUE_PATH):
        try:
            with open(OFFLINE_QUEUE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def save_offline_queue(items: List[Dict[str, Any]]):
    ensure_dirs()
    with open(OFFLINE_QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def load_success_state() -> List[Dict[str, Any]]:
    ensure_dirs()
    if os.path.exists(SUCCESS_STATE_PATH):
        try:
            with open(SUCCESS_STATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def save_success_state(items: List[Dict[str, Any]]):
    ensure_dirs()
    with open(SUCCESS_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


DEFAULT_CHANGE_WATCHERS: List[Dict[str, Any]] = [
    {
        "watch_key": "firma_sabitleri_watch",
        "enabled": True,
        "kind": "query",
        "database": "",
        "sql": "SELECT TOP 1 * FROM FIRMASABITLERI",
        "watch_interval_sec": 60,
        "triggers": ["firma_sabitleri", "stock_list"],
        "invalidate": []
    },
    {
        "watch_key": "stok_fiyat_adlari_watch",
        "enabled": True,
        "kind": "query",
        "database": "",
        "sql": "SELECT ID, AD FROM STOK_FIYAT_AD ORDER BY ID",
        "watch_interval_sec": 60,
        "triggers": ["stok_fiyat_adlari", "stock_list"],
        "invalidate": []
    },
    {
        "watch_key": "stock_master_watch",
        "enabled": True,
        "kind": "query",
        "database": "",
        "sql": "SELECT \
  ISNULL((SELECT COUNT(*) FROM STOK WHERE STOK_CINSI <> 4),0) AS stok_count, \
  ISNULL((SELECT MAX(ID) FROM STOK WHERE STOK_CINSI <> 4),0) AS stok_max_id, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ID,KOD,AD,AKTIF,STOK_GRUP,STOK_MARKA,SON_ALIS_FIYAT,SON_DOVIZ_FIYAT,SON_DOVIZ)) FROM STOK WHERE STOK_CINSI <> 4),0) AS stok_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(STOK_STOK_BIRIM,STOK_FIYAT_AD,FIYAT,DOVIZ_AD,KDV_DAHILMI)) FROM STOK_STOK_BIRIM_FIYAT),0) AS fiyat_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(STOK,MIKTAR)) FROM STOK_MIKTAR_STOK),0) AS miktar_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(STOK_STOK_BIRIM,BARKOD)) FROM STOK_BARKOD),0) AS barkod_sig",
        "watch_interval_sec": 30,
        "triggers": ["stock_list"],
        "invalidate": ["stok_extre", "stok_bilgi_miktar"]
    },
    {
        "watch_key": "cari_master_watch",
        "enabled": True,
        "kind": "query",
        "database": "",
        "sql": "SELECT \
  ISNULL((SELECT COUNT(*) FROM CARI WHERE CARI_TUR = 1),0) AS cari_count, \
  ISNULL((SELECT MAX(ID) FROM CARI WHERE CARI_TUR = 1),0) AS cari_max_id, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ID,KOD,AD,EK_AD,CARI_GRUP,AKTIF,DOVIZ_AD)) FROM CARI WHERE CARI_TUR = 1),0) AS cari_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ID,CARI,AD,TELEFON,TELEFON_SMS,TELEFON_CEP)) FROM CARI_ADRES),0) AS adres_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(KART,DOVIZ_AD,BORC,ALACAK)) FROM FINANS_DETAY_CARI_OZET),0) AS bakiye_sig",
        "watch_interval_sec": 30,
        "triggers": ["cari_bakiye_liste"],
        "invalidate": ["kart_extre_cari"]
    },
    {
        "watch_key": "daily_reports_watch",
        "enabled": True,
        "kind": "query",
        "database": "",
        "sql": "SELECT \
  ISNULL((SELECT COUNT(*) FROM FIS WHERE FIS_TURU IN (11,12,35,36) AND FIS_TARIHI >= CONVERT(date, GETDATE()) AND FIS_TARIHI < DATEADD(day,1,CONVERT(date, GETDATE()))),0) AS fis_count, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ID,FIS_TURU,LOKASYON,GENELTOPLAM,KDV_TOPLAM,FIS_TARIHI)) FROM FIS WHERE FIS_TURU IN (11,12,35,36) AND FIS_TARIHI >= CONVERT(date, GETDATE()) AND FIS_TARIHI < DATEADD(day,1,CONVERT(date, GETDATE()))),0) AS fis_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(FIS,STOK,MIKTAR_FIS,MIKTAR_CIKIS,FIYAT,KUR,ISKONTO_HESAP,KDV_TOPTAN,LOKASYON,FIS_TARIHI)) FROM FIS_DETAY WHERE FIS_TARIHI >= CONVERT(date, GETDATE()) AND FIS_TARIHI < DATEADD(day,1,CONVERT(date, GETDATE()))),0) AS fis_detay_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(LOKASYON,TUTAR,SATIR_MI,TARIH,TARIH_IPTAL)) FROM FIS_POS_IPTAL WHERE (TARIH >= CONVERT(date, GETDATE()) AND TARIH < DATEADD(day,1,CONVERT(date, GETDATE()))) OR (TARIH_IPTAL >= CONVERT(date, GETDATE()) AND TARIH_IPTAL < DATEADD(day,1,CONVERT(date, GETDATE())))),0) AS iptal_sig",
        "watch_interval_sec": 30,
        "triggers": ["financial_data", "financial_data_location", "hourly_data", "hourly_location_data", "cancel_data", "top10_stock_movements", "down10_stock_movements", "fis_gunluk_bildirim_feed"],
        "invalidate": []
    },
    {
        "watch_key": "iptal_reports_watch",
        "enabled": True,
        "kind": "query",
        "database": "",
        "sql": "SELECT \
  ISNULL((SELECT COUNT(*) FROM FIS_POS_IPTAL WHERE (TARIH >= CONVERT(date, GETDATE()) AND TARIH < DATEADD(day,1,CONVERT(date, GETDATE()))) OR (TARIH_IPTAL >= CONVERT(date, GETDATE()) AND TARIH_IPTAL < DATEADD(day,1,CONVERT(date, GETDATE())))),0) AS iptal_count, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(ID,LOKASYON,TUTAR,SATIR_MI,TARIH,TARIH_IPTAL)) FROM FIS_POS_IPTAL WHERE (TARIH >= CONVERT(date, GETDATE()) AND TARIH < DATEADD(day,1,CONVERT(date, GETDATE()))) OR (TARIH_IPTAL >= CONVERT(date, GETDATE()) AND TARIH_IPTAL < DATEADD(day,1,CONVERT(date, GETDATE())))),0) AS iptal_sig, \
  ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(FIS_POS_IPTAL,STOK,FIYAT,MIKTAR,MASA,SAAT)) FROM FIS_POS_IPTAL_DETAY WHERE FIS_POS_IPTAL IN (SELECT ID FROM FIS_POS_IPTAL WHERE (TARIH >= CONVERT(date, GETDATE()) AND TARIH < DATEADD(day,1,CONVERT(date, GETDATE()))) OR (TARIH_IPTAL >= CONVERT(date, GETDATE()) AND TARIH_IPTAL < DATEADD(day,1,CONVERT(date, GETDATE()))))),0) AS iptal_detay_sig",
        "watch_interval_sec": 30,
        "triggers": ["iptal_ozet", "iptal_detay"],
        "invalidate": []
    }
]


DEFAULT_DATASET_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "dataset_key": "firma_sabitleri",
        "display_name": "Firma Sabitleri",
        "enabled": True,
        "kind": "query",
        "mode": "push",
        "database": "",
        "sql": "SELECT * FROM FIRMASABITLERI",
        "params_order": [],
        "params_template": {},
        "push_enabled": True,
        "push_interval_sec": 3600,
        "snapshot": True,
        "guard_zero": True,
        "guard_mass_delete": True,
        "multi_result": False
    },
    {
        "dataset_key": "stok_fiyat_adlari",
        "display_name": "Stok Fiyat Adları",
        "enabled": True,
        "kind": "query",
        "mode": "push",
        "database": "",
        "sql": "SELECT ID, AD FROM STOK_FIYAT_AD ORDER BY AD",
        "params_order": [],
        "params_template": {},
        "push_enabled": True,
        "push_interval_sec": 1800,
        "snapshot": True,
        "guard_zero": True,
        "guard_mass_delete": True,
        "multi_result": False
    },
    {
        "dataset_key": "cari_bakiye_liste",
        "display_name": "Cari Bakiye Liste",
        "enabled": True,
        "kind": "procedure",
        "mode": "push",
        "database": "",
        "sql": "dbo.CARI_BAKIYE_LISTE",
        "params_order": [],
        "params_template": {},
        "push_enabled": True,
        "push_interval_sec": 900,
        "snapshot": True,
        "guard_zero": True,
        "guard_mass_delete": True,
        "multi_result": False
    },
    {
        "dataset_key": "financial_data",
        "display_name": "Finansal Özet (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetFinancialData",
        "params_order": ["sdate", "edate", "lokasyonID"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}", "lokasyonID": None},
        "push_enabled": True,
        "push_interval_sec": 120,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "financial_data_location",
        "display_name": "Finansal Özet Lokasyon (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetFinancialDataLocation",
        "params_order": ["sdate", "edate"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}"},
        "push_enabled": True,
        "push_interval_sec": 120,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "hourly_data",
        "display_name": "Saatlik Satış (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetHourlyData",
        "params_order": ["sdate", "edate", "lokasyonID"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}", "lokasyonID": None},
        "push_enabled": True,
        "push_interval_sec": 120,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "hourly_location_data",
        "display_name": "Saatlik Lokasyon Satış (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetHourlyLocationData",
        "params_order": ["sdate", "edate"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}"},
        "push_enabled": True,
        "push_interval_sec": 120,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "hourly_stock_detail",
        "display_name": "Saatlik Stok Satış Detayı",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GET_HOURLY_STOCK_DETAIL",
        "params_order": ["sdate", "edate", "lokasyonID"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}", "lokasyonID": None},
        "push_enabled": True,
        "push_interval_sec": 120,
        "snapshot": True,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "cancel_data",
        "display_name": "İptal Verileri (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetCancelData",
        "params_order": ["sdate", "edate"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}"},
        "push_enabled": True,
        "push_interval_sec": 300,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "top10_stock_movements",
        "display_name": "Top 10 Stok Hareket (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetTop10StockMovements",
        "params_order": ["sdate", "edate", "lokasyonID"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}", "lokasyonID": None},
        "push_enabled": True,
        "push_interval_sec": 300,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "down10_stock_movements",
        "display_name": "En Düşük 10 Stok Hareket (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetDown10StockMovements",
        "params_order": ["sdate", "edate", "lokasyonID"],
        "params_template": {"sdate": "{today_start}", "edate": "{now}", "lokasyonID": None},
        "push_enabled": True,
        "push_interval_sec": 300,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "acik_masalar",
        "display_name": "Açık Masalar (Canlı)",
        "enabled": True,
        "kind": "procedure",
        "mode": "push",
        "database": "",
        "sql": "dbo.ACIK_MASALAR",
        "params_order": ["sdate", "edate"],
        "params_template": {"sdate": None, "edate": None},
        "push_enabled": True,
        "push_interval_sec": LIVE_OPEN_TABLES_INTERVAL_SEC,
        "snapshot": True,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "acik_masa_detay",
        "display_name": "Açık Masa Detay",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.ACIK_MASA_DETAY",
        "params_order": ["POS_ID"],
        "params_template": {"POS_ID": 0},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "rap_filtre_lookup",
        "display_name": "Rapor Filtre Lookup",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.RAP_FILTRE_LOOKUP",
        "params_order": ["Kaynak", "Q"],
        "params_template": {"Kaynak": "", "Q": ""},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "rap_acik_hesap_kisi_ozet_web",
        "display_name": "RAP_ACIK_HESAP_KISI_OZET_WEB",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.RAP_ACIK_HESAP_KISI_OZET_WEB",
        "params_order": ["sdate", "edate", "Page", "PageSize"],
        "params_template": {"sdate": "{today_start}", "edate": "{today_end}", "Page": 1, "PageSize": 200},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "iptal_ozet",
        "display_name": "İptal Özet (Bugün)",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.IPTAL_OZET",
        "params_order": ["sdate", "edate"],
        "params_template": {"sdate": "{today_start}", "edate": "{today_end}"},
        "push_enabled": True,
        "push_interval_sec": 300,
        "snapshot": True,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "iptal_detay",
        "display_name": "İptal Fişleri ve Detayları",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.IPTAL_DETAY",
        "params_order": ["sdate", "edate", "IPTAL_ID"],
        "params_template": {"sdate": "{today_start}", "edate": "{today_end}", "IPTAL_ID": None},
        "push_enabled": True,
        "push_interval_sec": 300,
        "snapshot": True,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "garson_satis_ozet",
        "display_name": "Garson Satış Özet",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GARSON_SATIS_OZET",
        "params_order": ["sdate", "edate"],
        "params_template": {"sdate": "{today_start}", "edate": "{today_end}"},
        "push_enabled": True,
        "push_interval_sec": 300,
        "snapshot": True,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "fis_gunluk_bildirim_feed",
        "display_name": "Yüksek Tutar Fiş Bildirim Feed",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.FIS_GUNLUK_BILDIRIM_FEED",
        "params_order": ["TARIH", "MinTutar", "SonFisId", "Lokasyon", "Personel", "FisTuru"],
        "params_template": {"TARIH": "{now_date}", "MinTutar": 0, "SonFisId": 0, "Lokasyon": "", "Personel": "", "FisTuru": ""},
        "push_enabled": True,
        "push_interval_sec": 5,
        "snapshot": True,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "stock_list",
        "display_name": "Stok Listesi",
        "enabled": True,
        "kind": "procedure",
        "mode": "hybrid",
        "database": "",
        "sql": "dbo.GetStockList",
        "params_order": ["FIYAT_AD"],
        "params_template": {"FIYAT_AD": 0},
        "push_enabled": True,
        "push_interval_sec": 900,
        "snapshot": True,
        "guard_zero": True,
        "guard_mass_delete": True,
        "multi_result": False
    },
    {
        "dataset_key": "stok_extre",
        "display_name": "Stok Ekstre",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.STOK_EXTRE",
        "params_order": ["ID"],
        "params_template": {"ID": 0},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "stok_bilgi_miktar",
        "display_name": "Stok Bilgi Miktar",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.STOK_BILGI_MIKTAR",
        "params_order": ["ID", "LOKASYON"],
        "params_template": {"ID": 0, "LOKASYON": 0},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "kart_extre_cari",
        "display_name": "Kart Ekstre Cari",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.KART_EXTRE_CARI",
        "params_order": ["ID", "DOVIZ_AD", "TARIH_BASLANGIC", "TARIH_BITIS", "DEVIR"],
        "params_template": {"ID": 0, "DOVIZ_AD": 1, "TARIH_BASLANGIC": "{month_start}", "TARIH_BITIS": "{now_date}", "DEVIR": "Devreden"},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": False
    },
    {
        "dataset_key": "fis_detay_toplam",
        "display_name": "Fiş Detay ve Toplam",
        "enabled": True,
        "kind": "procedure",
        "mode": "ondemand",
        "database": "",
        "sql": "dbo.GetFisDetayVeToplam",
        "params_order": ["FisId"],
        "params_template": {"FisId": 0},
        "push_enabled": False,
        "push_interval_sec": 0,
        "snapshot": False,
        "guard_zero": False,
        "guard_mass_delete": False,
        "multi_result": True
    }
]

DEFAULTS: Dict[str, Any] = {
    "admin_pass_enc": "",
    "server_url": DEFAULT_SERVER_URL,
    "driver": "ODBC Driver 18 for SQL Server",
    "host": "localhost",
    "instance": "SQLEXPRESS",
    "port": "",
    "use_win_auth": False,
    "user": "sa",
    "sql_pwd_enc": "",
    "encrypt": True,
    "trust_cert": True,
    "database": "",
    "tenant_id": "",
    "interval_seconds": 30,
    "batch_size": 500,
    "auto_sync_enabled": False,
    "run_at_boot": False,
    "quiet_sync": True,
    "client_secret_enc": "",
    "client_secret_registered": False,
    "price_update_enabled": True,
    "price_update_interval_sec": 30,
    "price_update_kod_pc": 0,
    "price_update_kullanici": 0,
    "islem_enabled": True,
    "islem_interval_sec": 30,
    "islem_finans_enabled": False,
    "islem_fis_enabled": False,
    "islem_sayim_enabled": False,
    "islem_proje": 0,
    "islem_lokasyon": 0,
    "dataset_definitions": DEFAULT_DATASET_DEFINITIONS,
    "change_watchers": DEFAULT_CHANGE_WATCHERS,
}


def merge_defaults_by_key(existing: Any, defaults: List[Dict[str, Any]], key_name: str) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen = set()

    if isinstance(existing, list):
        for item in existing:
            if not isinstance(item, dict):
                continue
            key = str(item.get(key_name, "")).strip()
            if key:
                seen.add(key)
            merged.append(dict(item))

    for item in defaults:
        if not isinstance(item, dict):
            continue
        key = str(item.get(key_name, "")).strip()
        if key and key in seen:
            continue
        merged.append(dict(item))
        if key:
            seen.add(key)

    return merged



def apply_required_runtime_overrides(cfg: Dict[str, Any]) -> Dict[str, Any]:
    dataset_overrides = {
        "acik_masalar": {"push_interval_sec": LIVE_OPEN_TABLES_INTERVAL_SEC, "snapshot": True},
        "firma_sabitleri": {"push_interval_sec": 10, "snapshot": True, "push_enabled": True},
        "stok_fiyat_adlari": {"push_interval_sec": 10, "snapshot": True, "push_enabled": True},
        # Eski config içinde farklı kalsa bile stok/cari/saatlik satış web cache'e otomatik basılsın.
        "stock_list": {"mode": "push", "push_enabled": True, "snapshot": True, "guard_zero": True, "guard_mass_delete": True},
        "cari_bakiye_liste": {"mode": "push", "push_enabled": True, "snapshot": True, "guard_zero": True, "guard_mass_delete": True},
        "hourly_stock_detail": {"mode": "hybrid", "push_enabled": True, "push_interval_sec": 10, "snapshot": True, "guard_zero": False, "guard_mass_delete": False},
        "rap_filtre_lookup": {"mode": "ondemand", "push_enabled": False, "snapshot": False, "guard_zero": False, "guard_mass_delete": False, "params_order": ["Kaynak", "Q"], "params_template": {"Kaynak": "", "Q": ""}},
        "rap_acik_hesap_kisi_ozet_web": {"mode": "ondemand", "push_enabled": False, "snapshot": False, "guard_zero": False, "guard_mass_delete": False},
        "financial_data": {"push_interval_sec": 10},
        "financial_data_location": {"push_interval_sec": 10},
        "hourly_data": {"push_interval_sec": 10},
        "hourly_location_data": {"push_interval_sec": 10},
        "cancel_data": {"push_interval_sec": 10},
        "iptal_ozet": {"push_interval_sec": 10},
        "iptal_detay": {"push_interval_sec": 10},
        "garson_satis_ozet": {"push_interval_sec": 10},
        "fis_gunluk_bildirim_feed": {
            "mode": "ondemand",
            "push_enabled": False,
            "push_interval_sec": 0,
            "snapshot": False,
            "params_order": ["TARIH", "MinTutar", "SonFisId", "Lokasyon", "Personel", "FisTuru"],
            "params_template": {"TARIH": "{now_date}", "MinTutar": 4000, "SonFisId": 0, "Lokasyon": "", "Personel": "", "FisTuru": ""},
        },
    }
    for item in cfg.get("dataset_definitions", []) or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("dataset_key", "")).strip()
        if key in dataset_overrides:
            item.update(dataset_overrides[key])

    watcher_overrides = {
        "daily_reports_watch": {"watch_interval_sec": FAST_REACTIVE_INTERVAL_SEC},
        "iptal_reports_watch": {"watch_interval_sec": FAST_REACTIVE_INTERVAL_SEC},
        "garson_sales_watch": {"watch_interval_sec": FAST_REACTIVE_INTERVAL_SEC},
        "fis_bildirim_watch": {"watch_interval_sec": FAST_REACTIVE_INTERVAL_SEC},
    }
    for item in cfg.get("change_watchers", []) or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("watch_key", "")).strip()
        if key in watcher_overrides:
            item.update(watcher_overrides[key])
    return cfg

def load_cfg() -> Dict[str, Any]:
    ensure_dirs()
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            cfg = dict(DEFAULTS)
            cfg.update(data)
            cfg["dataset_definitions"] = merge_defaults_by_key(
                cfg.get("dataset_definitions"),
                DEFAULT_DATASET_DEFINITIONS,
                "dataset_key",
            )
            cfg["change_watchers"] = merge_defaults_by_key(
                cfg.get("change_watchers"),
                DEFAULT_CHANGE_WATCHERS,
                "watch_key",
            )
            return apply_required_runtime_overrides(cfg)
        except Exception:
            return apply_required_runtime_overrides(dict(DEFAULTS))
    return apply_required_runtime_overrides(dict(DEFAULTS))


def save_cfg(cfg: Dict[str, Any]):
    ensure_dirs()
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def factory_reset():
    for p in (CONFIG_PATH, SNAPSHOT_PATH, WATCH_STATE_PATH, LOG_PATH):
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


def build_server_candidates(host: str, instance: str, port: str) -> List[str]:
    cands: List[str] = []
    h = (host or "").strip()
    inst = (instance or "").strip()
    prt = (port or "").strip()

    if inst:
        cands.append(f"{h}\\{inst}")
    if prt:
        cands.append(f"{h},{prt}")
    if h:
        cands.append(h)
    if h.lower() == "localhost":
        cands.extend(["127.0.0.1", "127.0.0.1,1433"])

    out: List[str] = []
    seen = set()
    for cand in cands:
        if cand and cand not in seen:
            seen.add(cand)
            out.append(cand)
    return out


def try_connect(driver: str, server: str, use_win_auth: bool, user: str, pwd: str, encrypt: bool, trust: bool, database: str = "master"):
    enc = "yes" if encrypt else "no"
    tr = "yes" if trust else "no"
    if use_win_auth:
        cs = f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};Trusted_Connection=yes;Encrypt={enc};TrustServerCertificate={tr};Timeout=10;"
    else:
        cs = f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};UID={user};PWD={pwd};Encrypt={enc};TrustServerCertificate={tr};Timeout=10;"
    return pyodbc.connect(cs, timeout=10)


def list_databases(conn) -> List[str]:
    cur = conn.cursor()
    cur.execute("SELECT name FROM sys.databases WHERE state = 0 ORDER BY name")
    return [r[0] for r in cur.fetchall()]


def post_json(server_url: str, tenant_id: str, payload: Dict[str, Any], client_secret: Optional[str] = None, timeout: int = 300):
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Connection": "close",
    }
    if client_secret:
        headers["X-Client-Secret"] = client_secret

    body = json.dumps({"tenant_id": tenant_id, **payload}, ensure_ascii=False).encode("utf-8")
    last_err = None
    for _ in range(3):
        try:
            resp = requests.post(server_url, data=body, headers=headers, timeout=timeout)
            if 200 <= resp.status_code < 300:
                try:
                    return resp.json()
                except Exception:
                    return {"ok": True}
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
        except Exception as exc:
            last_err = exc
            time.sleep(1)
    raise RuntimeError(f"POST başarısız: {last_err}")


def split_text_chunks(text: str, chunk_size: int) -> List[str]:
    return [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)] or [""]


def split_rows_for_paged_push(rows: List[Dict[str, Any]], max_bytes: int = PAGED_PUSH_TARGET_BYTES, max_rows: int = PAGED_PUSH_MAX_ROWS_PER_PAGE):
    """Büyük listeyi MySQL max_allowed_packet'e takılmayacak küçük satır gruplarına böler."""
    batch = []
    batch_bytes = 2  # []
    for row in rows:
        row_json = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
        row_bytes = len(row_json.encode("utf-8")) + (1 if batch else 0)

        if batch and (len(batch) >= max_rows or batch_bytes + row_bytes > max_bytes):
            yield batch
            batch = []
            batch_bytes = 2

        batch.append(row)
        batch_bytes += row_bytes

    if batch:
        yield batch


def _first_row_value(row: Dict[str, Any], keys: List[str], default: Any = None) -> Any:
    """Satır içinden ilk dolu değeri alır; yoksa default döner."""
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return default


def _num_value(value: Any) -> float:
    """SQL'den gelen sayısal/metin değerleri güvenli float'a çevirir."""
    if value is None or value == "":
        return 0.0
    try:
        if isinstance(value, str):
            value = value.strip().replace("₺", "").replace(" ", "")
            if "," in value and "." in value:
                value = value.replace(".", "").replace(",", ".")
            elif "," in value:
                value = value.replace(",", ".")
        return float(value)
    except Exception:
        return 0.0


def _fmt_decimal(value: float, digits: int = 2) -> str:
    try:
        return f"{float(value):.{digits}f}"
    except Exception:
        return "0.00" if digits == 2 else "0"


def _hourly_group_day(row: Dict[str, Any]) -> str:
    val = _first_row_value(row, ["TARIH", "FIS_TARIHI", "GUN", "DATE", "TARIH_GUN", "tarih", "fis_tarihi"])
    if val is None:
        return ""
    txt = str(val).strip()
    if len(txt) >= 10 and txt[4:5] == "-" and txt[7:8] == "-":
        return txt[:10]
    return txt


def _safe_int_hour(value: Any) -> Optional[int]:
    try:
        if value is None or str(value).strip() == "":
            return None
        h = int(float(str(value).strip()))
        if 0 <= h <= 23:
            return h
        return None
    except Exception:
        return None


def _hour_label(hour_no: int) -> str:
    next_hour = (int(hour_no) + 1) % 24
    return f"{int(hour_no):02d}:00 - {next_hour:02d}:00"


def _normalize_date_value(value: Any) -> str:
    if value is None:
        return ""
    txt = str(value).strip()
    if not txt:
        return ""
    if len(txt) >= 10 and txt[4:5] == "-" and txt[7:8] == "-":
        return txt[:10]
    return txt


def aggregate_hourly_stock_detail_rows(rows: List[Dict[str, Any]], default_date: Any = None, include_zero_hours: bool = True) -> List[Dict[str, Any]]:
    """
    GET_HOURLY_STOCK_DETAIL procedure ürün bazında satır döndürür.

    Web'e ürün ürün ayrı row basmıyoruz; 1 saat + 1 lokasyon = 1 row oluşturuyoruz.
    Ama o saat aralığındaki ürün kırılımını kaybetmemek için ürünleri aynı row içinde
    URUNLER listesi olarak saklıyoruz.

    Çıktı mantığı:
      TARIH + SAAT_NO + LOKASYON_ID = 1 row
      row["URUNLER"] = aynı saat/lokasyonda satılan ürünlerin toplamları

    Böylece dataset_cache_rows şişmez, ama web o saat aralığında hangi ürün kaç adet
    satılmış görebilir.
    """
    source_rows = [r for r in rows if isinstance(r, dict)]
    default_day = _normalize_date_value(default_date)
    if not source_rows:
        return []

    typed = [str(r.get("SATIR_TIPI", "")).strip().upper() for r in source_rows]
    # Ürün kırılımı için mümkünse DETAY satırlarını kullanırız.
    # Sadece toplam satırı gelirse yine saat/lokasyon özeti üretiriz ama URUNLER boş kalabilir.
    if any(t == "DETAY" for t in typed):
        source_rows = [r for r in source_rows if str(r.get("SATIR_TIPI", "")).strip().upper() == "DETAY"]
    elif any(t == "SAAT_LOKASYON_TOPLAM" for t in typed):
        source_rows = [r for r in source_rows if str(r.get("SATIR_TIPI", "")).strip().upper() == "SAAT_LOKASYON_TOPLAM"]
    elif any(t == "SAAT_TOPLAM" for t in typed):
        source_rows = [r for r in source_rows if str(r.get("SATIR_TIPI", "")).strip().upper() == "SAAT_TOPLAM"]

    sum_fields_2 = [
        "BRUT_KDV_DAHIL_TOPLAM_TUTAR",
        "SATIR_ISKONTO_TUTARI",
        "FIS_ISKONTO_TUTARI",
        "GENEL_ISKONTO_TUTARI",
        "PERAKENDE_SATIR_ISKONTO_TUTARI",
        "ERP12_SATIR_ISKONTO_TUTARI",
        "PERAKENDE_FIS_ISKONTO_TUTARI",
        "ERP12_FIS_ISKONTO_TUTARI",
        "PERAKENDE_GENEL_ISKONTO_TUTARI",
        "ERP12_GENEL_ISKONTO_TUTARI",
        "KDV_HARIC_NET_TUTAR",
        "KDV_TUTARI",
        "KDV_DAHIL_TOPLAM_TUTAR",
        "PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR",
        "ERP12_KDV_DAHIL_TOPLAM_TUTAR",
    ]
    sum_fields_3 = ["TOPLAM_MIKTAR"]
    count_fields = ["SATIR_SAYISI", "PERAKENDE_SATIR_SAYISI", "ERP12_SATIR_SAYISI"]

    groups: Dict[str, Dict[str, Any]] = {}
    lokasyonlar: Dict[str, Dict[str, Any]] = {}

    for row in source_rows:
        gun = _normalize_date_value(_hourly_group_day(row)) or default_day
        saat_no = _safe_int_hour(_first_row_value(row, ["SAAT_NO", "SAAT", "HOUR"]))
        if saat_no is None:
            continue

        lok_id = _first_row_value(row, ["LOKASYON_ID", "LOKASYONID", "LOKASYON"])
        lok_ad = _first_row_value(row, ["LOKASYON", "LOKASYON_ADI", "LOKASYON_AD"])
        lok_key = str(lok_id if lok_id not in (None, "") else "0")
        if lok_key not in lokasyonlar:
            lokasyonlar[lok_key] = {
                "LOKASYON_ID": lok_id,
                "LOKASYON": lok_ad if lok_ad not in (None, "") else "TÜM LOKASYONLAR",
            }

        key = "|".join([str(gun or ""), str(saat_no), lok_key])
        if key not in groups:
            groups[key] = {
                "SATIR_TIPI": "SAAT_LOKASYON_URUNLER",
                "TARIH": gun,
                "SAAT_NO": saat_no,
                "SAAT_ADI": _hour_label(saat_no),
                "LOKASYON_ID": lok_id,
                "LOKASYON": lok_ad if lok_ad not in (None, "") else "TÜM LOKASYONLAR",
                "__URUNLER_MAP": {},
            }
            for f in sum_fields_2 + sum_fields_3 + count_fields:
                groups[key][f] = 0.0

        g = groups[key]
        for f in sum_fields_2 + sum_fields_3:
            g[f] = _num_value(g.get(f)) + _num_value(row.get(f))
        for f in count_fields:
            if row.get(f) is not None:
                g[f] = _num_value(g.get(f)) + _num_value(row.get(f))
        if row.get("SATIR_SAYISI") is None:
            g["SATIR_SAYISI"] = _num_value(g.get("SATIR_SAYISI")) + 1

        # Aynı saat/lokasyon row'unun içinde ürün kırılımını da tut.
        stok_id = _first_row_value(row, ["STOK_ID", "STOK", "stok_id"])
        stok_kodu = _first_row_value(row, ["STOK_KODU", "STOK_KOD", "KOD", "BARKOD"])
        stok_adi = _first_row_value(row, ["STOK_ADI", "STOK_AD", "AD", "URUN_ADI"])
        birim_id = _first_row_value(row, ["BIRIM_ID", "STOK_BIRIM", "BIRIM"])
        birim_adi = _first_row_value(row, ["BIRIM_ADI", "BIRIM_AD", "BIRIM"])

        # Toplam satırlarında ürün bilgisi olmayabilir; o zaman URUNLER'e boş/toplam satırı eklemeyelim.
        if stok_id in (None, "") and stok_adi in (None, "") and stok_kodu in (None, ""):
            continue

        urun_key = "|".join([
            str(stok_id if stok_id not in (None, "") else "0"),
            str(birim_id if birim_id not in (None, "") else "0"),
            str(stok_kodu if stok_kodu not in (None, "") else ""),
            str(stok_adi if stok_adi not in (None, "") else ""),
        ])
        urun_map = g.setdefault("__URUNLER_MAP", {})
        if urun_key not in urun_map:
            urun_map[urun_key] = {
                "STOK_ID": stok_id,
                "STOK_KODU": stok_kodu,
                "STOK_ADI": stok_adi,
                "BIRIM_ID": birim_id,
                "BIRIM_ADI": birim_adi,
            }
            for f in sum_fields_2 + sum_fields_3 + count_fields:
                urun_map[urun_key][f] = 0.0

        u = urun_map[urun_key]
        for f in sum_fields_2 + sum_fields_3:
            u[f] = _num_value(u.get(f)) + _num_value(row.get(f))
        for f in count_fields:
            if row.get(f) is not None:
                u[f] = _num_value(u.get(f)) + _num_value(row.get(f))
        if row.get("SATIR_SAYISI") is None:
            u["SATIR_SAYISI"] = _num_value(u.get("SATIR_SAYISI")) + 1

    # Gün içinde 24 saat var. Satış olmayan saatler de 0 olarak hazır dursun.
    # Bu satırlarda URUNLER boş liste olur.
    if include_zero_hours and lokasyonlar:
        all_days = sorted({str(g.get("TARIH") or default_day or "") for g in groups.values()}) or ([default_day] if default_day else [""])
        for gun in all_days:
            for lok_key, lok in lokasyonlar.items():
                for h in range(24):
                    key = "|".join([str(gun or ""), str(h), lok_key])
                    if key not in groups:
                        groups[key] = {
                            "SATIR_TIPI": "SAAT_LOKASYON_URUNLER",
                            "TARIH": gun,
                            "SAAT_NO": h,
                            "SAAT_ADI": _hour_label(h),
                            "LOKASYON_ID": lok.get("LOKASYON_ID"),
                            "LOKASYON": lok.get("LOKASYON") or "TÜM LOKASYONLAR",
                            "__URUNLER_MAP": {},
                        }
                        for f in sum_fields_2 + sum_fields_3 + count_fields:
                            groups[key][f] = 0.0

    out: List[Dict[str, Any]] = []
    for g in groups.values():
        miktar = _num_value(g.get("TOPLAM_MIKTAR"))
        tutar = _num_value(g.get("KDV_DAHIL_TOPLAM_TUTAR"))
        brut = _num_value(g.get("BRUT_KDV_DAHIL_TOPLAM_TUTAR"))
        birim_tutar = tutar if tutar else brut
        g["KDV_DAHIL_BIRIM_FIYAT"] = _fmt_decimal((birim_tutar / miktar) if miktar else 0, 2)

        for f in sum_fields_2:
            g[f] = _fmt_decimal(_num_value(g.get(f)), 2)
        for f in sum_fields_3:
            g[f] = _fmt_decimal(_num_value(g.get(f)), 3)
        for f in count_fields:
            g[f] = int(round(_num_value(g.get(f))))

        urunler = []
        for u in (g.get("__URUNLER_MAP") or {}).values():
            umiktar = _num_value(u.get("TOPLAM_MIKTAR"))
            ututar = _num_value(u.get("KDV_DAHIL_TOPLAM_TUTAR"))
            ubrut = _num_value(u.get("BRUT_KDV_DAHIL_TOPLAM_TUTAR"))
            ubirim_tutar = ututar if ututar else ubrut
            u["KDV_DAHIL_BIRIM_FIYAT"] = _fmt_decimal((ubirim_tutar / umiktar) if umiktar else 0, 2)
            for f in sum_fields_2:
                u[f] = _fmt_decimal(_num_value(u.get(f)), 2)
            for f in sum_fields_3:
                u[f] = _fmt_decimal(_num_value(u.get(f)), 3)
            for f in count_fields:
                u[f] = int(round(_num_value(u.get(f))))
            urunler.append(u)

        urunler.sort(key=lambda u: (-_num_value(u.get("KDV_DAHIL_TOPLAM_TUTAR")), -_num_value(u.get("TOPLAM_MIKTAR")), str(u.get("STOK_ADI") or "")))
        g["URUNLER"] = urunler
        g["URUN_SAYISI"] = len(urunler)
        g.pop("__URUNLER_MAP", None)
        out.append(g)

    out.sort(key=lambda r: (str(r.get("TARIH") or ""), str(r.get("LOKASYON") or ""), int(_num_value(r.get("SAAT_NO")))))
    return out

def aggregate_acik_masa_detay_rows(rows: List[Dict[str, Any]], forced_pos_id: Any = None) -> List[Dict[str, Any]]:
    """
    acik_masa_detay ürün ürün dataset_cache_rows'a düşmesin diye satırları POS/masa bazında tek kayda toplar.
    Ürünler kaybolmasın diye tek kaydın içinde URUNLER listesi olarak saklanır.

    Çıktı mantığı:
      1 açık masa/POS_ID = 1 row
      row_json.URUNLER = masadaki ürün satırları
    """
    source_rows = [r for r in rows if isinstance(r, dict)]
    if not source_rows:
        return []

    groups: Dict[str, Dict[str, Any]] = {}

    # Açık masa detaylarında karşılaşılabilecek toplam alanları.
    tutar_fields = [
        "TUTAR", "TOPLAM_TUTAR", "KDV_DAHIL_TOPLAM_TUTAR", "DAHIL_TUTAR",
        "NET_TUTAR", "SATIR_TUTAR", "FIYAT_TUTAR", "KALAN_TUTAR", "ODENEN_TUTAR",
    ]
    miktar_fields = ["MIKTAR", "MIKTAR_FIS", "ADET", "TOPLAM_MIKTAR"]

    for row in source_rows:
        pos_id = forced_pos_id if forced_pos_id not in (None, "", 0, "0") else _first_row_value(row, ["POS_ID", "POSID", "POS", "POS_GECICI", "pos_id"])
        masa_id = _first_row_value(row, ["MASA_ID", "MASAID", "MASA", "masa_id"])
        lok_id = _first_row_value(row, ["LOKASYON_ID", "LOKASYONID", "LOKASYON", "lokasyon_id"])

        # POS_ID varsa onunla grupluyoruz; yoksa masa/lokasyonla fallback.
        key = "|".join([str(pos_id or ""), str(masa_id or ""), str(lok_id or "")])
        if key.strip("|") == "":
            key = "hash:" + hash_obj(row)

        if key not in groups:
            groups[key] = {
                "SATIR_TIPI": "ACIK_MASA_DETAY_TOPLAM",
                "POS_ID": pos_id,
                "MASA_ID": masa_id,
                "MASA": _first_row_value(row, ["MASA_ADI", "MASA_AD", "MASA", "masa"], masa_id),
                "BOLUM": _first_row_value(row, ["BOLUM", "BOLUM_AD", "BOLUM_ADI", "SALON", "bolum"], ""),
                "LOKASYON_ID": lok_id,
                "LOKASYON": _first_row_value(row, ["LOKASYON_ADI", "LOKASYON_AD", "LOKASYON", "lokasyon"], ""),
                "GARSON_ID": _first_row_value(row, ["GARSON_ID", "GARSON", "garson_id"], None),
                "GARSON_AD": _first_row_value(row, ["GARSON_AD", "GARSON_ADI", "GARSON", "garson_ad"], ""),
                "SATIR_SAYISI": 0,
                "TOPLAM_MIKTAR": 0.0,
                "TOPLAM_TUTAR": 0.0,
                "KDV_DAHIL_TOPLAM_TUTAR": 0.0,
                "KALAN_TUTAR": 0.0,
                "ODENEN_TUTAR": 0.0,
                "SON_ZAMAN": _first_row_value(row, ["ZAMAN", "TARIH", "FIS_TARIHI", "SAAT"], ""),
                "URUNLER": [],
            }

        g = groups[key]
        g["SATIR_SAYISI"] = int(g.get("SATIR_SAYISI", 0)) + 1

        miktar = 0.0
        for f in miktar_fields:
            if row.get(f) is not None:
                miktar = _num_value(row.get(f))
                break
        g["TOPLAM_MIKTAR"] = _num_value(g.get("TOPLAM_MIKTAR")) + miktar

        # Öncelik: satırın net/toplam tutarı; yoksa MIKTAR*FIYAT.
        satir_tutar = 0.0
        for f in tutar_fields:
            if row.get(f) is not None and _num_value(row.get(f)) != 0:
                satir_tutar = _num_value(row.get(f))
                break
        if satir_tutar == 0:
            satir_tutar = miktar * _num_value(_first_row_value(row, ["FIYAT", "DAHIL_FIYAT", "BIRIM_FIYAT"], 0))

        g["TOPLAM_TUTAR"] = _num_value(g.get("TOPLAM_TUTAR")) + satir_tutar
        g["KDV_DAHIL_TOPLAM_TUTAR"] = _num_value(g.get("KDV_DAHIL_TOPLAM_TUTAR")) + satir_tutar

        # Belge seviyesinde gelen ödenen/kalan varsa satır satır toplamak yerine en büyük/son değeri koru.
        kalan = _num_value(_first_row_value(row, ["KALAN_TUTAR", "KALAN", "BAKIYE"], 0))
        odenen = _num_value(_first_row_value(row, ["ODENEN_TUTAR", "ODENEN"], 0))
        if kalan:
            g["KALAN_TUTAR"] = kalan
        if odenen:
            g["ODENEN_TUTAR"] = odenen

        zaman = _first_row_value(row, ["ZAMAN", "TARIH", "FIS_TARIHI", "SAAT"], None)
        if zaman is not None:
            if str(zaman) > str(g.get("SON_ZAMAN") or ""):
                g["SON_ZAMAN"] = str(zaman)

        # Ürün detayı tek satır içinde saklanır; dataset_cache_rows'ta ayrı ayrı ürün satırı oluşmaz.
        urun = dict(row)
        g["URUNLER"].append(urun)

    out: List[Dict[str, Any]] = []
    for g in groups.values():
        g["TOPLAM_MIKTAR"] = _fmt_decimal(_num_value(g.get("TOPLAM_MIKTAR")), 3)
        g["TOPLAM_TUTAR"] = _fmt_decimal(_num_value(g.get("TOPLAM_TUTAR")), 2)
        g["KDV_DAHIL_TOPLAM_TUTAR"] = _fmt_decimal(_num_value(g.get("KDV_DAHIL_TOPLAM_TUTAR")), 2)
        g["KALAN_TUTAR"] = _fmt_decimal(_num_value(g.get("KALAN_TUTAR")), 2)
        g["ODENEN_TUTAR"] = _fmt_decimal(_num_value(g.get("ODENEN_TUTAR")), 2)
        out.append(g)

    out.sort(key=lambda r: (str(r.get("LOKASYON") or ""), str(r.get("MASA") or ""), str(r.get("POS_ID") or "")))
    return out


def make_row_key(dataset_key: str, row: Dict[str, Any]) -> str:
    """Stok/cari satırını webde tekil güncellemek için stabil anahtar üretir."""
    if not isinstance(row, dict):
        return sha256_text(canonical(row))

    if dataset_key == "stock_list":
        # Aynı stok birden fazla fiyat adında gelebilir. Bu yüzden row_key sadece STOK_ID olamaz.
        # FIYAT_AD + STOK + BIRIM/BARKOD kombinasyonu ile tutulur.
        fiyat = _first_row_value(row, ["FIYAT_AD", "FIYAT_AD_ID", "fiyat_ad", "fiyat_ad_id", "STOK_FIYAT_AD"])
        stok = _first_row_value(row, ["STOK_ID", "stok_id", "STOK", "stok", "ID", "id", "STOK_KODU", "stok_kodu", "KOD", "kod", "BARKOD", "barkod"])
        birim = _first_row_value(row, ["BIRIM_ID", "birim_id", "STOK_BIRIM", "stok_birim", "BIRIM", "birim", "BIRIM_ADI", "birim_adi"])
        parts = []
        if fiyat is not None:
            parts.append(f"FIYAT_AD:{str(fiyat).strip()}")
        if stok is not None:
            parts.append(f"STOK:{str(stok).strip()}")
        if birim is not None:
            parts.append(f"BIRIM:{str(birim).strip()}")
        if parts:
            return f"{dataset_key}:" + "|".join(parts)
        candidates = ["BARKOD", "barkod", "KOD", "kod", "STOK_KODU", "stok_kodu"]
    elif dataset_key == "cari_bakiye_liste":
        candidates = [
            "CARI_ID", "cari_id", "CARI", "cari", "ID", "id",
            "KOD", "kod", "CARI_KODU", "cari_kodu",
        ]
    elif dataset_key == "iptal_ozet":
        parts = []
        for label, keys in [
            ("TARIH", ["TARIH", "TARIH_IPTAL", "tarih", "date", "GUN"]),
            ("LOKASYON", ["LOKASYON_ID", "LOKASYON", "lokasyon_id", "lokasyon"]),
            ("PERSONEL", ["PERSONEL_ID", "PERSONEL", "KULLANICI", "USER_ID", "personel"]),
            ("SATIR", ["SATIR_MI", "satir_mi"]),
        ]:
            val = _first_row_value(row, keys)
            if val is not None:
                parts.append(f"{label}:{str(val).strip()}")
        if parts:
            return f"{dataset_key}:" + "|".join(parts)
        candidates = ["ID", "id"]
    elif dataset_key == "iptal_detay":
        parts = []
        for label, keys in [
            ("IPTAL", ["IPTAL_ID", "FIS_POS_IPTAL", "iptal_id", "ID", "id"]),
            ("DETAY", ["DETAY_ID", "SATIR_ID", "SIRA", "SATIR_NO", "detay_id"]),
            ("STOK", ["STOK_ID", "STOK", "BARKOD", "KOD"]),
        ]:
            val = _first_row_value(row, keys)
            if val is not None:
                parts.append(f"{label}:{str(val).strip()}")
        if parts:
            return f"{dataset_key}:" + "|".join(parts)
        candidates = ["ID", "id"]
    elif dataset_key == "acik_masa_detay":
        parts = []
        for label, keys in [
            ("POS", ["POS_ID", "POSID", "POS", "pos_id"]),
            ("SATIR", ["DETAY_ID", "SATIR_ID", "ID", "id", "SIRA", "SATIR_NO"]),
            ("STOK", ["STOK_ID", "STOK", "BARKOD", "KOD"]),
        ]:
            val = _first_row_value(row, keys)
            if val is not None:
                parts.append(f"{label}:{str(val).strip()}")
        if parts:
            return f"{dataset_key}:" + "|".join(parts)
        candidates = ["ID", "id"]
    elif dataset_key == "rap_acik_hesap_kisi_ozet_web":
        candidates = ["CARI_ID", "CARI", "KART_ID", "KISI_ID", "ID", "id", "CARI_KODU", "KOD"]
    elif dataset_key == "hourly_stock_detail":
        # Saatlik stok satışında web'e ürün ürün satır basmıyoruz.
        # Tekil anahtar sadece gün + saat aralığı + lokasyon bazında olmalı.
        parts = []
        for label, keys in [
            ("TARIH", ["TARIH", "FIS_TARIHI", "GUN", "DATE"]),
            ("SAAT", ["SAAT_NO", "SAAT", "HOUR", "SAAT_ADI"]),
            ("LOKASYON", ["LOKASYON_ID", "LOKASYON"]),
        ]:
            val = _first_row_value(row, keys)
            if val is not None:
                parts.append(f"{label}:{str(val).strip()}")
        if parts:
            return f"{dataset_key}:" + "|".join(parts)
        candidates = ["SAAT_NO", "SAAT_ADI", "ID", "id"]
    else:
        candidates = ["ID", "id", "KOD", "kod", "CARI_ID", "STOK_ID"]

    for key in candidates:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return f"{dataset_key}:{key}:{str(value).strip()}"

    return f"{dataset_key}:hash:{hash_obj(row)}"

def delta_snapshot_key(dataset_key: str, params: Dict[str, Any]) -> str:
    return f"delta::{dataset_key}|{hash_obj(params)}"


def build_row_hash_map(dataset_key: str, rows: List[Dict[str, Any]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        rk = make_row_key(dataset_key, row)
        out[rk] = hash_obj(row)
    return out


def split_delta_changes(changes: List[Dict[str, Any]], max_bytes: int = DELTA_PUSH_TARGET_BYTES, max_rows: int = DELTA_PUSH_MAX_ROWS_PER_BATCH):
    batch = []
    batch_bytes = 2
    for item in changes:
        item_json = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        item_bytes = len(item_json.encode("utf-8")) + (1 if batch else 0)

        if batch and (len(batch) >= max_rows or batch_bytes + item_bytes > max_bytes):
            yield batch
            batch = []
            batch_bytes = 2

        batch.append(item)
        batch_bytes += item_bytes

    if batch:
        yield batch


def resolve_placeholders(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    now = datetime.now()
    mapping = {
        "{now}": now.strftime("%Y-%m-%d %H:%M:%S"),
        "{today_start}": now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S"),
        "{today_end}": now.replace(hour=23, minute=59, second=59, microsecond=0).strftime("%Y-%m-%d %H:%M:%S"),
        "{now_date}": now.strftime("%Y-%m-%d"),
        "{month_start}": now.replace(day=1).strftime("%Y-%m-%d"),
        "{yesterday_start}": (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S"),
        "{yesterday_end}": (now - timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=0).strftime("%Y-%m-%d %H:%M:%S"),
    }

    return mapping.get(value, value)


def resolve_params(params_template: Dict[str, Any]) -> Dict[str, Any]:
    return {k: resolve_placeholders(v) for k, v in (params_template or {}).items()}


# ─────────────── Geçmiş Veri Basma (Backfill) — 2026-07 ───────────────
# Günlük scope'lu datasetler (sunucu cache_lookup sdate gününe göre AYRI saklar,
# bugünün verisi ezilmez).
BACKFILL_DATASET_KEYS = [
    "financial_data", "financial_data_location", "hourly_data", "hourly_location_data",
    "hourly_stock_detail", "cancel_data", "top10_stock_movements", "down10_stock_movements",
    "iptal_ozet", "iptal_detay", "garson_satis_ozet", "fis_gunluk_bildirim_feed",
]


def resolve_params_for_day(params_template: Dict[str, Any], day: datetime) -> Dict[str, Any]:
    """resolve_placeholders'ın belirli bir GÜN için çalışan versiyonu."""
    day_start = day.strftime("%Y-%m-%d 00:00:00")
    day_end = day.strftime("%Y-%m-%d 23:59:59")
    prev = day - timedelta(days=1)
    mapping = {
        "{now}": day_end,
        "{today_start}": day_start,
        "{today_end}": day_end,
        "{now_date}": day.strftime("%Y-%m-%d"),
        "{month_start}": day.replace(day=1).strftime("%Y-%m-%d"),
        "{yesterday_start}": prev.strftime("%Y-%m-%d 00:00:00"),
        "{yesterday_end}": prev.strftime("%Y-%m-%d 23:59:59"),
    }
    out: Dict[str, Any] = {}
    for k, v in (params_template or {}).items():
        out[k] = mapping.get(v, v) if isinstance(v, str) else v
    return out



def ordered_param_values(defn: Dict[str, Any], params: Dict[str, Any]) -> List[Any]:
    order = defn.get("params_order") or list(params.keys())
    return [params.get(name) for name in order]


def dataset_run_key(dataset_key: str, params: Dict[str, Any]) -> str:
    return f"{dataset_key}|{hash_obj(params)}"


class LoginDialog(QDialog):
    def __init__(self, has_pass: bool, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Yönetici Girişi")
        self.setModal(True)
        self.setMinimumWidth(420)

        v = QVBoxLayout(self)
        title = QLabel("Yönetici Girişi / İlk Kurulum")
        title.setStyleSheet("font-size:18px;font-weight:700;")
        v.addWidget(title)

        form = QFormLayout()
        self.ed1 = QLineEdit()
        self.ed1.setEchoMode(QLineEdit.Password)
        self.ed2 = QLineEdit()
        self.ed2.setEchoMode(QLineEdit.Password)

        if has_pass:
            form.addRow("Yönetici Şifresi", self.ed1)
        else:
            form.addRow("Yeni Şifre", self.ed1)
            form.addRow("Tekrar", self.ed2)

        v.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        v.addWidget(buttons)
        self.has_pass = has_pass

    def passwords(self):
        return self.ed1.text(), self.ed2.text()


class Main(QMainWindow):
    append_log_signal = Signal(str)
    refresh_success_signal = Signal()
    popup_info_signal = Signal(str, str)
    popup_error_signal = Signal(str, str)

    def __init__(self, autorun: bool = False):
        super().__init__()
        self.cfg = load_cfg()
        self.autorun = autorun
        self.logged_in = False
        self._allow_real_exit = False
        self._sync_busy = False
        self._live_sync_busy = False
        self._reactive_sync_busy = False
        self._request_poll_busy = False
        self._price_update_busy = False
        self._islem_busy = False
        self._backfill_busy = False
        self._backfill_cancel = False
        self._ondemand_update_busy = False
        self._last_secret_register_try = 0.0
        self._last_lookup_direct_sync_ts = 0.0
        self._last_extre_prewarm_ts = 0.0
        self._last_monthly_fis_detail_prewarm_ts = 0.0

        self.setWindowTitle("KasaCepte Transfer Client")
        self.setMinimumSize(QSize(1180, 820))

        self.tabs = QTabWidget()
        self.setCentralWidget(self.tabs)
        self.tabs.setEnabled(False)

        self.tab_sql = QWidget()
        self.tab_settings = QWidget()
        self.tab_datasets = QWidget()
        self.tab_run = QWidget()

        self.tabs.addTab(self.tab_sql, "1) SQL Bağlantı")
        self.tabs.addTab(self.tab_settings, "2) Sunucu & Güvenlik")
        self.tabs.addTab(self.tab_datasets, "3) Dataset Tanımları")
        self.tabs.addTab(self.tab_run, "4) Senkron")

        self.build_sql_tab()
        self.build_settings_tab()
        self.build_datasets_tab()
        self.build_run_tab()
        self.refresh_manual_dataset_combo()
        self.render_success_state()
        self.build_tray()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.on_tick)

        self.live_timer = QTimer(self)
        self.live_timer.timeout.connect(self.on_live_tick)

        self.reactive_timer = QTimer(self)
        self.reactive_timer.timeout.connect(self.on_reactive_tick)

        self.request_timer = QTimer(self)
        self.request_timer.timeout.connect(self.on_request_tick)

        self.price_update_timer = QTimer(self)
        self.price_update_timer.timeout.connect(self.on_price_update_tick)

        self.islem_timer = QTimer(self)
        self.islem_timer.timeout.connect(self.on_islem_tick)

        self.append_log_signal.connect(self._append_log)
        self.refresh_success_signal.connect(self._render_success_state_ui)
        self.popup_info_signal.connect(self._show_info_popup)
        self.popup_error_signal.connect(self._show_error_popup)

        self.startup_auto_timer = QTimer(self)
        self.startup_auto_timer.setSingleShot(True)
        self.startup_auto_timer.timeout.connect(self._ensure_auto_sync_running)
        self.startup_auto_timer.start(30000)

        self.watchdog_timer = QTimer(self)
        self.watchdog_timer.timeout.connect(self._ensure_auto_sync_running)
        self.watchdog_timer.start(15000)

        self._ensure_client_secret()
        self.refresh_secret_ui()

        if self.autorun:
            self.hide()
            if self.cfg.get("auto_sync_enabled", False):
                QTimer.singleShot(AUTORUN_START_DELAY_SEC * 1000, self.start_auto_sync_silent)
        else:
            self.show_login(allow_exit=True)

    def println(self, msg: str):
        log(msg)
        if threading.current_thread() is threading.main_thread():
            if hasattr(self, "txt_log"):
                self.txt_log.append(msg)
        else:
            self.append_log_signal.emit(msg)

    @Slot(str)
    def _append_log(self, msg: str):
        if hasattr(self, "txt_log"):
            self.txt_log.append(msg)

    @Slot()
    def _render_success_state_ui(self):
        self.render_success_state()

    @Slot(str, str)
    def _show_info_popup(self, title: str, message: str):
        QMessageBox.information(self, title, message)

    @Slot(str, str)
    def _show_error_popup(self, title: str, message: str):
        QMessageBox.critical(self, title, message)

    def _run_background(self, name: str, target, *, use_sync_lock: bool = False, error_title: str = "Hata", success_message: str = ""):
        if use_sync_lock and self._sync_busy:
            self.println(f"{name}: zaten çalışıyor")
            return
        if use_sync_lock:
            self._sync_busy = True

        def worker():
            try:
                target()
                if success_message:
                    self.popup_info_signal.emit("Bilgi", success_message)
            except Exception as exc:
                self.println(f"{name} hata: {exc}")
                log(traceback.format_exc())
                if error_title:
                    self.popup_error_signal.emit(error_title, str(exc))
            finally:
                if use_sync_lock:
                    self._sync_busy = False

        threading.Thread(target=worker, name=name, daemon=True).start()

    def _ensure_auto_sync_running(self):
        try:
            started = False
            if not self.timer.isActive():
                sec = max(10, int(self.cfg.get("interval_seconds", 30)))
                self.timer.start(sec * 1000)
                self.cfg["auto_sync_enabled"] = True
                save_cfg(self.cfg)
                self.println(f"Watchdog otomatik senkronu başlattı. ({sec} sn)")
                QTimer.singleShot(1000, self.on_tick)
                started = True
            if self.cfg.get("auto_sync_enabled", False) and not self.live_timer.isActive():
                self.start_live_open_tables_timer(silent=started)
            if self.cfg.get("auto_sync_enabled", False) and not self.reactive_timer.isActive():
                self.start_reactive_timer(silent=started)
            if self.cfg.get("auto_sync_enabled", False) and not self.request_timer.isActive():
                self.start_request_timer(silent=started)
            if self.cfg.get("auto_sync_enabled", False) and self.cfg.get("price_update_enabled", True) and not self.price_update_timer.isActive():
                self.start_price_update_timer(silent=started)
            if self.cfg.get("auto_sync_enabled", False) and self.cfg.get("islem_enabled", True) and not self.islem_timer.isActive():
                self.start_islem_timer(silent=started)
        except Exception as exc:
            self.println(f"Watchdog hata: {exc}")

    def _cleanup_logs_if_needed(self, days: int = 7):
        last = str(self.cfg.get("last_log_cleanup_at", "") or "")
        now = datetime.now()
        should = True
        if last:
            try:
                prev = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
                should = now >= prev + timedelta(hours=24)
            except Exception:
                should = True
        if not should:
            return
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            return
        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "cleanup_logs", "days": days},
                client_secret=self.get_client_secret(),
                timeout=120,
            )
            self.cfg["last_log_cleanup_at"] = now_str()
            save_cfg(self.cfg)
            self.println(f"7 günlük log temizliği: {resp}")
        except Exception as exc:
            self.println(f"Otomatik log temizliği hata: {exc}")

    def _save_conn_silent(self):
        self.cfg.update({
            "driver": self.cmb_driver.currentText(),
            "host": self.ed_host.text().strip(),
            "instance": self.ed_instance.text().strip(),
            "port": self.ed_port.text().strip(),
            "use_win_auth": self.chk_win.isChecked(),
            "user": self.ed_user.text().strip(),
            "encrypt": self.chk_encrypt.isChecked(),
            "trust_cert": self.chk_trust.isChecked(),
            "database": self.cmb_db.currentText().strip(),
        })
        if not self.chk_win.isChecked() and self.ed_pass.text():
            self.cfg["sql_pwd_enc"] = self.dpapi_set(self.ed_pass.text())
        save_cfg(self.cfg)

    def _save_settings_silent(self):
        self.cfg["server_url"] = self.ed_server_url.text().strip()
        self.cfg["tenant_id"] = self.ed_tenant.text().strip()
        self.cfg["interval_seconds"] = int(self.spin_interval.value())
        self.cfg["batch_size"] = int(self.spin_batch.value())
        self.cfg["auto_sync_enabled"] = self.chk_auto.isChecked()
        self.cfg["run_at_boot"] = self.chk_boot.isChecked()
        self.cfg["price_update_enabled"] = self.chk_price_update.isChecked()
        self.cfg["price_update_interval_sec"] = int(self.spin_price_interval.value())
        self.cfg["price_update_kod_pc"] = int(self.spin_price_kod_pc.value())
        self.cfg["price_update_kullanici"] = int(self.spin_price_kullanici.value())
        self._islem_yetki_cfg_oku()
        self._set_run_at_boot(self.chk_boot.isChecked())
        save_cfg(self.cfg)

    def _islem_yetki_cfg_oku(self):
        self.cfg["islem_finans_enabled"] = self.chk_islem_finans.isChecked()
        self.cfg["islem_fis_enabled"] = self.chk_islem_fis.isChecked()
        self.cfg["islem_sayim_enabled"] = self.chk_islem_sayim.isChecked()

    def push_islem_yetkileri(self, silent: bool = True):
        """Yetkileri sunucuya bildirir — mobil uygulama kapalı özelliklerde
        'işleme yetkiniz yok' mesajı gösterir. (Arka planda çalışır, UI kilitlenmez.)"""
        def worker():
            try:
                self._price_update_post({
                    "action": "islem_yetki_set",
                    "finans": 1 if self.cfg.get("islem_finans_enabled", False) else 0,
                    "fis": 1 if self.cfg.get("islem_fis_enabled", False) else 0,
                    "sayim": 1 if self.cfg.get("islem_sayim_enabled", False) else 0,
                    "fiyat": 1 if self.cfg.get("price_update_enabled", True) else 0,
                }, timeout=30)
                if not silent:
                    f = "açık" if self.cfg.get("islem_finans_enabled") else "kapalı"
                    fi = "açık" if self.cfg.get("islem_fis_enabled") else "kapalı"
                    s = "açık" if self.cfg.get("islem_sayim_enabled") else "kapalı"
                    p = "açık" if self.cfg.get("price_update_enabled", True) else "kapalı"
                    self.println(f"islem yetkileri sunucuya bildirildi: finans={f} fis={fi} sayim={s} fiyat={p}")
            except Exception as exc:
                self.println(f"islem yetkileri gönderilemedi (sonraki senkronda tekrar denenecek): {exc}")
        threading.Thread(target=worker, name="islem_yetki_push", daemon=True).start()

    def _save_datasets_silent(self):
        defs = json.loads(self.txt_datasets.toPlainText())
        if not isinstance(defs, list):
            raise ValueError("Dataset tanımları liste olmak zorunda.")
        self.cfg["dataset_definitions"] = defs
        save_cfg(self.cfg)

    def dpapi_get(self, enc: str) -> str:
        try:
            return dpapi_unprotect(enc).decode("utf-8") if enc else ""
        except Exception:
            return ""

    def dpapi_set(self, text: str) -> str:
        return dpapi_protect(text.encode("utf-8")) if text else ""

    def show_login(self, allow_exit: bool = True):
        has = bool(self.cfg.get("admin_pass_enc"))
        dlg = LoginDialog(has, self)

        while True:
            res = dlg.exec()
            if res != QDialog.Accepted:
                if allow_exit:
                    sys.exit(0)
                self.hide()
                return False

            p1, p2 = dlg.passwords()
            if has:
                saved = self.dpapi_get(self.cfg.get("admin_pass_enc", ""))
                if p1 != saved:
                    QMessageBox.critical(self, "Hata", "Şifre hatalı.")
                    continue
                break
            else:
                if not p1 or p1 != p2:
                    QMessageBox.warning(self, "Uyarı", "Şifreler boş ya da uyuşmuyor.")
                    continue
                self.cfg["admin_pass_enc"] = self.dpapi_set(p1)
                save_cfg(self.cfg)
                break

        self.tabs.setEnabled(True)
        self.logged_in = True
        return True

    def lock_admin_ui(self):
        self.logged_in = False
        if hasattr(self, "tabs"):
            self.tabs.setEnabled(False)

    def require_admin_password(self, title: str = "Yönetici Girişi") -> bool:
        has = bool(self.cfg.get("admin_pass_enc"))
        if not has:
            return self.show_login(allow_exit=False)

        saved = self.dpapi_get(self.cfg.get("admin_pass_enc", ""))
        while True:
            pwd, ok = QInputDialog.getText(self, title, "Yönetici şifresini girin:", QLineEdit.Password)
            if not ok:
                return False
            if pwd != saved:
                QMessageBox.critical(self, "Hata", "Şifre hatalı.")
                continue
            self.tabs.setEnabled(True)
            self.logged_in = True
            return True

    def tray_guard(self, callback, title: str = "Yönetici Girişi"):
        self.lock_admin_ui()
        if not self.require_admin_password(title):
            return
        callback()

    def build_sql_tab(self):
        v = QVBoxLayout(self.tab_sql)
        title = QLabel("SQL Server Bağlantısı")
        title.setStyleSheet("font-size:20px;font-weight:700;")
        v.addWidget(title)

        form = QFormLayout()
        self.cmb_driver = QComboBox()
        self.cmb_driver.addItems(["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"])
        self.cmb_driver.setCurrentText(self.cfg.get("driver", "ODBC Driver 18 for SQL Server"))

        self.ed_host = QLineEdit(self.cfg.get("host", "localhost"))
        self.ed_instance = QLineEdit(self.cfg.get("instance", "SQLEXPRESS"))
        self.ed_port = QLineEdit(self.cfg.get("port", ""))
        self.chk_win = QCheckBox("Windows Authentication")
        self.chk_win.setChecked(bool(self.cfg.get("use_win_auth", False)))
        self.ed_user = QLineEdit(self.cfg.get("user", "sa"))
        self.ed_pass = QLineEdit()
        self.ed_pass.setEchoMode(QLineEdit.Password)
        self.chk_encrypt = QCheckBox("Encrypt")
        self.chk_encrypt.setChecked(bool(self.cfg.get("encrypt", True)))
        self.chk_trust = QCheckBox("Trust Server Certificate")
        self.chk_trust.setChecked(bool(self.cfg.get("trust_cert", True)))
        self.cmb_db = QComboBox()
        self.cmb_db.setEditable(False)
        if self.cfg.get("database"):
            self.cmb_db.addItem(self.cfg["database"])

        form.addRow("ODBC Driver", self.cmb_driver)
        form.addRow("Sunucu", self.ed_host)
        form.addRow("Instance", self.ed_instance)
        form.addRow("Port", self.ed_port)
        form.addRow("", self.chk_win)
        form.addRow("Kullanıcı", self.ed_user)
        form.addRow("Parola", self.ed_pass)
        form.addRow("", self.chk_encrypt)
        form.addRow("", self.chk_trust)
        form.addRow("Veritabanı", self.cmb_db)
        v.addLayout(form)

        hb = QHBoxLayout()
        self.btn_test_conn = QPushButton("Bağlantıyı Dene")
        self.btn_save_conn = QPushButton("Bağlantıyı Kaydet")
        hb.addWidget(self.btn_test_conn)
        hb.addWidget(self.btn_save_conn)
        v.addLayout(hb)

        self.btn_test_conn.clicked.connect(self.on_test_conn)
        self.btn_save_conn.clicked.connect(self.on_save_conn)

    def build_settings_tab(self):
        v = QVBoxLayout(self.tab_settings)
        title = QLabel("Sunucu, Tenant ve Çalışma Ayarları")
        title.setStyleSheet("font-size:20px;font-weight:700;")
        v.addWidget(title)

        form = QFormLayout()
        self.ed_server_url = QLineEdit(self.cfg.get("server_url", DEFAULT_SERVER_URL))
        self.ed_tenant = QLineEdit(self.cfg.get("tenant_id", ""))
        self.btn_gen_tenant = QPushButton("Tenant Üret")
        tenant_hb = QHBoxLayout()
        tenant_hb.addWidget(self.ed_tenant)
        tenant_hb.addWidget(self.btn_gen_tenant)

        self.spin_interval = QSpinBox()
        self.spin_interval.setRange(10, 86400)
        self.spin_interval.setValue(int(self.cfg.get("interval_seconds", 30)))

        self.spin_batch = QSpinBox()
        self.spin_batch.setRange(50, 5000)
        self.spin_batch.setValue(int(self.cfg.get("batch_size", 500)))

        self.chk_auto = QCheckBox("Otomatik senkron açık")
        self.chk_auto.setChecked(bool(self.cfg.get("auto_sync_enabled", False)))

        self.chk_boot = QCheckBox("Windows açılışında çalışsın")
        self.chk_boot.setChecked(bool(self.cfg.get("run_at_boot", False)))

        self.chk_price_update = QCheckBox("Mobil fiyat güncellemelerini uygula")
        self.chk_price_update.setChecked(bool(self.cfg.get("price_update_enabled", True)))

        self.chk_islem_finans = QCheckBox("Mobil Finans İşlemleri (Tahsilat/Ödeme/Çek/Senet)")
        self.chk_islem_finans.setChecked(bool(self.cfg.get("islem_finans_enabled", False)))
        self.chk_islem_fis = QCheckBox("Mobil Fatura/Fiş Girişi")
        self.chk_islem_fis.setChecked(bool(self.cfg.get("islem_fis_enabled", False)))
        self.chk_islem_sayim = QCheckBox("Mobil Sayım Fişi")
        self.chk_islem_sayim.setChecked(bool(self.cfg.get("islem_sayim_enabled", False)))

        self.spin_price_interval = QSpinBox()
        self.spin_price_interval.setRange(10, 3600)
        self.spin_price_interval.setValue(int(self.cfg.get("price_update_interval_sec", 30) or 30))

        self.spin_price_kod_pc = QSpinBox()
        self.spin_price_kod_pc.setRange(0, 2147483647)
        self.spin_price_kod_pc.setValue(int(self.cfg.get("price_update_kod_pc", 0) or 0))

        self.spin_price_kullanici = QSpinBox()
        self.spin_price_kullanici.setRange(0, 2147483647)
        self.spin_price_kullanici.setValue(int(self.cfg.get("price_update_kullanici", 0) or 0))

        self.ed_secret = QLineEdit()
        self.ed_secret.setEchoMode(QLineEdit.Password)
        self.ed_secret.setReadOnly(True)
        self.btn_copy_secret = QPushButton("Secret Kopyala")
        self.btn_regen_secret = QPushButton("Secret Yenile")
        self.btn_register_secret = QPushButton("Secret Register")

        sec_hb = QHBoxLayout()
        sec_hb.addWidget(self.ed_secret)
        sec_hb.addWidget(self.btn_copy_secret)
        sec_hb.addWidget(self.btn_regen_secret)
        sec_hb.addWidget(self.btn_register_secret)

        form.addRow("Server URL", self.ed_server_url)
        form.addRow("Tenant ID", tenant_hb)
        form.addRow("Senkron Aralığı (sn)", self.spin_interval)
        form.addRow("Batch Boyutu", self.spin_batch)
        form.addRow("", self.chk_auto)
        form.addRow("", self.chk_boot)
        form.addRow("", self.chk_price_update)
        form.addRow("", self.chk_islem_finans)
        form.addRow("", self.chk_islem_fis)
        form.addRow("", self.chk_islem_sayim)
        form.addRow("Fiyat Güncelleme Aralığı (sn)", self.spin_price_interval)
        form.addRow("Fiyat KOD_PC", self.spin_price_kod_pc)
        form.addRow("Fiyat KULLANICI", self.spin_price_kullanici)
        form.addRow("Client Secret", sec_hb)

        v.addLayout(form)

        hb = QHBoxLayout()
        self.btn_save_settings = QPushButton("Ayarları Kaydet")
        hb.addWidget(self.btn_save_settings)
        v.addLayout(hb)

        self.btn_gen_tenant.clicked.connect(self.on_gen_tenant)
        self.btn_save_settings.clicked.connect(self.on_save_settings)
        self.btn_copy_secret.clicked.connect(self.on_copy_secret)
        self.btn_regen_secret.clicked.connect(self.on_regen_secret)
        self.btn_register_secret.clicked.connect(lambda: self.register_client_secret_if_needed(force=True))

    def build_datasets_tab(self):
        v = QVBoxLayout(self.tab_datasets)
        title = QLabel("Dataset Tanımları")
        title.setStyleSheet("font-size:20px;font-weight:700;")
        v.addWidget(title)

        info = QLabel(
            "JSON formatında dataset tanımları. Sonradan yeni procedure/select eklemek için buraya kayıt eklemen yeterli.\n"
            "database alanı boşsa seçili ana veritabanı kullanılır."
        )
        info.setWordWrap(True)
        v.addWidget(info)

        self.txt_datasets = QTextEdit()
        self.txt_datasets.setPlainText(json.dumps(self.cfg.get("dataset_definitions", DEFAULT_DATASET_DEFINITIONS), ensure_ascii=False, indent=2))
        v.addWidget(self.txt_datasets, 1)

        hb = QHBoxLayout()
        self.btn_restore_datasets = QPushButton("Varsayılanları Yükle")
        self.btn_save_datasets = QPushButton("Datasetleri Kaydet")
        hb.addWidget(self.btn_restore_datasets)
        hb.addWidget(self.btn_save_datasets)
        v.addLayout(hb)

        self.btn_restore_datasets.clicked.connect(self.on_restore_datasets)
        self.btn_save_datasets.clicked.connect(self.on_save_datasets)

    def build_run_tab(self):
        v = QVBoxLayout(self.tab_run)
        title = QLabel("Senkron İşlemleri")
        title.setStyleSheet("font-size:20px;font-weight:700;")
        v.addWidget(title)

        hb = QHBoxLayout()
        self.btn_full_sync = QPushButton("Tüm Push Datasetleri Gönder")
        self.btn_start_auto = QPushButton("Otomatik Senkronu Başlat")
        self.btn_stop_auto = QPushButton("Otomatik Senkronu Durdur")
        self.btn_poll_once = QPushButton("Kuyruğu Bir Kez Çek")
        self.btn_price_update_once = QPushButton("Fiyat Güncellemeyi Bir Kez Çek")
        self.btn_tenant_wipe = QPushButton("Tenant Verisini Sunucuda Sıfırla")
        hb.addWidget(self.btn_full_sync)
        hb.addWidget(self.btn_start_auto)
        hb.addWidget(self.btn_stop_auto)
        hb.addWidget(self.btn_poll_once)
        hb.addWidget(self.btn_price_update_once)
        hb.addWidget(self.btn_tenant_wipe)
        v.addLayout(hb)

        hb2 = QHBoxLayout()
        self.cmb_manual_dataset = QComboBox()
        self.btn_manual_run = QPushButton("Seçili Dataseti Çalıştır")
        self.btn_flush_offline = QPushButton("Offline Kuyruğu Gönder")
        self.btn_clean_logs = QPushButton("Sunucu Log Temizliği")
        self.btn_open_health = QPushButton("Sağlık Ekranını Aç")
        hb2.addWidget(QLabel("Dataset:"))
        hb2.addWidget(self.cmb_manual_dataset, 1)
        hb2.addWidget(self.btn_manual_run)
        hb2.addWidget(self.btn_flush_offline)
        hb2.addWidget(self.btn_clean_logs)
        hb2.addWidget(self.btn_open_health)
        v.addLayout(hb2)

        hb3 = QHBoxLayout()
        self.dt_backfill_start = QDateEdit()
        self.dt_backfill_start.setCalendarPopup(True)
        self.dt_backfill_start.setDisplayFormat("yyyy-MM-dd")
        self.dt_backfill_start.setDate(QDate.currentDate().addDays(-7))
        self.dt_backfill_end = QDateEdit()
        self.dt_backfill_end.setCalendarPopup(True)
        self.dt_backfill_end.setDisplayFormat("yyyy-MM-dd")
        self.dt_backfill_end.setDate(QDate.currentDate().addDays(-1))
        self.btn_backfill = QPushButton("Geçmiş Veriyi Bas (Backfill)")
        self.btn_backfill_stop = QPushButton("Backfill Durdur")
        hb3.addWidget(QLabel("Geçmiş Tarih Aralığı:"))
        hb3.addWidget(self.dt_backfill_start)
        hb3.addWidget(QLabel("→"))
        hb3.addWidget(self.dt_backfill_end)
        hb3.addWidget(self.btn_backfill)
        hb3.addWidget(self.btn_backfill_stop)
        hb3.addStretch(1)
        v.addLayout(hb3)

        v.addWidget(QLabel("Senkron Logu"))
        self.txt_log = QTextEdit()
        self.txt_log.setReadOnly(True)
        v.addWidget(self.txt_log, 2)

        v.addWidget(QLabel("Son Başarılı Senkronlar"))
        self.txt_success = QTextEdit()
        self.txt_success.setReadOnly(True)
        self.txt_success.setMinimumHeight(180)
        v.addWidget(self.txt_success, 1)

        self.btn_full_sync.clicked.connect(lambda: self.run_full_sync())
        self.btn_start_auto.clicked.connect(self.start_auto_sync)
        self.btn_stop_auto.clicked.connect(self.stop_auto_sync)
        self.btn_poll_once.clicked.connect(self.run_poll_once_async)
        self.btn_price_update_once.clicked.connect(self.on_price_update_tick)
        self.btn_tenant_wipe.clicked.connect(self.on_tenant_wipe)
        self.btn_manual_run.clicked.connect(self.manual_run_selected_dataset)
        self.btn_flush_offline.clicked.connect(self.flush_offline_queue_async)
        self.btn_clean_logs.clicked.connect(self.cleanup_server_logs)
        self.btn_open_health.clicked.connect(self.open_health_dashboard)
        self.btn_backfill.clicked.connect(self.on_backfill_clicked)
        self.btn_backfill_stop.clicked.connect(self.on_backfill_cancel)

    def build_tray(self):
        style = self.style() or QApplication.style()
        tray_icon = None
        for sp_name in ("SP_ComputerIcon", "SP_DesktopIcon", "SP_FileIcon"):
            sp = getattr(QStyle, sp_name, None)
            if sp is None:
                continue
            try:
                icon = style.standardIcon(sp)
                if not icon.isNull():
                    tray_icon = icon
                    break
            except Exception:
                continue

        if tray_icon is None or tray_icon.isNull():
            tray_icon = self.windowIcon()

        self.tray = QSystemTrayIcon(tray_icon, self)

        menu = QMenu()
        act_show = QAction("Göster", self)
        act_show.triggered.connect(lambda: self.tray_guard(self.bring_to_front, "Yönetici Girişi"))
        menu.addAction(act_show)

        act_start = QAction("Auto Sync Başlat", self)
        act_start.triggered.connect(lambda: self.tray_guard(self.start_auto_sync, "Auto Sync Başlat"))
        menu.addAction(act_start)

        act_stop = QAction("Auto Sync Durdur", self)
        act_stop.triggered.connect(lambda: self.tray_guard(self.stop_auto_sync, "Auto Sync Durdur"))
        menu.addAction(act_stop)

        act_reset = QAction("Factory Reset", self)
        act_reset.triggered.connect(lambda: self.tray_guard(self.do_factory_reset, "Factory Reset"))
        menu.addAction(act_reset)

        act_exit = QAction("Çıkış", self)
        act_exit.triggered.connect(lambda: self.tray_guard(self.real_exit, "Çıkış"))
        menu.addAction(act_exit)

        self.tray.setToolTip(APP_NAME)
        self.tray.setContextMenu(menu)
        self.tray.setVisible(True)
        self.tray.activated.connect(self.on_tray_activated)

    def on_tray_activated(self, reason):
        if reason in (QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick):
            self.tray_guard(self.bring_to_front, "Yönetici Girişi")

    def bring_to_front(self):
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, event):
        if self._allow_real_exit:
            event.accept()
            return
        self.lock_admin_ui()
        self.hide()
        self.tray.showMessage(APP_NAME, "Uygulama sistem tepsisine küçültüldü.", QSystemTrayIcon.Information, 2500)
        event.ignore()

    def real_exit(self):
        self._allow_real_exit = True
        self.timer.stop()
        self.live_timer.stop()
        self.reactive_timer.stop()
        self.tray.hide()
        self.close()

    def do_factory_reset(self):
        if QMessageBox.question(self, "Onay", "Tüm config, snapshot ve log dosyaları silinsin mi?") != QMessageBox.Yes:
            return
        factory_reset()
        QMessageBox.information(self, "OK", "Factory reset tamamlandı. Uygulamayı yeniden başlatın.")

    def _ensure_client_secret(self):
        sec = self.dpapi_get(self.cfg.get("client_secret_enc", ""))
        if not sec:
            sec = uuid.uuid4().hex
            self.cfg["client_secret_enc"] = self.dpapi_set(sec)
            self.cfg["client_secret_registered"] = False
            save_cfg(self.cfg)

    def get_client_secret(self) -> str:
        return self.dpapi_get(self.cfg.get("client_secret_enc", ""))

    def refresh_secret_ui(self):
        if hasattr(self, "ed_secret"):
            self.ed_secret.setText(self.get_client_secret())

    def on_copy_secret(self):
        secret = self.get_client_secret()
        QApplication.clipboard().setText(secret, QClipboard.Clipboard)
        QMessageBox.information(self, "OK", "Client secret panoya kopyalandı.")

    def on_regen_secret(self):
        if QMessageBox.question(self, "Dikkat", "Secret yenilenirse sunucu tarafında tekrar register gerekir. Devam edilsin mi?") != QMessageBox.Yes:
            return
        self.cfg["client_secret_enc"] = self.dpapi_set(uuid.uuid4().hex)
        self.cfg["client_secret_registered"] = False
        save_cfg(self.cfg)
        self.refresh_secret_ui()
        QMessageBox.information(self, "OK", "Yeni secret üretildi.")

    def on_gen_tenant(self):
        if self.ed_tenant.text().strip():
            if QMessageBox.question(self, "Bilgi", "Tenant zaten dolu. Yeni tenant üretmek istiyor musun?") != QMessageBox.Yes:
                return
        self.ed_tenant.setText(uuid.uuid4().hex)
        self.cfg["tenant_id"] = self.ed_tenant.text().strip()
        save_cfg(self.cfg)

    def on_restore_datasets(self):
        self.txt_datasets.setPlainText(json.dumps(DEFAULT_DATASET_DEFINITIONS, ensure_ascii=False, indent=2))
        self.refresh_manual_dataset_combo()

    def on_save_datasets(self):
        try:
            defs = json.loads(self.txt_datasets.toPlainText())
            if not isinstance(defs, list):
                raise ValueError("Dataset tanımları liste olmak zorunda.")
            self.cfg["dataset_definitions"] = defs
            save_cfg(self.cfg)
            self.refresh_manual_dataset_combo()
            QMessageBox.information(self, "OK", "Dataset tanımları kaydedildi.")
        except Exception as exc:
            QMessageBox.critical(self, "Hata", f"Dataset JSON hatalı:\n{exc}")

    def on_save_conn(self):
        self.cfg.update({
            "driver": self.cmb_driver.currentText(),
            "host": self.ed_host.text().strip(),
            "instance": self.ed_instance.text().strip(),
            "port": self.ed_port.text().strip(),
            "use_win_auth": self.chk_win.isChecked(),
            "user": self.ed_user.text().strip(),
            "encrypt": self.chk_encrypt.isChecked(),
            "trust_cert": self.chk_trust.isChecked(),
            "database": self.cmb_db.currentText().strip(),
        })
        if not self.chk_win.isChecked() and self.ed_pass.text():
            self.cfg["sql_pwd_enc"] = self.dpapi_set(self.ed_pass.text())
        save_cfg(self.cfg)
        QMessageBox.information(self, "OK", "Bağlantı ayarları kaydedildi.")

    def on_save_settings(self):
        self.cfg["server_url"] = self.ed_server_url.text().strip()
        self.cfg["tenant_id"] = self.ed_tenant.text().strip()
        self.cfg["interval_seconds"] = int(self.spin_interval.value())
        self.cfg["batch_size"] = int(self.spin_batch.value())
        self.cfg["auto_sync_enabled"] = self.chk_auto.isChecked()
        self.cfg["run_at_boot"] = self.chk_boot.isChecked()
        self.cfg["price_update_enabled"] = self.chk_price_update.isChecked()
        self.cfg["price_update_interval_sec"] = int(self.spin_price_interval.value())
        self.cfg["price_update_kod_pc"] = int(self.spin_price_kod_pc.value())
        self.cfg["price_update_kullanici"] = int(self.spin_price_kullanici.value())
        self._islem_yetki_cfg_oku()
        self.push_islem_yetkileri(silent=False)

        self._set_run_at_boot(self.chk_boot.isChecked())
        save_cfg(self.cfg)
        QMessageBox.information(self, "OK", "Ayarlar kaydedildi.")

    def on_test_conn(self):
        host = self.ed_host.text().strip()
        inst = self.ed_instance.text().strip()
        port = self.ed_port.text().strip()
        driver = self.cmb_driver.currentText()
        use_win = self.chk_win.isChecked()
        user = self.ed_user.text().strip()
        pwd = self.ed_pass.text()
        if not use_win and not pwd:
            pwd = self.dpapi_get(self.cfg.get("sql_pwd_enc", ""))

        encrypt = self.chk_encrypt.isChecked()
        trust = self.chk_trust.isChecked()

        if not host:
            QMessageBox.warning(self, "Eksik", "Sunucu alanı boş.")
            return

        progress = QProgressDialog("Bağlantı deneniyor...", None, 0, 100, self)
        progress.setWindowModality(Qt.ApplicationModal)
        progress.setCancelButton(None)
        progress.show()
        QApplication.processEvents()

        ok_conn = None
        last_err = None
        for srv in build_server_candidates(host, inst, port):
            try:
                ok_conn = try_connect(driver, srv, use_win, user, pwd, encrypt, trust, database="master")
                self.println(f"✅ Bağlantı OK: {srv}")
                break
            except Exception as exc:
                last_err = exc
                self.println(f"❌ {srv} -> {exc}")

        if not ok_conn:
            progress.close()
            QMessageBox.critical(self, "Hata", f"Bağlantı kurulamadı.\n\n{last_err}")
            return

        try:
            dbs = list_databases(ok_conn)
            self.cmb_db.clear()
            self.cmb_db.addItems(dbs)
            if self.cfg.get("database"):
                idx = self.cmb_db.findText(self.cfg["database"])
                if idx >= 0:
                    self.cmb_db.setCurrentIndex(idx)
            progress.close()
            self.on_save_conn()
        finally:
            try:
                ok_conn.close()
            except Exception:
                pass

    def _set_run_at_boot(self, enable: bool):
        if not winreg:
            return
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_SET_VALUE,
            )
            if enable:
                if getattr(sys, "frozen", False):
                    cmd = f"\"{sys.executable}\" --autorun"
                else:
                    cmd = f"\"{sys.executable}\" \"{os.path.abspath(sys.argv[0])}\" --autorun"
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)
            else:
                try:
                    winreg.DeleteValue(key, APP_NAME)
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception as exc:
            self.println(f"Autostart ayarlanamadı: {exc}")

    def get_selected_database(self, override: str = "") -> str:
        db_name = (override or "").strip() or self.cmb_db.currentText().strip() or self.cfg.get("database", "").strip()
        if not db_name:
            raise RuntimeError("Veritabanı seçilmemiş.")
        return db_name

    def get_connection(self, database_override: str = ""):
        cfg = load_cfg()
        driver = cfg["driver"]
        host = cfg["host"]
        inst = cfg.get("instance", "")
        port = cfg.get("port", "")
        use_win = cfg.get("use_win_auth", False)
        user = cfg.get("user", "")
        pwd = self.dpapi_get(cfg.get("sql_pwd_enc", ""))
        encrypt = cfg.get("encrypt", True)
        trust = cfg.get("trust_cert", True)
        db_name = self.get_selected_database(database_override)

        last_err = None
        for srv in build_server_candidates(host, inst, port):
            try:
                return try_connect(driver, srv, use_win, user, pwd, encrypt, trust, database=db_name)
            except Exception as exc:
                last_err = exc
        raise RuntimeError(f"SQL bağlantısı kurulamadı: {last_err}")

    def register_client_secret_if_needed(self, force: bool = False) -> bool:
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            self.println("Tenant boş olduğu için secret register atlandı.")
            return False

        if self.cfg.get("client_secret_registered") and not force:
            return True

        now_ts = time.time()
        if not force and (now_ts - self._last_secret_register_try) < 30:
            return False
        self._last_secret_register_try = now_ts

        secret = self.get_client_secret()
        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {
                    "action": "client_secret_register",
                    "db_name": self.get_selected_database() if (self.cmb_db.currentText().strip() or self.cfg.get("database")) else None,
                },
                client_secret=secret,
                timeout=20,
            )
            if resp and resp.get("ok"):
                self.cfg["client_secret_registered"] = True
                save_cfg(self.cfg)
                self.println("✓ Client secret register başarılı.")
                return True
        except Exception as exc:
            self.println(f"Client secret register hata: {exc}")
        return False

    def heartbeat(self):
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            return
        try:
            post_json(
                self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "heartbeat"},
                client_secret=self.get_client_secret(),
                timeout=20,
            )
        except Exception as exc:
            self.println(f"Heartbeat hata: {exc}")

    def parse_dataset_defs(self) -> List[Dict[str, Any]]:
        try:
            defs = json.loads(self.txt_datasets.toPlainText())
            if not isinstance(defs, list):
                raise ValueError("Dataset listesi bekleniyor.")
            return defs
        except Exception as exc:
            raise RuntimeError(f"Dataset tanımları okunamadı: {exc}")

    def execute_query(self, conn, sql_text: str) -> List[Dict[str, Any]]:
        cur = conn.cursor()
        cur.execute(sql_text)
        cols = [c[0] for c in cur.description] if cur.description else []
        return [sanitize_row(dict(zip(cols, row))) for row in cur.fetchall()]

    def execute_procedure(self, conn, proc_name: str, values: List[Any], multi_result: bool = False):
        cur = conn.cursor()
        placeholders = ",".join(["?"] * len(values))
        sql = f"EXEC {proc_name} {placeholders}" if placeholders else f"EXEC {proc_name}"
        cur.execute(sql, values)

        if not multi_result:
            while True:
                if cur.description:
                    cols = [c[0] for c in cur.description]
                    return [sanitize_row(dict(zip(cols, row))) for row in cur.fetchall()]
                try:
                    has_next = cur.nextset()
                except Exception:
                    has_next = False
                if not has_next:
                    return []

        result_sets = []
        while True:
            if cur.description:
                cols = [c[0] for c in cur.description]
                rows = [sanitize_row(dict(zip(cols, row))) for row in cur.fetchall()]
                result_sets.append(rows)
            try:
                has_next = cur.nextset()
            except Exception:
                has_next = False
            if not has_next:
                break
        return {"result_sets": result_sets}

    def load_change_watchers(self) -> List[Dict[str, Any]]:
        watchers = self.cfg.get("change_watchers", DEFAULT_CHANGE_WATCHERS)
        return watchers if isinstance(watchers, list) else DEFAULT_CHANGE_WATCHERS

    def should_run_watcher(self, watch_key: str, interval_sec: int) -> bool:
        state = load_watch_state()
        meta = state.get(watch_key, {})
        last_run = meta.get("last_run_at")
        if not last_run:
            return True
        try:
            last_dt = datetime.strptime(last_run, "%Y-%m-%d %H:%M:%S")
        except Exception:
            return True
        return datetime.now() >= last_dt + timedelta(seconds=max(5, int(interval_sec)))

    def update_watcher_state(self, watch_key: str, signature: str):
        state = load_watch_state()
        state[watch_key] = {
            "signature": signature,
            "last_run_at": now_str(),
        }
        save_watch_state(state)

    def execute_change_watcher(self, watcher: Dict[str, Any]) -> str:
        conn = self.get_connection(watcher.get("database", ""))
        try:
            rows = self.execute_query(conn, watcher.get("sql", ""))
            return hash_obj(rows)
        finally:
            conn.close()

    def invalidate_server_dataset(self, dataset_key: str):
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            return
        try:
            post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "dataset_wipe", "dataset_key": dataset_key},
                client_secret=self.get_client_secret(),
                timeout=120,
            )
            self.println(f"↺ Server cache temizlendi: {dataset_key}")
        except Exception as exc:
            self.println(f"Cache temizleme hata ({dataset_key}): {exc}")

    def detect_changed_dependencies(self, watch_keys: Optional[set] = None, only_triggers: Optional[set] = None) -> set:
        force_dataset_keys: set = set()
        watchers = self.load_change_watchers()
        state = load_watch_state()
        watch_keys = set(watch_keys or [])
        only_triggers = set(only_triggers or [])

        for watcher in watchers:
            if not isinstance(watcher, dict) or not watcher.get("enabled", True):
                continue
            watch_key = str(watcher.get("watch_key", "")).strip()
            if not watch_key:
                continue
            if watch_keys and watch_key not in watch_keys:
                continue
            interval_sec = int(watcher.get("watch_interval_sec", 30))
            if not self.should_run_watcher(watch_key, interval_sec):
                continue
            try:
                signature = self.execute_change_watcher(watcher)
            except Exception as exc:
                self.println(f"Watcher hata ({watch_key}): {exc}")
                continue

            old_sig = ((state.get(watch_key) or {}).get("signature") or "")
            self.update_watcher_state(watch_key, signature)
            state = load_watch_state()
            if old_sig and old_sig == signature:
                continue

            triggers = [str(x) for x in (watcher.get("triggers") or []) if str(x).strip()]
            if only_triggers:
                triggers = [x for x in triggers if x in only_triggers]
            invalidates = [str(x) for x in (watcher.get("invalidate") or []) if str(x).strip()]
            if old_sig:
                self.println(f"Δ Değişiklik algılandı: {watch_key} -> {', '.join(triggers) if triggers else '-'}")
            else:
                self.println(f"• İlk watcher imzası alındı: {watch_key}")
            force_dataset_keys.update(triggers)
            if old_sig:
                for dataset_key in invalidates:
                    self.invalidate_server_dataset(dataset_key)

        return force_dataset_keys

    def load_stock_price_names(self, database_override: str = "") -> List[Dict[str, Any]]:
        """Stok fiyat adlarını okur. Boş dönerse FIYAT_AD=0 fallback kullanılır."""
        conn = self.get_connection(database_override)
        try:
            try:
                rows = self.execute_query(conn, "SELECT ID, AD FROM STOK_FIYAT_AD ORDER BY ID")
            except Exception as exc:
                self.println(f"stock_list fiyat adları okunamadı, FIYAT_AD=0 kullanılacak: {exc}")
                return [{"ID": 0, "AD": "Varsayılan"}]
        finally:
            conn.close()

        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            fid = row.get("ID")
            if fid is None or str(fid).strip() == "":
                continue
            out.append({"ID": fid, "AD": row.get("AD") or f"Fiyat {fid}"})

        return out or [{"ID": 0, "AD": "Varsayılan"}]

    def execute_stock_list_all_price_names(self, defn: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        stock_list tek web datası olarak basılır; fakat SQL tarafında fiyat adına göre ürün döndüğü için
        her fiyat adı ayrı sorgulanır. Ürün dönmeyen fiyat adları gönderilmez.
        Örn. bir fiyat adında sadece 10 ürün varsa, o fiyat adı için sadece o 10 satır stock_list içine eklenir.
        """
        fiyat_adlari = self.load_stock_price_names(defn.get("database", ""))
        all_rows: List[Dict[str, Any]] = []
        total_price_names = 0
        skipped_empty = 0

        for fiyat in fiyat_adlari:
            fiyat_id = fiyat.get("ID", 0)
            fiyat_adi = fiyat.get("AD") or f"Fiyat {fiyat_id}"
            params = resolve_params(defn.get("params_template", {}))
            params["FIYAT_AD"] = fiyat_id

            conn = self.get_connection(defn.get("database", ""))
            try:
                values = ordered_param_values(defn, params)
                rows = self.execute_procedure(conn, defn["sql"], values, bool(defn.get("multi_result", False)))
            finally:
                conn.close()

            rows = [r for r in (rows or []) if isinstance(r, dict)]
            if not rows:
                skipped_empty += 1
                self.println(f"stock_list: ürün yok, fiyat adı atlandı -> FIYAT_AD={fiyat_id} / {fiyat_adi}")
                continue

            total_price_names += 1
            self.println(f"stock_list: fiyat adı eklendi -> FIYAT_AD={fiyat_id} / {fiyat_adi} / {len(rows)} ürün")
            for row in rows:
                item = dict(row)
                item["FIYAT_AD"] = fiyat_id
                item["FIYAT_AD_ID"] = fiyat_id
                item["FIYAT_ADI"] = fiyat_adi
                item["FIYAT_LISTE_ADI"] = fiyat_adi
                all_rows.append(item)

        if not all_rows:
            # Bazı firmalarda GetStockList sadece FIYAT_AD=0 ile tüm stokları döndürüyor olabilir.
            # Fiyat adları tek tek boş geldiyse listeyi tamamen boş bırakmamak için son fallback denenir.
            self.println("stock_list: fiyat adlarının tamamı boş geldi; FIYAT_AD=0 fallback deneniyor")
            params = resolve_params(defn.get("params_template", {}))
            params["FIYAT_AD"] = 0
            conn = self.get_connection(defn.get("database", ""))
            try:
                values = ordered_param_values(defn, params)
                rows = self.execute_procedure(conn, defn["sql"], values, bool(defn.get("multi_result", False)))
            finally:
                conn.close()

            rows = [r for r in (rows or []) if isinstance(r, dict)]
            for row in rows:
                item = dict(row)
                item.setdefault("FIYAT_AD", 0)
                item.setdefault("FIYAT_AD_ID", 0)
                item.setdefault("FIYAT_ADI", "Varsayılan")
                item.setdefault("FIYAT_LISTE_ADI", "Varsayılan")
                all_rows.append(item)
            if rows:
                self.println(f"stock_list: FIYAT_AD=0 fallback ile {len(rows)} ürün bulundu")

        self.println(f"stock_list: toplam eklenecek satır={len(all_rows)}, dolu fiyat adı={total_price_names}, boş atlanan={skipped_empty}")
        return all_rows

    def execute_dataset(self, defn: Dict[str, Any], params: Dict[str, Any]):
        conn = self.get_connection(defn.get("database", ""))
        try:
            if defn.get("kind") == "query":
                return self.execute_query(conn, defn["sql"])
            values = ordered_param_values(defn, params)
            return self.execute_procedure(conn, defn["sql"], values, bool(defn.get("multi_result", False)))
        finally:
            conn.close()

    def should_push_now(self, defn: Dict[str, Any], params: Dict[str, Any], force: bool = False) -> bool:
        if force:
            return True
        if not defn.get("push_enabled", False):
            return False

        snap = load_snapshots()
        key = dataset_run_key(defn["dataset_key"], params)
        meta = snap.get(key, {})
        interval_sec = int(defn.get("push_interval_sec", self.cfg.get("interval_seconds", 30)))
        last_sync = meta.get("last_sync_at")
        if not last_sync:
            return True
        try:
            last_dt = datetime.strptime(last_sync, "%Y-%m-%d %H:%M:%S")
        except Exception:
            return True
        return datetime.now() >= last_dt + timedelta(seconds=interval_sec)

    def protect_mass_delete(self, defn: Dict[str, Any], params: Dict[str, Any], data: Any, force: bool) -> None:
        if force:
            return
        if not defn.get("snapshot"):
            return
        if not isinstance(data, list):
            return

        snap = load_snapshots()
        key = dataset_run_key(defn["dataset_key"], params)
        prev = snap.get(key, {})
        prev_count = int(prev.get("row_count", 0))
        curr_count = len(data)

        if prev_count > 0 and defn.get("guard_zero", False) and curr_count == 0:
            raise RuntimeError(f"{defn['dataset_key']} için sorgu 0 kayıt döndürdü. Güvenlik için push iptal edildi.")

        if prev_count >= MASS_DELETE_MIN_PREV and defn.get("guard_mass_delete", False):
            ratio_deleted = 1.0 - (curr_count / prev_count if prev_count else 1.0)
            if ratio_deleted >= MASS_DELETE_RATIO_BLOCK:
                raise RuntimeError(
                    f"{defn['dataset_key']} için toplu silme şüphesi var. Önceki: {prev_count}, Şimdiki: {curr_count}. "
                    "Güvenlik için push iptal edildi."
                )

    def update_snapshot(self, defn: Dict[str, Any], params: Dict[str, Any], data: Any):
        key = dataset_run_key(defn["dataset_key"], params)
        snap = load_snapshots()
        snap[key] = {
            "dataset_key": defn["dataset_key"],
            "params": params,
            "data_hash": hash_obj(data),
            "row_count": len(data) if isinstance(data, list) else 1,
            "last_sync_at": now_str(),
        }
        save_snapshots(snap)

    def server_dataset_status(self, dataset_key: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Web cache durumunu döndürür. Kontrol başarısızsa normal akışı bozmaz."""
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            return {"ok": False, "exists": True, "row_count": 1, "active_row_count": 1}

        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {
                    "action": "dataset_cache_exists",
                    "dataset_key": dataset_key,
                    "params": params,
                },
                client_secret=self.get_client_secret(),
                timeout=30,
            )
            return resp if isinstance(resp, dict) else {"ok": False, "exists": True, "row_count": 1, "active_row_count": 1}
        except Exception as exc:
            self.println(f"Web cache kontrolü yapılamadı: {dataset_key} -> {exc}")
            # Stok/cari sayfalı push ve rows datasetlerinde web durumu okunamazsa
            # "var" kabul etmek en riskli senaryodur; local snapshot aynı olsa bile web boş kalabilir.
            # Bu yüzden bu datasetlerde eksik kabul edip yeniden seed/push zorlanır.
            if is_paged_push_dataset_key(dataset_key) or is_rows_cache_dataset_key(dataset_key):
                return {"ok": False, "exists": False, "row_count": 0, "active_row_count": 0, "error": str(exc)}
            return {"ok": False, "exists": True, "row_count": 1, "active_row_count": 1, "error": str(exc)}

    def server_dataset_exists(self, dataset_key: str, params: Dict[str, Any]) -> bool:
        return bool(self.server_dataset_status(dataset_key, params).get("exists", False))

    def _get_delta_snapshot(self, dataset_key: str, params: Dict[str, Any]) -> Dict[str, Any]:
        snap = load_snapshots()
        item = snap.get(delta_snapshot_key(dataset_key, params), {})
        return item if isinstance(item, dict) else {}

    def _save_delta_snapshot(self, dataset_key: str, params: Dict[str, Any], rows: List[Dict[str, Any]], data_hash: str):
        snap = load_snapshots()
        snap[delta_snapshot_key(dataset_key, params)] = {
            "dataset_key": dataset_key,
            "params": params,
            "row_hashes": build_row_hash_map(dataset_key, rows),
            "data_hash": data_hash,
            "row_count": len(rows),
            "last_sync_at": now_str(),
        }
        save_snapshots(snap)

    def _push_delta_dataset(self, defn: Dict[str, Any], params: Dict[str, Any], data: List[Dict[str, Any]], force_full: bool = False):
        """Stok/cari gibi büyük listelerde sadece değişen satırları web'e gönderir."""
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            raise RuntimeError("Tenant boş.")

        server_url = self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL)
        secret = self.get_client_secret()
        dataset_key = str(defn["dataset_key"])
        current_rows = [row for row in data if isinstance(row, dict)]
        if dataset_key == "hourly_stock_detail":
            before_count = len(current_rows)
            default_day = params.get("sdate") or params.get("SDATE") or params.get("date") or params.get("TARIH")
            current_rows = aggregate_hourly_stock_detail_rows(current_rows, default_day, include_zero_hours=True)
            self.println(f"hourly_stock_detail: ürün satırları tarih+saat+lokasyon bazında 24 saatlik özete toplandı ({before_count} -> {len(current_rows)} satır)")
        elif dataset_key == "acik_masa_detay":
            before_count = len(current_rows)
            current_rows = aggregate_acik_masa_detay_rows(current_rows, params.get("POS_ID") or params.get("pos_id"))
            self.println(f"acik_masa_detay: ürün satırları masa/POS bazında tek kayda toplandı ({before_count} -> {len(current_rows)} satır)")
        current_hashes = build_row_hash_map(dataset_key, current_rows)
        current_data_hash = hash_obj(data)

        prev_snapshot = self._get_delta_snapshot(dataset_key, params)
        prev_hashes = prev_snapshot.get("row_hashes", {}) if isinstance(prev_snapshot.get("row_hashes", {}), dict) else {}

        server_status = self.server_dataset_status(dataset_key, params)
        server_exists = bool(server_status.get("exists", False))
        try:
            server_row_count = int(server_status.get("active_row_count", server_status.get("row_count", 0)) or 0)
        except Exception:
            server_row_count = 0
        seed_mode = force_full or (not server_exists) or server_row_count <= 0 or not prev_hashes

        row_by_key = {}
        for row in current_rows:
            row_by_key[make_row_key(dataset_key, row)] = row

        upserts = []
        deletes = []

        if seed_mode:
            for row_key, row in row_by_key.items():
                upserts.append({
                    "op": "upsert",
                    "row_key": row_key,
                    "row_hash": current_hashes.get(row_key, hash_obj(row)),
                    "row": row,
                })
            if prev_hashes:
                for row_key in prev_hashes.keys():
                    if row_key not in current_hashes:
                        deletes.append({"op": "delete", "row_key": row_key})
        else:
            for row_key, row_hash in current_hashes.items():
                if prev_hashes.get(row_key) != row_hash:
                    row = row_by_key[row_key]
                    upserts.append({
                        "op": "upsert",
                        "row_key": row_key,
                        "row_hash": row_hash,
                        "row": row,
                    })
            for row_key in prev_hashes.keys():
                if row_key not in current_hashes:
                    deletes.append({"op": "delete", "row_key": row_key})

        if not upserts and not deletes and server_exists:
            self.println(f"= Delta değişiklik yok: {dataset_key}")
            self._save_delta_snapshot(dataset_key, params, current_rows, current_data_hash)
            return {"ok": True, "delta": True, "no_changes": True, "row_count": len(current_rows)}

        self.println(
            f"{dataset_key}: delta gönderim başlıyor. "
            f"mode={'seed' if seed_mode else 'delta'}, upsert={len(upserts)}, delete={len(deletes)}, toplam={len(current_rows)}"
        )

        batch_no = 0
        for batch in split_delta_changes(upserts):
            batch_no += 1
            post_json(
                server_url,
                tenant,
                {
                    "action": "dataset_delta_push",
                    "dataset_key": dataset_key,
                    "params": params,
                    "changes": batch,
                    "deletes": [],
                    "mode": "seed" if seed_mode else "delta",
                },
                client_secret=secret,
                timeout=300,
            )
            self.println(f"{dataset_key}: delta upsert batch {batch_no} gönderildi ({len(batch)} satır)")

        delete_batch_no = 0
        for batch in split_delta_changes(deletes):
            delete_batch_no += 1
            post_json(
                server_url,
                tenant,
                {
                    "action": "dataset_delta_push",
                    "dataset_key": dataset_key,
                    "params": params,
                    "changes": [],
                    "deletes": batch,
                    "mode": "delta",
                },
                client_secret=secret,
                timeout=300,
            )
            self.println(f"{dataset_key}: delta delete batch {delete_batch_no} gönderildi ({len(batch)} satır)")

        resp = post_json(
            server_url,
            tenant,
            {
                "action": "dataset_delta_commit",
                "dataset_key": dataset_key,
                "params": params,
                "total_row_count": len(current_rows),
                "data_hash": current_data_hash,
            },
            client_secret=secret,
            timeout=300,
        )

        if resp.get("ok"):
            self._save_delta_snapshot(dataset_key, params, current_rows, current_data_hash)

        return resp

    def _is_packet_error(self, exc: Exception) -> bool:
        text = str(exc).lower()
        return (
            "max_allowed_packet" in text
            or "got a packet bigger" in text
            or "1153" in text
            or "communication link failure" in text
        )

    def _push_paged_dataset(self, defn: Dict[str, Any], params: Dict[str, Any], data: List[Dict[str, Any]]):
        """stock_list / cari_bakiye_liste ilk dolumunu MySQL paket limitine takılmadan sayfa sayfa basar."""
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            raise RuntimeError("Tenant boş.")

        server_url = self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL)
        secret = self.get_client_secret()
        dataset_key = str(defn["dataset_key"])
        data_hash = hash_obj(data)

        if not isinstance(data, list) or len(data) == 0:
            raise RuntimeError(f"{dataset_key}: 0 kayıt geldiği için sayfalı push yapılmadı.")

        last_error = None
        for target_bytes in PAGED_PUSH_FALLBACK_BYTES:
            upload_id = uuid.uuid4().hex
            pages = list(split_rows_for_paged_push(data, max_bytes=target_bytes, max_rows=PAGED_PUSH_MAX_ROWS_PER_PAGE))
            total_parts = len(pages)

            self.println(
                f"{dataset_key}: büyük liste page upload başlıyor. "
                f"Toplam kayıt={len(data)}, sayfa={total_parts}, hedef={target_bytes} byte, max_satır={PAGED_PUSH_MAX_ROWS_PER_PAGE}"
            )

            try:
                post_json(
                    server_url,
                    tenant,
                    {
                        "action": "dataset_page_begin",
                        "dataset_key": dataset_key,
                        "upload_id": upload_id,
                        "params": params,
                        "total_parts": total_parts,
                        "total_row_count": len(data),
                        "data_hash": data_hash,
                    },
                    client_secret=secret,
                    timeout=120,
                )

                for idx, page_rows in enumerate(pages, start=1):
                    post_json(
                        server_url,
                        tenant,
                        {
                            "action": "dataset_page_part",
                            "dataset_key": dataset_key,
                            "upload_id": upload_id,
                            "part_no": idx,
                            "total_parts": total_parts,
                            "params": params,
                            "data": page_rows,
                        },
                        client_secret=secret,
                        timeout=300,
                    )
                    self.println(f"{dataset_key}: page {idx}/{total_parts} gönderildi ({len(page_rows)} kayıt)")

                return post_json(
                    server_url,
                    tenant,
                    {
                        "action": "dataset_page_commit",
                        "dataset_key": dataset_key,
                        "upload_id": upload_id,
                        "params": params,
                        "total_parts": total_parts,
                        "total_row_count": len(data),
                        "data_hash": data_hash,
                    },
                    client_secret=secret,
                    timeout=300,
                )
            except Exception as exc:
                last_error = exc
                if self._is_packet_error(exc) and target_bytes != PAGED_PUSH_FALLBACK_BYTES[-1]:
                    self.println(f"{dataset_key}: paket büyük geldi, daha küçük paketle tekrar denenecek. hedef={target_bytes} hata={exc}")
                    continue
                raise

        raise RuntimeError(f"{dataset_key}: sayfalı gönderim başarısız: {last_error}")

    def _push_paged_dataset_delta_or_seed(self, defn: Dict[str, Any], params: Dict[str, Any], data: List[Dict[str, Any]], force_full: bool = False):
        """
        stock_list / cari_bakiye_liste için doğru çalışma şekli:
        - Webde sayfa yoksa veya local delta snapshot yoksa full seed sayfalı basılır.
        - Webde veri varsa sadece değişen ürün/cari satırları gönderilir.
        - Sayfa yapısı web tarafında korunur; client tüm listeyi tekrar POST etmez.
        """
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            raise RuntimeError("Tenant boş.")

        server_url = self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL)
        secret = self.get_client_secret()
        dataset_key = str(defn["dataset_key"])

        current_rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        if not current_rows:
            raise RuntimeError(f"{dataset_key}: 0 kayıt geldiği için push yapılmadı.")

        current_hashes = build_row_hash_map(dataset_key, current_rows)
        current_data_hash = hash_obj(current_rows)
        prev_snapshot = self._get_delta_snapshot(dataset_key, params)
        prev_hashes = prev_snapshot.get("row_hashes", {}) if isinstance(prev_snapshot.get("row_hashes", {}), dict) else {}

        server_status = self.server_dataset_status(dataset_key, params)
        server_exists = bool(server_status.get("exists", False))
        try:
            server_row_count = int(server_status.get("active_row_count", server_status.get("row_count", 0)) or 0)
        except Exception:
            server_row_count = 0

        seed_mode = force_full or (not server_exists) or server_row_count <= 0 or not prev_hashes

        if seed_mode:
            self.println(
                f"{dataset_key}: sayfalı seed/full push yapılacak. "
                f"server_exists={server_exists}, server_row_count={server_row_count}, local_snapshot={bool(prev_hashes)}"
            )
            resp = self._push_paged_dataset(defn, params, current_rows)
            if resp.get("ok"):
                self._save_delta_snapshot(dataset_key, params, current_rows, current_data_hash)
            return resp

        row_by_key = {make_row_key(dataset_key, row): row for row in current_rows}
        upserts = []
        deletes = []

        for row_key, row_hash in current_hashes.items():
            if prev_hashes.get(row_key) != row_hash:
                upserts.append({
                    "op": "upsert",
                    "row_key": row_key,
                    "row_hash": row_hash,
                    "row": row_by_key[row_key],
                })

        for row_key in prev_hashes.keys():
            if row_key not in current_hashes:
                deletes.append({"op": "delete", "row_key": row_key})

        if not upserts and not deletes:
            self.println(f"= Sayfalı delta değişiklik yok: {dataset_key}")
            self._save_delta_snapshot(dataset_key, params, current_rows, current_data_hash)
            return {"ok": True, "paged_delta": True, "no_changes": True, "row_count": len(current_rows)}

        self.println(
            f"{dataset_key}: sayfalı delta gönderim başlıyor. "
            f"upsert={len(upserts)}, delete={len(deletes)}, toplam={len(current_rows)}"
        )

        # Genelde 1-2 satır değişir; yine de büyük değişiklikte güvenli batch yapıyoruz.
        batch_no = 0
        for batch in split_delta_changes(upserts):
            batch_no += 1
            post_json(
                server_url,
                tenant,
                {
                    "action": "dataset_page_delta_push",
                    "dataset_key": dataset_key,
                    "params": params,
                    "changes": batch,
                    "deletes": [],
                    "total_row_count": len(current_rows),
                    "data_hash": current_data_hash,
                },
                client_secret=secret,
                timeout=300,
            )
            self.println(f"{dataset_key}: sayfalı delta upsert batch {batch_no} gönderildi ({len(batch)} satır)")

        delete_batch_no = 0
        for batch in split_delta_changes(deletes):
            delete_batch_no += 1
            post_json(
                server_url,
                tenant,
                {
                    "action": "dataset_page_delta_push",
                    "dataset_key": dataset_key,
                    "params": params,
                    "changes": [],
                    "deletes": batch,
                    "total_row_count": len(current_rows),
                    "data_hash": current_data_hash,
                },
                client_secret=secret,
                timeout=300,
            )
            self.println(f"{dataset_key}: sayfalı delta delete batch {delete_batch_no} gönderildi ({len(batch)} satır)")

        self._save_delta_snapshot(dataset_key, params, current_rows, current_data_hash)
        return {
            "ok": True,
            "paged_delta": True,
            "upsert_count": len(upserts),
            "delete_count": len(deletes),
            "row_count": len(current_rows),
        }

    def get_fis_bildirim_settings_from_web(self, fallback_min_tutar: Any = 4000) -> Dict[str, Any]:
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            return {"MinTutar": fallback_min_tutar or 4000, "source": "tenant_empty", "default_used": True}
        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {
                    "action": "fis_bildirim_settings_get",
                    "default_min_tutar": fallback_min_tutar or 4000,
                },
                client_secret=self.get_client_secret(),
                timeout=20,
            )
            if resp and resp.get("ok"):
                settings = resp.get("settings") or {}
                mt = settings.get("MinTutar", fallback_min_tutar or 4000)
                try:
                    mt_float = float(mt)
                except Exception:
                    mt_float = float(fallback_min_tutar or 4000)
                settings["MinTutar"] = mt_float
                return settings
        except Exception as exc:
            self.println(f"fis_bildirim ayar okuma atlandı, varsayılan kullanılacak: {exc}")
        return {"MinTutar": fallback_min_tutar or 4000, "source": "fallback", "default_used": True}

    def apply_fis_bildirim_settings_to_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(params or {})
        fallback = out.get("MinTutar", 4000)
        settings = self.get_fis_bildirim_settings_from_web(fallback)
        out["MinTutar"] = settings.get("MinTutar", fallback or 4000)
        self.println(f"fis_gunluk_bildirim_feed MinTutar={out['MinTutar']} kaynak={settings.get('source', '-')}")
        return out

    def push_dataset(self, defn: Dict[str, Any], params: Dict[str, Any], data: Any):
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            raise RuntimeError("Tenant boş.")
        server_url = self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL)
        secret = self.get_client_secret()
        dataset_key = str(defn["dataset_key"])

        payload = {
            "action": "dataset_push",
            "dataset_key": dataset_key,
            "params": params,
            "data": data,
            "data_hash": hash_obj(data),
        }

        try:
            if dataset_key in PAGED_PUSH_DATASET_KEYS and isinstance(data, list):
                return self._push_paged_dataset_delta_or_seed(defn, params, data, force_full=False)

            if is_rows_cache_dataset_key(dataset_key) and isinstance(data, list):
                return self._push_delta_dataset(defn, params, data, force_full=False)

            body_size = len(json.dumps({"tenant_id": tenant, **payload}, ensure_ascii=False).encode("utf-8"))
            if body_size <= MAX_PAYLOAD_BYTES:
                return post_json(server_url, tenant, payload, client_secret=secret, timeout=300)

            upload_id = uuid.uuid4().hex
            data_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            chunks = split_text_chunks(data_json, CHUNK_SIZE_CHARS)

            for idx, chunk in enumerate(chunks, start=1):
                post_json(
                    server_url,
                    tenant,
                    {
                        "action": "dataset_push_part",
                        "dataset_key": dataset_key,
                        "upload_id": upload_id,
                        "part_no": idx,
                        "total_parts": len(chunks),
                        "params": params,
                        "chunk_text": chunk,
                    },
                    client_secret=secret,
                    timeout=300,
                )

            return post_json(
                server_url,
                tenant,
                {
                    "action": "dataset_push_commit",
                    "dataset_key": dataset_key,
                    "upload_id": upload_id,
                    "params": params,
                    "data_hash": hash_obj(data),
                },
                client_secret=secret,
                timeout=300,
            )
        except Exception as exc:
            if dataset_key in PAGED_PUSH_DATASET_KEYS:
                self.println(f"{dataset_key}: sayfalı gönderilemedi, bir sonraki senkronda tekrar denenecek -> {exc}")
                return {"ok": False, "queued_offline": True, "message": str(exc)}

            if is_rows_cache_dataset_key(dataset_key):
                self.println(f"{dataset_key}: delta gönderilemedi, bir sonraki senkronda tekrar denenecek -> {exc}")
                return {"ok": False, "queued_offline": True, "message": str(exc)}

            self.queue_offline_payload(payload)
            self.println(f"Offline kuyruğa alındı: {dataset_key} -> {exc}")
            return {"ok": False, "queued_offline": True, "message": str(exc)}

    def sync_push_datasets(self, force: bool = False, force_dataset_keys: Optional[set] = None, only_dataset_keys: Optional[set] = None):
        defs = self.parse_dataset_defs()
        total = 0
        pushed = 0
        force_dataset_keys = force_dataset_keys or set()
        only_dataset_keys = set(only_dataset_keys or [])

        fiyat_adlari = None

        for defn in defs:
            dataset_key = str((defn or {}).get("dataset_key", "")).strip()
            if dataset_key in PAGED_PUSH_DATASET_KEYS:
                defn = normalize_paged_push_definition(defn)
            if only_dataset_keys and defn.get("dataset_key") not in only_dataset_keys:
                continue
            if not defn.get("enabled", True):
                continue
            if defn.get("mode") not in ("push", "hybrid"):
                continue

            params = resolve_params(defn.get("params_template", {}))
            dataset_key = str(defn.get("dataset_key", ""))
            dataset_force = force or (dataset_key in force_dataset_keys)

            if not dataset_force and defn.get("push_enabled", False):
                server_status = self.server_dataset_status(dataset_key, params)
                server_has_cache = bool(server_status.get("exists", False))
                try:
                    server_row_count = int(server_status.get("active_row_count", server_status.get("row_count", 0)) or 0)
                except Exception:
                    server_row_count = 0

                if dataset_key in PAGED_PUSH_DATASET_KEYS:
                    self.println(f"{dataset_key}: web sayfa durumu -> exists={server_has_cache}, active_row_count={server_row_count}")

                # Stok/cari dataset_cache_pages içine sayfalı basılır.
                # hourly_stock_detail ise dataset_cache_rows içine saat/lokasyon özeti olarak basılır.
                # Bu datasetlerde aktif satır sayısı 0 ise ilk dolum tekrar zorlanır.
                server_needs_seed = (not server_has_cache) or ((is_rows_cache_dataset_key(dataset_key) or dataset_key in PAGED_PUSH_DATASET_KEYS) and server_row_count <= 0)

                if server_needs_seed:
                    dataset_force = True
                    if dataset_key in PAGED_PUSH_DATASET_KEYS:
                        self.println(f"! Web cache/sayfa yok, sayfalı full push yapılacak: {dataset_key} (server_row_count={server_row_count})")
                    elif is_rows_cache_dataset_key(dataset_key):
                        self.println(f"! Web cache/satır yok, delta seed yapılacak: {dataset_key} (server_row_count={server_row_count})")
                    else:
                        self.println(f"! Web cache yok, otomatik full push yapılacak: {dataset_key}")
                elif is_rows_cache_dataset_key(dataset_key) and not self._get_delta_snapshot(dataset_key, params).get("row_hashes"):
                    dataset_force = True
                    self.println(f"! Local delta snapshot yok, ilk satır bazlı seed yapılacak: {dataset_key}")

            if not self.should_push_now(defn, params, force=dataset_force):
                continue

            total += 1
            self.println(f"→ Çalışıyor: {defn['dataset_key']}")
            if dataset_key == "stock_list":
                # Tek web datasetine basılacak ama satırlar fiyat adına göre zenginleştirilecek.
                data = self.execute_stock_list_all_price_names(defn)
                params = resolve_params(defn.get("params_template", {}))
                params["FIYAT_AD"] = 0
            else:
                data = self.execute_dataset(defn, params)
            self.protect_mass_delete(defn, params, data, force=force)

            key = dataset_run_key(defn["dataset_key"], params)
            old_snap = load_snapshots().get(key, {})
            old_hash = old_snap.get("data_hash")
            new_hash = hash_obj(data)

            if not dataset_force and defn.get("snapshot") and old_hash == new_hash:
                if not is_rows_cache_dataset_key(dataset_key) or self._get_delta_snapshot(dataset_key, params).get("row_hashes"):
                    self.println(f"= Değişiklik yok: {defn['dataset_key']}")
                    self.update_snapshot(defn, params, data)
                    continue

            resp = self.push_dataset(defn, params, data)
            if not resp.get("ok"):
                if resp.get("queued_offline"):
                    self.println(f"~ Offline kuyruğa alındı: {defn['dataset_key']}")
                    continue
                raise RuntimeError(f"Sunucu push hatası: {resp}")
            self.update_snapshot(defn, params, data)
            pushed += 1
            row_count = len(data) if isinstance(data, list) else 1
            self.record_success(defn["dataset_key"], params, row_count, status="ok", note="otomatik/push")
            self.println(f"✓ Gönderildi: {defn['dataset_key']} ({row_count} kayıt)")

        self.println(f"Push tamamlandı. Değerlendirilen: {total}, gönderilen: {pushed}")

    def _first_row_value(self, row: Dict[str, Any], keys: List[str], default: Any = None) -> Any:
        for key in keys:
            if key in row and row.get(key) not in (None, ""):
                return row.get(key)
            upper = key.upper()
            lower = key.lower()
            if upper in row and row.get(upper) not in (None, ""):
                return row.get(upper)
            if lower in row and row.get(lower) not in (None, ""):
                return row.get(lower)
        return default

    def _is_zero_like(self, value: Any) -> bool:
        """SQL bit/int/string değerinde 0/False açık anlamına gelsin."""
        if value is None:
            return False
        if isinstance(value, bool):
            return value is False
        try:
            return int(value) == 0
        except Exception:
            return str(value).strip().lower() in ("0", "false", "hayır", "hayir", "no")

    def _pos_gecici_is_really_open(self, pos_id: Any, database_override: str = "") -> bool:
        """
        ACIK_MASA_DETAY sadece POS_GECICI.KAPANDI = 0 olan gerçek açık masalar için çalışmalı.
        Kapanmış/tahsilat alınmış POS kayıtlarında FIS alanı bazen karışabildiği için asıl kriter KAPANDI'dır.
        """
        if pos_id in (None, "", 0, "0"):
            return False
        conn = self.get_connection(database_override)
        try:
            cur = conn.cursor()
            try:
                cur.execute(
                    "SELECT TOP 1 ID, KAPANDI, FIS FROM POS_GECICI WHERE ID = ?",
                    [pos_id],
                )
                row = cur.fetchone()
                if not row:
                    return False
                kapandi_val = row[1]
                return self._is_zero_like(kapandi_val)
            except Exception:
                # Eski veritabanlarında KAPANDI alanı yoksa geriye uyumluluk için FIS boş kontrolüne düş.
                cur.execute(
                    "SELECT TOP 1 ID, FIS FROM POS_GECICI WHERE ID = ?",
                    [pos_id],
                )
                row = cur.fetchone()
                if not row:
                    return False
                fis_val = row[1]
                return fis_val in (None, "", 0, "0")
        finally:
            conn.close()

    def cleanup_acik_masa_detay_cache(self, active_pos_ids: List[Any]) -> None:
        """Webde kapanmış/açık olmayan POS_ID detaylarını temizler; tüm cache'i silmez."""
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            return
        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "acik_masa_detay_cleanup", "active_pos_ids": [str(x) for x in active_pos_ids]},
                client_secret=self.get_client_secret(),
                timeout=60,
            )
            if resp and resp.get("ok"):
                deleted = int(resp.get("deleted", 0) or 0)
                if deleted:
                    self.println(f"acik_masa_detay stale cache temizlendi: {deleted} kayıt")
        except Exception as exc:
            self.println(f"acik_masa_detay stale cache temizleme hata: {exc}")

    def _push_direct_cache_dataset_if_changed(self, defn: Dict[str, Any], params: Dict[str, Any], data: Any, note: str = "direct_cache", allow_empty: bool = False) -> bool:
        """
        Bazı ondemand datasetler request beklemez: veri varsa web cache'e yazılır.
        Aynı veri tekrar yazılmaz; webde cache yoksa aynı veri bile yeniden seed edilir.
        """
        dataset_key = str(defn.get("dataset_key", "")).strip()
        row_count = normalize_row_count(data)
        if (row_count <= 0 or (isinstance(data, list) and not data)) and not allow_empty:
            self.println(f"{dataset_key}: veri yok, direkt cache push atlandı. params={params}")
            return False

        server_status = self.server_dataset_status(dataset_key, params)
        server_has_cache = bool(server_status.get("exists", False))
        try:
            server_row_count = int(server_status.get("active_row_count", server_status.get("row_count", 0)) or 0)
        except Exception:
            server_row_count = 0
        # Direkt cache'e alınan özel datasetlerde cache kaydı var ama row_count=0 ise
        # normalde "var" kabul edilmez. Ancak bildirim feed gibi boş listenin de
        # anlamlı olduğu datasetlerde cache varlığı yeterlidir.
        server_needs_seed = (not server_has_cache) or ((not allow_empty) and server_row_count <= 0)
        new_hash = hash_obj(data)
        snap = load_snapshots()
        skey = "direct_cache|" + dataset_run_key(dataset_key, params)
        old_hash = str((snap.get(skey, {}) or {}).get("data_hash", "") or "")

        if not server_needs_seed and old_hash == new_hash:
            self.println(f"= Direkt cache değişiklik yok: {dataset_key} params={params}")
            return False

        resp = self.push_dataset(defn, params, data)
        if not resp.get("ok"):
            if resp.get("queued_offline"):
                self.println(f"~ Direkt cache offline kuyruğa alındı: {dataset_key} params={params}")
                return False
            raise RuntimeError(f"Direkt cache push hatası: {resp}")

        snap[skey] = {
            "dataset_key": dataset_key,
            "params": params,
            "data_hash": new_hash,
            "row_count": row_count,
            "last_sync_at": now_str(),
            "note": note,
        }
        save_snapshots(snap)
        self.update_snapshot(defn, params, data)
        self.record_success(dataset_key, params, row_count, status=note, note="request beklemeden cache'e basıldı")
        self.println(f"✓ Direkt cache güncellendi: {dataset_key} ({row_count} kayıt) params={params}")
        return True

    def sync_direct_acik_masa_detay(self, defs: Optional[List[Dict[str, Any]]] = None) -> int:
        """Sadece gerçekten açık POS_GECICI kayıtları için ACIK_MASA_DETAY cache'e basılır."""
        defs = defs or self.parse_dataset_defs()
        def_map = {str(d.get("dataset_key", "")): d for d in defs if isinstance(d, dict) and d.get("dataset_key")}
        detail_def = def_map.get("acik_masa_detay")
        open_def = def_map.get("acik_masalar")
        if not detail_def or not detail_def.get("enabled", True):
            return 0
        if not open_def or not open_def.get("enabled", True):
            self.println("acik_masa_detay direkt cache atlandı: acik_masalar tanımı yok/kapalı.")
            return 0

        try:
            open_rows = self.execute_dataset(open_def, resolve_params(open_def.get("params_template", {})))
        except Exception as exc:
            self.println(f"acik_masa_detay için açık masa listesi okunamadı: {exc}")
            return 0

        if not isinstance(open_rows, list):
            open_rows = []

        pushed = 0
        seen = set()
        active_pos_ids: List[Any] = []
        skipped_closed = 0
        skipped_no_pos = 0

        for row in open_rows:
            if not isinstance(row, dict):
                continue

            # Sadece gerçek POS_ID alanları kullanılacak; ID fallback yok.
            pos_id = self._first_row_value(row, ["POS_ID", "POSID", "POS_GECICI_ID", "POS_GECICI", "pos_id"], None)
            if pos_id in (None, "", 0, "0"):
                skipped_no_pos += 1
                continue

            # ACIK_MASALAR çıktısında KAPANDI geliyorsa daha SQL'e gitmeden ele.
            row_kapandi = self._first_row_value(row, ["KAPANDI", "kapandi", "Kapandi"], None)
            if row_kapandi is not None and not self._is_zero_like(row_kapandi):
                skipped_closed += 1
                self.println(f"acik_masa_detay atlandı: POS_ID={pos_id} ACIK_MASALAR.KAPANDI={row_kapandi}")
                continue

            pos_key = str(pos_id)
            if pos_key in seen:
                continue
            seen.add(pos_key)

            # En kesin kontrol: POS_GECICI.KAPANDI = 0 ise açık masadır.
            try:
                if not self._pos_gecici_is_really_open(pos_id, open_def.get("database", "")):
                    skipped_closed += 1
                    self.println(f"acik_masa_detay atlandı: POS_ID={pos_id} POS_GECICI üzerinde açık değil/kapanmış görünüyor")
                    continue
            except Exception as exc:
                skipped_closed += 1
                self.println(f"acik_masa_detay atlandı: POS_ID={pos_id} açık kontrol hatası -> {exc}")
                continue

            active_pos_ids.append(pos_id)
            params = {"POS_ID": pos_id}
            try:
                data = self.execute_dataset(detail_def, params)
                if isinstance(data, list):
                    before_count = len(data)
                    data = aggregate_acik_masa_detay_rows(data, pos_id)
                    self.println(f"acik_masa_detay POS_ID={pos_id}: ürün satırları tek masa kaydına toplandı ({before_count} -> {len(data)} satır)")
                if self._push_direct_cache_dataset_if_changed(detail_def, params, data, note="direct_acik_masa_detay"):
                    pushed += 1
            except Exception as exc:
                self.println(f"acik_masa_detay direkt cache hata: POS_ID={pos_id} -> {exc}")

        # Komple silme yok; sadece artık açık olmayan POS_ID cache kayıtları temizlenir.
        self.cleanup_acik_masa_detay_cache(active_pos_ids)

        if not active_pos_ids:
            self.println("acik_masa_detay: gerçek açık POS_ID yok; eski açık olmayan detaylar temizlendi.")
        self.println(f"Açık masa detay kontrolü: gerçek açık POS={len(active_pos_ids)}, gönderilen={pushed}, kapalı atlanan={skipped_closed}, POS_ID olmayan atlanan={skipped_no_pos}")
        return pushed

    def sync_direct_rap_filtre_lookup(self, defs: Optional[List[Dict[str, Any]]] = None) -> int:
        """RAP_FILTRE_LOOKUP Kaynak boşken veri döndürmediği için tüm kaynakları tek tek okuyup tek cache'e basar."""
        defs = defs or self.parse_dataset_defs()
        defn = next((d for d in defs if isinstance(d, dict) and d.get("dataset_key") == "rap_filtre_lookup"), None)
        if not defn or not defn.get("enabled", True):
            return 0

        all_rows: List[Dict[str, Any]] = []
        ok_sources = 0
        empty_sources = 0
        for kaynak in RAP_FILTER_LOOKUP_SOURCES:
            params = {"Kaynak": kaynak, "Q": ""}
            try:
                rows = self.execute_dataset(defn, params)
            except Exception as exc:
                self.println(f"rap_filtre_lookup kaynak okunamadı: {kaynak} -> {exc}")
                continue
            rows = [r for r in (rows or []) if isinstance(r, dict)]
            if not rows:
                empty_sources += 1
                continue
            ok_sources += 1
            for row in rows:
                item = dict(row)
                item["Kaynak"] = kaynak
                item["KAYNAK"] = kaynak
                all_rows.append(item)

        if not all_rows:
            self.println("rap_filtre_lookup: tüm kaynaklar boş geldi, cache push yapılmadı.")
            return 0

        cache_params = {"Kaynak": "", "Q": ""}
        if self._push_direct_cache_dataset_if_changed(defn, cache_params, all_rows, note="direct_rap_filtre_lookup_all_sources"):
            self.println(f"rap_filtre_lookup cache güncellendi. Kaynak={ok_sources}, boş={empty_sources}, toplam satır={len(all_rows)}")
            return 1
        return 0

    def sync_direct_rap_acik_hesap_ozet(self, defs: Optional[List[Dict[str, Any]]] = None) -> int:
        """Açık hesap kişi özet web raporunu veri varsa açık masa detayıyla karıştırmadan ayrı dataset_cache kaydı olarak basar."""
        defs = defs or self.parse_dataset_defs()
        defn = next((d for d in defs if isinstance(d, dict) and d.get("dataset_key") == "rap_acik_hesap_kisi_ozet_web"), None)
        if not defn or not defn.get("enabled", True):
            return 0

        base_params = resolve_params(defn.get("params_template", {}))
        try:
            page_size = int(base_params.get("PageSize") or base_params.get("page_size") or 200)
        except Exception:
            page_size = 200
        page_size = max(1, min(1000, page_size))

        # Cache anahtarında Page/PageSize tutmuyoruz. Web dataset_get zaten rows üzerinden kendi page/page_size ile okuyacak.
        cache_params = dict(base_params)
        cache_params.pop("Page", None)
        cache_params.pop("PageSize", None)
        cache_params.pop("page", None)
        cache_params.pop("page_size", None)

        all_rows: List[Dict[str, Any]] = []
        max_pages = 200
        for page in range(1, max_pages + 1):
            exec_params = dict(base_params)
            exec_params["Page"] = page
            exec_params["PageSize"] = page_size
            try:
                data = self.execute_dataset(defn, exec_params)
                if not isinstance(data, list) or not data:
                    if page == 1:
                        self.println("rap_acik_hesap_kisi_ozet_web: veri yok, direkt cache push atlandı.")
                    break
                all_rows.extend([r for r in data if isinstance(r, dict)])
                if len(data) < page_size:
                    break
            except Exception as exc:
                self.println(f"rap_acik_hesap_kisi_ozet_web direkt cache hata: Page={page} -> {exc}")
                break

        if not all_rows:
            return 0
        if self._push_direct_cache_dataset_if_changed(defn, cache_params, all_rows, note="direct_rap_acik_hesap_rows"):
            self.println(f"Açık hesap kişi özet rows cache güncellendi. Toplam satır: {len(all_rows)}")
            return 1
        return 0

    def maybe_sync_rap_filtre_lookup_fast(self, defs: Optional[List[Dict[str, Any]]] = None, min_interval_sec: int = 300) -> int:
        """Lookup cache boş/geç kalmasın diye hızlı turda kontrollü çalıştırılır."""
        now_ts = time.time()
        if (now_ts - float(getattr(self, "_last_lookup_direct_sync_ts", 0.0) or 0.0)) < min_interval_sec:
            return 0
        self._last_lookup_direct_sync_ts = now_ts
        return self.sync_direct_rap_filtre_lookup(defs or self.parse_dataset_defs())

    def sync_direct_fis_gunluk_bildirim_feed(self, defs: Optional[List[Dict[str, Any]]] = None) -> int:
        """
        Yüksek satış bildirimi request beklemesin diye günün FIS_GUNLUK_BILDIRIM_FEED sonucunu
        dataset_cache içine direkt basar.

        Önemli: MinTutar burada 0 gönderilir. Mobil uygulamadaki satış limiti/backend watcher
        dataset_get veya request parametresinde MinTutar olarak gelir; sync.php aynı günlük cache'i
        bu limite göre filtreler. Böylece limit değişince POS client'ta ayar okumaya gerek kalmaz.
        """
        defs = defs or self.parse_dataset_defs()
        defn = next((d for d in defs if isinstance(d, dict) and d.get("dataset_key") == "fis_gunluk_bildirim_feed"), None)
        if not defn or not defn.get("enabled", True):
            return 0

        params = resolve_params(defn.get("params_template", {}))
        params["TARIH"] = resolve_placeholders(params.get("TARIH", "{now_date}"))
        params["MinTutar"] = 0
        params["SonFisId"] = 0
        params["Lokasyon"] = ""
        params["Personel"] = ""
        params["FisTuru"] = ""

        try:
            data = self.execute_dataset(defn, params)
            if not isinstance(data, list):
                data = []
            # Boş sonuç da cache'e yazılabilir; böylece backend boşken de request kuyruğuna düşmez.
            if self._push_direct_cache_dataset_if_changed(defn, params, data, note="direct_fis_bildirim_feed", allow_empty=True):
                self.println(f"fis_gunluk_bildirim_feed cache güncellendi. Satır={len(data)}")
                return 1
            return 0
        except Exception as exc:
            self.println(f"fis_gunluk_bildirim_feed direkt cache hata: {exc}")
            return 0

    def current_month_bounds_for_sql(self) -> Dict[str, str]:
        """Bu ayın başlangıcı ve bugünün sınırlarını üretir."""
        now = datetime.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return {
            "month_start_dt": month_start.strftime("%Y-%m-%d %H:%M:%S"),
            "tomorrow_start_dt": tomorrow.strftime("%Y-%m-%d %H:%M:%S"),
            "month_start_date": month_start.strftime("%Y-%m-%d"),
            "today_date": now.strftime("%Y-%m-%d"),
            "month_key": month_start.strftime("%Y-%m"),
        }

    def load_current_month_moving_stock_ids(self, database_override: str = "", limit: int = PREWARM_EXTRE_STOCK_LIMIT) -> List[Any]:
        """Bu ay FIS_DETAY içinde hareket görmüş stok ID'lerini döndürür."""
        bounds = self.current_month_bounds_for_sql()
        limit = max(1, min(5000, int(limit or PREWARM_EXTRE_STOCK_LIMIT)))
        sql = f"""
SELECT TOP {limit}
       FD.STOK AS ID,
       COUNT(*) AS HAREKET_SAYISI,
       MAX(FD.FIS_TARIHI) AS SON_HAREKET_TARIHI
  FROM FIS_DETAY FD WITH (NOLOCK)
 WHERE FD.FIS_TARIHI >= '{bounds['month_start_dt']}'
   AND FD.FIS_TARIHI <  '{bounds['tomorrow_start_dt']}'
   AND ISNULL(FD.STOK, 0) <> 0
 GROUP BY FD.STOK
 ORDER BY MAX(FD.FIS_TARIHI) DESC, COUNT(*) DESC, FD.STOK DESC
""".strip()
        conn = self.get_connection(database_override)
        try:
            rows = self.execute_query(conn, sql)
        finally:
            conn.close()

        out: List[Any] = []
        seen = set()
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            sid = self._first_row_value(row, ["ID", "STOK", "stok", "Stok"], None)
            if sid in (None, "", 0, "0"):
                continue
            key = str(sid)
            if key in seen:
                continue
            seen.add(key)
            out.append(sid)
        return out

    def load_balance_stock_ids(self, database_override: str = "", limit: int = PREWARM_STOK_BILGI_MIKTAR_BALANCE_STOCK_LIMIT) -> List[Any]:
        """
        Miktarı/bakiyesi sıfır olmayan stok ID'lerini döndürür.
        Öncelik ERP12 tarafında stok miktar özetinde kullanılan STOK_MIKTAR_STOK tablosudur.
        Tablo/alan farklıysa GetStockList sonucu fallback olarak denenir.
        """
        limit = max(1, min(50000, int(limit or PREWARM_STOK_BILGI_MIKTAR_BALANCE_STOCK_LIMIT)))
        queries = [
            (
                "STOK_MIKTAR_STOK",
                f"""
SELECT TOP {limit}
       SMS.STOK AS ID,
       SUM(ISNULL(SMS.MIKTAR, 0)) AS MIKTAR
  FROM STOK_MIKTAR_STOK SMS WITH (NOLOCK)
 WHERE ISNULL(SMS.STOK, 0) <> 0
 GROUP BY SMS.STOK
HAVING ABS(SUM(ISNULL(SMS.MIKTAR, 0))) > 0.0001
 ORDER BY ABS(SUM(ISNULL(SMS.MIKTAR, 0))) DESC, SMS.STOK DESC
""".strip(),
            ),
        ]

        for label, sql in queries:
            conn = self.get_connection(database_override)
            try:
                rows = self.execute_query(conn, sql)
            except Exception as exc:
                self.println(f"Bakiyeli/miktarlı stok listesi {label} üzerinden okunamadı: {exc}")
                rows = []
            finally:
                conn.close()

            out: List[Any] = []
            seen = set()
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                sid = self._first_row_value(row, ["ID", "STOK", "stok", "Stok", "STOK_ID", "stok_id"], None)
                if sid in (None, "", 0, "0"):
                    continue
                key = str(sid)
                if key in seen:
                    continue
                seen.add(key)
                out.append(sid)
            if out:
                self.println(f"Bakiyeli/miktarlı stok listesi {label} üzerinden alındı: {len(out)} stok")
                return out

        # Fallback: stock_list prosedüründen miktarı/bakiyesi olan stokları çek.
        try:
            def_map = {str(d.get("dataset_key", "")): d for d in self.parse_dataset_defs() if isinstance(d, dict) and d.get("dataset_key")}
            stock_def = def_map.get("stock_list")
            if not stock_def:
                return []
            rows = self.execute_dataset(stock_def, resolve_params(stock_def.get("params_template", {})))
            out: List[Any] = []
            seen = set()
            qty_keys = [
                "MIKTAR", "MİKTAR", "KALAN", "BAKIYE", "STOK_BAKIYE", "STOK_MIKTAR", "STOK_MİKTAR",
                "MEVCUT", "MEVCUT_MIKTAR", "MEVCUT_MİKTAR", "ENVANTER", "DEPODAKI_MIKTAR", "DEPODAKİ_MİKTAR",
            ]
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                sid = self._first_row_value(row, ["ID", "STOK", "STOK_ID", "stok", "stok_id"], None)
                if sid in (None, "", 0, "0"):
                    continue
                qty_val = self._first_row_value(row, qty_keys, None)
                if qty_val is None:
                    continue
                try:
                    if abs(float(str(qty_val).replace(",", "."))) <= 0.0001:
                        continue
                except Exception:
                    continue
                key = str(sid)
                if key in seen:
                    continue
                seen.add(key)
                out.append(sid)
                if len(out) >= limit:
                    break
            if out:
                self.println(f"Bakiyeli/miktarlı stok listesi stock_list fallback ile alındı: {len(out)} stok")
            return out
        except Exception as exc:
            self.println(f"Bakiyeli/miktarlı stok listesi fallback hata: {exc}")
            return []

    def load_current_month_moving_cari_ids(self, database_override: str = "", limit: int = PREWARM_EXTRE_CARI_LIMIT) -> List[Any]:
        """
        Bu ay hareket görmüş cari ID'lerini döndürür.
        FINANS_DETAY kolonları firmaya göre değişebildiği için burada ana ve tek güvenli kaynak FIS.CARI'dir.
        Bakiyesi olan cariler ayrıca load_balance_cari_ids ile eklenir.
        """
        bounds = self.current_month_bounds_for_sql()
        limit = max(1, min(5000, int(limit or PREWARM_EXTRE_CARI_LIMIT)))
        sql = f"""
SELECT TOP {limit}
       F.CARI AS ID,
       COUNT(*) AS HAREKET_SAYISI,
       MAX(F.FIS_TARIHI) AS SON_HAREKET_TARIHI
  FROM FIS F WITH (NOLOCK)
 WHERE F.FIS_TARIHI >= '{bounds['month_start_dt']}'
   AND F.FIS_TARIHI <  '{bounds['tomorrow_start_dt']}'
   AND ISNULL(F.CARI, 0) <> 0
 GROUP BY F.CARI
 ORDER BY MAX(F.FIS_TARIHI) DESC, COUNT(*) DESC, F.CARI DESC
""".strip()

        conn = self.get_connection(database_override)
        try:
            rows = self.execute_query(conn, sql)
        except Exception as exc:
            self.println(f"Cari hareket listesi FIS.CARI üzerinden alınamadı: {exc}")
            rows = []
        finally:
            conn.close()

        out: List[Any] = []
        seen = set()
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            cid = self._first_row_value(row, ["ID", "CARI", "cari", "Cari"], None)
            if cid in (None, "", 0, "0"):
                continue
            key = str(cid)
            if key in seen:
                continue
            seen.add(key)
            out.append(cid)

        if out:
            self.println(f"Cari hareket listesi FIS.CARI üzerinden alındı: {len(out)} cari")
        else:
            self.println("Cari hareket listesi FIS.CARI üzerinden boş geldi.")
        return out

    def load_balance_cari_ids(self, database_override: str = "", limit: int = PREWARM_EXTRE_BALANCE_CARI_LIMIT) -> List[Any]:
        """
        Bakiyesi sıfır olmayan cari kartları döndürür.
        Öncelik FINANS_DETAY_CARI_OZET tablosudur; bazı firmalarda bakiye alanları farklı
        davranabileceği için CARI_BAKIYE_LISTE prosedürü fallback olarak denenir.
        """
        limit = max(1, min(5000, int(limit or PREWARM_EXTRE_BALANCE_CARI_LIMIT)))
        queries = [
            (
                "FINANS_DETAY_CARI_OZET",
                f"""
SELECT TOP {limit}
       X.KART AS ID,
       SUM(ISNULL(X.BORC, 0)) AS BORC,
       SUM(ISNULL(X.ALACAK, 0)) AS ALACAK,
       SUM(ISNULL(X.BORC, 0) - ISNULL(X.ALACAK, 0)) AS BAKIYE
  FROM FINANS_DETAY_CARI_OZET X WITH (NOLOCK)
 WHERE ISNULL(X.KART, 0) <> 0
 GROUP BY X.KART
HAVING ABS(SUM(ISNULL(X.BORC, 0) - ISNULL(X.ALACAK, 0))) > 0.0001
 ORDER BY ABS(SUM(ISNULL(X.BORC, 0) - ISNULL(X.ALACAK, 0))) DESC, X.KART DESC
""".strip(),
            ),
        ]

        for label, sql in queries:
            conn = self.get_connection(database_override)
            try:
                rows = self.execute_query(conn, sql)
            except Exception as exc:
                self.println(f"Bakiyeli cari listesi {label} üzerinden okunamadı: {exc}")
                rows = []
            finally:
                conn.close()

            out: List[Any] = []
            seen = set()
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                cid = self._first_row_value(row, ["ID", "KART", "CARI", "cari", "Cari"], None)
                if cid in (None, "", 0, "0"):
                    continue
                key = str(cid)
                if key in seen:
                    continue
                seen.add(key)
                out.append(cid)
            if out:
                self.println(f"Bakiyeli cari listesi {label} üzerinden alındı: {len(out)} cari")
                return out

        # Fallback: prosedür tanımı varsa CARI_BAKIYE_LISTE sonucundan bakiye veren kartları çek.
        try:
            def_map = {str(d.get("dataset_key", "")): d for d in self.parse_dataset_defs() if isinstance(d, dict) and d.get("dataset_key")}
            bakiye_def = def_map.get("cari_bakiye_liste")
            if not bakiye_def:
                return []
            rows = self.execute_dataset(bakiye_def, resolve_params(bakiye_def.get("params_template", {})))
            out: List[Any] = []
            seen = set()
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                cid = self._first_row_value(row, ["ID", "CARI", "KART", "CARI_ID", "cari_id"], None)
                if cid in (None, "", 0, "0"):
                    continue
                bakiye = self._first_row_value(row, ["BAKIYE", "KALAN", "KALAN_TUTAR", "BORC_BAKIYE", "ALACAK_BAKIYE"], None)
                if bakiye is None:
                    borc = self._first_row_value(row, ["BORC", "BORÇ"], 0)
                    alacak = self._first_row_value(row, ["ALACAK"], 0)
                    try:
                        bakiye = float(str(borc).replace(",", ".")) - float(str(alacak).replace(",", "."))
                    except Exception:
                        bakiye = 0
                try:
                    if abs(float(str(bakiye).replace(",", "."))) <= 0.0001:
                        continue
                except Exception:
                    continue
                key = str(cid)
                if key in seen:
                    continue
                seen.add(key)
                out.append(cid)
                if len(out) >= limit:
                    break
            if out:
                self.println(f"Bakiyeli cari listesi CARI_BAKIYE_LISTE fallback ile alındı: {len(out)} cari")
            return out
        except Exception as exc:
            self.println(f"Bakiyeli cari listesi fallback hata: {exc}")
            return []

    def prewarm_stok_bilgi_miktar_cache(self, bilgi_def: Optional[Dict[str, Any]], stock_ids: List[Any], month_key: str, max_per_run: int = PREWARM_STOK_BILGI_MIKTAR_MAX_PER_RUN) -> int:
        """
        Bu ay hareket gören + miktarı/bakiyesi olan stoklar için STOK_BILGI_MIKTAR cache'ini hazırlar.
        Ana model ondemand kalır; biz sık açılacak stokların genel miktar bilgisini LOKASYON=0 ile önden basarız.
        """
        if not PREWARM_STOK_BILGI_MIKTAR_ENABLED:
            return 0
        if not bilgi_def or not bilgi_def.get("enabled", True):
            return 0
        if not stock_ids:
            return 0

        items: List[Dict[str, Any]] = []
        seen = set()
        lokasyon_ids = PREWARM_STOK_BILGI_MIKTAR_LOKASYON_IDS or [0]
        for sid in stock_ids:
            if sid in (None, "", 0, "0"):
                continue
            for lok in lokasyon_ids:
                key = f"{sid}|{lok}"
                if key in seen:
                    continue
                seen.add(key)
                params = resolve_params(bilgi_def.get("params_template", {}))
                params["ID"] = sid
                params["LOKASYON"] = lok
                items.append({
                    "dataset_key": "stok_bilgi_miktar",
                    "defn": bilgi_def,
                    "params": params,
                    "ref_id": sid,
                    "lokasyon": lok,
                })

        selected = self._rotate_items_for_prewarm(items, month_key + "|stok_bilgi_miktar", max_per_run)
        pushed = 0
        checked = 0
        for item in selected:
            checked += 1
            try:
                data = self.execute_dataset(item["defn"], dict(item["params"]))
                if self._push_direct_cache_dataset_if_changed(item["defn"], dict(item["params"]), data, note="prewarm_stok_bilgi_miktar"):
                    pushed += 1
            except Exception as exc:
                self.println(
                    "stok_bilgi_miktar ön cache hata: "
                    f"ID={item.get('ref_id')} LOKASYON={item.get('lokasyon')} -> {exc}"
                )

        if checked:
            self.println(
                "Stok bilgi/miktar ön cache tamamlandı. "
                f"Liste={len(items)}, kontrol={checked}, güncelleme={pushed}"
            )
        return pushed

    def _extract_recent_fis_ids_from_extre(self, data: Any, limit: int = PREWARM_FIS_DETAIL_PER_EXTRE) -> List[Any]:
        """Ekstre sonucundan son fiş ID'lerini güvenli şekilde ayıklar."""
        if not isinstance(data, list):
            return []
        limit = max(1, int(limit or PREWARM_FIS_DETAIL_PER_EXTRE))
        candidate_keys = [
            "FIS_ID", "FISID", "FIS_IDD", "FisId", "FisID",
            "FIS", "fis", "Fis",
            "FATURA_FIS", "FATURA_FIS_ID", "BELGE_FIS_ID",
        ]
        rows_with_fis: List[Dict[str, Any]] = []
        for row in data:
            if not isinstance(row, dict):
                continue
            fid = self._first_row_value(row, candidate_keys, None)
            if fid in (None, "", 0, "0"):
                continue
            # Fiş numarası gibi metinsel alanları yanlışlıkla FisId yapmayalım.
            try:
                fid_num = int(float(str(fid).strip().replace(",", ".")))
            except Exception:
                continue
            if fid_num <= 0:
                continue
            date_val = self._first_row_value(row, ["TARIH", "FIS_TARIHI", "TARİH", "Tarih", "DATE"], "")
            rows_with_fis.append({"fid": fid_num, "date": str(date_val or "")})

        rows_with_fis.sort(key=lambda x: (x.get("date", ""), x.get("fid", 0)), reverse=True)
        out: List[Any] = []
        seen = set()
        for item in rows_with_fis:
            fid = item["fid"]
            if fid in seen:
                continue
            seen.add(fid)
            out.append(fid)
            if len(out) >= limit:
                break
        return out

    def prewarm_fis_detail_cache(self, fis_def: Optional[Dict[str, Any]], fis_ids: List[Any], budget: int) -> int:
        """Sadece küçük limitlerle son fiş detaylarını cache'e hazırlar; ana davranış yine ondemand kalır."""
        if not PREWARM_FIS_DETAIL_ENABLED or not fis_def or not fis_def.get("enabled", True):
            return 0
        if budget <= 0 or not fis_ids:
            return 0
        pushed = 0
        checked = 0
        seen = set()
        for fid in fis_ids:
            if checked >= budget:
                break
            if fid in (None, "", 0, "0"):
                continue
            key = str(fid)
            if key in seen:
                continue
            seen.add(key)
            checked += 1
            params = resolve_params(fis_def.get("params_template", {}))
            params["FisId"] = fid
            try:
                data = self.execute_dataset(fis_def, params)
                if self._push_direct_cache_dataset_if_changed(fis_def, params, data, note="prewarm_recent_fis_detail"):
                    pushed += 1
            except Exception as exc:
                self.println(f"fis_detay_toplam ön cache hata: FisId={fid} -> {exc}")
        return pushed

    def _rotate_items_for_prewarm(self, items: List[Dict[str, Any]], month_key: str, max_per_run: int) -> List[Dict[str, Any]]:
        """Her turda aynı ilk kayıtlar dönmesin diye cursor ile listeyi döndürür."""
        if not items:
            return []
        max_per_run = max(1, int(max_per_run or PREWARM_EXTRE_MAX_PER_RUN))
        if len(items) <= max_per_run:
            return items

        snap = load_snapshots()
        skey = f"current_month_extre_cursor|{month_key}"
        meta = snap.get(skey, {}) if isinstance(snap.get(skey, {}), dict) else {}
        try:
            cursor = int(meta.get("cursor", 0) or 0)
        except Exception:
            cursor = 0
        cursor = cursor % len(items)
        ordered = items[cursor:] + items[:cursor]
        selected = ordered[:max_per_run]
        snap[skey] = {
            "month_key": month_key,
            "cursor": (cursor + len(selected)) % len(items),
            "item_count": len(items),
            "max_per_run": max_per_run,
            "last_sync_at": now_str(),
        }
        save_snapshots(snap)
        return selected

    def load_current_month_fis_ids(self, database_override: str = "", limit: int = PREWARM_MONTHLY_FIS_DETAIL_FIS_LIMIT) -> List[Any]:
        """Bu ayki belirlenen FIS_TURU listesindeki fiş ID'lerini döndürür. Fiş detay cache'i bu listeyle parça parça ısıtılır."""
        bounds = self.current_month_bounds_for_sql()
        limit = max(1, min(50000, int(limit or PREWARM_MONTHLY_FIS_DETAIL_FIS_LIMIT)))
        fis_turu_values = ",".join(str(int(x)) for x in (PREWARM_MONTHLY_FIS_DETAIL_FIS_TURU or (11, 12, 35, 36)))
        sql = f"""
SELECT TOP {limit}
       F.ID AS FIS_ID,
       F.FIS_TARIHI,
       F.FIS_TURU
  FROM FIS F WITH (NOLOCK)
 WHERE F.FIS_TARIHI >= '{bounds['month_start_dt']}'
   AND F.FIS_TARIHI <  '{bounds['tomorrow_start_dt']}'
   AND ISNULL(F.ID, 0) <> 0
   AND F.FIS_TURU IN ({fis_turu_values})
 ORDER BY F.FIS_TARIHI DESC, F.ID DESC
""".strip()
        conn = self.get_connection(database_override)
        try:
            rows = self.execute_query(conn, sql)
        except Exception as exc:
            self.println(f"Bu ayki fiş listesi FIS üzerinden okunamadı: {exc}")
            rows = []
        finally:
            conn.close()

        out: List[Any] = []
        seen = set()
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            fid = self._first_row_value(row, ["FIS_ID", "ID", "FIS", "FisId", "fis_id"], None)
            if fid in (None, "", 0, "0"):
                continue
            try:
                fid_num = int(float(str(fid).strip().replace(",", ".")))
            except Exception:
                continue
            if fid_num <= 0:
                continue
            if fid_num in seen:
                continue
            seen.add(fid_num)
            out.append(fid_num)
        return out

    def sync_current_month_fis_detail_cache(self, defs: Optional[List[Dict[str, Any]]] = None, force: bool = False, max_per_run: int = PREWARM_MONTHLY_FIS_DETAIL_MAX_PER_RUN) -> int:
        """
        Bu ayki FIS kayıtlarının ürün/satır detaylarını fis_detay_toplam dataset_cache'ine hazırlar.
        Tek seferde tüm ayı basmak yerine cursor ile parça parça gider; cache varsa ve hash aynıysa tekrar yazmaz.
        """
        if not PREWARM_MONTHLY_FIS_DETAIL_ENABLED:
            return 0
        now_ts = time.time()
        if not force and (now_ts - float(getattr(self, "_last_monthly_fis_detail_prewarm_ts", 0.0) or 0.0)) < PREWARM_MONTHLY_FIS_DETAIL_INTERVAL_SEC:
            return 0
        self._last_monthly_fis_detail_prewarm_ts = now_ts

        defs = defs or self.parse_dataset_defs()
        def_map = {str(d.get("dataset_key", "")): d for d in defs if isinstance(d, dict) and d.get("dataset_key")}
        fis_def = def_map.get("fis_detay_toplam")
        if not fis_def or not fis_def.get("enabled", True):
            return 0

        bounds = self.current_month_bounds_for_sql()
        try:
            fis_ids = self.load_current_month_fis_ids(fis_def.get("database", ""), PREWARM_MONTHLY_FIS_DETAIL_FIS_LIMIT)
        except Exception as exc:
            self.println(f"Bu ayki fiş detay ön cache listesi alınamadı: {exc}")
            fis_ids = []

        if not fis_ids:
            self.println("Bu ay için fiş bulunamadı; fis_detay_toplam ön cache atlandı.")
            return 0

        items: List[Dict[str, Any]] = []
        for fid in fis_ids:
            params = resolve_params(fis_def.get("params_template", {}))
            params["FisId"] = fid
            items.append({"dataset_key": "fis_detay_toplam", "defn": fis_def, "params": params, "ref_id": fid})

        selected = self._rotate_items_for_prewarm(items, bounds["month_key"] + "|monthly_fis_detail", max_per_run)
        pushed = 0
        checked = 0
        for item in selected:
            checked += 1
            params = dict(item["params"])
            try:
                data = self.execute_dataset(item["defn"], params)
                if self._push_direct_cache_dataset_if_changed(item["defn"], params, data, note="prewarm_current_month_fis_detail"):
                    pushed += 1
            except Exception as exc:
                self.println(f"Bu ay fiş detayı ön cache hata: FisId={item.get('ref_id')} -> {exc}")

        self.println(
            "Bu ay fiş detay ön cache tamamlandı. "
            f"Fiş_liste={len(items)}, kontrol={checked}, güncelleme={pushed}"
        )
        return pushed

    def sync_current_month_extre_cache(self, defs: Optional[List[Dict[str, Any]]] = None, force: bool = False, max_per_run: int = PREWARM_EXTRE_MAX_PER_RUN) -> int:
        """
        Bu ay hareket görmüş stokların ve hareket/bakiye veren carilerin ekstrelerini
        request beklemeden web cache'e hazırlar.
        Fiş içerikleri tamamen push edilmez; sadece seçilen ekstrelerden son birkaç FisId
        küçük limitlerle ısıtılır, kalan fiş detayları tıklanınca ondemand çalışır.
        """
        now_ts = time.time()
        if not force and (now_ts - float(getattr(self, "_last_extre_prewarm_ts", 0.0) or 0.0)) < PREWARM_EXTRE_INTERVAL_SEC:
            return 0
        self._last_extre_prewarm_ts = now_ts

        defs = defs or self.parse_dataset_defs()
        def_map = {str(d.get("dataset_key", "")): d for d in defs if isinstance(d, dict) and d.get("dataset_key")}
        stok_def = def_map.get("stok_extre")
        stok_bilgi_def = def_map.get("stok_bilgi_miktar")
        cari_def = def_map.get("kart_extre_cari")
        fis_def = def_map.get("fis_detay_toplam")
        if not stok_def and not cari_def and not stok_bilgi_def:
            return 0

        bounds = self.current_month_bounds_for_sql()
        items: List[Dict[str, Any]] = []
        stok_bilgi_stock_ids: List[Any] = []

        if (stok_def and stok_def.get("enabled", True)) or (stok_bilgi_def and stok_bilgi_def.get("enabled", True)):
            stock_database = (stok_def or stok_bilgi_def or {}).get("database", "")
            try:
                stock_ids = self.load_current_month_moving_stock_ids(stock_database, PREWARM_EXTRE_STOCK_LIMIT)
            except Exception as exc:
                self.println(f"Stok hareket ön cache listesi alınamadı: {exc}")
                stock_ids = []

            if stok_def and stok_def.get("enabled", True):
                for sid in stock_ids:
                    params = resolve_params(stok_def.get("params_template", {}))
                    params["ID"] = sid
                    items.append({"dataset_key": "stok_extre", "defn": stok_def, "params": params, "ref_id": sid, "source": "month_movement"})
                self.println(f"Stok ekstre ön cache listesi: bu ay hareket gören {len(stock_ids)} stok")

            balance_stock_ids: List[Any] = []
            if stok_bilgi_def and stok_bilgi_def.get("enabled", True):
                try:
                    balance_stock_ids = self.load_balance_stock_ids(stock_database, PREWARM_STOK_BILGI_MIKTAR_BALANCE_STOCK_LIMIT)
                except Exception as exc:
                    self.println(f"Bakiyeli/miktarlı stok ön cache listesi alınamadı: {exc}")
                    balance_stock_ids = []

                seen_stok_bilgi = set()
                for sid in list(stock_ids) + list(balance_stock_ids):
                    if sid in (None, "", 0, "0"):
                        continue
                    key = str(sid)
                    if key in seen_stok_bilgi:
                        continue
                    seen_stok_bilgi.add(key)
                    stok_bilgi_stock_ids.append(sid)
                self.println(
                    "Stok bilgi/miktar ön cache listesi: "
                    f"bu ay hareket gören {len(stock_ids)} stok + bakiyeli/miktarlı {len(balance_stock_ids)} stok "
                    f"=> tekilleştirilmiş {len(stok_bilgi_stock_ids)} stok"
                )

        if cari_def and cari_def.get("enabled", True):
            try:
                moving_cari_ids = self.load_current_month_moving_cari_ids(cari_def.get("database", ""), PREWARM_EXTRE_CARI_LIMIT)
            except Exception as exc:
                self.println(f"Cari hareket ön cache listesi alınamadı: {exc}")
                moving_cari_ids = []

            try:
                balance_cari_ids = self.load_balance_cari_ids(cari_def.get("database", ""), PREWARM_EXTRE_BALANCE_CARI_LIMIT)
            except Exception as exc:
                self.println(f"Bakiyeli cari ön cache listesi alınamadı: {exc}")
                balance_cari_ids = []

            merged_cari_ids: List[Any] = []
            source_map: Dict[str, str] = {}
            for cid in moving_cari_ids:
                key = str(cid)
                if key not in source_map:
                    source_map[key] = "month_movement"
                    merged_cari_ids.append(cid)
            for cid in balance_cari_ids:
                key = str(cid)
                if key not in source_map:
                    source_map[key] = "balance"
                    merged_cari_ids.append(cid)
                elif source_map[key] == "month_movement":
                    source_map[key] = "month_movement+balance"

            for cid in merged_cari_ids:
                params = resolve_params(cari_def.get("params_template", {}))
                params["ID"] = cid
                params["TARIH_BASLANGIC"] = bounds["month_start_date"]
                params["TARIH_BITIS"] = bounds["today_date"]
                params.setdefault("DOVIZ_AD", 1)
                params.setdefault("DEVIR", "Devreden")
                items.append({
                    "dataset_key": "kart_extre_cari",
                    "defn": cari_def,
                    "params": params,
                    "ref_id": cid,
                    "source": source_map.get(str(cid), "balance_or_movement"),
                })
            self.println(
                "Cari ekstre ön cache listesi: "
                f"bu ay hareket gören {len(moving_cari_ids)} cari + bakiyeli {len(balance_cari_ids)} cari "
                f"=> tekilleştirilmiş {len(merged_cari_ids)} cari"
            )

        if not items and not stok_bilgi_stock_ids:
            self.println("Bu ay hareket görmüş stok, bakiyeli/miktarlı stok veya hareket/bakiye veren cari bulunamadı; ekstre/stok bilgi ön cache atlandı.")
            return 0

        selected = self._rotate_items_for_prewarm(items, bounds["month_key"], max_per_run)
        pushed = 0
        checked = 0
        fis_detail_pushed = 0
        fis_detail_budget = PREWARM_FIS_DETAIL_MAX_PER_RUN
        fis_ids_for_detail: List[Any] = []

        for item in selected:
            defn = item["defn"]
            dataset_key = str(item["dataset_key"])
            params = dict(item["params"])
            checked += 1
            try:
                data = self.execute_dataset(defn, params)
                if self._push_direct_cache_dataset_if_changed(defn, params, data, note="prewarm_current_month_extre"):
                    pushed += 1
                if dataset_key == "kart_extre_cari" and fis_detail_budget > 0:
                    fis_ids_for_detail.extend(self._extract_recent_fis_ids_from_extre(data, PREWARM_FIS_DETAIL_PER_EXTRE))
            except Exception as exc:
                self.println(f"{dataset_key} ön cache hata: ID={item.get('ref_id')} kaynak={item.get('source')} -> {exc}")

        # Aynı turda sadece sınırlı sayıda son fiş detayı hazırlanır; ana fiş içeriği modeli ondemand kalır.
        if fis_ids_for_detail and fis_detail_budget > 0:
            unique_fis_ids: List[Any] = []
            seen_fis = set()
            for fid in fis_ids_for_detail:
                key = str(fid)
                if key in seen_fis:
                    continue
                seen_fis.add(key)
                unique_fis_ids.append(fid)
                if len(unique_fis_ids) >= fis_detail_budget:
                    break
            fis_detail_pushed = self.prewarm_fis_detail_cache(fis_def, unique_fis_ids, fis_detail_budget)

        stok_bilgi_pushed = self.prewarm_stok_bilgi_miktar_cache(
            stok_bilgi_def,
            stok_bilgi_stock_ids,
            bounds["month_key"],
            PREWARM_STOK_BILGI_MIKTAR_MAX_PER_RUN,
        )

        self.println(
            "Bu ay ekstre/stok bilgi ön cache tamamlandı. "
            f"Ekstre_liste={len(items)}, ekstre_kontrol={checked}, ekstre_güncelleme={pushed}, "
            f"stok_bilgi_ön_cache={stok_bilgi_pushed}, fiş_detay_ön_cache={fis_detail_pushed}"
        )
        return pushed + fis_detail_pushed + stok_bilgi_pushed

    def sync_direct_cache_ondemand_datasets(self, only_dataset_keys: Optional[set] = None):
        """
        Genel ondemand mantığını bozmaz. Sadece seçilen özel datasetler request beklemeden cache'e basılır.
        - rap_acik_hesap_kisi_ozet_web: veri varsa sayfa sayfa cache'e basılır.
        - acik_masa_detay: açık masalardaki POS_ID'ler için detay cache'e basılır.
        """
        only_dataset_keys = set(only_dataset_keys or DIRECT_CACHE_ONDEMAND_KEYS)
        defs = self.parse_dataset_defs()
        pushed = 0
        handled = set()
        if "rap_acik_hesap_kisi_ozet_web" in only_dataset_keys:
            pushed += self.sync_direct_rap_acik_hesap_ozet(defs)
            handled.add("rap_acik_hesap_kisi_ozet_web")
        if "rap_filtre_lookup" in only_dataset_keys:
            pushed += self.sync_direct_rap_filtre_lookup(defs)
            handled.add("rap_filtre_lookup")
        if "fis_gunluk_bildirim_feed" in only_dataset_keys:
            pushed += self.sync_direct_fis_gunluk_bildirim_feed(defs)
            handled.add("fis_gunluk_bildirim_feed")
        if "acik_masa_detay" in only_dataset_keys:
            pushed += self.sync_direct_acik_masa_detay(defs)
            handled.add("acik_masa_detay")

        # Diğer özel direkt-cache datasetler: params_template ile çalışır, veri varsa rows/cache güncellenir.
        def_map = {str(d.get("dataset_key", "")): d for d in defs if isinstance(d, dict) and d.get("dataset_key")}
        for key in sorted(only_dataset_keys - handled):
            defn = def_map.get(key)
            if not defn or not defn.get("enabled", True):
                continue
            try:
                params = resolve_params(defn.get("params_template", {}))
                data = self.execute_dataset(defn, params)
                if self._push_direct_cache_dataset_if_changed(defn, params, data, note="direct_cache_rows"):
                    pushed += 1
            except Exception as exc:
                self.println(f"{key} direkt cache hata: {exc}")
        return pushed

    def ondemand_dataset_keys(self) -> List[str]:
        """Mode=ondemand olan datasetleri döndürür. Bunlar ilk açılışta push edilmez; ilk requestten sonra izlenir."""
        keys: List[str] = []
        try:
            for item in self.parse_dataset_defs():
                if not isinstance(item, dict):
                    continue
                if not item.get("enabled", True):
                    continue
                if str(item.get("mode", "")).strip().lower() == "ondemand":
                    key = str(item.get("dataset_key", "")).strip()
                    if key:
                        keys.append(key)
        except Exception as exc:
            self.println(f"ondemand dataset listesi okunamadı: {exc}")
        return keys

    def fetch_tracked_ondemand_queries(self, dataset_keys: List[str]) -> List[Dict[str, Any]]:
        """Webde cache oluşmuş ondemand sorguları client'a bildirir; client bundan sonra bunları değişiklik için izler."""
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant or not dataset_keys:
            return []
        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {
                    "action": "ondemand_tracked_list",
                    "dataset_keys": dataset_keys,
                    "limit": 250,
                },
                client_secret=self.get_client_secret(),
                timeout=60,
            )
            if resp.get("ok"):
                items = resp.get("items", []) or []
                return [x for x in items if isinstance(x, dict)]
            self.println(f"ondemand takip listesi alınamadı: {resp}")
        except Exception as exc:
            self.println(f"ondemand takip listesi hata: {exc}")
        return []

    def _tracked_ondemand_snapshot_key(self, dataset_key: str, params: Dict[str, Any]) -> str:
        return "ondemand_track|" + dataset_run_key(dataset_key, params)

    def sync_tracked_ondemand_queries(self):
        """
        Önceden request ile web cache'e yazılmış ondemand sorguları tekrar request açmadan günceller.
        Yani ilk istek webden gelir; sonraki değişiklikleri client aynı parametrelerle arka planda takip eder.
        """
        defs = self.parse_dataset_defs()
        def_map = {str(d.get("dataset_key", "")): d for d in defs if isinstance(d, dict) and d.get("dataset_key")}
        keys = [k for k in self.ondemand_dataset_keys() if k in def_map]
        if not keys:
            return

        tracked = self.fetch_tracked_ondemand_queries(keys)
        if not tracked:
            return

        snap = load_snapshots()
        changed_any = False
        checked = 0
        pushed = 0
        now_dt = datetime.now()

        for item in tracked:
            dataset_key = str(item.get("dataset_key", "")).strip()
            params = item.get("params", {}) if isinstance(item.get("params", {}), dict) else {}
            defn = def_map.get(dataset_key)
            if not defn:
                continue

            skey = self._tracked_ondemand_snapshot_key(dataset_key, params)
            meta = snap.get(skey, {}) if isinstance(snap.get(skey, {}), dict) else {}
            last_check = str(meta.get("last_check_at", "") or "")
            if last_check:
                try:
                    last_dt = datetime.strptime(last_check, "%Y-%m-%d %H:%M:%S")
                    if now_dt < last_dt + timedelta(seconds=ONDEMAND_TRACK_REFRESH_INTERVAL_SEC):
                        continue
                except Exception:
                    pass

            checked += 1
            try:
                data = self.execute_dataset(defn, params)
                new_hash = hash_obj(data)
                server_hash = str(item.get("data_hash", "") or "")
                old_hash = str(meta.get("data_hash", "") or "")

                if new_hash != server_hash and new_hash != old_hash:
                    resp = self.push_dataset(defn, params, data)
                    if not resp.get("ok"):
                        self.println(f"ondemand güncelleme gönderilemedi: {dataset_key} -> {resp}")
                    else:
                        pushed += 1
                        row_count = normalize_row_count(data)
                        self.record_success(dataset_key, params, row_count, status="ondemand_update", note="cache takip güncellendi")
                        self.println(f"↻ Ondemand cache güncellendi: {dataset_key} ({row_count} kayıt)")
                        server_hash = new_hash

                snap[skey] = {
                    "dataset_key": dataset_key,
                    "params": params,
                    "data_hash": new_hash,
                    "server_hash": server_hash,
                    "row_count": normalize_row_count(data),
                    "last_check_at": now_str(),
                }
                changed_any = True
            except Exception as exc:
                snap[skey] = {
                    **meta,
                    "dataset_key": dataset_key,
                    "params": params,
                    "last_check_at": now_str(),
                    "last_error": str(exc),
                }
                changed_any = True
                self.println(f"ondemand takip hata: {dataset_key} -> {exc}")

        if changed_any:
            save_snapshots(snap)
        if checked:
            self.println(f"Ondemand takip tamamlandı. Kontrol={checked}, güncelleme={pushed}")

    def process_pending_requests(self):
        try:
            defs = self.parse_dataset_defs()
            def_map = {d["dataset_key"]: d for d in defs if isinstance(d, dict) and d.get("dataset_key")}
            tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
            if not tenant:
                self.println("Tenant boş, request poll atlandı.")
                return

            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "request_poll", "limit": REQUEST_POLL_LIMIT},
                client_secret=self.get_client_secret(),
                timeout=60,
            )

            if not resp.get("ok"):
                raise RuntimeError(str(resp))

            requests_list = resp.get("requests", []) or []
            if not requests_list:
                self.println("Kuyrukta iş yok.")
                return

            for req in requests_list:
                request_uid = req.get("request_uid")
                dataset_key = req.get("dataset_key")
                params = req.get("params", {}) or {}
                defn = def_map.get(dataset_key)

                if not defn:
                    self.send_request_result(request_uid, dataset_key, params, status="error", error_text="dataset_definition_not_found")
                    continue

                self.println(f"⇣ Request alındı: {dataset_key} ({request_uid})")
                try:
                    if dataset_key == "fis_gunluk_bildirim_feed":
                        self.println(f"fis_gunluk_bildirim_feed request params={json.dumps(params, ensure_ascii=False)}")
                    data = self.execute_dataset(defn, params)
                    row_count = normalize_row_count(data)
                    if dataset_key == "fis_gunluk_bildirim_feed":
                        self.println(f"fis_gunluk_bildirim_feed SQL sonucu={row_count} kayıt")
                    self.send_request_result(request_uid, dataset_key, params, status="done", data=data)
                    self.record_success(dataset_key, params, row_count, status="ondemand", note="request işlendi")
                    self.println(f"✓ Request işlendi: {dataset_key} ({row_count} kayıt)")
                except Exception as exc:
                    self.send_request_result(request_uid, dataset_key, params, status="error", error_text=str(exc))
                    self.println(f"✗ Request hata: {dataset_key} -> {exc}")

        except Exception as exc:
            self.println(f"Request poll hata: {exc}")

    def send_request_result(self, request_uid: str, dataset_key: str, params: Dict[str, Any], status: str, data: Any = None, error_text: str = ""):
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        post_json(
            self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
            tenant,
            {
                "action": "request_result_push",
                "request_uid": request_uid,
                "dataset_key": dataset_key,
                "status": status,
                "params": params,
                "data": data if data is not None else [],
                "error_text": error_text,
            },
            client_secret=self.get_client_secret(),
            timeout=300,
        )

    def _full_sync_job(self):
        self._save_conn_silent()
        self._save_settings_silent()
        self._save_datasets_silent()
        self.register_client_secret_if_needed(force=False)
        self.flush_offline_queue(show_message=False)
        self.sync_push_datasets(force=True)
        self.sync_direct_cache_ondemand_datasets()
        self.sync_current_month_extre_cache(force=True, max_per_run=PREWARM_EXTRE_MAX_PER_RUN)
        self.sync_current_month_fis_detail_cache(force=True, max_per_run=PREWARM_MONTHLY_FIS_DETAIL_MAX_PER_RUN)
        self._cleanup_logs_if_needed(7)

    def run_full_sync(self):
        self._run_background("full_sync", self._full_sync_job, use_sync_lock=True, error_title="Full Sync Hata")

    def _auto_sync_job(self):
        self.register_client_secret_if_needed(force=False)
        self.heartbeat()
        self.flush_offline_queue(show_message=False)

        # 1) Önce canlı/rapor ekranını besleyen kritik datasetler.
        priority_force_keys = self.detect_changed_dependencies(
            watch_keys=FAST_REACTIVE_WATCH_KEYS,
            only_triggers=PRIORITY_REPORT_DATASET_KEYS,
        )
        self.sync_direct_cache_ondemand_datasets(only_dataset_keys=PRIORITY_DIRECT_CACHE_KEYS)
        self.sync_push_datasets(
            force=False,
            force_dataset_keys=priority_force_keys,
            only_dataset_keys=PRIORITY_REPORT_DATASET_KEYS,
        )

        # 2) Webden gelen kullanıcı istekleri; arka plan prewarm bunların önüne geçmesin.
        self.process_pending_requests()

        # 3) Diğer büyük/master işler arka planda.
        background_force_keys = self.detect_changed_dependencies() - PRIORITY_REPORT_DATASET_KEYS
        self.sync_push_datasets(
            force=False,
            force_dataset_keys=background_force_keys,
            only_dataset_keys=BACKGROUND_PUSH_DATASET_KEYS,
        )
        self.sync_direct_cache_ondemand_datasets(only_dataset_keys=BACKGROUND_DIRECT_CACHE_KEYS)
        self.sync_tracked_ondemand_queries()
        self.sync_current_month_extre_cache(force=False, max_per_run=PREWARM_EXTRE_MAX_PER_RUN)
        self.sync_current_month_fis_detail_cache(force=False, max_per_run=PREWARM_MONTHLY_FIS_DETAIL_MAX_PER_RUN)
        self._cleanup_logs_if_needed(7)

    def _live_open_tables_job(self):
        defs = self.parse_dataset_defs()
        acik_var = any((d.get("dataset_key") == "acik_masalar" and d.get("enabled", True)) for d in defs if isinstance(d, dict))
        if not acik_var:
            self.println("Canlı açık masa sync atlandı: dataset tanımı yok veya kapalı.")
            return
        self.register_client_secret_if_needed(force=False)
        self.sync_push_datasets(force=False, force_dataset_keys=LIVE_DATASET_KEYS, only_dataset_keys=LIVE_DATASET_KEYS)
        self.sync_direct_cache_ondemand_datasets(only_dataset_keys={"acik_masa_detay"})


    def _reactive_sync_job(self):
        self.register_client_secret_if_needed(force=False)

        # Hızlı reactive tur SADECE canlı/rapor ekranını besler.
        # Lookup, stok/cari listeleri, ekstre prewarm ve aylık fiş detayları bu turda çalışmaz.
        self.sync_direct_cache_ondemand_datasets(only_dataset_keys=PRIORITY_DIRECT_CACHE_KEYS)

        self.sync_push_datasets(
            force=False,
            only_dataset_keys=FAST_REACTIVE_DATASET_KEYS,
        )

        force_dataset_keys = self.detect_changed_dependencies(
            watch_keys=FAST_REACTIVE_WATCH_KEYS,
            only_triggers=FAST_REACTIVE_DATASET_KEYS,
        )
        if force_dataset_keys:
            self.sync_push_datasets(
                force=False,
                force_dataset_keys=force_dataset_keys,
                only_dataset_keys=FAST_REACTIVE_DATASET_KEYS,
            )

    def on_reactive_tick(self):
        if self._reactive_sync_busy:
            self.println("reactive_sync: zaten çalışıyor")
            return
        self._reactive_sync_busy = True

        def worker():
            try:
                self._reactive_sync_job()
            except Exception as exc:
                self.println(f"reactive_sync hata: {exc}")
                log(traceback.format_exc())
            finally:
                self._reactive_sync_busy = False

        threading.Thread(target=worker, name="reactive_sync", daemon=True).start()

    def start_reactive_timer(self, silent: bool = False):
        self.reactive_timer.start(FAST_REACTIVE_INTERVAL_SEC * 1000)
        if not silent:
            self.println(f"Hızlı günlük veri kontrolü başladı. ({FAST_REACTIVE_INTERVAL_SEC} sn)")
        QTimer.singleShot(1200, self.on_reactive_tick)

    def stop_reactive_timer(self, silent: bool = False):
        self.reactive_timer.stop()
        if not silent:
            self.println("Hızlı günlük veri kontrolü durduruldu.")

    def on_live_tick(self):
        if self._live_sync_busy:
            self.println("live_open_tables: zaten çalışıyor")
            return
        self._live_sync_busy = True

        def worker():
            try:
                self._live_open_tables_job()
            except Exception as exc:
                self.println(f"live_open_tables hata: {exc}")
                log(traceback.format_exc())
            finally:
                self._live_sync_busy = False

        threading.Thread(target=worker, name="live_open_tables", daemon=True).start()

    def start_live_open_tables_timer(self, silent: bool = False):
        self.live_timer.start(LIVE_OPEN_TABLES_INTERVAL_SEC * 1000)
        if not silent:
            self.println(f"Canlı açık masa kontrolü başladı. ({LIVE_OPEN_TABLES_INTERVAL_SEC} sn)")
        QTimer.singleShot(1500, self.on_live_tick)

    def stop_live_open_tables_timer(self, silent: bool = False):
        self.live_timer.stop()
        if not silent:
            self.println("Canlı açık masa kontrolü durduruldu.")

    def on_request_tick(self):
        if self._request_poll_busy:
            self.println("request_poll: zaten çalışıyor")
            return
        self._request_poll_busy = True

        def worker():
            try:
                self.process_pending_requests()
            except Exception as exc:
                self.println(f"request_poll hata: {exc}")
                log(traceback.format_exc())
            finally:
                self._request_poll_busy = False

        threading.Thread(target=worker, name="request_poll_fast", daemon=True).start()

    def start_request_timer(self, silent: bool = False):
        self.request_timer.start(REQUEST_POLL_INTERVAL_SEC * 1000)
        if not silent:
            self.println(f"Ondemand request kuyruğu başladı. ({REQUEST_POLL_INTERVAL_SEC} sn)")
        QTimer.singleShot(900, self.on_request_tick)

    def stop_request_timer(self, silent: bool = False):
        self.request_timer.stop()
        if not silent:
            self.println("Ondemand request kuyruğu durduruldu.")


    def on_price_update_tick(self):
        if not self.cfg.get("price_update_enabled", True):
            return
        if self._price_update_busy:
            self.println("price_update: zaten çalışıyor")
            return
        self._price_update_busy = True

        def worker():
            try:
                self.process_pending_price_updates()
            except Exception as exc:
                self.println(f"price_update hata: {exc}")
                log(traceback.format_exc())
            finally:
                self._price_update_busy = False

        threading.Thread(target=worker, name="price_update_poll", daemon=True).start()

    def start_price_update_timer(self, silent: bool = False):
        if not self.cfg.get("price_update_enabled", True):
            return
        sec = max(10, int(self.cfg.get("price_update_interval_sec", 30) or 30))
        self.price_update_timer.start(sec * 1000)
        if not silent:
            self.println(f"Mobil fiyat güncelleme kontrolü başladı. ({sec} sn)")
        QTimer.singleShot(1800, self.on_price_update_tick)

    def stop_price_update_timer(self, silent: bool = False):
        self.price_update_timer.stop()
        if not silent:
            self.println("Mobil fiyat güncelleme kontrolü durduruldu.")

    # ─────────────── Mobil İşlem Kuyruğu (Finans/Fiş/Sayım) — 2026-07 ───────────────
    def on_islem_tick(self):
        if not self.cfg.get("islem_enabled", True):
            return
        if self._islem_busy:
            return
        self._islem_busy = True

        def worker():
            try:
                self.process_pending_islemler()
            except Exception as exc:
                self.println(f"islem hata: {exc}")
                log(traceback.format_exc())
            finally:
                self._islem_busy = False

        threading.Thread(target=worker, name="islem_poll", daemon=True).start()

    def start_islem_timer(self, silent: bool = False):
        if not self.cfg.get("islem_enabled", True):
            return
        sec = max(10, int(self.cfg.get("islem_interval_sec", 30) or 30))
        self.islem_timer.start(sec * 1000)
        if not silent:
            self.println(f"Mobil işlem kuyruğu kontrolü başladı. ({sec} sn)")
        QTimer.singleShot(2500, self.on_islem_tick)

    def stop_islem_timer(self, silent: bool = False):
        self.islem_timer.stop()
        if not silent:
            self.println("Mobil işlem kuyruğu kontrolü durduruldu.")

    def _price_update_post(self, payload: Dict[str, Any], timeout: int = 60) -> Dict[str, Any]:
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            raise RuntimeError("Tenant boş.")
        server_url = self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL)
        return post_json(server_url, tenant, payload, client_secret=self.get_client_secret(), timeout=timeout)

    def _as_int_or_none(self, value: Any) -> Optional[int]:
        if value is None:
            return None
        s = str(value).strip()
        if s == "":
            return None
        try:
            return int(float(s))
        except Exception:
            return None

    def _price_float(self, value: Any) -> float:
        if value is None or str(value).strip() == "":
            raise RuntimeError("Yeni fiyat boş.")
        return float(str(value).replace(",", "."))

    def _exec_sequence_change(self, cur, kod_pc: int, seq_id: int, kullanici: int, islem: int, tablo: str):
        cur.execute(
            "EXEC SEQUNCES_DEGISIKLIK_AD @KOD_PC=?, @SEQUNCES=?, @KULLANICI=?, @ISLEM=?, @TABLO=?",
            kod_pc,
            seq_id,
            kullanici,
            islem,
            tablo,
        )
        while True:
            try:
                if not cur.nextset():
                    break
            except Exception:
                break

    def _erp_next_sequence_id(self, cur, tablo: str, kod_pc: int) -> int:
        """
        ERP12 yeni ID alma. SEQUENS_VER bazı kurulumlarda resultset/scalar döndürebiliyor.
        Dönen ilk sayısal değeri yakalıyoruz. Dönmezse güvenli olması için hata veriyoruz;
        MAX(ID)+1 gibi riskli tahmin yapmıyoruz.
        """
        cur.execute("EXEC SEQUENS_VER @TABLO=?, @KOD_PC=?", tablo, kod_pc)
        found = None
        while True:
            if cur.description:
                rows = cur.fetchall()
                for row in rows:
                    for val in row:
                        try:
                            iv = int(val)
                            if iv > 0:
                                found = iv
                                break
                        except Exception:
                            continue
                    if found:
                        break
            if found:
                break
            try:
                if not cur.nextset():
                    break
            except Exception:
                break
        if not found:
            raise RuntimeError("SEQUENS_VER yeni ID döndürmedi. Procedure output yapısı kontrol edilmeli.")
        return int(found)

    def apply_single_price_update_to_erp(self, conn, item: Dict[str, Any], kod_pc: int, kullanici: int) -> Dict[str, Any]:
        pending_id = self._as_int_or_none(item.get("id"))
        stok_id = self._as_int_or_none(item.get("product_id"))
        source_price_id = self._as_int_or_none(item.get("stok_stok_birim_id"))
        price_name_id = self._as_int_or_none(item.get("price_name_id"))
        new_price = self._price_float(item.get("new_price"))

        if pending_id is None:
            raise RuntimeError("Pending ID boş.")
        if stok_id is None:
            raise RuntimeError("product_id / STOK.ID boş.")
        if source_price_id is None:
            raise RuntimeError("stok_stok_birim_id / STOK_STOK_BIRIM_FIYAT.ID boş.")
        if price_name_id is None:
            raise RuntimeError("price_name_id boş. Fiyat adı olmadan bu ERP şemasında güvenli işlem yapılamaz.")
        if kod_pc <= 0 or kullanici <= 0:
            raise RuntimeError("Fiyat güncelleme için KOD_PC ve KULLANICI ayarları girilmeli.")

        cur = conn.cursor()
        try:
            # Gelen ID bazen hedef fiyat satırı, bazen de aynı ürün/birim için var olan başka fiyat adının satırıdır.
            cur.execute(
                """
                SELECT TOP 1 ID, STOK_STOK_BIRIM, DOVIZ_AD, KDV_DAHILMI
                  FROM STOK_STOK_BIRIM_FIYAT WITH (UPDLOCK, HOLDLOCK)
                 WHERE ID = ?
                """,
                source_price_id,
            )
            base = cur.fetchone()
            if not base:
                raise RuntimeError(f"Kaynak fiyat satırı bulunamadı: STOK_STOK_BIRIM_FIYAT.ID={source_price_id}")

            stok_stok_birim = int(base.STOK_STOK_BIRIM)
            doviz_ad = int(base.DOVIZ_AD or 1)
            kdv_dahilmi = str(base.KDV_DAHILMI or "1")

            cur.execute(
                """
                SELECT TOP 1 ID
                  FROM STOK_STOK_BIRIM_FIYAT WITH (UPDLOCK, HOLDLOCK)
                 WHERE STOK_STOK_BIRIM = ? AND STOK_FIYAT_AD = ?
                 ORDER BY ID
                """,
                stok_stok_birim,
                price_name_id,
            )
            target = cur.fetchone()

            if target:
                target_price_id = int(target.ID)
                cur.execute(
                    """
                    UPDATE STOK_STOK_BIRIM_FIYAT
                       SET STOK_FIYAT_AD = ?,
                           FIYAT = ?,
                           STOK_STOK_BIRIM = ?,
                           KDV_DAHILMI = ?,
                           DOVIZ_AD = ?
                     WHERE ID = ?
                    """,
                    price_name_id,
                    new_price,
                    stok_stok_birim,
                    kdv_dahilmi,
                    doviz_ad,
                    target_price_id,
                )
                # pyodbc/SQL Server tarafında cur.rowcount; trigger, procedure veya NOCOUNT etkisiyle
                # 0 / -1 dönebilir. Bu yüzden başarıyı rowcount ile değil, gerçek satırı
                # tekrar okuyarak doğruluyoruz.
                cur.execute(
                    """
                    SELECT TOP 1 ID, FIYAT, STOK_STOK_BIRIM, STOK_FIYAT_AD
                      FROM STOK_STOK_BIRIM_FIYAT
                     WHERE ID = ?
                    """,
                    target_price_id,
                )
                verify = cur.fetchone()
                if not verify:
                    raise RuntimeError(f"Fiyat satırı doğrulanamadı: ID={target_price_id}")

                self._exec_sequence_change(cur, kod_pc, target_price_id, kullanici, 2, "STOK_STOK_BIRIM_FIYAT")
                return {"pending_id": pending_id, "mode": "update", "price_row_id": target_price_id}

            new_price_id = self._erp_next_sequence_id(cur, "STOK_STOK_BIRIM_FIYAT", kod_pc)
            cur.execute(
                """
                INSERT INTO STOK_STOK_BIRIM_FIYAT
                    (ID, STOK_STOK_BIRIM, DOVIZ_AD, STOK_FIYAT_AD, FIYAT, KDV_DAHILMI)
                VALUES
                    (?, ?, ?, ?, ?, ?)
                """,
                new_price_id,
                stok_stok_birim,
                doviz_ad,
                price_name_id,
                new_price,
                kdv_dahilmi,
            )
            # INSERT sonrası da rowcount güvenilir olmayabilir. Yeni satırı gerçek SELECT ile
            # doğruluyoruz; satır varsa işlem başarılıdır.
            cur.execute(
                """
                SELECT TOP 1 ID, FIYAT, STOK_STOK_BIRIM, STOK_FIYAT_AD
                  FROM STOK_STOK_BIRIM_FIYAT
                 WHERE ID = ?
                """,
                new_price_id,
            )
            inserted = cur.fetchone()
            if not inserted:
                raise RuntimeError(f"Yeni fiyat satırı doğrulanamadı: ID={new_price_id}")

            self._exec_sequence_change(cur, kod_pc, new_price_id, kullanici, 1, "STOK_STOK_BIRIM_FIYAT")
            return {"pending_id": pending_id, "mode": "insert", "price_row_id": new_price_id}
        except Exception:
            raise

    def process_pending_price_updates(self):
        if not self.cfg.get("price_update_enabled", True):
            return
        resp = self._price_update_post({"action": "price_update_poll", "limit": 200}, timeout=60)
        items = resp.get("items", []) if isinstance(resp, dict) else []
        if not items:
            return

        kod_pc = int(self.cfg.get("price_update_kod_pc", 0) or 0)
        kullanici = int(self.cfg.get("price_update_kullanici", 0) or 0)
        self.println(f"price_update: {len(items)} bekleyen kayıt alındı.")

        success_ids: List[int] = []
        failed: List[Dict[str, Any]] = []
        conn = self.get_connection()
        try:
            for item in items:
                pending_id = self._as_int_or_none(item.get("id"))
                try:
                    result = self.apply_single_price_update_to_erp(conn, item, kod_pc, kullanici)
                    conn.commit()
                    success_ids.append(int(result["pending_id"]))
                    self.println(
                        f"price_update OK: pending={result['pending_id']} mode={result['mode']} fiyat_id={result['price_row_id']}"
                    )
                except Exception as exc:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    msg = str(exc)[:480]
                    if pending_id is not None:
                        failed.append({"id": pending_id, "error_message": msg})
                    self.println(f"price_update HATA: pending={pending_id} -> {msg}")
        finally:
            conn.close()

        if success_ids:
            self._price_update_post({"action": "price_update_mark_applied_bulk", "ids": success_ids}, timeout=60)
            self.println(f"price_update: {len(success_ids)} kayıt applied bildirildi.")

        for row in failed:
            self._price_update_post(
                {"action": "price_update_mark_applied", "id": row["id"], "error_message": row["error_message"]},
                timeout=60,
            )
        if failed:
            self.println(f"price_update: {len(failed)} kayıt failed bildirildi.")


    # ─────────────── Mobil İşlem Kuyruğu — ERP12 aktarım metotları ───────────────
    def process_pending_islemler(self):
        resp = self._price_update_post({"action": "islem_poll", "limit": 50}, timeout=60)
        items = resp.get("items", []) if isinstance(resp, dict) else []
        if not items:
            return
        kod_pc = int(self.cfg.get("islem_kod_pc", 0) or self.cfg.get("price_update_kod_pc", 0) or 0)
        kullanici = int(self.cfg.get("islem_kullanici", 0) or self.cfg.get("price_update_kullanici", 0) or 0)
        proje = int(self.cfg.get("islem_proje", 0) or 0)
        lokasyon = int(self.cfg.get("islem_lokasyon", 0) or 0)
        if kod_pc <= 0 or kullanici <= 0:
            self.println("islem: KOD_PC / KULLANICI ayarları girilmeli (price_update ayarları da kullanılır)!")
            return
        izinli = {
            "finans": bool(self.cfg.get("islem_finans_enabled", False)),
            "fis": bool(self.cfg.get("islem_fis_enabled", False)),
            "sayim": bool(self.cfg.get("islem_sayim_enabled", False)),
        }
        items = [it for it in items if izinli.get(str(it.get("islem_grubu") or "finans"), False)]
        if not items:
            return
        self.println(f"islem: {len(items)} yetkili bekleyen kayıt işlenecek.")

        conn = self.get_connection()
        try:
            for item in items:
                qid = int(item.get("id") or 0)
                try:
                    # MÜKERRER ÖNLEME: EXTERNAL_ID = kuyruk id'si daha önce yazılmış mı?
                    cur = conn.cursor()
                    cur.execute("SELECT TOP 1 ID FROM FINANS_DETAY WHERE EXTERNAL_ID = ?", qid)
                    row = cur.fetchone()
                    if row:
                        conn.commit()
                        self._price_update_post({"action": "islem_mark", "id": qid,
                                                 "erp_id": int(row[0])}, timeout=30)
                        self.println(f"islem SKIP (zaten aktarılmış): queue={qid}")
                        continue

                    grubu = str(item.get("islem_grubu") or "finans")
                    if grubu == "finans":
                        erp_id = self.apply_finans_islem_to_erp(conn, item, kod_pc, kullanici, proje, lokasyon)
                    elif grubu == "fis":
                        erp_id = self.apply_fis_islem_to_erp(conn, item, kod_pc, kullanici, proje, lokasyon)
                    elif grubu == "sayim":
                        erp_id = self.apply_sayim_islem_to_erp(conn, item, kod_pc, kullanici, proje, lokasyon)
                    else:
                        raise RuntimeError(f"Bilinmeyen islem_grubu: {grubu}")
                    conn.commit()
                    self._price_update_post({"action": "islem_mark", "id": qid, "erp_id": erp_id}, timeout=30)
                    self.println(f"islem OK: queue={qid} grubu={grubu} erp_id={erp_id}")
                except Exception as exc:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    msg = str(exc)[:480]
                    self._price_update_post({"action": "islem_mark", "id": qid,
                                             "error_message": msg}, timeout=30)
                    self.println(f"islem HATA: queue={qid} -> {msg}")
        finally:
            conn.close()

    def apply_finans_islem_to_erp(self, conn, item: Dict[str, Any], kod_pc: int,
                                  kullanici: int, proje: int, lokasyon: int) -> int:
        """Tahsilat/Ödeme/Çek/Senet -> FINANS + FINANS_DETAY."""
        qid = int(item["id"])
        tur = int(item["islem_turu"])
        tutar = float(item["tutar"] or 0)
        borclu = int(item["kart_borclu"] or 0)
        alacakli = int(item["kart_alacakli"] or 0)
        aciklama = str(item.get("aciklama") or "")
        vade = item.get("vade_tarihi") or None  # 'YYYY-MM-DD' | None

        cur = conn.cursor()
        finans_id = self._erp_next_sequence_id(cur, "FINANS", kod_pc)
        belgeno = f"MBL-{qid:010d}"
        # KASA_AD = kasa/banka tarafındaki kart. Borçlu=KASA olan türler:
        # 1 Nakit Tahsilat, 7 Havale Alma, 15 Pos Tahsilat, 21 Çek Girişi, 35 Senet Girişi
        KASA_BORCLU_TURLER = {1, 7, 15, 21, 35}
        kasa_ad = borclu if tur in KASA_BORCLU_TURLER else alacakli
        cur.execute(
            "INSERT INTO FINANS(PROJE,BELGENO,TARIH,LOKASYON,KASA_AD,ID) VALUES (?,?,GETDATE(),?,?,?)",
            proje, belgeno, lokasyon, kasa_ad, finans_id,
        )
        cur.execute("SELECT TOP 1 ID FROM FINANS WHERE ID = ?", finans_id)
        if not cur.fetchone():
            raise RuntimeError(f"FINANS satırı doğrulanamadı: ID={finans_id}")
        self._exec_sequence_change(cur, kod_pc, finans_id, kullanici, 1, "FINANS")

        detay_id = self._erp_next_sequence_id(cur, "FINANS_DETAY", kod_pc)
        cur.execute(
            """INSERT INTO FINANS_DETAY(
                 SECIM,FINANS_ISLEM_TURU,CARI_ADRES,DOVIZ_AD,ID,ACIKLAMA,KUR,FK_PROJE,
                 YENIDEN_TAKSIT,KART_ALACAKLI,KART_BORCLU,EXTERNAL_ID,FINANS,
                 FK_FINANS_ACIKLAMA,VADE_TARIHI,BELGENO,FIS,TAKSIT_SAYISI,FK_PERSONEL,
                 MUHASEBELESTI,TUTAR,TAKSIT_FISI,TAHSILID,BANKA_POS_TAKSIT)
               VALUES (0,?,0,1,?,?,1,?,0,?,?,?,?,0,
                       COALESCE(?, GETDATE()),?,0,1,?,'0',?,0,0,0)""",
            tur, detay_id, aciklama, proje,
            alacakli, borclu, qid, finans_id,
            vade, belgeno, kullanici, tutar,
        )
        self._exec_sequence_change(cur, kod_pc, detay_id, kullanici, 1, "FINANS_DETAY")
        return finans_id

    def apply_fis_islem_to_erp(self, conn, item: Dict[str, Any], kod_pc: int,
                               kullanici: int, proje: int, lokasyon: int) -> int:
        """Fatura/Fiş girişi -> FIS + FIS_DETAY (+ nakit/kart ödemede FINANS kaydı).
        detay_json: {odeme_tipi, kasa_id, satirlar:[{stok_id,barkod,kod,ad,miktar,fiyat}], geneltoplam}"""
        qid = int(item["id"])
        detay = json.loads(item.get("detay_json") or "{}")
        satirlar = detay.get("satirlar") or []
        if not satirlar:
            raise RuntimeError("detay_json.satirlar boş")
        geneltoplam = float(detay.get("geneltoplam") or item.get("tutar") or 0)
        cari = int(item.get("kart_borclu") or item.get("kart_alacakli") or 0)
        islem_turu = int(item["islem_turu"])  # 47/45/71/69
        # FIS_TURU eşleme (örneğinizde satış faturası FIS_TURU=2 idi) — DOĞRULAYIN:
        fis_turu_map = {47: 2, 45: 1, 71: 4, 69: 3}
        fis_turu = fis_turu_map.get(islem_turu, 2)

        cur = conn.cursor()
        fis_id = self._erp_next_sequence_id(cur, "FIS", kod_pc)
        belgeno = f"MBL-{qid:08d}"
        cur.execute(
            """INSERT INTO FIS(ID,FIS_TURU,LOKASYON,CARI,CARI_ADRES,GONDERIM_ADRESI,PROJE,BELGENO,
                 FIS_TARIHI,SEVK_TARIHI,DOVIZ_AD,DOVIZ_KUR,CARI_PERSONEL,SATIR_TOPLAM,
                 SATIR_ISKONTO_TOPLAM,FIS_ISKONTO_ORAN,FIS_ISKONTO_TOPLAM,YUVARLAMA,KDV_TOPLAM,
                 OTV_TOPLAM,TEFKIFAT_TOPLAM,GENELTOPLAM,VADE,VADE_SECENEKLERI,ACIKLAMA,
                 FIS_CARIYI_ETKILERMI,CARI_DOVIZ_AD,CARI_DOVIZ_KUR,CARI_TAKIP_SEKLI,
                 E_FATURA_GIDIS_KODU,SEVKIYAT_YAPILSIN,FIS_SEZON,FIS_BASIM_TIPI,KARGO_CARISI,
                 INTERNET_ODEME_SEKLI,INTERNET_ODEME_ACIKLAMASI,ONAY_BEKLIYOR,BAGKUR_ORAN,
                 BAGKUR_TUTAR,STOPAJ_ORAN,STOPAJ_TUTAR,BORSA_ORAN,BORSA_TUTAR,MERA_ORAN,MERA_TUTAR,
                 TEVKIF,FIS_OZEL_KOD_1,FIS_OZEL_KOD_2,FIS_OZEL_KOD_3,FIS_OZEL_KOD_4,FIS_OZEL_KOD_5,
                 BELGE_YETKILISI,NAKLIYE_ODEME_TIPI,SEVK_SEKLI,ARTTIRIM,IHRACAT_GONDERIM_SEKLI,
                 IHRACAT_TESLIM_SEKLI,VERGI_MUAFIYET_KODU,DOVIZ_KUR_SECIMI,FIS_ODEME_TIPI_ISKONTOLARI,
                 FIS_STOK_HAREKETLERINI_ETKILER,FIS_ALT_TIPI,SEVK_PERSONEL_AD,SEVK_PERSONEL_TCKN,
                 SEVK_ARAC_PLAKA,SEVK_DORSE_PLAKA,SGK_DOSYA_NO,SGK_DONEM_BASLANGIC,SGK_DONEM_BITIS,
                 MUHASEBELESTI,PAREKENDE_KDV_KULLAN,SATILDIGI_PAZAR_YERI,ODEMEMNIN_YAPILDIGI_TARIH,
                 GONDERIM_TARIHI,SEVK_NEDENI,ASIL_SATICI_CARISI,HAREKET_TARIHI,SATIR_STOPAJ_TOPLAM,
                 ALIS_BELGE_NO,ALIS_BELGE_NO_2,ALIS_BELGE_NO_3,ALIS_BELGE_NO_4,ALIS_BELGE_NO_5,E_FATURA_TIPI)
               VALUES (?,?,?,?,0,0,?,?,GETDATE(),GETDATE(),1,1.00,?,?,0,'',0,0,?,0,0,?,GETDATE(),17,?,
                       '1',1,1.00,1,'','0',0,0,0,0,'','0',0,0,0,0,0,0,0,0,'0',0,0,0,0,0,0,0,0,0,0,0,0,2,1,
                       '1',1,'','','','','',GETDATE(),GETDATE(),'0','0','',GETDATE(),GETDATE(),0,0,GETDATE(),0,
                       '','','','','',0)""",
            fis_id, fis_turu, lokasyon, cari, proje, belgeno, kullanici,
            geneltoplam, 0, geneltoplam, str(item.get("aciklama") or ""),
        )
        cur.execute("SELECT TOP 1 ID FROM FIS WHERE ID = ?", fis_id)
        if not cur.fetchone():
            raise RuntimeError(f"FIS satırı doğrulanamadı: ID={fis_id}")
        self._exec_sequence_change(cur, kod_pc, fis_id, kullanici, 1, "FIS")

        for i, s in enumerate(satirlar):
            d_id = self._erp_next_sequence_id(cur, "FIS_DETAY", kod_pc)
            miktar = float(s.get("miktar") or 0)
            dahil_fiyat = float(s.get("fiyat") or 0)
            dahil_tutar = round(miktar * dahil_fiyat, 2)
            cur.execute(
                """INSERT INTO FIS_DETAY(ID,FIS,LOKASYON,STOK,STOK_CINSI,STOK_BIRIM,BARKOD,KOLI_BARKODU,
                     DOVIZ_AD,CARPAN,KAB,MIKTAR_FIS,MIKTAR_BEDELSIZ,MIKTAR_GIRIS,MIKTAR_CIKIS,ANLASMA_FIYAT,
                     FIYAT,DAHIL_FIYAT,TUTAR,DAHIL_TUTAR,ISKONTO,ISKONTO_HESAP,OTV_ORAN,OTV_TUTAR,KDV_TOPTAN,
                     TEVKIF,KUR,PUAN,FIYAT_FARKI,SERINO_ZORUNLU,FK_PERSONEL,SATIR,YEREL_KARSI_FIYAT,
                     BELGE_TARIHINDEKI_SON_ALIS_FIYATI,HK_MIKTAR_FIS,FATRALANDIRILMIS_IRSALIYEMI,URETILENMI,
                     FK_VERGI_MUAFIYET_KODU,TOPLAM_SATIR_ISKONTOSU,TOPLAM_FIS_ISKONTOSU,TOPLAM_OTV,
                     TOPLAM_KDV_MATRAHI,TOPLAM_KDV,TOPLAM_TEVKIF,HESAPLANAN_FIYAT,PRIM,FIS_DETAY_SATIR_TURU,
                     LISTE_FIYATI,RECETE_MALIYET_ORANI,RECETE,PARTINO,PARTINO_ZORUNLU,YEREL_FIYAT,ISLENDI,
                     ACIKLAMA,KOD,JOKER,BAGLI_SATIR,MASA,AMBALAJ_BIRIM,AMBALAJ_MIKTAR,AMBALAJ_CARPAN,GTIPNO,
                     POS_PROMASYON,POS_PROMASYON_TOPLAM,FK_STOK_TEVKIF_LESTE,LOKASYON_MALIYETI,
                     MALIYET_ELLE_GIRILDI,ALT_BIRIM_MIKTARI,UTS,ANLASMA_DETAY_ID,STOK_FIYAT_AD,BURUT,FIRE,
                     FIYAT_MANUEL_GIRILDI,FK_IHRACAT_KAB_CINSI,IHRACAT_KAB_NO,IHRACAT_KAB_ADET,SATICIKODU,
                     PARTI_NO_SON_KULLANMA_TARIHI,BUNDLE_DETAY,FK_GIDER_YERI,KT_BUNDLE_FIYAT,
                     SATIR_STOPAJ_TUTAR,URETIM_TARIHI,FK_E_FATURA_SATIR_TIPI)
                   VALUES (?,?,?,?,1,1012,?,'',1,1.0,0,?,0,?,?,0,
                     ?,?,?,?,'',0,0,0,1.00,0,1,0,0,'0',?,?,0,0,'','0',0,0,0,0,0,
                     ?,0,0,?,0,0,?,0,0,'','0',?,'0','',?,'',0,0,0,1.0,1,'',0,0,0,0,'0',1,'',0,1016,0,0,'0',
                     0,0,0,'',GETDATE(),0,0,0,0,GETDATE(),0)""",
                d_id, fis_id, lokasyon, int(s.get("stok_id") or 0),
                str(s.get("barkod") or ""),
                miktar,
                miktar if fis_turu in (1, 3) else 0,          # alışta MIKTAR_GIRIS
                miktar if fis_turu in (2, 4) else 0,          # satışta MIKTAR_CIKIS
                dahil_fiyat, dahil_fiyat, dahil_tutar, dahil_tutar,
                kullanici, i,
                dahil_tutar,      # TOPLAM_KDV_MATRAHI (yaklaşık — ERP yeniden hesaplar)
                dahil_fiyat,      # HESAPLANAN_FIYAT
                dahil_fiyat,      # LISTE_FIYATI
                dahil_fiyat,      # YEREL_FIYAT
                str(s.get("kod") or ""),
            )
            self._exec_sequence_change(cur, kod_pc, d_id, kullanici, 1, "FIS_DETAY")

        # Nakit/Kart ödeme -> FIS bağlantılı FINANS kaydı
        odeme = str(detay.get("odeme_tipi") or "acik_hesap")
        if odeme in ("nakit", "kart") and detay.get("kasa_id"):
            f_id = self._erp_next_sequence_id(cur, "FINANS", kod_pc)
            cur.execute(
                "INSERT INTO FINANS(PROJE,BELGENO,TARIH,LOKASYON,FIS,KASA_AD,ID) VALUES (?,?,GETDATE(),?,?,?,?)",
                proje, belgeno, lokasyon, fis_id, int(detay["kasa_id"]), f_id,
            )
            self._exec_sequence_change(cur, kod_pc, f_id, kullanici, 1, "FINANS")
            fd_id = self._erp_next_sequence_id(cur, "FINANS_DETAY", kod_pc)
            cur.execute(
                """INSERT INTO FINANS_DETAY(ISLEM_TARIHI,ID,FINANS,KART_ALACAKLI,DOVIZ_AD,FIS,FK_PERSONEL,
                     TUTAR,ACIKLAMA,VADE_TARIHI,CARI_ADRES,KUR,KART_BORCLU,FINANS_ISLEM_TURU,SECIM,EXTERNAL_ID)
                   VALUES (GETDATE(),?,?,?,1,?,?,?,?,GETDATE(),0,1,?,?,0,?)""",
                fd_id, f_id, fis_id, fis_id, kullanici,
                geneltoplam, "", cari, islem_turu, qid,
            )
            self._exec_sequence_change(cur, kod_pc, fd_id, kullanici, 1, "FINANS_DETAY")
        return fis_id

    def apply_sayim_islem_to_erp(self, conn, item: Dict[str, Any], kod_pc: int,
                                 kullanici: int, proje: int, lokasyon: int) -> int:
        """Sayım fişi -> SAYIM + SAYIM_DETAY (2026-07-30 Profiler dökümüyle birebir).
        detay_json: {lokasyon, satirlar:[{stok_id,barkod,kod,ad,miktar}], toplam_kalem, toplam_miktar}"""
        qid = int(item["id"])
        detay = json.loads(item.get("detay_json") or "{}")
        satirlar = detay.get("satirlar") or []
        if not satirlar:
            raise RuntimeError("detay_json.satirlar boş")
        aciklama = str(item.get("aciklama") or "")

        cur = conn.cursor()
        sayim_id = self._erp_next_sequence_id(cur, "SAYIM", kod_pc)
        cur.execute(
            "INSERT INTO SAYIM(FIS,LOKASYON,TARIH,ID,ACIKLAMA) VALUES (?,?,GETDATE(),?,?)",
            0, lokasyon, sayim_id, aciklama,
        )
        cur.execute("SELECT TOP 1 ID FROM SAYIM WHERE ID = ?", sayim_id)
        if not cur.fetchone():
            raise RuntimeError(f"SAYIM satırı doğrulanamadı: ID={sayim_id}")
        self._exec_sequence_change(cur, kod_pc, sayim_id, kullanici, 1, "SAYIM")

        for s in satirlar:
            d_id = self._erp_next_sequence_id(cur, "SAYIM_DETAY", kod_pc)
            miktar = float(s.get("miktar") or 0)
            cur.execute(
                """INSERT INTO SAYIM_DETAY(CARPAN,SERINO_ZORUNLU,BARKOD,ID,SERI_NO,MIKTAR,PARTINO,
                     STOK_BIRIM,KOD,ACIKLAMA,HK_MIKTAR_FIS,TARIH,KAB,PARTINO_ZORUNLU,STOK,SAYIM,KOLI_BARKODU)
                   VALUES (1.00000000,'0',?,?,'',?,'',1012,?,'','',GETDATE(),0,'0',?,?,'')""",
                str(s.get("barkod") or ""), d_id, miktar,
                str(s.get("kod") or ""), int(s.get("stok_id") or 0), sayim_id,
            )
            self._exec_sequence_change(cur, kod_pc, d_id, kullanici, 1, "SAYIM_DETAY")
        return sayim_id


    # ─────────────── Geçmiş Veri Basma (Backfill) ───────────────
    def on_backfill_clicked(self):
        if self._backfill_busy:
            QMessageBox.information(self, "Backfill", "Backfill zaten çalışıyor.")
            return
        d1 = self.dt_backfill_start.date().toPython()
        d2 = self.dt_backfill_end.date().toPython()
        if d1 > d2:
            d1, d2 = d2, d1
        gun_sayisi = (d2 - d1).days + 1
        if gun_sayisi > 366:
            QMessageBox.warning(self, "Backfill", "En fazla 366 günlük aralık seçin.")
            return
        defs = {str(d.get("dataset_key")): d for d in (self.cfg.get("dataset_definitions") or [])}
        hedef_adlari = [k for k in BACKFILL_DATASET_KEYS if k in defs and defs[k].get("enabled", True)]
        if QMessageBox.question(
            self, "Geçmiş Veri Basma",
            f"{d1} → {d2} ({gun_sayisi} gün) aralığındaki günlük raporlar ERP'den okunup sunucuya basılacak.\n"
            f"Datasetler ({len(hedef_adlari)}): {', '.join(hedef_adlari)}\n\n"
            f"Sunucu her günü ayrı saklar; bugünün verisi ETKİLENMEZ. Başlatılsın mı?",
        ) != QMessageBox.Yes:
            return
        self._backfill_busy = True
        self._backfill_cancel = False
        threading.Thread(target=self._run_backfill_job, args=(d1, d2), name="backfill", daemon=True).start()

    def on_backfill_cancel(self):
        if self._backfill_busy:
            self._backfill_cancel = True
            self.println("backfill: durdurma istendi — mevcut işlem bitince duracak.")
        else:
            self.println("backfill: çalışan işlem yok.")

    def _run_backfill_job(self, d1, d2):
        try:
            defs = {str(d.get("dataset_key")): d for d in (self.cfg.get("dataset_definitions") or [])}
            hedefler = [defs[k] for k in BACKFILL_DATASET_KEYS if k in defs and defs[k].get("enabled", True)]
            if not hedefler:
                self.println("backfill: uygun dataset bulunamadı.")
                return
            toplam_gun = (d2 - d1).days + 1
            self.println(f"backfill BAŞLADI: {d1} → {d2} ({toplam_gun} gün × {len(hedefler)} dataset)")
            ok = 0
            hata = 0
            islenen = 0
            gun = d2  # en yeni günden geriye doğru
            while gun >= d1:
                if self._backfill_cancel:
                    self.println("backfill: kullanıcı durdurdu.")
                    break
                day_dt = datetime(gun.year, gun.month, gun.day)
                for defn in hedefler:
                    if self._backfill_cancel:
                        break
                    key = str(defn.get("dataset_key"))
                    try:
                        params = resolve_params_for_day(defn.get("params_template", {}), day_dt)
                        rows = self.execute_dataset(defn, params)
                        say = len(rows) if isinstance(rows, list) else 1
                        self.push_dataset(defn, params, rows)
                        ok += 1
                        self.println(f"backfill {gun} {key}: {say} satır ✓")
                    except Exception as exc:
                        hata += 1
                        self.println(f"backfill {gun} {key} HATA: {str(exc)[:200]}")
                    time.sleep(0.15)
                islenen += 1
                gun = gun - timedelta(days=1)
            self.println(f"backfill BİTTİ: {islenen}/{toplam_gun} gün işlendi, {ok} başarılı push, {hata} hata.")
        except Exception as exc:
            self.println(f"backfill genel hata: {exc}")
            log(traceback.format_exc())
        finally:
            self._backfill_busy = False
            self._backfill_cancel = False

    def on_tick(self):
        self._run_background("auto_sync", self._auto_sync_job, use_sync_lock=True, error_title="")

    def start_auto_sync(self):
        self._save_conn_silent()
        self._save_settings_silent()
        self._save_datasets_silent()
        sec = max(10, int(self.cfg.get("interval_seconds", 30)))
        self.timer.start(sec * 1000)
        self.start_live_open_tables_timer(silent=True)
        self.start_reactive_timer(silent=True)
        self.start_request_timer(silent=True)
        self.start_price_update_timer(silent=True)
        self.start_islem_timer(silent=True)
        self.push_islem_yetkileri(silent=True)
        self.println(f"Otomatik senkron başladı. ({sec} sn)")
        self.println(f"Açık masalar canlı izleniyor. ({LIVE_OPEN_TABLES_INTERVAL_SEC} sn)")
        self.cfg["auto_sync_enabled"] = True
        save_cfg(self.cfg)
        QTimer.singleShot(1000, self.on_tick)

    def start_auto_sync_silent(self):
        sec = max(10, int(self.cfg.get("interval_seconds", 30)))
        self.timer.start(sec * 1000)
        self.start_live_open_tables_timer(silent=True)
        self.start_reactive_timer(silent=True)
        self.start_request_timer(silent=True)
        self.start_price_update_timer(silent=True)
        self.start_islem_timer(silent=True)
        self.push_islem_yetkileri(silent=True)
        self.println(f"Autorun auto sync başladı. ({sec} sn)")
        self.println(f"Autorun açık masa canlı izlemesi başladı. ({LIVE_OPEN_TABLES_INTERVAL_SEC} sn)")
        QTimer.singleShot(1000, self.on_tick)

    def stop_auto_sync(self):
        self.timer.stop()
        self.stop_live_open_tables_timer(silent=True)
        self.stop_reactive_timer(silent=True)
        self.stop_request_timer(silent=True)
        self.stop_price_update_timer(silent=True)
        self.stop_islem_timer(silent=True)
        self.cfg["auto_sync_enabled"] = False
        save_cfg(self.cfg)
        self.println("Otomatik senkron durduruldu.")

    def on_tenant_wipe(self):
        if QMessageBox.question(self, "Onay", "Sunucudaki bu tenant verileri silinsin mi?") != QMessageBox.Yes:
            return
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        try:
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "dataset_wipe"},
                client_secret=self.get_client_secret(),
                timeout=120,
            )
            self.println(f"Tenant wipe: {resp}")
        except Exception as exc:
            self.println(f"Tenant wipe hata: {exc}")
            QMessageBox.critical(self, "Hata", str(exc))

    def refresh_manual_dataset_combo(self):
        if not hasattr(self, "cmb_manual_dataset"):
            return
        current = self.cmb_manual_dataset.currentText() if self.cmb_manual_dataset.count() else ""
        self.cmb_manual_dataset.clear()
        try:
            defs = self.parse_dataset_defs()
        except Exception:
            defs = []
        for d in defs:
            if isinstance(d, dict) and d.get("enabled", True) and d.get("dataset_key"):
                self.cmb_manual_dataset.addItem(d["dataset_key"])
        if current:
            idx = self.cmb_manual_dataset.findText(current)
            if idx >= 0:
                self.cmb_manual_dataset.setCurrentIndex(idx)

    def render_success_state(self):
        if threading.current_thread() is not threading.main_thread():
            self.refresh_success_signal.emit()
            return
        if not hasattr(self, "txt_success"):
            return
        items = load_success_state()
        lines = []
        for item in items[:50]:
            lines.append(
                f"[{item.get('time','')}] {item.get('dataset_key','')} | kayıt={item.get('row_count',0)} | durum={item.get('status','ok')} | {item.get('note','')}"
            )
        self.txt_success.setPlainText("\n".join(lines))

    def record_success(self, dataset_key: str, params: Dict[str, Any], row_count: int, status: str = "ok", note: str = ""):
        items = load_success_state()
        items.insert(0, {
            "time": now_str(),
            "dataset_key": dataset_key,
            "params": params,
            "row_count": row_count,
            "status": status,
            "note": note,
        })
        save_success_state(items[:200])
        self.refresh_success_signal.emit()

    def queue_offline_payload(self, payload: Dict[str, Any]):
        items = load_offline_queue()
        action = str(payload.get("action", "")).strip()
        dataset_key = str(payload.get("dataset_key", "")).strip()
        params = payload.get("params", {}) if isinstance(payload.get("params", {}), dict) else {}
        replace_existing = action in {"dataset_push", "request_result_push"} and dataset_key != ""

        if replace_existing:
            payload_key = f"{action}|{dataset_key}|{hash_obj(params)}"
            replaced = False
            for item in items:
                existing_payload = item.get("payload", {}) if isinstance(item, dict) else {}
                existing_action = str(existing_payload.get("action", "")).strip()
                existing_dataset_key = str(existing_payload.get("dataset_key", "")).strip()
                existing_params = existing_payload.get("params", {}) if isinstance(existing_payload.get("params", {}), dict) else {}
                existing_key = f"{existing_action}|{existing_dataset_key}|{hash_obj(existing_params)}"
                if existing_key == payload_key:
                    item["queued_at"] = now_str()
                    item["payload"] = payload
                    replaced = True
                    break
            if replaced:
                save_offline_queue(items)
                return

        items.append({
            "queued_at": now_str(),
            "payload": payload,
        })
        save_offline_queue(items)

    def flush_offline_queue(self, show_message: bool = False):
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()
        if not tenant:
            if show_message:
                QMessageBox.warning(self, "Uyarı", "Tenant boş.")
            return
        items = load_offline_queue()
        if not items:
            self.println("Offline kuyruk boş.")
            if show_message:
                QMessageBox.information(self, "Bilgi", "Offline kuyruk boş.")
            return
        remaining = []
        sent = 0
        for item in items:
            payload = item.get("payload", {})
            try:
                resp = post_json(
                    self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                    tenant,
                    payload,
                    client_secret=self.get_client_secret(),
                    timeout=300,
                )
                if resp.get("ok"):
                    sent += 1
                    dataset_key = payload.get("dataset_key", "offline")
                    data = payload.get("data", [])
                    self.record_success(dataset_key, payload.get("params", {}), normalize_row_count(data), status="offline_flush", note="offline kuyruktan gönderildi")
                else:
                    remaining.append(item)
            except Exception:
                remaining.append(item)
        save_offline_queue(remaining)
        self.println(f"Offline kuyruk işlendi. Gönderilen: {sent}, Kalan: {len(remaining)}")
        if show_message:
            QMessageBox.information(self, "Bilgi", f"Gönderilen: {sent} | Kalan: {len(remaining)}")

    def run_poll_once_async(self):
        if self._request_poll_busy:
            self.println("request_poll: zaten çalışıyor")
            return
        self.on_request_tick()

    def flush_offline_queue_async(self):
        def _job():
            self.flush_offline_queue(show_message=False)
        self._run_background("offline_flush", _job, use_sync_lock=False, error_title="Offline Kuyruk Hata", success_message="Offline kuyruk gönderimi tamamlandı.")

    def open_health_dashboard(self):
        url = (self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL)).replace("sync.php", "health_dashboard.php")
        self.println(f"Sağlık ekranı açılıyor: {url}")
        try:
            os.startfile(url)  # type: ignore[attr-defined]
        except Exception:
            import webbrowser
            webbrowser.open(url)

    def cleanup_server_logs(self):
        days, ok = QInputDialog.getInt(self, "Log Temizliği", "Kaç günden eski kayıtlar temizlensin?", 7, 1, 3650)
        if not ok:
            return
        tenant = self.ed_tenant.text().strip() or self.cfg.get("tenant_id", "").strip()

        def _job():
            resp = post_json(
                self.ed_server_url.text().strip() or self.cfg.get("server_url", DEFAULT_SERVER_URL),
                tenant,
                {"action": "cleanup_logs", "days": days},
                client_secret=self.get_client_secret(),
                timeout=120,
            )
            self.println(f"Log temizliği: {resp}")
            self.popup_info_signal.emit("Bilgi", json.dumps(resp, ensure_ascii=False))

        self._run_background("cleanup_logs", _job, use_sync_lock=False, error_title="Log Temizliği Hata")

    def _manual_run_selected_dataset_impl(self, selected: str):
        defs = self.parse_dataset_defs()
        defn = next((d for d in defs if d.get("dataset_key") == selected), None)
        if not defn:
            raise RuntimeError("Dataset bulunamadı.")
        if selected in PAGED_PUSH_DATASET_KEYS:
            defn = normalize_paged_push_definition(defn)
            params = resolve_params(defn.get("params_template", {}))
            if selected == "stock_list":
                params["FIYAT_AD"] = 0
                data = self.execute_stock_list_all_price_names(defn)
            else:
                data = self.execute_dataset(defn, params)
            if not isinstance(data, list) or len(data) == 0:
                raise RuntimeError(f"{selected} 0 kayıt döndürdü; güvenlik için sayfalı push yapılmadı.")
            resp = self._push_paged_dataset(defn, params, data)
            if not resp.get("ok") and not resp.get("queued_offline"):
                raise RuntimeError(str(resp))
            self.update_snapshot(defn, params, data)
            self.record_success(selected, params, normalize_row_count(data), status="manual", note="manuel sayfalı/full push")
            self.popup_info_signal.emit("Bilgi", f"{selected} manuel sayfalı çalıştı. Toplam kayıt: {normalize_row_count(data)}")
            return

        params = resolve_params(defn.get("params_template", {}))
        data = self.execute_dataset(defn, params)
        if defn.get("mode") in ("push", "hybrid"):
            resp = self.push_dataset(defn, params, data)
            if not resp.get("ok") and not resp.get("queued_offline"):
                raise RuntimeError(str(resp))
        self.record_success(selected, params, normalize_row_count(data), status="manual", note="manuel çalıştırma")
        self.popup_info_signal.emit("Bilgi", f"{selected} manuel çalıştı.")

    def manual_run_selected_dataset(self):
        selected = self.cmb_manual_dataset.currentText().strip() if hasattr(self, "cmb_manual_dataset") else ""
        if not selected:
            return
        self._run_background(
            f"manual_{selected}",
            lambda: self._manual_run_selected_dataset_impl(selected),
            use_sync_lock=False,
            error_title="Manuel Çalıştırma Hata",
        )


def main():
    autorun = "--autorun" in sys.argv

    def _global_excepthook(exc_type, exc_value, exc_tb):
        try:
            log("UNHANDLED: " + "".join(traceback.format_exception(exc_type, exc_value, exc_tb)))
        except Exception:
            pass

    sys.excepthook = _global_excepthook

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    w = Main(autorun=autorun)
    if not autorun:
        w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
