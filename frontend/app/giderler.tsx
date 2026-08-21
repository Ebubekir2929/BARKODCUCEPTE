// 2026-08 — Giderler ekranı: Gelir Tablosu (rap_lm_gelir_tablosu) verisinden
// GİDERLER grubunu ayıklayıp kalem kalem gösterir. Tarih aralığı + lokasyon seçimi.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useDataSourceStore } from '../src/store/dataSourceStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface GiderKalem { aciklama: string; tutar: number; kod: string }
interface Ozet { toplamGider: number; netSatis: number; brutKar: number; karZarar: number }

const fmt = (v: number) =>
  '₺' + Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tarihStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Aralik = 'bugun' | 'hafta' | 'ay' | 'gecenay';
const ARALIKLAR: { key: Aralik; label: string }[] = [
  { key: 'bugun', label: 'Bugün' },
  { key: 'hafta', label: 'Son 7 Gün' },
  { key: 'ay', label: 'Bu Ay' },
  { key: 'gecenay', label: 'Geçen Ay' },
];

function aralikTarihleri(a: Aralik): { bas: string; bit: string } {
  const simdi = new Date();
  if (a === 'bugun') return { bas: tarihStr(simdi), bit: tarihStr(simdi) };
  if (a === 'hafta') {
    const b = new Date(simdi); b.setDate(b.getDate() - 6);
    return { bas: tarihStr(b), bit: tarihStr(simdi) };
  }
  if (a === 'gecenay') {
    const ilk = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const son = new Date(simdi.getFullYear(), simdi.getMonth(), 0);
    return { bas: tarihStr(ilk), bit: tarihStr(son) };
  }
  return { bas: tarihStr(new Date(simdi.getFullYear(), simdi.getMonth(), 1)), bit: tarihStr(simdi) };
}

export default function GiderlerScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStore();
  const { user, token } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants?.length) return '';
    const m = /^data(\d+)$/.exec(activeSource || '');
    const idx = m ? parseInt(m[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [aralik, setAralik] = useState<Aralik>('ay');
  const [lokasyonlar, setLokasyonlar] = useState<{ value: string; label: string }[]>([]);
  const [seciliLokasyon, setSeciliLokasyon] = useState<string>('');
  const [lokasyonAcik, setLokasyonAcik] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [kalemler, setKalemler] = useState<GiderKalem[]>([]);
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [eskiVeri, setEskiVeri] = useState(false);

  // Lokasyon seçenekleri
  useEffect(() => {
    if (!token || !activeTenantId) return;
    (async () => {
      try {
        const resp = await fetch(`${API_URL}/api/data/report-filter-options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId, source: 'LOKASYON' }),
        });
        const j = await resp.json();
        if (j?.ok && Array.isArray(j.data)) {
          const opts = j.data.map((r: any) => ({
            value: String(r.ID ?? r.AD ?? ''),
            label: String(r.AD || r.ID || ''),
          })).filter((o: any) => o.value);
          setLokasyonlar(opts);
          if (opts.length > 0) setSeciliLokasyon((prev) => prev || opts[0].value);
        }
      } catch { /* sessiz */ }
    })();
  }, [token, activeTenantId]);

  const veriIsle = useCallback((rows: any[]) => {
    const giderler: GiderKalem[] = [];
    let toplamGider = 0, netSatis = 0, brutKar = 0, karZarar = 0;
    for (const r of rows || []) {
      const grup = String(r?.GRUP || '');
      const seviye = Number(r?.SEVIYE ?? -1);
      const tutar = parseFloat(String(r?.TUTAR ?? '0')) || 0;
      if (grup === 'GİDERLER') {
        if (seviye === 0) toplamGider = tutar;
        else giderler.push({ aciklama: String(r?.ACIKLAMA || 'Gider'), tutar, kod: String(r?.KOD || '') });
      } else if (grup === 'NET SATIŞLAR' && seviye === 0) netSatis = tutar;
      else if (grup === 'BRÜT SATIŞ KARI VEYA ZARARI' && seviye === 0) brutKar = tutar;
      else if (grup === 'KAR VEYA ZARARI' && seviye === 0) karZarar = tutar;
    }
    giderler.sort((a, b) => Math.abs(b.tutar) - Math.abs(a.tutar));
    setKalemler(giderler);
    setOzet({ toplamGider, netSatis, brutKar, karZarar });
  }, []);

  const getir = useCallback(async () => {
    if (!token || !activeTenantId || !seciliLokasyon) return;
    setYukleniyor(true);
    setHata(null);
    setEskiVeri(false);
    const { bas, bit } = aralikTarihleri(aralik);
    const body = {
      tenant_id: activeTenantId,
      dataset_key: 'rap_lm_gelir_tablosu',
      params: {
        BASTARIH: `${bas} 00:00:00`, BITTARIH: `${bit} 23:59:59`,
        KdvDahil: 0, Lokasyon: seciliLokasyon,
        SatisGrupGoster: 1, IadeGrupGoster: 1, MaliyetGrupGoster: 1,
        Page: 1, PageSize: 500,
      },
      fetch_all: true,
    };
    try {
      // 1) Anında cache
      try {
        const cResp = await fetch(`${API_URL}/api/data/report-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...body, cache_only: true }),
        });
        const cJson = await cResp.json().catch(() => ({}));
        if (cJson?.ok && Array.isArray(cJson.data) && cJson.data.length > 0) {
          veriIsle(cJson.data);
          setEskiVeri(true);
          setYukleniyor(false);
        }
      } catch { /* cache miss */ }
      // 2) Taze veri
      const resp = await fetch(`${API_URL}/api/data/report-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await resp.json();
      if (!j?.ok) throw new Error(j?.detail || 'Rapor alınamadı');
      veriIsle(j.data || []);
      setEskiVeri(false);
    } catch (e: any) {
      if (kalemler.length === 0) setHata(e?.message || 'Bağlantı hatası');
    } finally {
      setYukleniyor(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId, seciliLokasyon, aralik, veriIsle]);

  useEffect(() => { getir(); }, [getir]);

  const seciliLokasyonAd = lokasyonlar.find((l) => l.value === seciliLokasyon)?.label || 'Lokasyon seçin';
  const toplam = ozet ? Math.abs(ozet.toplamGider) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Giderler</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Aralık seçici */}
      <View style={styles.aralikSatir}>
        {ARALIKLAR.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[styles.aralikBtn, {
              backgroundColor: aralik === a.key ? colors.primary : colors.card,
              borderColor: aralik === a.key ? colors.primary : colors.border,
            }]}
            onPress={() => setAralik(a.key)}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: aralik === a.key ? '#fff' : colors.text }}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Lokasyon seçici */}
      <TouchableOpacity
        style={[styles.lokasyonBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => setLokasyonAcik((v) => !v)}
      >
        <Ionicons name="location-outline" size={16} color={colors.primary} />
        <Text style={[{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.text }]} numberOfLines={1}>{seciliLokasyonAd}</Text>
        <Ionicons name={lokasyonAcik ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>
      {lokasyonAcik && (
        <View style={[styles.lokasyonListe, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {lokasyonlar.map((l) => (
            <TouchableOpacity
              key={l.value}
              style={styles.lokasyonSecenek}
              onPress={() => { setSeciliLokasyon(l.value); setLokasyonAcik(false); }}
            >
              <Text style={{ fontSize: 13, color: l.value === seciliLokasyon ? colors.primary : colors.text, fontWeight: l.value === seciliLokasyon ? '700' : '400' }}>
                {l.label}
              </Text>
              {l.value === seciliLokasyon && <Ionicons name="checkmark" size={16} color={colors.primary} />}
            </TouchableOpacity>
          ))}
          {lokasyonlar.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.textSecondary, padding: 10 }}>Lokasyon listesi yükleniyor…</Text>
          )}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={getir} tintColor={colors.primary} />}
      >
        {yukleniyor && kalemler.length === 0 && <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />}

        {hata && kalemler.length === 0 && !yukleniyor && (
          <View style={{ alignItems: 'center', marginTop: 32, gap: 8 }}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>{hata}</Text>
            <TouchableOpacity style={[styles.tekrarBtn, { backgroundColor: colors.primary }]} onPress={getir}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Tekrar Dene</Text>
            </TouchableOpacity>
          </View>
        )}

        {ozet && (
          <>
            {eskiVeri && (
              <View style={[styles.eskiVeriBant, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B' }]}>
                <Ionicons name="time-outline" size={14} color="#F59E0B" />
                <Text style={{ fontSize: 11.5, color: '#B45309', flex: 1 }}>Önbellek verisi gösteriliyor, güncel veri yükleniyor…</Text>
                {yukleniyor && <ActivityIndicator size="small" color="#F59E0B" />}
              </View>
            )}

            {/* Toplam gider kartı */}
            <View style={[styles.toplamKart, { backgroundColor: '#EF444412', borderColor: '#EF444440' }]}>
              <View style={[styles.toplamIkon, { backgroundColor: '#EF444422' }]}>
                <Ionicons name="trending-down" size={24} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary }}>TOPLAM GİDER</Text>
                <Text style={{ fontSize: 26, fontWeight: '800', color: '#EF4444' }}>{fmt(toplam)}</Text>
              </View>
            </View>

            {/* Özet satırları */}
            <View style={[styles.ozetKart, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.ozetSatir}>
                <Text style={[styles.ozetLabel, { color: colors.textSecondary }]}>Net Satışlar</Text>
                <Text style={[styles.ozetDeger, { color: colors.text }]}>{fmt(ozet.netSatis)}</Text>
              </View>
              <View style={[styles.ozetAyrac, { backgroundColor: colors.border }]} />
              <View style={styles.ozetSatir}>
                <Text style={[styles.ozetLabel, { color: colors.textSecondary }]}>Brüt Kâr</Text>
                <Text style={[styles.ozetDeger, { color: ozet.brutKar >= 0 ? '#10B981' : '#EF4444' }]}>{fmt(ozet.brutKar)}</Text>
              </View>
              <View style={[styles.ozetAyrac, { backgroundColor: colors.border }]} />
              <View style={styles.ozetSatir}>
                <Text style={[styles.ozetLabel, { color: colors.textSecondary }]}>Kâr / Zarar</Text>
                <Text style={[styles.ozetDeger, { color: ozet.karZarar >= 0 ? '#10B981' : '#EF4444' }]}>
                  {ozet.karZarar >= 0 ? '' : '-'}{fmt(ozet.karZarar)}
                </Text>
              </View>
            </View>

            {/* Gider kalemleri */}
            <Text style={[styles.bolumBaslik, { color: colors.textSecondary }]}>GİDER KALEMLERİ ({kalemler.length})</Text>
            {kalemler.map((k, i) => {
              const pay = toplam > 0 ? (Math.abs(k.tutar) / toplam) * 100 : 0;
              return (
                <View key={`${k.kod}-${i}`} style={[styles.kalemKart, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={[{ fontSize: 13.5, fontWeight: '600', color: colors.text }]} numberOfLines={2}>{k.aciklama}</Text>
                    <View style={[styles.payBar, { backgroundColor: colors.border }]}>
                      <View style={[styles.payDolu, { width: `${Math.min(100, pay)}%`, backgroundColor: '#EF4444' }]} />
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#EF4444' }}>{fmt(k.tutar)}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary }}>%{pay.toFixed(1)}</Text>
                  </View>
                </View>
              );
            })}
            {kalemler.length === 0 && !yukleniyor && (
              <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 12 }}>Bu aralıkta gider kaydı yok</Text>
            )}
          </>
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
  aralikSatir: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  aralikBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  lokasyonBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1,
  },
  lokasyonListe: { marginHorizontal: 16, marginTop: 4, borderRadius: 10, borderWidth: 1, maxHeight: 220, overflow: 'hidden' },
  lokasyonSecenek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  eskiVeriBant: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10 },
  toplamKart: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 16 },
  toplamIkon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  ozetKart: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginTop: 10 },
  ozetSatir: { flex: 1, alignItems: 'center', gap: 2 },
  ozetAyrac: { width: 1 },
  ozetLabel: { fontSize: 11, fontWeight: '600' },
  ozetDeger: { fontSize: 13.5, fontWeight: '800' },
  bolumBaslik: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  kalemKart: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  payBar: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  payDolu: { height: 4, borderRadius: 2 },
  tekrarBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
});
