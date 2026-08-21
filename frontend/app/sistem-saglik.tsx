// 2026-06 — Sistem Sağlığı ekranı: sunucu, veritabanı havuzu ve tünel durumu
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../src/store/themeStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface PoolInfo { acik: number; bos: number; min: number; max: number }
interface Durum {
  surum?: string;
  patron?: PoolInfo | null;
  data?: PoolInfo | null;
  tunel_aktif?: boolean;
  bellek_mb?: number;
  ram_cache?: { dataset_girdi: number; dataset_satir: number; global_girdi: number };
  derin_acquire?: number;
  derin_select1?: number;
  derin_meta_sorgu?: { sure: number; satir: number };
  derin_hata?: string;
}

export default function SistemSaglikScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStore();
  const [durum, setDurum] = useState<Durum | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [sure, setSure] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sonKontrol, setSonKontrol] = useState<Date | null>(null);

  const kontrolEt = useCallback(async () => {
    setLoading(true);
    setHata(null);
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const resp = await fetch(`${API_URL}/api/sistem-durum?derin=1`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`Sunucu hatası: ${resp.status}`);
      const j = await resp.json();
      setDurum(j);
      setSure(Date.now() - t0);
    } catch (e: any) {
      setHata(e?.name === 'AbortError' ? 'Sunucu yanıt vermedi (30 sn)' : (e?.message || 'Bağlantı hatası'));
      setDurum(null);
      setSure(null);
    } finally {
      setLoading(false);
      setSonKontrol(new Date());
    }
  }, []);

  useEffect(() => { kontrolEt(); }, [kontrolEt]);

  const dbSaglikli = !!durum && !durum.derin_hata && !!durum.derin_meta_sorgu;
  const genelDurum: { renk: string; ikon: any; baslik: string; detay: string } = (loading && !durum && !hata)
    ? { renk: '#3B82F6', ikon: 'time', baslik: 'Kontrol Ediliyor...', detay: 'Sunucu ve veritabanı test ediliyor' }
    : hata
    ? { renk: '#EF4444', ikon: 'close-circle', baslik: 'Sunucuya Ulaşılamıyor', detay: hata }
    : dbSaglikli
      ? { renk: '#10B981', ikon: 'checkmark-circle', baslik: 'Her Şey Yolunda', detay: 'Sunucu ve veritabanı sağlıklı çalışıyor' }
      : { renk: '#F59E0B', ikon: 'warning', baslik: 'Kısmi Sorun', detay: durum?.derin_hata || 'Veritabanı yanıtında gecikme var' };

  const PoolKart = ({ ad, p }: { ad: string; p?: PoolInfo | null }) => {
    if (!p) {
      return (
        <View style={[styles.satir, { borderBottomColor: colors.border }]}>
          <Text style={[styles.satirBaslik, { color: colors.text }]}>{ad}</Text>
          <Text style={[styles.kotu]}>başlatılmadı</Text>
        </View>
      );
    }
    const doluluk = p.acik > 0 ? (p.acik - p.bos) / p.max : 0;
    const renk = doluluk > 0.85 ? '#EF4444' : doluluk > 0.6 ? '#F59E0B' : '#10B981';
    return (
      <View style={[styles.satir, { borderBottomColor: colors.border }]}>
        <Text style={[styles.satirBaslik, { color: colors.text }]}>{ad}</Text>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <View style={[styles.bar, { backgroundColor: colors.border }]}>
            <View style={[styles.barDolu, { width: `${Math.min(100, doluluk * 100)}%`, backgroundColor: renk }]} />
          </View>
        </View>
        <Text style={[styles.satirDeger, { color: colors.textSecondary }]}>{p.acik - p.bos}/{p.max} meşgul</Text>
      </View>
    );
  };

  const OlcumSatir = ({ ad, deger, birim = 'sn', esik = 2 }: { ad: string; deger?: number | null; birim?: string; esik?: number }) => (
    <View style={[styles.satir, { borderBottomColor: colors.border }]}>
      <Text style={[styles.satirBaslik, { color: colors.text }]}>{ad}</Text>
      {deger == null
        ? <Text style={styles.kotu}>—</Text>
        : <Text style={{ fontWeight: '700', color: deger > esik ? '#F59E0B' : '#10B981' }}>{deger} {birim}</Text>}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.geriBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerBaslik, { color: colors.text }]}>Sistem Sağlığı</Text>
        <TouchableOpacity onPress={kontrolEt} style={styles.geriBtn} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="refresh" size={22} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={kontrolEt} tintColor={colors.primary} />}
      >
        {/* Genel durum kartı */}
        <View style={[styles.genelKart, { backgroundColor: genelDurum.renk + '15', borderColor: genelDurum.renk }]}>
          <Ionicons name={genelDurum.ikon} size={44} color={genelDurum.renk} />
          <Text style={[styles.genelBaslik, { color: genelDurum.renk }]}>{genelDurum.baslik}</Text>
          <Text style={[styles.genelDetay, { color: colors.textSecondary }]}>{genelDurum.detay}</Text>
          {sonKontrol && (
            <Text style={[styles.sonKontrol, { color: colors.textSecondary }]}>
              Son kontrol: {sonKontrol.toLocaleTimeString('tr-TR')}
            </Text>
          )}
        </View>

        {durum && (
          <>
            {/* Bağlantı bilgileri */}
            <Text style={[styles.bolumBaslik, { color: colors.textSecondary }]}>BAĞLANTI</Text>
            <View style={[styles.kart, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.satir, { borderBottomColor: colors.border }]}>
                <Text style={[styles.satirBaslik, { color: colors.text }]}>Sunucu Yanıt Süresi</Text>
                <Text style={{ fontWeight: '700', color: (sure || 0) > 3000 ? '#F59E0B' : '#10B981' }}>
                  {sure != null ? `${(sure / 1000).toFixed(1)} sn` : '—'}
                </Text>
              </View>
              <View style={[styles.satir, { borderBottomColor: colors.border }]}>
                <Text style={[styles.satirBaslik, { color: colors.text }]}>Veritabanı Yolu</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons
                    name={durum.tunel_aktif ? 'shield-checkmark' : 'flash'}
                    size={16}
                    color={durum.tunel_aktif ? '#F59E0B' : '#10B981'}
                  />
                  <Text style={{ fontWeight: '600', color: durum.tunel_aktif ? '#F59E0B' : '#10B981' }}>
                    {durum.tunel_aktif ? 'Güvenli Tünel' : 'Direkt Bağlantı'}
                  </Text>
                </View>
              </View>
              <View style={[styles.satir, { borderBottomWidth: 0 }]}>
                <Text style={[styles.satirBaslik, { color: colors.text }]}>Sunucu Sürümü</Text>
                <Text style={[styles.satirDeger, { color: colors.textSecondary }]}>{durum.surum || '—'}</Text>
              </View>
            </View>

            {/* Havuzlar */}
            <Text style={[styles.bolumBaslik, { color: colors.textSecondary }]}>VERİTABANI BAĞLANTI HAVUZU</Text>
            <View style={[styles.kart, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {typeof durum.bellek_mb === 'number' && (
                <View style={[styles.satir, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.satirBaslik, { color: colors.text }]}>Sunucu Belleği</Text>
                  <Text style={{ fontWeight: '700', color: durum.bellek_mb > 450 ? '#EF4444' : durum.bellek_mb > 300 ? '#F59E0B' : '#10B981' }}>
                    {durum.bellek_mb.toFixed(0)} MB
                    {durum.ram_cache ? `  ·  ${durum.ram_cache.dataset_satir.toLocaleString('tr-TR')} önbellek satırı` : ''}
                  </Text>
                </View>
              )}
              <PoolKart ad="Kullanıcı DB" p={durum.patron} />
              <PoolKart ad="Veri DB" p={durum.data} />
            </View>

            {/* Sorgu ölçümleri */}
            <Text style={[styles.bolumBaslik, { color: colors.textSecondary }]}>SORGU HIZLARI</Text>
            <View style={[styles.kart, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <OlcumSatir ad="Basit Sorgu" deger={durum.derin_select1} />
              <OlcumSatir
                ad={`Veri Sorgusu${durum.derin_meta_sorgu ? ` (${durum.derin_meta_sorgu.satir} satır)` : ''}`}
                deger={durum.derin_meta_sorgu?.sure}
              />
              {durum.derin_hata ? (
                <View style={[styles.satir, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.satirBaslik, { color: '#EF4444' }]}>Hata</Text>
                  <Text style={[styles.kotu, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>{durum.derin_hata}</Text>
                </View>
              ) : null}
            </View>
          </>
        )}

        <Text style={[styles.aciklamaMetin, { color: colors.textSecondary }]}>
          Bu ekran sunucunun, veritabanı bağlantılarının ve sorgu hızlarının anlık durumunu gösterir.
          Uygulamada yavaşlık veya bağlantı sorunu yaşarsanız buradan kontrol edebilirsiniz.
        </Text>
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
  geriBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerBaslik: { fontSize: 17, fontWeight: '700' },
  genelKart: {
    borderRadius: 16, borderWidth: 1, alignItems: 'center',
    paddingVertical: 24, paddingHorizontal: 16, marginBottom: 8,
  },
  genelBaslik: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  genelDetay: { fontSize: 13, marginTop: 4, textAlign: 'center' },
  sonKontrol: { fontSize: 11, marginTop: 8 },
  bolumBaslik: { fontSize: 12, fontWeight: '700', marginTop: 20, marginBottom: 8, letterSpacing: 0.5 },
  kart: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  satir: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1,
  },
  satirBaslik: { fontSize: 14, fontWeight: '500' },
  satirDeger: { fontSize: 13, fontWeight: '600' },
  kotu: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barDolu: { height: 8, borderRadius: 4 },
  aciklamaMetin: { fontSize: 12, lineHeight: 18, marginTop: 20, textAlign: 'center', paddingHorizontal: 8 },
});
