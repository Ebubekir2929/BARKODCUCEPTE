/**
 * sayim-giris.tsx — Sayım Fişi Girişi (Faz 3) — 2026-07
 *
 * Hızlı stok sayımı: kamera SÜREKLİ açık kalır, her barkod okumada ilgili
 * ürünün sayılan miktarı +1 artar (barkod → ürün önbelleği ile tekrar
 * okumalarda API'ye gitmez). Manuel arama + miktar düzenleme + kaydet →
 * MySQL kuyruğu (islem_grubu='sayim', POS istemcisi ERP12'ye aktarır) → PDF.
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
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

// Kamera web'de crash yapabiliyor — lazy/safe import (fis-giris deseni)
let CameraView: any = null;
let useCameraPermissions: any = () => [null, async () => ({ granted: false })];
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
} catch {}

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface Satir { stok_id: number; barkod: string; kod: string; ad: string; miktar: number }

export default function SayimGirisScreen() {
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

  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [aciklama, setAciklama] = useState('');
  const [urunAra, setUrunAra] = useState('');
  const [urunler, setUrunler] = useState<any[]>([]);
  const [urunBusy, setUrunBusy] = useState(false);
  const [showUrunSecim, setShowUrunSecim] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [sonOkunan, setSonOkunan] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [sonKayit, setSonKayit] = useState<{ id: number; kalem: number; miktar: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const scanLock = useRef(false);
  const barkodCache = useRef<Map<string, any>>(new Map()); // barkod → ürün (tekrar okumada API yok)
  const satirlarRef = useRef<Satir[]>([]);
  satirlarRef.current = satirlar;

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2500); };
  const authHeaders = () => {
    const { token } = useAuthStore.getState();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` };
  };

  const toplamMiktar = useMemo(() => satirlar.reduce((s, r) => s + r.miktar, 0), [satirlar]);

  const satirEkle = useCallback((u: any, artis = 1) => {
    const id = Number(u.ID || 0);
    setSatirlar((prev) => {
      const i = prev.findIndex((s) => s.stok_id === id);
      if (i >= 0) {
        const kopya = [...prev];
        kopya[i] = { ...kopya[i], miktar: Math.max(0, kopya[i].miktar + artis) };
        return kopya;
      }
      return [{
        stok_id: id, barkod: String(u.BARKOD || ''), kod: String(u.KOD || ''),
        ad: String(u.AD || ''), miktar: Math.max(0, artis),
      }, ...prev];
    });
  }, []);

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

  // Sürekli tarama: scanner AÇIK KALIR, her okuma miktarı +1 artırır
  const barkodOkundu = async ({ data }: any) => {
    const barkod = String(data || '').trim();
    if (scanLock.current || !barkod) return;
    scanLock.current = true;
    try {
      let urun = barkodCache.current.get(barkod);
      if (!urun) {
        const r = await fetch(`${API_URL}/api/data/stock-list`, {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ tenant_id: activeTenantId, page: 1, page_size: 5, search: barkod }),
        });
        const j = await r.json();
        urun = (j.data || []).find((u: any) => String(u.BARKOD || '') === barkod) || (j.data || [])[0];
        if (urun) barkodCache.current.set(barkod, urun);
      }
      if (urun) {
        satirEkle(urun, 1);
        const mevcut = satirlarRef.current.find((s) => s.stok_id === Number(urun.ID || 0));
        setSonOkunan(`✓ ${urun.AD} → ${(mevcut?.miktar || 0) + 1}`);
      } else {
        setSonOkunan(`✗ Bulunamadı: ${barkod}`);
      }
    } catch { setSonOkunan('✗ Arama hatası'); }
    setTimeout(() => { scanLock.current = false; }, 1200);
  };

  const scannerAc = async () => {
    if (Platform.OS === 'web' || !CameraView) return showToast('Kamera yalnızca cihazda çalışır', false);
    if (!camPerm?.granted) {
      const r = await requestCamPerm();
      if (!r.granted) return showToast('Kamera izni verilmedi', false);
    }
    scanLock.current = false;
    setSonOkunan('');
    setShowScanner(true);
  };

  const pdfYazdir = async (kayitId: number) => {
    const html = `<html><head><meta charset="utf-8"><style>
      body{font-family:sans-serif;padding:24px;color:#111}
      h2{margin:0} .sub{color:#666;font-size:12px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;font-size:11px;text-align:left}
      th{background:#f5f5f5} .t{text-align:right}
    </style></head><body>
      <h2>Sayım Fişi</h2>
      <div class="sub">Belge: SYM-${String(kayitId).padStart(8, '0')} · ${new Date().toLocaleString('tr-TR')}${aciklama ? `<br/>Açıklama: ${aciklama}` : ''}</div>
      <table><thead><tr><th>#</th><th>Ürün</th><th>Barkod</th><th class="t">Sayılan Miktar</th></tr></thead><tbody>
      ${satirlar.map((s, i) => `<tr><td>${i + 1}</td><td>${s.ad}</td><td>${s.barkod || s.kod}</td><td class="t">${s.miktar}</td></tr>`).join('')}
      <tr><td colspan="3"><b>TOPLAM (${satirlar.length} kalem)</b></td><td class="t"><b>${toplamMiktar}</b></td></tr>
      </tbody></table></body></html>`;
    try {
      if (Platform.OS === 'web') await Print.printAsync({ html });
      else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Sayım Fişi PDF' });
      }
    } catch { showToast('PDF oluşturulamadı', false); }
  };

  const kaydet = async () => {
    if (busy) return;
    if (satirlar.length === 0) return showToast('En az bir ürün sayın', false);
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/islem/sayim-create`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, aciklama, satirlar }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.detail || 'Kaydedilemedi');
      setSonKayit({ id: j.id, kalem: j.toplam_kalem, miktar: j.toplam_miktar });
      showToast(`✓ Sayım fişi kaydedildi (#${j.id}) — POS aktaracak`);
    } catch (e: any) { showToast(String(e?.message || 'Hata'), false); }
    setBusy(false);
  };

  const yeniSayim = () => { setSatirlar([]); setAciklama(''); setSonKayit(null); };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Sayım Fişi</Text>
        <TouchableOpacity onPress={() => router.push('/kuyruk-durum')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="list-circle-outline" size={26} color={colors.text} />
        </TouchableOpacity>
      </View>

      {sonKayit ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
          <Ionicons name="checkmark-circle" size={64} color="#10B981" />
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Sayım Fişi Kaydedildi</Text>
          <Text style={{ color: colors.textSecondary }}>Belge #{sonKayit.id} · {sonKayit.kalem} kalem · {sonKayit.miktar} adet — POS istemcisi ERP12&apos;ye aktaracak</Text>
          <TouchableOpacity onPress={() => pdfYazdir(sonKayit.id)} style={[styles.kaydetBtn, { backgroundColor: colors.primary, width: '100%' }]}>
            <Ionicons name="document-text-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800' }}>PDF Yazdır / Paylaş</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={yeniSayim} style={[styles.kaydetBtn, { backgroundColor: '#10B981', width: '100%' }]}>
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800' }}>Yeni Sayım</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Büyük tarama butonu — sayımın ana aksiyonu */}
          <TouchableOpacity onPress={scannerAc} style={[styles.scanBigBtn, { backgroundColor: '#8B5CF6' }]}>
            <Ionicons name="barcode-outline" size={28} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Sürekli Barkod Tarama</Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>Her okuma miktarı +1 artırır, kamera açık kalır</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secBtn, { marginTop: 10, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowUrunSecim(true)}>
            <Ionicons name="search" size={16} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, flex: 1 }}>Ürün adı / barkod ile manuel ekle…</Text>
          </TouchableOpacity>

          {/* Özet */}
          <View style={[styles.ozetRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#8B5CF6' }}>{satirlar.length}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>KALEM</Text>
            </View>
            <View style={{ width: 1, backgroundColor: colors.border }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: colors.text }}>{toplamMiktar}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>TOPLAM MİKTAR</Text>
            </View>
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>SAYILAN ÜRÜNLER</Text>
          {satirlar.length === 0 && (
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>Henüz ürün sayılmadı — barkod okutun veya manuel ekleyin.</Text>
          )}
          {satirlar.map((s, i) => (
            <View key={`${s.stok_id}-${i}`} style={[styles.satirRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>{s.ad}</Text>
                <Text style={{ fontSize: 10, color: colors.textSecondary }}>{s.barkod || s.kod}</Text>
              </View>
              <TouchableOpacity onPress={() => setSatirlar((p) => p.map((x, xi) => xi === i ? { ...x, miktar: Math.max(0, x.miktar - 1) } : x))}
                style={[styles.stepBtn, { borderColor: colors.border }]} hitSlop={6}>
                <Ionicons name="remove" size={16} color={colors.text} />
              </TouchableOpacity>
              <TextInput
                style={[styles.miniInput, { borderColor: colors.border, color: colors.text }]}
                value={String(s.miktar)} keyboardType="decimal-pad"
                onChangeText={(v) => setSatirlar((p) => p.map((x, xi) => xi === i ? { ...x, miktar: parseFloat(v.replace(',', '.')) || 0 } : x))}
              />
              <TouchableOpacity onPress={() => setSatirlar((p) => p.map((x, xi) => xi === i ? { ...x, miktar: x.miktar + 1 } : x))}
                style={[styles.stepBtn, { borderColor: colors.border }]} hitSlop={6}>
                <Ionicons name="add" size={16} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSatirlar((p) => p.filter((_, xi) => xi !== i))} hitSlop={8}>
                <Ionicons name="trash-outline" size={17} color="#EF4444" />
              </TouchableOpacity>
            </View>
          ))}

          <Text style={[styles.label, { color: colors.textSecondary }]}>AÇIKLAMA</Text>
          <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            value={aciklama} onChangeText={setAciklama} placeholder="İsteğe bağlı (örn. depo sayımı)" placeholderTextColor={colors.textSecondary} />

          <TouchableOpacity onPress={kaydet} disabled={busy} style={[styles.kaydetBtn, { backgroundColor: '#8B5CF6', opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{busy ? 'Kaydediliyor…' : 'Sayım Fişini Kaydet'}</Text>
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
                  <TouchableOpacity style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                    onPress={() => { satirEkle(u, 1); showToast(`✓ ${u.AD} eklendi`); }}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{u.AD}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{u.BARKOD || u.KOD}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      )}

      {/* Sürekli barkod tarayıcı — okuma sonrası KAPANMAZ */}
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
          {/* Canlı sayaç + son okunan */}
          <View style={styles.scanInfo}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{satirlar.length} kalem · {toplamMiktar} adet</Text>
            {sonOkunan ? <Text style={{ color: sonOkunan.startsWith('✓') ? '#6EE7B7' : '#FCA5A5', fontSize: 12, marginTop: 3 }} numberOfLines={1}>{sonOkunan}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scanDone}>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800' }}>Taramayı Bitir</Text>
          </TouchableOpacity>
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
  scanBigBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14 },
  secBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 13, borderRadius: 10, borderWidth: 1.5 },
  ozetRow: { flexDirection: 'row', padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 14 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  miniInput: { width: 56, borderWidth: 1, borderRadius: 8, padding: 6, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  stepBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  satirRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  kaydetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 15, borderRadius: 12, marginTop: 16 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 999, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingVertical: 12, paddingBottom: 28 },
  sheetTitle: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, marginBottom: 10 },
  sheetRow: { paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  scanClose: { position: 'absolute', top: 50, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 22, padding: 9 },
  scanInfo: { position: 'absolute', top: 52, left: 20, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, maxWidth: '65%' },
  scanDone: { position: 'absolute', bottom: 46, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#8B5CF6', paddingHorizontal: 22, paddingVertical: 13, borderRadius: 26 },
  toast: { position: 'absolute', bottom: 30, left: 20, right: 20, padding: 14, borderRadius: 12, alignItems: 'center', zIndex: 10000 },
});
