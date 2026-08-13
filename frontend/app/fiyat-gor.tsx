// 2026-06 — Barkoddan Fiyat Gör: barkod okut → tüm fiyat adlarındaki
// fiyatlar + stok miktarı + ürün bilgileri. Art arda okutma destekli.
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, Alert, Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useDataSourceStore } from '../src/store/dataSourceStore';

let CameraView: any = null;
let useCameraPermissions: any = () => [null, async () => ({ granted: false })];
try {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
} catch {}

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface FiyatSatir { fiyat_ad_id: number; fiyat_adi: string; fiyat: any; doviz: string; kdv_dahil?: boolean }
interface Sonuc {
  found: boolean;
  barkod: string;
  urun?: { ad: string; kod: string; barkod: string; miktar: any; birim?: string; aktif?: boolean; kdv?: any };
  fiyatlar?: FiyatSatir[];
}

const fmtFiyat = (v: any, doviz = 'TRY') => {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  const sym = doviz === 'TRY' ? '₺' : doviz + ' ';
  return sym + n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function FiyatGorScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStore();
  const { user, token } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const activeTenantId = React.useMemo(() => {
    if (!user?.tenants?.length) return '';
    const m = /^data(\d+)$/.exec(activeSource || '');
    const idx = m ? parseInt(m[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);
  const [permission, requestPermission] = useCameraPermissions();
  const [kameraAcik, setKameraAcik] = useState(false);
  const [manuelBarkod, setManuelBarkod] = useState('');
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const sonOkunan = useRef<{ kod: string; ts: number }>({ kod: '', ts: 0 });

  const fiyatSorgula = useCallback(async (barkod: string) => {
    const kod = barkod.trim();
    if (!kod) return;
    setYukleniyor(true);
    try {
      const resp = await fetch(`${API_URL}/api/data/barcode-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, barkod: kod }),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.detail || 'Sorgu hatası');
      setSonuc(j);
    } catch (e: any) {
      Alert.alert('Hata', e?.message || 'Fiyat sorgulanamadı');
    } finally {
      setYukleniyor(false);
    }
  }, [token, activeTenantId]);

  const barkodOkundu = useCallback((data: string) => {
    const now = Date.now();
    // Aynı barkod 2 sn içinde tekrar okunursa yoksay
    if (sonOkunan.current.kod === data && now - sonOkunan.current.ts < 2000) return;
    sonOkunan.current = { kod: data, ts: now };
    fiyatSorgula(data);
  }, [fiyatSorgula]);

  const kameraAc = async () => {
    if (!CameraView) {
      Alert.alert('Kamera Yok', 'Bu cihazda kamera modülü kullanılamıyor. Barkodu elle yazabilirsiniz.');
      return;
    }
    if (permission?.granted) { setKameraAcik(true); return; }
    if (permission && !permission.canAskAgain) {
      Alert.alert(
        'Kamera İzni Gerekli',
        'Barkod taramak için kamera izni gerekiyor. Ayarlardan izin verebilirsiniz.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Ayarları Aç', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    Alert.alert('Kamera İzni', 'Ürün barkodunu okutup fiyatını anında görmek için kamera izni gerekiyor.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İzin Ver',
        onPress: async () => {
          const res = await requestPermission();
          if (res?.granted) setKameraAcik(true);
          else if (res && !res.canAskAgain) {
            Alert.alert('İzin Reddedildi', 'Ayarlardan kamera iznini açabilirsiniz.', [
              { text: 'Tamam', style: 'cancel' },
              { text: 'Ayarları Aç', onPress: () => Linking.openSettings() },
            ]);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Fiyat Gör</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Kamera alanı */}
      {kameraAcik && CameraView && permission?.granted ? (
        <View style={styles.kameraKutu}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={(r: any) => { if (r?.data) barkodOkundu(String(r.data)); }}
          />
          <View style={styles.kameraCizgi} pointerEvents="none" />
          <TouchableOpacity
            style={styles.kameraKapat}
            onPress={() => setKameraAcik(false)}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.kameraIpucu}>
            <Text style={styles.kameraIpucuText}>Barkodu çerçeveye hizalayın · art arda okutabilirsiniz</Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={[styles.kameraPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={kameraAc}>
          <Ionicons name="barcode-outline" size={44} color={colors.primary} />
          <Text style={[styles.kameraPlaceholderText, { color: colors.text }]}>Barkod Taramak İçin Dokunun</Text>
        </TouchableOpacity>
      )}

      {/* Manuel giriş */}
      <View style={[styles.manuelSatir, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[styles.manuelInput, { color: colors.text }]}
          placeholder="Barkod veya stok kodu yazın"
          placeholderTextColor={colors.textSecondary}
          value={manuelBarkod}
          onChangeText={setManuelBarkod}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          returnKeyType="search"
          onSubmitEditing={() => fiyatSorgula(manuelBarkod)}
        />
        <TouchableOpacity onPress={() => fiyatSorgula(manuelBarkod)} style={[styles.araBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.araBtnText}>Ara</Text>
        </TouchableOpacity>
      </View>

      {/* Sonuç */}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        {yukleniyor && <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />}

        {!yukleniyor && sonuc && !sonuc.found && (
          <View style={[styles.bulunamadi, { backgroundColor: '#EF444415', borderColor: '#EF4444' }]}>
            <Ionicons name="alert-circle" size={36} color="#EF4444" />
            <Text style={[styles.bulunamadiText, { color: '#EF4444' }]}>Ürün bulunamadı</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Barkod: {sonuc.barkod}</Text>
          </View>
        )}

        {!yukleniyor && sonuc?.found && sonuc.urun && (
          <>
            {/* Ürün bilgisi */}
            <View style={[styles.urunKart, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.urunAd, { color: colors.text }]}>{sonuc.urun.ad}</Text>
              <View style={styles.urunMetaRow}>
                <View style={styles.urunMeta}>
                  <Ionicons name="barcode-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.urunMetaText, { color: colors.textSecondary }]}>{sonuc.urun.barkod || '—'}</Text>
                </View>
                <View style={styles.urunMeta}>
                  <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.urunMetaText, { color: colors.textSecondary }]}>{sonuc.urun.kod || '—'}</Text>
                </View>
              </View>
              <View style={[styles.miktarSatir, { borderTopColor: colors.border }]}>
                <Text style={[styles.miktarLabel, { color: colors.textSecondary }]}>Stok Miktarı</Text>
                <Text style={[styles.miktarDeger, { color: Number(sonuc.urun.miktar) > 0 ? '#10B981' : '#EF4444' }]}>
                  {Number(sonuc.urun.miktar || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                  {sonuc.urun.birim ? ` ${sonuc.urun.birim}` : ''}
                </Text>
              </View>
            </View>

            {/* Fiyatlar */}
            <Text style={[styles.bolumBaslik, { color: colors.textSecondary }]}>FİYATLAR</Text>
            {(sonuc.fiyatlar || []).map((f) => (
              <View key={String(f.fiyat_ad_id)} style={[styles.fiyatKart, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View>
                  <Text style={[styles.fiyatAdi, { color: colors.text }]}>{f.fiyat_adi}</Text>
                  {f.kdv_dahil != null && (
                    <Text style={{ fontSize: 11, color: colors.textSecondary }}>{f.kdv_dahil ? 'KDV Dahil' : 'KDV Hariç'}</Text>
                  )}
                </View>
                <Text style={[styles.fiyatDeger, { color: colors.primary }]}>{fmtFiyat(f.fiyat, f.doviz)}</Text>
              </View>
            ))}
            {(sonuc.fiyatlar || []).length === 0 && (
              <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 8 }}>Fiyat kaydı bulunamadı</Text>
            )}
          </>
        )}

        {!yukleniyor && !sonuc && (
          <View style={{ alignItems: 'center', marginTop: 32 }}>
            <Ionicons name="pricetags-outline" size={48} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
              Barkod okutun veya elle yazın —{'\n'}ürünün tüm fiyatları burada görünecek
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  kameraKutu: { height: 220, overflow: 'hidden' },
  kameraCizgi: {
    position: 'absolute', left: '15%', right: '15%', top: '48%', height: 2,
    backgroundColor: '#EF4444', opacity: 0.8, borderRadius: 1,
  },
  kameraKapat: {
    position: 'absolute', top: 10, right: 10, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  kameraIpucu: {
    position: 'absolute', bottom: 8, left: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10,
  },
  kameraIpucuText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  kameraPlaceholder: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 8,
  },
  kameraPlaceholderText: { fontSize: 15, fontWeight: '600' },
  manuelSatir: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  manuelInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  araBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9 },
  araBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  bulunamadi: {
    borderRadius: 14, borderWidth: 1, alignItems: 'center',
    paddingVertical: 22, gap: 6, marginTop: 8,
  },
  bulunamadiText: { fontSize: 16, fontWeight: '700' },
  urunKart: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 4 },
  urunAd: { fontSize: 17, fontWeight: '800' },
  urunMetaRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  urunMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  urunMetaText: { fontSize: 12.5 },
  miktarSatir: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, marginTop: 12, paddingTop: 12,
  },
  miktarLabel: { fontSize: 13, fontWeight: '600' },
  miktarDeger: { fontSize: 16, fontWeight: '800' },
  bolumBaslik: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  fiyatKart: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
  },
  fiyatAdi: { fontSize: 15, fontWeight: '600' },
  fiyatDeger: { fontSize: 19, fontWeight: '800' },
});
