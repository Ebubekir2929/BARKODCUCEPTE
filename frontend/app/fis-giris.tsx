/**
 * fis-giris.tsx — Fatura/Fiş Girişi (Faz 2) — 2026-07
 *
 * Alış/Satış faturası ve fişi: ürün adı/barkod arama + kamera ile barkod
 * okuma, satır sepeti, ödeme tipi (nakit/kart/açık hesap), kaydet →
 * MySQL kuyruğu (POS istemcisi ERP12'ye FIS+FIS_DETAY basar) → PDF çıktısı.
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform, KeyboardAvoidingView, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useDataSourceStore } from '../src/store/dataSourceStore';

// Kamera web'de crash yapabiliyor — lazy/safe import (price-update deseni)
let CameraView: any = null;
let useCameraPermissions: any = () => [null, async () => ({ granted: false })];
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
} catch {}

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const TIPLER = [
  { key: 'satis_faturasi', ad: 'Satış Faturası', renk: '#10B981' },
  { key: 'alis_faturasi', ad: 'Alış Faturası', renk: '#3B82F6' },
  { key: 'satis_fisi', ad: 'Satış Fişi', renk: '#10B981' },
  { key: 'alis_fisi', ad: 'Alış Fişi', renk: '#3B82F6' },
];
const ODEMELER = [
  { key: 'nakit', ad: 'Nakit', icon: 'cash-outline' },
  { key: 'kart', ad: 'Kart', icon: 'card-outline' },
  { key: 'acik_hesap', ad: 'Açık Hesap', icon: 'book-outline' },
];

interface Satir { stok_id: number; barkod: string; kod: string; ad: string; miktar: number; fiyat: number }

const fmt = (n: number) => '₺' + (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FisGirisScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const [camPerm, requestCamPerm] = useCameraPermissions();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const m = /^data(\d+)$/.exec(activeSource || '');
    const idx = m ? parseInt(m[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [tip, setTip] = useState(TIPLER[0]);
  const [cari, setCari] = useState<{ id: number; ad: string } | null>(null);
  const [odeme, setOdeme] = useState('acik_hesap');
  const [kasa, setKasa] = useState<{ kart_id: number; ad: string } | null>(null);
  const [aciklama, setAciklama] = useState('');
  const [satirlar, setSatirlar] = useState<Satir[]>([]);

  const [urunAra, setUrunAra] = useState('');
  const [urunler, setUrunler] = useState<any[]>([]);
  const [urunBusy, setUrunBusy] = useState(false);
  const [showUrunSecim, setShowUrunSecim] = useState(false);
  const [showCariSecim, setShowCariSecim] = useState(false);
  const [showKasaSecim, setShowKasaSecim] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const scanLock = useRef(false);
  const [cariler, setCariler] = useState<any[]>([]);
  const [cariAra, setCariAra] = useState('');
  const [kasalar, setKasalar] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [sonKayit, setSonKayit] = useState<{ id: number; toplam: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const authHeaders = () => {
    const { token } = useAuthStore.getState();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` };
  };

  // POS istemcisinden açılan yetki kontrolü (kapalıysa ekran kilitli)
  const [yetki, setYetki] = useState<boolean | null>(null);
  useEffect(() => {
    let iptal = false;
    if (!activeTenantId) { setYetki(false); return; }
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/islem/yetkiler?tenant_id=${activeTenantId}`, { headers: authHeaders() });
        const j = await r.json();
        if (!iptal) setYetki(j.ok ? !!j.fis : false);
      } catch { if (!iptal) setYetki(false); }
    })();
    return () => { iptal = true; };
  }, [activeTenantId]);

  const toplam = useMemo(() => satirlar.reduce((s, r) => s + r.miktar * r.fiyat, 0), [satirlar]);

  const urunAraYap = useCallback(async (q: string) => {
    if (!q.trim() || !activeTenantId) return;
    setUrunBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/data/stock-list`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, page: 1, page_size: 30, search: q.trim() }),
      });
      const j = await r.json();
      setUrunler(j.ok && Array.isArray(j.data) ? j.data : []);
    } catch { setUrunler([]); }
    setUrunBusy(false);
  }, [activeTenantId]);

  const satirEkle = (u: any) => {
    const id = Number(u.ID || 0);
    setSatirlar((prev) => {
      const i = prev.findIndex((s) => s.stok_id === id);
      if (i >= 0) {
        const kopya = [...prev];
        kopya[i] = { ...kopya[i], miktar: kopya[i].miktar + 1 };
        return kopya;
      }
      return [...prev, {
        stok_id: id, barkod: String(u.BARKOD || ''), kod: String(u.KOD || ''),
        ad: String(u.AD || ''), miktar: 1, fiyat: parseFloat(u.FIYAT || '0') || 0,
      }];
    });
    setShowUrunSecim(false); setUrunAra(''); setUrunler([]);
  };

  const barkodOkundu = async ({ data }: any) => {
    if (scanLock.current || !data) return;
    scanLock.current = true;
    setShowScanner(false);
    try {
      const r = await fetch(`${API_URL}/api/data/stock-list`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, page: 1, page_size: 5, search: String(data).trim() }),
      });
      const j = await r.json();
      const bulunan = (j.data || []).find((u: any) => String(u.BARKOD || '') === String(data).trim()) || (j.data || [])[0];
      if (bulunan) { satirEkle(bulunan); showToast(`✓ ${bulunan.AD}`); }
      else showToast(`Barkod bulunamadı: ${data}`, false);
    } catch { showToast('Arama hatası', false); }
    setTimeout(() => { scanLock.current = false; }, 1200);
  };

  const scannerAc = async () => {
    if (Platform.OS === 'web' || !CameraView) return showToast('Kamera yalnızca cihazda çalışır', false);
    if (!camPerm?.granted) {
      const r = await requestCamPerm();
      if (!r.granted) return showToast('Kamera izni verilmedi', false);
    }
    scanLock.current = false;
    setShowScanner(true);
  };

  const loadCariler = useCallback(async () => {
    if (cariler.length > 0) return;
    try {
      const r = await fetch(`${API_URL}/api/data/cari-list`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, page: 1, page_size: 50000 }),
      });
      const j = await r.json();
      if (j.ok && Array.isArray(j.data)) setCariler(j.data);
    } catch {}
  }, [activeTenantId, cariler.length]);

  const loadKasalar = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/islem/kasalar?tenant_id=${activeTenantId}`, { headers: authHeaders() });
      const j = await r.json();
      if (j.ok) setKasalar(j.data || []);
    } catch {}
  }, [activeTenantId]);

  const filtreliCariler = useMemo(() => {
    const q = cariAra.trim().toLocaleLowerCase('tr-TR');
    if (!q) return cariler.slice(0, 100);
    return cariler.filter((c: any) =>
      String(c.AD || '').toLocaleLowerCase('tr-TR').includes(q) || String(c.KOD || '').toLocaleLowerCase('tr-TR').includes(q),
    ).slice(0, 100);
  }, [cariler, cariAra]);

  const pdfYazdir = async (kayitId: number) => {
    const html = `<html><head><meta charset="utf-8"><style>
      body{font-family:sans-serif;padding:24px;color:#111}
      h2{margin:0} .sub{color:#666;font-size:12px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;font-size:11px;text-align:left}
      th{background:#f5f5f5} .t{text-align:right}
    </style></head><body>
      <h2>${tip.ad}</h2>
      <div class="sub">Belge: MBL-${String(kayitId).padStart(8, '0')} · ${new Date().toLocaleString('tr-TR')}<br/>
      Cari: <b>${cari?.ad || '-'}</b> · Ödeme: ${ODEMELER.find((o) => o.key === odeme)?.ad}${kasa ? ` (${kasa.ad})` : ''}</div>
      <table><thead><tr><th>Ürün</th><th>Barkod</th><th class="t">Miktar</th><th class="t">Fiyat</th><th class="t">Tutar</th></tr></thead><tbody>
      ${satirlar.map((s) => `<tr><td>${s.ad}</td><td>${s.barkod}</td><td class="t">${s.miktar}</td><td class="t">${fmt(s.fiyat)}</td><td class="t">${fmt(s.miktar * s.fiyat)}</td></tr>`).join('')}
      <tr><td colspan="4"><b>GENEL TOPLAM</b></td><td class="t"><b>${fmt(toplam)}</b></td></tr>
      </tbody></table></body></html>`;
    try {
      if (Platform.OS === 'web') await Print.printAsync({ html });
      else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${tip.ad} PDF` });
      }
    } catch { showToast('PDF oluşturulamadı', false); }
  };

  const kaydet = async () => {
    if (busy) return;
    if (!cari) return showToast('Cari seçin', false);
    if (satirlar.length === 0) return showToast('En az bir ürün ekleyin', false);
    if ((odeme === 'nakit' || odeme === 'kart') && !kasa) return showToast('Kasa seçin', false);
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/islem/fis-create`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          tenant_id: activeTenantId, fis_tipi: tip.key,
          cari_id: cari.id, cari_ad: cari.ad,
          odeme_tipi: odeme, kasa_id: kasa?.kart_id || null, kasa_ad: kasa?.ad || null,
          aciklama, satirlar,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.detail || 'Kaydedilemedi');
      setSonKayit({ id: j.id, toplam: j.geneltoplam });
      showToast(`✓ ${tip.ad} kaydedildi (#${j.id}) — POS aktaracak`);
    } catch (e: any) { showToast(String(e?.message || 'Hata'), false); }
    setBusy(false);
  };

  const yeniFis = () => { setSatirlar([]); setAciklama(''); setSonKayit(null); };

  const inputStyle = [styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }];

  if (yetki !== true) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Fatura / Fiş Girişi</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
          {yetki === null ? <ActivityIndicator size="large" color={colors.primary} /> : (
            <>
              <Ionicons name="lock-closed-outline" size={56} color={colors.textSecondary} />
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>İşleme Yetkiniz Yok</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 }}>
                Bu özellik POS istemcisinden{'\n'}(Ayarlar → &quot;Mobil Fatura/Fiş Girişi&quot;) açılmalıdır.
              </Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Fatura / Fiş Girişi</Text>
        <TouchableOpacity onPress={() => router.push('/kuyruk-durum')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="list-circle-outline" size={26} color={colors.text} />
        </TouchableOpacity>
      </View>

      {sonKayit ? (
        /* Kayıt sonrası: PDF / yeni fiş */
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
          <Ionicons name="checkmark-circle" size={64} color="#10B981" />
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{tip.ad} Kaydedildi</Text>
          <Text style={{ color: colors.textSecondary }}>Belge #{sonKayit.id} · {fmt(sonKayit.toplam)} — POS istemcisi ERP12&apos;ye aktaracak</Text>
          <TouchableOpacity onPress={() => pdfYazdir(sonKayit.id)} style={[styles.kaydetBtn, { backgroundColor: colors.primary, width: '100%' }]}>
            <Ionicons name="document-text-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800' }}>PDF Yazdır / Paylaş</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={yeniFis} style={[styles.kaydetBtn, { backgroundColor: '#10B981', width: '100%' }]}>
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800' }}>Yeni Fiş</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.turGrid}>
            {TIPLER.map((t2) => (
              <TouchableOpacity key={t2.key} onPress={() => setTip(t2)}
                style={[styles.turChip, { backgroundColor: tip.key === t2.key ? t2.renk + '18' : colors.card, borderColor: tip.key === t2.key ? t2.renk : colors.border }]}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: tip.key === t2.key ? t2.renk : colors.text }}>{t2.ad}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>CARİ</Text>
          <TouchableOpacity style={[styles.secBtn, { backgroundColor: colors.card, borderColor: cari ? colors.primary : colors.border }]}
            onPress={() => { setShowCariSecim(true); loadCariler(); }}>
            <Ionicons name="person-outline" size={18} color={cari ? colors.primary : colors.textSecondary} />
            <Text style={{ flex: 1, color: cari ? colors.text : colors.textSecondary, fontWeight: cari ? '700' : '400' }} numberOfLines={1}>{cari ? cari.ad : 'Cari seçin…'}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Ürün ekleme */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>ÜRÜNLER ({satirlar.length})</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.secBtn, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowUrunSecim(true)}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, flex: 1 }}>Ürün adı / barkod ara…</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secBtn, { backgroundColor: '#10B98118', borderColor: '#10B981', paddingHorizontal: 14 }]} onPress={scannerAc}>
              <Ionicons name="barcode-outline" size={20} color="#10B981" />
            </TouchableOpacity>
          </View>

          {satirlar.map((s, i) => (
            <View key={`${s.stok_id}-${i}`} style={[styles.satirRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>{s.ad}</Text>
                <Text style={{ fontSize: 10, color: colors.textSecondary }}>{s.barkod || s.kod}</Text>
              </View>
              <TextInput
                style={[styles.miniInput, { borderColor: colors.border, color: colors.text }]}
                value={String(s.miktar)} keyboardType="decimal-pad"
                onChangeText={(v) => setSatirlar((p) => p.map((x, xi) => xi === i ? { ...x, miktar: parseFloat(v.replace(',', '.')) || 0 } : x))}
              />
              <TextInput
                style={[styles.miniInput, { width: 74, borderColor: colors.border, color: colors.text }]}
                value={String(s.fiyat)} keyboardType="decimal-pad"
                onChangeText={(v) => setSatirlar((p) => p.map((x, xi) => xi === i ? { ...x, fiyat: parseFloat(v.replace(',', '.')) || 0 } : x))}
              />
              <Text style={{ width: 70, textAlign: 'right', fontSize: 12, fontWeight: '800', color: colors.text }}>{fmt(s.miktar * s.fiyat)}</Text>
              <TouchableOpacity onPress={() => setSatirlar((p) => p.filter((_, xi) => xi !== i))} hitSlop={8}>
                <Ionicons name="trash-outline" size={17} color="#EF4444" />
              </TouchableOpacity>
            </View>
          ))}

          {/* Ödeme tipi */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>ÖDEME TİPİ</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {ODEMELER.map((o) => (
              <TouchableOpacity key={o.key} onPress={() => setOdeme(o.key)}
                style={[styles.turChip, { flex: 1, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: odeme === o.key ? colors.primary + '18' : colors.card, borderColor: odeme === o.key ? colors.primary : colors.border }]}>
                <Ionicons name={o.icon as any} size={15} color={odeme === o.key ? colors.primary : colors.textSecondary} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: odeme === o.key ? colors.primary : colors.text }}>{o.ad}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {(odeme === 'nakit' || odeme === 'kart') && (
            <TouchableOpacity style={[styles.secBtn, { marginTop: 8, backgroundColor: colors.card, borderColor: kasa ? colors.primary : colors.border }]}
              onPress={() => { setShowKasaSecim(true); loadKasalar(); }}>
              <Ionicons name="business-outline" size={18} color={kasa ? colors.primary : colors.textSecondary} />
              <Text style={{ flex: 1, color: kasa ? colors.text : colors.textSecondary }} numberOfLines={1}>{kasa ? kasa.ad : 'Kasa/Banka seçin…'}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          <Text style={[styles.label, { color: colors.textSecondary }]}>AÇIKLAMA</Text>
          <TextInput style={inputStyle} value={aciklama} onChangeText={setAciklama} placeholder="İsteğe bağlı" placeholderTextColor={colors.textSecondary} />

          {/* Toplam + kaydet */}
          <View style={[styles.toplamRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>GENEL TOPLAM</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: colors.text }}>{fmt(toplam)}</Text>
          </View>
          <TouchableOpacity onPress={kaydet} disabled={busy} style={[styles.kaydetBtn, { backgroundColor: tip.renk, opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{busy ? 'Kaydediliyor…' : `${tip.ad} Kaydet`}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      {/* Ürün arama sheet */}
      {showUrunSecim && (
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowUrunSecim(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Ürün Ara</Text>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <TextInput
                style={[styles.input, { flex: 1, backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={urunAra} onChangeText={setUrunAra} onSubmitEditing={() => urunAraYap(urunAra)}
                placeholder="Ürün adı veya barkod…" placeholderTextColor={colors.textSecondary} autoFocus returnKeyType="search"
              />
              <TouchableOpacity onPress={() => urunAraYap(urunAra)} style={[styles.kaydetBtn, { backgroundColor: colors.primary, marginTop: 0, paddingHorizontal: 16, paddingVertical: 12 }]}>
                <Ionicons name="search" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
            {urunBusy ? <View style={{ padding: 20, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View> : (
              <FlatList
                data={urunler}
                keyExtractor={(u: any, i: number) => String(u.ID || i)}
                style={{ maxHeight: 340, marginTop: 8 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={{ color: colors.textSecondary, fontSize: 12, padding: 16 }}>Arama yapın…</Text>}
                renderItem={({ item: u }: any) => (
                  <TouchableOpacity style={[styles.sheetRow, { borderBottomColor: colors.border }]} onPress={() => satirEkle(u)}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{u.AD}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{u.BARKOD || u.KOD} · {fmt(parseFloat(u.FIYAT || '0'))}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      )}

      {/* Cari seçim sheet */}
      {showCariSecim && (
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowCariSecim(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Cari Seç</Text>
            <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, marginHorizontal: 16 }]}
              value={cariAra} onChangeText={setCariAra} placeholder="Cari ara…" placeholderTextColor={colors.textSecondary} autoFocus />
            {cariler.length === 0 ? <View style={{ padding: 24, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View> : (
              <FlatList data={filtreliCariler} keyExtractor={(c: any, i: number) => String(c.ID || i)} style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled"
                renderItem={({ item: c }: any) => (
                  <TouchableOpacity style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                    onPress={() => { setCari({ id: Number(c.ID || c.KART || 0), ad: String(c.AD || '') }); setShowCariSecim(false); setCariAra(''); }}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{c.AD}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{c.KOD || ''}</Text>
                  </TouchableOpacity>
                )} />
            )}
          </View>
        </View>
      )}

      {/* Kasa seçim sheet */}
      {showKasaSecim && (
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowKasaSecim(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Kasa / Banka Seç</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {kasalar.length === 0 && <Text style={{ color: colors.textSecondary, fontSize: 12, padding: 16 }}>Kasa listesi boş — Cariler → İşlem ekranından ekleyebilirsiniz.</Text>}
              {kasalar.map((k) => (
                <TouchableOpacity key={k.kart_id} style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                  onPress={() => { setKasa(k); setShowKasaSecim(false); }}>
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{k.ad}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>ID: {k.kart_id} · {k.tip}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Barkod tarayıcı */}
      {showScanner && CameraView && (
        <View style={[styles.overlay, { justifyContent: 'center', backgroundColor: '#000' }]}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'qr'] }}
            onBarcodeScanned={barkodOkundu}
          />
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scanClose}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={styles.scanHint}><Text style={{ color: '#fff', fontWeight: '700' }}>Barkodu okutun</Text></View>
        </View>
      )}

      {toast && (
        <View style={[styles.toast, { backgroundColor: toast.ok ? '#10B981' : '#EF4444' }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  turGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  turChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5 },
  secBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 13, borderRadius: 10, borderWidth: 1.5 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  miniInput: { width: 52, borderWidth: 1, borderRadius: 8, padding: 6, fontSize: 12, textAlign: 'center' },
  satirRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  toplamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 18 },
  kaydetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 15, borderRadius: 12, marginTop: 12 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 999, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingVertical: 12, paddingBottom: 28 },
  sheetTitle: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, marginBottom: 10 },
  sheetRow: { paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  scanClose: { position: 'absolute', top: 50, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 22, padding: 9 },
  scanHint: { position: 'absolute', bottom: 60, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  toast: { position: 'absolute', bottom: 30, left: 20, right: 20, padding: 14, borderRadius: 12, alignItems: 'center', zIndex: 10000 },
});
