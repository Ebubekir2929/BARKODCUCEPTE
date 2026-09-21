"""v23 — Haftalık Rapor Maili.

Her Pazartesi (İstanbul HAFTALIK_RAPOR_SAAT:00, varsayılan 08:00) aktif ve
e-postası olan kullanıcılara GEÇEN HAFTANIN (Pzt–Paz) satış özeti gönderilir:
kaynak (tenant) başına toplam ciro, nakit/kart, önceki haftaya göre değişim,
gün gün döküm, en iyi gün ve aylık hedef ilerlemesi.

Kaynak: dashboard "Toplam" ile aynı — `_finans_gun_toplamlari` (günün en güncel
`financial_data` blobu, lokasyon filtresiz). Hedef: `routes.hedef._hedef_bul`.

Tablolar (kasacepteweb):
  haftalik_rapor_ayar     (user_id PK, aktif)            — yalnızca ayarı değiştirenler; varsayılan AÇIK
  haftalik_rapor_gonderim (user_id, hafta PK, durum, hata) — aynı hafta iki kez gönderilmez

Açılışta 5 dk sonra "yakalama" turu: Pazartesi ve saat geçmişse (Railway
redeploy'u tam o saate denk gelirse) tur çalışır; gonderim tablosu tekrarı önler.
"""
import asyncio
import logging
import os
from datetime import date, datetime, timedelta, timezone

logger = logging.getLogger(__name__)

RAPOR_SAATI_ISTANBUL = int(os.environ.get("HAFTALIK_RAPOR_SAAT", "8"))
KULLANICI_ARASI_SN = 0.5
_IST = timezone(timedelta(hours=3))
_GUN_KISA = ("Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz")
_GUN_UZUN = ("Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar")
_AY_AD = ("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık")

son_calisma: dict = {}
_task = None
_calisiyor = False
_tables_ready = False


# ── yardımcılar ──────────────────────────────────────────────────────────────
def istanbul_simdi() -> datetime:
    return datetime.now(_IST)


def gecen_hafta_araligi(bugun: date | None = None) -> tuple[date, date]:
    """Son TAMAMLANMIŞ hafta (Pzt–Paz). Pazartesi çalışınca: önceki Pzt–Paz."""
    bugun = bugun or istanbul_simdi().date()
    bu_pzt = bugun - timedelta(days=bugun.weekday())
    return bu_pzt - timedelta(days=7), bu_pzt - timedelta(days=1)


def hafta_etiketi(pzt: date) -> str:
    y, w, _ = pzt.isocalendar()
    return f"{y}-W{w:02d}"


def para(v: float) -> str:
    """₺12.345,67 (Türkçe biçim)."""
    s = f"{abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if v < 0 else ''}₺{s}"


def tarih_uzun(d: date) -> str:
    return f"{d.day} {_AY_AD[d.month - 1]} {d.year}"


def aralik_metni(pzt: date, paz: date) -> str:
    if pzt.month == paz.month:
        return f"{pzt.day} – {paz.day} {_AY_AD[paz.month - 1]} {paz.year}"
    return f"{pzt.day} {_AY_AD[pzt.month - 1]} – {paz.day} {_AY_AD[paz.month - 1]} {paz.year}"


async def _ensure_tables():
    global _tables_ready
    if _tables_ready:
        return
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS haftalik_rapor_ayar (
                  user_id INT NOT NULL,
                  aktif TINYINT(1) NOT NULL DEFAULT 1,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  PRIMARY KEY (user_id)
                ) CHARACTER SET utf8mb4
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS haftalik_rapor_gonderim (
                  user_id INT NOT NULL,
                  hafta CHAR(24) NOT NULL,
                  email VARCHAR(190) DEFAULT NULL,
                  durum VARCHAR(20) NOT NULL,
                  hata VARCHAR(255) DEFAULT NULL,
                  gonderim_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (user_id, hafta)
                ) CHARACTER SET utf8mb4
            """)
    _tables_ready = True


# ── ayar / gönderim kaydı ────────────────────────────────────────────────────
async def ayar_getir(user_id: int) -> bool:
    await _ensure_tables()
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT aktif FROM haftalik_rapor_ayar WHERE user_id=%s", (user_id,))
            r = await cur.fetchone()
    return True if r is None else bool(r[0])


async def ayar_kaydet(user_id: int, aktif: bool) -> None:
    await _ensure_tables()
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO haftalik_rapor_ayar (user_id, aktif) VALUES (%s,%s) "
                "ON DUPLICATE KEY UPDATE aktif=VALUES(aktif)",
                (user_id, 1 if aktif else 0),
            )


async def son_gonderim(user_id: int) -> dict | None:
    await _ensure_tables()
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT hafta, email, durum, hata, gonderim_at FROM haftalik_rapor_gonderim "
                "WHERE user_id=%s ORDER BY gonderim_at DESC LIMIT 1",
                (user_id,),
            )
            r = await cur.fetchone()
    if not r:
        return None
    return {"hafta": r[0], "email": r[1], "durum": r[2], "hata": r[3],
            "zaman": r[4].isoformat(timespec="seconds") if r[4] else None}


async def _gonderim_yaz(user_id: int, hafta: str, email: str, durum: str, hata: str | None = None):
    from services import get_data_pool
    pool = await get_data_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO haftalik_rapor_gonderim (user_id, hafta, email, durum, hata) VALUES (%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE email=VALUES(email), durum=VALUES(durum), hata=VALUES(hata), gonderim_at=NOW()",
                (user_id, hafta, (email or "")[:190], durum, (hata or None) and hata[:255]),
            )


# ── veri toplama ─────────────────────────────────────────────────────────────
async def kullanici_kaynaklari(user: dict) -> list[dict]:
    """[{tenant_id, name}] — MySQL ana kaynak + Mongo ek kaynaklar (build_user_response ile aynı)."""
    from routes import auth as _auth
    mongo = _auth.mongo_db
    out: list[dict] = []
    if user.get("tenant_id"):
        name = None
        if mongo is not None:
            doc = await mongo.tenant_names.find_one({"user_id": user["user_id"], "tenant_id": user["tenant_id"]})
            name = (doc or {}).get("name")
        out.append({"tenant_id": user["tenant_id"], "name": name or "Ana Veri"})
    if mongo is not None:
        async for et in mongo.user_tenants.find({"user_id": user["user_id"]}).limit(10):
            if et.get("tenant_id") and all(o["tenant_id"] != et["tenant_id"] for o in out):
                out.append({"tenant_id": et["tenant_id"], "name": et.get("name") or et["tenant_id"]})
    return out


async def kaynak_ozeti(tenant_id: str, name: str, pzt: date, paz: date) -> dict:
    """Bir kaynağın haftalık özeti (bu hafta + önceki hafta + aylık hedef)."""
    from routes.data import _finans_gun_toplamlari
    from routes.hedef import _hedef_bul
    from services import get_data_pool

    onceki_pzt = pzt - timedelta(days=7)
    gunler = [onceki_pzt + timedelta(days=i) for i in range(14)]
    toplamlar = await _finans_gun_toplamlari(
        tenant_id, [f'%"sdate":"{g.isoformat()}%' for g in gunler], limit=400
    )
    bos = {"toplam": 0.0, "nakit": 0.0, "kart": 0.0}
    hafta = [{"tarih": g.isoformat(), "gun": _GUN_KISA[g.weekday()], **toplamlar.get(g.isoformat(), bos)} for g in gunler[7:]]
    onceki = [toplamlar.get(g.isoformat(), bos) for g in gunler[:7]]

    toplam = round(sum(g["toplam"] for g in hafta), 2)
    nakit = round(sum(g["nakit"] for g in hafta), 2)
    kart = round(sum(g["kart"] for g in hafta), 2)
    onceki_toplam = round(sum(g["toplam"] for g in onceki), 2)
    degisim = round((toplam - onceki_toplam) / onceki_toplam * 100, 1) if onceki_toplam > 0 else None
    en_iyi = max(hafta, key=lambda g: g["toplam"]) if toplam > 0 else None
    satisli_gun = sum(1 for g in hafta if g["toplam"] > 0)

    # Aylık hedef — haftanın son gününün ayı (ay başından o güne kadar gerçekleşen)
    ay = paz.strftime("%Y-%m")
    hedef_bilgi = None
    try:
        pool = await get_data_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                hedef, _kaynak_ay = await _hedef_bul(cur, tenant_id, ay)
        if hedef > 0:
            ay_gunleri = await _finans_gun_toplamlari(tenant_id, [f'%"sdate":"{ay}-%'], limit=400)
            gerceklesen = round(sum(v["toplam"] for g, v in ay_gunleri.items() if g.startswith(ay) and g <= paz.isoformat()), 2)
            hedef_bilgi = {
                "ay": ay, "ay_adi": _AY_AD[int(ay[5:7]) - 1], "hedef": round(hedef, 2),
                "gerceklesen": gerceklesen, "oran": round(gerceklesen / hedef * 100, 1),
                "kalan": round(max(hedef - gerceklesen, 0.0), 2),
            }
    except Exception as e:  # tablo yoksa vb. — hedef bölümü atlanır
        logger.warning(f"[haftalik_rapor] hedef okunamadı {tenant_id[:8]}: {e}")

    return {
        "tenant_id": tenant_id, "name": name,
        "toplam": toplam, "nakit": nakit, "kart": kart,
        "onceki_toplam": onceki_toplam, "degisim_yuzde": degisim,
        "gunler": hafta, "en_iyi_gun": en_iyi, "satisli_gun": satisli_gun,
        "hedef": hedef_bilgi,
    }


async def rapor_verisi(user: dict, bugun: date | None = None) -> dict:
    pzt, paz = gecen_hafta_araligi(bugun)
    kaynaklar = await kullanici_kaynaklari(user)
    ozetler = [await kaynak_ozeti(k["tenant_id"], k["name"], pzt, paz) for k in kaynaklar]
    return {
        "hafta": hafta_etiketi(pzt),
        "baslangic": pzt.isoformat(), "bitis": paz.isoformat(),
        "aralik": aralik_metni(pzt, paz),
        "kullanici": user.get("full_name") or user.get("username") or "Kullanıcı",
        "email": user.get("email"),
        "kaynaklar": ozetler,
        "genel_toplam": round(sum(o["toplam"] for o in ozetler), 2),
        "veri_var": any(o["toplam"] > 0 or o["onceki_toplam"] > 0 for o in ozetler),
    }


# ── e-posta içeriği ──────────────────────────────────────────────────────────
def _degisim_html(d: float | None) -> str:
    if d is None:
        return '<span style="color:#64748B;font-size:13px">önceki hafta verisi yok</span>'
    renk, ok = ("#16A34A", "▲") if d >= 0 else ("#DC2626", "▼")
    return (f'<span style="color:{renk};font-weight:700;font-size:14px">{ok} {abs(d):.1f}%</span>'
            f'<span style="color:#64748B;font-size:13px"> önceki haftaya göre</span>')


def _kaynak_html(o: dict) -> str:
    en_yuksek = max((g["toplam"] for g in o["gunler"]), default=0.0) or 1.0
    satirlar = []
    for g in o["gunler"]:
        w = int(round(g["toplam"] / en_yuksek * 100)) if g["toplam"] > 0 else 0
        vurgu = o["en_iyi_gun"] and g["tarih"] == o["en_iyi_gun"]["tarih"]
        satirlar.append(
            f'<tr>'
            f'<td style="padding:6px 8px;color:#334155;font-size:13px;white-space:nowrap">{g["gun"]} <span style="color:#94A3B8">{g["tarih"][8:10]}</span></td>'
            f'<td style="padding:6px 8px;width:100%">'
            f'<div style="background:#F1F5F9;border-radius:6px;height:10px;overflow:hidden">'
            f'<div style="width:{w}%;height:10px;background:{"#0EA5E9" if vurgu else "#93C5FD"}"></div></div></td>'
            f'<td style="padding:6px 8px;text-align:right;font-size:13px;font-weight:{700 if vurgu else 500};color:#0F172A;white-space:nowrap">{para(g["toplam"])}</td>'
            f'</tr>'
        )
    hedef_html = ""
    h = o.get("hedef")
    if h:
        w = min(int(round(h["oran"])), 100)
        renk = "#16A34A" if h["oran"] >= 100 else "#0EA5E9"
        hedef_html = (
            f'<div style="margin-top:14px;padding:12px;background:#F8FAFC;border-radius:10px">'
            f'<table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155"><tr>'
            f'<td style="padding:0"><b>{h["ay_adi"]} hedefi</b></td>'
            f'<td style="padding:0;text-align:right">{para(h["gerceklesen"])} / {para(h["hedef"])} · <b style="color:{renk}">{h["oran"]:.1f}%</b></td></tr></table>'
            f'<div style="background:#E2E8F0;border-radius:6px;height:10px;margin-top:8px;overflow:hidden">'
            f'<div style="width:{w}%;height:10px;background:{renk}"></div></div>'
            f'<div style="font-size:12px;color:#64748B;margin-top:6px">'
            + ("Hedef tamamlandı 🎉" if h["oran"] >= 100 else f'Kalan: {para(h["kalan"])}') + "</div></div>"
        )
    en_iyi = (f'<div style="font-size:13px;color:#334155;margin-top:10px">🏆 En iyi gün: <b>{_GUN_UZUN[date.fromisoformat(o["en_iyi_gun"]["tarih"]).weekday()]}</b> — {para(o["en_iyi_gun"]["toplam"])}</div>'
              if o["en_iyi_gun"] else '<div style="font-size:13px;color:#64748B;margin-top:10px">Bu hafta satış kaydı yok.</div>')
    return f"""
    <div style="border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:16px 0">
      <div style="font-size:13px;color:#64748B;text-transform:uppercase;letter-spacing:.5px">{o["name"]}</div>
      <div style="font-size:26px;font-weight:800;color:#0F172A;margin:4px 0">{para(o["toplam"])}</div>
      <div>{_degisim_html(o["degisim_yuzde"])}</div>
      <div style="margin-top:10px;font-size:13px;color:#334155">
        <span style="display:inline-block;background:#ECFDF5;color:#047857;padding:4px 10px;border-radius:999px;margin-right:6px">Nakit {para(o["nakit"])}</span>
        <span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;padding:4px 10px;border-radius:999px">Kart {para(o["kart"])}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">{''.join(satirlar)}</table>
      {en_iyi}
      {hedef_html}
    </div>"""


def rapor_html(v: dict) -> str:
    kaynaklar = "".join(_kaynak_html(o) for o in v["kaynaklar"])
    genel = ""
    if len(v["kaynaklar"]) > 1:
        genel = (f'<div style="background:#0EA5E9;color:#fff;border-radius:12px;padding:14px 16px;margin-top:4px">'
                 f'<div style="font-size:12px;opacity:.9">TÜM KAYNAKLAR TOPLAMI</div>'
                 f'<div style="font-size:24px;font-weight:800">{para(v["genel_toplam"])}</div></div>')
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.08)">
    <div style="background:#0EA5E9;padding:20px;text-align:center;color:#fff">
      <h1 style="margin:0;font-size:20px">Barkodcu Cepte</h1>
      <div style="font-size:14px;opacity:.95;margin-top:4px">Haftalık Satış Özeti · {v["aralik"]}</div>
    </div>
    <div style="padding:20px 24px;color:#333;line-height:1.5">
      <p style="margin:0 0 8px">Merhaba <b>{v["kullanici"]}</b>,</p>
      <p style="margin:0 0 12px;color:#475569;font-size:14px">Geçen haftanın satış özetiniz aşağıdadır.</p>
      {genel}
      {kaynaklar}
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0"/>
      <p style="font-size:12px;color:#888;margin:0">Bu özet her Pazartesi {RAPOR_SAATI_ISTANBUL:02d}:00'de gönderilir.
      Almak istemiyorsanız uygulamada <b>Ayarlar → Haftalık Rapor Maili</b> anahtarını kapatabilirsiniz.</p>
    </div>
  </div>
</body></html>"""


def rapor_metin(v: dict) -> str:
    satirlar = [f"Barkodcu Cepte — Haftalık Satış Özeti ({v['aralik']})", f"Merhaba {v['kullanici']},", ""]
    for o in v["kaynaklar"]:
        d = o["degisim_yuzde"]
        satirlar.append(f"[{o['name']}] Toplam: {para(o['toplam'])} | Nakit: {para(o['nakit'])} | Kart: {para(o['kart'])}")
        satirlar.append("  Önceki haftaya göre: " + (f"{'+' if d >= 0 else ''}{d:.1f}%" if d is not None else "veri yok"))
        for g in o["gunler"]:
            satirlar.append(f"  {g['gun']} {g['tarih'][8:10]}: {para(g['toplam'])}")
        if o["en_iyi_gun"]:
            satirlar.append(f"  En iyi gün: {o['en_iyi_gun']['gun']} — {para(o['en_iyi_gun']['toplam'])}")
        if o.get("hedef"):
            h = o["hedef"]
            satirlar.append(f"  {h['ay_adi']} hedefi: {para(h['gerceklesen'])} / {para(h['hedef'])} ({h['oran']:.1f}%)")
        satirlar.append("")
    if len(v["kaynaklar"]) > 1:
        satirlar.append(f"Tüm kaynaklar toplamı: {para(v['genel_toplam'])}")
    satirlar.append("\nAyarlar → Haftalık Rapor Maili anahtarıyla bu e-postayı kapatabilirsiniz.")
    return "\n".join(satirlar)


# ── gönderim ─────────────────────────────────────────────────────────────────
async def kullaniciya_gonder(user: dict, hafta_eki: str = "", zorla: bool = False) -> dict:
    """Tek kullanıcıya rapor. `zorla=True` → veri yok / kapalı olsa da gönderir (elle test).
    Dönen: {durum: gonderildi|veri_yok|kapali|eposta_yok|hata, ...}"""
    from services.mailer import send_email
    await _ensure_tables()
    email = (user.get("email") or "").strip()
    if not email:
        return {"durum": "eposta_yok"}
    if not zorla and not await ayar_getir(user["user_id"]):
        return {"durum": "kapali"}
    veri = await rapor_verisi(user)
    hafta = veri["hafta"] + hafta_eki
    if not veri["veri_var"] and not zorla:
        await _gonderim_yaz(user["user_id"], hafta, email, "veri_yok")
        return {"durum": "veri_yok", "hafta": veri["hafta"]}
    konu = f"Haftalık Satış Özeti · {veri['aralik']} — {para(veri['genel_toplam'])}"
    ok = await asyncio.to_thread(send_email, email, konu, rapor_html(veri), rapor_metin(veri))
    await _gonderim_yaz(user["user_id"], hafta, email, "gonderildi" if ok else "hata", None if ok else "e-posta sağlayıcı reddetti")
    return {"durum": "gonderildi" if ok else "hata", "hafta": veri["hafta"], "email": email,
            "genel_toplam": veri["genel_toplam"], "kaynak_sayisi": len(veri["kaynaklar"])}


async def haftalik_tur() -> dict:
    """Tüm aktif kullanıcılar için haftalık tur (aynı hafta tekrar gönderilmez)."""
    global _calisiyor
    if _calisiyor:
        return {**son_calisma, "durum": "zaten çalışıyor"}
    _calisiyor = True
    from services import get_patron_pool, get_data_pool
    await _ensure_tables()
    pzt, _ = gecen_hafta_araligi()
    hafta = hafta_etiketi(pzt)
    stat: dict = {"durum": "çalışıyor", "hafta": hafta, "baslangic": istanbul_simdi().isoformat(timespec="seconds"),
                  "gonderildi": 0, "veri_yok": 0, "kapali": 0, "atlandi": 0, "hata": 0}
    son_calisma.clear()
    son_calisma.update(stat)
    try:
        pool = await get_patron_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT user_id, username, email, full_name, tenant_id FROM users "
                    "WHERE active=1 AND email IS NOT NULL AND email<>'' ORDER BY user_id"
                )
                kullanicilar = [dict(zip(("user_id", "username", "email", "full_name", "tenant_id"), r)) for r in await cur.fetchall()]
        dpool = await get_data_pool()
        async with dpool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT user_id FROM haftalik_rapor_ayar WHERE aktif=0")
                kapalilar = {r[0] for r in await cur.fetchall()}
                await cur.execute("SELECT user_id FROM haftalik_rapor_gonderim WHERE hafta=%s", (hafta,))
                gonderilmis = {r[0] for r in await cur.fetchall()}
        stat["toplam_kullanici"] = len(kullanicilar)
        for u in kullanicilar:
            if u["user_id"] in kapalilar:
                stat["kapali"] += 1
                continue
            if u["user_id"] in gonderilmis:
                stat["atlandi"] += 1
                continue
            try:
                r = await kullaniciya_gonder(u)
                stat[r["durum"] if r["durum"] in stat else "hata"] += 1
            except Exception as e:
                stat["hata"] += 1
                logger.error(f"[haftalik_rapor] user {u['user_id']} hata: {e}")
                try:
                    await _gonderim_yaz(u["user_id"], hafta, u["email"], "hata", str(e))
                except Exception:
                    pass
            son_calisma.update(stat)
            await asyncio.sleep(KULLANICI_ARASI_SN)
    finally:
        _calisiyor = False
    stat["durum"] = "bitti"
    stat["bitis"] = istanbul_simdi().isoformat(timespec="seconds")
    logger.info(f"[haftalik_rapor] tur tamamlandı: {stat}")
    son_calisma.clear()
    son_calisma.update(stat)
    return stat


# ── zamanlayıcı ──────────────────────────────────────────────────────────────
def sonraki_pazartesi_saniye(simdi: datetime | None = None) -> float:
    simdi = simdi or istanbul_simdi()
    hedef = simdi.replace(hour=RAPOR_SAATI_ISTANBUL, minute=0, second=0, microsecond=0)
    gun_fark = (7 - simdi.weekday()) % 7
    hedef += timedelta(days=gun_fark)
    if hedef <= simdi:
        hedef += timedelta(days=7)
    return (hedef - simdi).total_seconds()


def sonraki_gonderim_metni() -> str:
    hedef = istanbul_simdi() + timedelta(seconds=sonraki_pazartesi_saniye())
    return f"{tarih_uzun(hedef.date())} Pazartesi {RAPOR_SAATI_ISTANBUL:02d}:00"


async def _dongu():
    # Yakalama turu: Pazartesi ve saat geçtiyse (redeploy tam o saate denk gelmiş olabilir)
    await asyncio.sleep(300)
    simdi = istanbul_simdi()
    if simdi.weekday() == 0 and simdi.hour >= RAPOR_SAATI_ISTANBUL:
        try:
            await haftalik_tur()
        except Exception as e:
            logger.error(f"[haftalik_rapor] yakalama turu hatası: {e}")
    while True:
        bekle = sonraki_pazartesi_saniye()
        logger.info(f"[haftalik_rapor] sonraki tur {bekle / 3600:.1f} saat sonra ({sonraki_gonderim_metni()})")
        await asyncio.sleep(bekle)
        try:
            await haftalik_tur()
        except Exception as e:
            logger.error(f"[haftalik_rapor] tur hatası: {e}")
        await asyncio.sleep(120)


def start_haftalik_rapor():
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_event_loop().create_task(_dongu())
        logger.info(f"📧 Haftalık rapor maili zamanlandı (Pazartesi İstanbul {RAPOR_SAATI_ISTANBUL:02d}:00)")
