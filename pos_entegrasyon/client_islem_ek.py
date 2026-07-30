# -*- coding: utf-8 -*-
"""
CLIENT.PY EKİ — Mobil İşlem Kuyruğu (Finans Tahsilat/Ödeme/Çek/Senet + Fiş) — 2026-07

KURULUM:
1. Aşağıdaki metotları ana pencere sınıfınıza (price_update metotlarının yanına) ekleyin.
2. __init__'e:  self._islem_busy = False
                self.islem_timer = QTimer(self); self.islem_timer.timeout.connect(self.on_islem_tick)
3. Ayarlara (DEFAULT_CFG):
     "islem_enabled": True, "islem_interval_sec": 30,
     "islem_kod_pc": 0, "islem_kullanici": 0,          # FK_PERSONEL
     "islem_proje": 0, "islem_lokasyon": 0,
4. Timer'ı price_update timer'ının başlatıldığı yerde başlatın:
     if self.cfg.get("islem_enabled", True): self.islem_timer.start(30*1000)
5. sync.php'ye sync_php_islem_ek.php içindeki 2 case eklenmiş olmalı.

DİKKAT: SEQUENS_VER prosedürünüz yeni ID'yi nasıl döndürüyorsa `sequens_ver()`
fonksiyonunu ona göre doğrulayın (varsayım: SELECT ile tek satır tek kolon döner).
"""
import json
import threading
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────────────────────────────────
# Aşağıdaki metotlar ana pencere sınıfının İÇİNE eklenecek
# ─────────────────────────────────────────────────────────────────────────

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
        finally:
            self._islem_busy = False

    threading.Thread(target=worker, name="islem_poll", daemon=True).start()


def process_pending_islemler(self):
    resp = self._price_update_post({"action": "islem_poll", "limit": 50}, timeout=60)
    items = resp.get("items", []) if isinstance(resp, dict) else []
    if not items:
        return
    kod_pc = int(self.cfg.get("islem_kod_pc", 0) or 0)
    kullanici = int(self.cfg.get("islem_kullanici", 0) or 0)
    proje = int(self.cfg.get("islem_proje", 0) or 0)
    lokasyon = int(self.cfg.get("islem_lokasyon", 0) or 0)
    if kod_pc <= 0 or kullanici <= 0:
        self.println("islem: islem_kod_pc / islem_kullanici ayarları girilmeli!")
        return
    self.println(f"islem: {len(items)} bekleyen kayıt alındı.")

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
                else:
                    raise RuntimeError(f"Bilinmeyen islem_grubu: {grubu}")
                conn.commit()
                self._price_update_post({"action": "islem_mark", "id": qid, "erp_id": erp_id}, timeout=30)
                self.println(f"islem OK: queue={qid} erp_id={erp_id}")
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


def sequens_ver(self, conn, tablo: str, kod_pc: int) -> int:
    """EXEC SEQUENS_VER — yeni ID rezerve eder.
    NOT: Prosedürünüz sonucu SELECT ile döndürmüyorsa burayı uyarlamalısınız
    (örn. OUTPUT parametresi veya sequence tablosundan SELECT)."""
    cur = conn.cursor()
    cur.execute("EXEC SEQUENS_VER @TABLO = ?, @KOD_PC = ?", tablo, kod_pc)
    row = None
    try:
        row = cur.fetchone()
    except Exception:
        pass
    while row is None and cur.nextset():
        try:
            row = cur.fetchone()
        except Exception:
            row = None
    if not row:
        raise RuntimeError(f"SEQUENS_VER({tablo}) ID döndürmedi — prosedür çıktısını kontrol edin.")
    return int(row[0])


def apply_finans_islem_to_erp(self, conn, item: Dict[str, Any], kod_pc: int,
                              kullanici: int, proje: int, lokasyon: int) -> int:
    """Tahsilat/Ödeme/Çek/Senet → FINANS + FINANS_DETAY (profiler dökümünüzle birebir)."""
    qid = int(item["id"])
    tur = int(item["islem_turu"])
    tutar = float(item["tutar"] or 0)
    borclu = int(item["kart_borclu"] or 0)
    alacakli = int(item["kart_alacakli"] or 0)
    aciklama = str(item.get("aciklama") or "")
    vade = item.get("vade_tarihi") or None  # 'YYYY-MM-DD' | None

    cur = conn.cursor()
    finans_id = self.sequens_ver(conn, "FINANS", kod_pc)
    belgeno = f"MBL-{qid:010d}"
    # KASA_AD: kasa tarafındaki kart (yön tablosuna göre borçlu ya da alacaklı kasadır;
    # mobil uygulama kasa kartını doğru tarafa yerleştirmiş durumda)
    kasa_ad = borclu if item.get("kart_borclu_ad") and "kasa" in str(item.get("kart_borclu_ad", "")).lower() else borclu
    cur.execute(
        """INSERT INTO FINANS(PROJE,BELGENO,TARIH,LOKASYON,KASA_AD,ID)
           VALUES (?,?,GETDATE(),?,?,?)""",
        proje, belgeno, lokasyon, kasa_ad, finans_id,
    )

    detay_id = self.sequens_ver(conn, "FINANS_DETAY", kod_pc)
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
    # Çek/senet no + vergi no: ERP şemanızda ilgili kolonlar (ör. CEK_NO) varsa
    # buraya UPDATE ekleyin. Çek resmi MySQL'de (cek_resmi, base64) duruyor;
    # islem_poll'a {"include_resim":1} gönderirseniz gelir.
    return finans_id


def apply_fis_islem_to_erp(self, conn, item: Dict[str, Any], kod_pc: int,
                           kullanici: int, proje: int, lokasyon: int) -> int:
    """Fatura/Fiş girişi → FIS + FIS_DETAY (+ nakit/kart ödemede FINANS kaydı).
    detay_json: {odeme_tipi, kasa_id, satirlar:[{stok_id,barkod,kod,ad,miktar,fiyat,kdv}], geneltoplam}
    NOT: FIS tablosunun 80+ kolonu profiler dökümünüzdeki varsayılanlarla doldurulur.
    FIS_TURU eşlemesini (satış faturası=2 örneğinizdeki gibi) kendi kurulumunuza göre doğrulayın."""
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
    fis_id = self.sequens_ver(conn, "FIS", kod_pc)
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

    for i, s in enumerate(satirlar):
        d_id = self.sequens_ver(conn, "FIS_DETAY", kod_pc)
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

    # Nakit/Kart ödeme → FINANS kaydı (örneğinizdeki FIS bağlantılı FINANS gibi)
    odeme = str(detay.get("odeme_tipi") or "acik_hesap")
    if odeme in ("nakit", "kart") and detay.get("kasa_id"):
        f_id = self.sequens_ver(conn, "FINANS", kod_pc)
        cur.execute(
            "INSERT INTO FINANS(PROJE,BELGENO,TARIH,LOKASYON,FIS,KASA_AD,ID) VALUES (?,?,GETDATE(),?,?,?,?)",
            proje, belgeno, lokasyon, fis_id, int(detay["kasa_id"]), f_id,
        )
        fd_id = self.sequens_ver(conn, "FINANS_DETAY", kod_pc)
        cur.execute(
            """INSERT INTO FINANS_DETAY(ISLEM_TARIHI,ID,FINANS,KART_ALACAKLI,DOVIZ_AD,FIS,FK_PERSONEL,
                 TUTAR,ACIKLAMA,VADE_TARIHI,CARI_ADRES,KUR,KART_BORCLU,FINANS_ISLEM_TURU,SECIM,EXTERNAL_ID)
               VALUES (GETDATE(),?,?,?,1,?,?,?,?,GETDATE(),0,1,?,?,0,?)""",
            fd_id, f_id, fis_id, fis_id, kullanici,
            geneltoplam, "", cari, islem_turu, qid,
        )
    return fis_id
