/**
 * IptalDetailModal — Push notification "Fiş İptal" bildirimine tıklayınca açılır.
 *
 * 2026-05-06 — Sıfırdan yazıldı. Eski inline modal (dashboard.tsx içinde 140 satır
 * gömülü) tamamen silindi.
 *
 * AKIŞ:
 *  - Bildirim payload'unda `iptal_id` (ZORUNLU) ve `tenant` gelir.
 *  - Modal açılır → `POST /api/data/iptal-detail { tenant_id, iptal_id }` çağırılır.
 *  - Backend response: `{ ok, header: {...}, data: [...] }`
 *      • `header` — fiş bilgileri (LOKASYON, SAAT, PERSONEL, TUTAR, MASA, ...)
 *      • `data`   — ürün satırları (STOK_ADI, MIKTAR, BIRIM_ADI, SATIR_TUTAR, ...)
 *
 * UI:
 *  - Üst: Kırmızı header — "Fiş İptal" + close
 *  - Hero: Tutar (büyük, kırmızı) + chip'ler: Saat · Lokasyon · Veri Kaynağı · İptal Eden
 *  - Body: Ürün listesi (kalem)
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  tenantId: string;
  iptalId: string;
  tenantName?: string;
}

type Header = {
  TUTAR?: string | number;
  IPTAL_TIPI?: string;
  IPTAL_SAATI?: string;
  SAAT?: string;
  IPTAL_TARIH?: string;
  LOKASYON?: string;
  PERSONEL_AD?: string;
  PERSONEL?: string;
  MASA?: string;
  MASA_AD?: string;
  [key: string]: any;
};

type Line = {
  STOK_ADI?: string;
  MIKTAR?: string | number;
  BIRIM_ADI?: string;
  SATIR_TUTAR?: string | number;
  MASA?: string;
  SAAT?: string;
  [key: string]: any;
};

export const IptalDetailModal: React.FC<Props> = ({
  visible, onClose, tenantId, iptalId, tenantName,
}) => {
  const { colors } = useThemeStore();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // SWR arka plan yenileme
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const apiBase = process.env.EXPO_PUBLIC_BACKEND_URL || '';

  const reset = useCallback(() => {
    setHeader(null); setLines([]); setError(null); setLoading(false); setRefreshing(false);
  }, []);

  // Modal kapatılınca state sıfırla
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  // 2026-06 — SWR akışı:
  //  1) Cache-only istek → anında (~200ms) render. Header + varsa satırlar.
  //  2) Satır detayı cache'te yoksa allow_fetch=true ile SESSİZ arka plan
  //     isteği → POS'tan taze detay gelir, UI blokaj olmadan güncellenir.
  useEffect(() => {
    if (!visible || !iptalId || !tenantId) return;
    let cancelled = false;

    const fetchDetail = async (allowFetch: boolean) => {
      const { token } = useAuthStore.getState();
      if (!token) throw new Error('Oturum bulunamadı');
      const r = await fetch(`${apiBase}/api/data/iptal-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tenant_id: tenantId,
          iptal_id: iptalId,
          ...(allowFetch ? { allow_fetch: true } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.detail || 'Fiş iptal detayı alınamadı');
      return j;
    };

    (async () => {
      try {
        setLoading(true);
        setError(null);
        // 1) Cache'ten anında göster
        const cached = await fetchDetail(false);
        if (cancelled) return;
        const cachedHeader: Header | null =
          (cached.header && typeof cached.header === 'object' && Object.keys(cached.header).length > 0)
            ? cached.header : null;
        const cachedLines: Line[] = Array.isArray(cached.data) ? cached.data : [];
        setHeader(cachedHeader);
        setLines(cachedLines);
        const cacheHasAnything = !!cachedHeader || cachedLines.length > 0;
        if (cacheHasAnything) setLoading(false);

        // 2) Satır detayı eksikse arka planda POS'tan taze çek (sessiz)
        if (cachedLines.length === 0) {
          setRefreshing(true);
          try {
            const fresh = await fetchDetail(true);
            if (cancelled) return;
            const freshLines: Line[] = Array.isArray(fresh.data) ? fresh.data : [];
            if (freshLines.length > 0) setLines(freshLines);
            if (fresh.header && typeof fresh.header === 'object' && Object.keys(fresh.header).length > 0) {
              setHeader(fresh.header);
            }
          } catch (e: any) {
            // Cache'te hiçbir şey yoksa ve taze istek de başarısızsa → hata göster
            if (!cancelled && !cacheHasAnything) {
              setError(String(e?.message || e || 'Fiş iptal detayı alınamadı'));
            }
          } finally {
            if (!cancelled) { setRefreshing(false); setLoading(false); }
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message || e || 'Bağlantı hatası'));
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, iptalId, tenantId, apiBase]);

  const totals = useMemo(() => {
    const tutar = parseFloat(String(header?.TUTAR ?? '')) || lines.reduce((s, l) => s + (parseFloat(String(l.SATIR_TUTAR ?? '')) || 0), 0);
    const kalemSayisi = lines.length;
    return { tutar, kalemSayisi };
  }, [header, lines]);

  const headerInfo = useMemo(() => {
    // 2026-05-06 — iptal_ozet dataset'indeki gerçek field isimleri:
    // IPTAL_TIPI, LOKASYON, LOKASYON_ID, PERSONEL_AD, PERSONEL_ID, SATIR_MI,
    // TARIH, TARIH_IPTAL, TUTAR, DETAY_SATIR_SAYISI
    const saatRaw = String(
      header?.TARIH_IPTAL || header?.TARIH || header?.IPTAL_SAATI || header?.SAAT || header?.IPTAL_TARIH || ''
    ).trim();
    // "2026-05-02 17:27:33" → "17:27:33" (saat kısmını ön plana çıkar)
    let saat = saatRaw;
    if (saatRaw.includes(' ')) {
      const [d, t] = saatRaw.split(' ');
      saat = t ? `${t}` : d;
    }
    const lokasyon = String(header?.LOKASYON || header?.LOKASYON_ADI || '').trim();
    const personel = String(header?.PERSONEL_AD || header?.PERSONEL || header?.KULLANICI || '').trim();
    const masa = String(header?.MASA || header?.MASA_AD || '').trim();
    const iptalTipi = String(header?.IPTAL_TIPI || 'İPTAL').trim().toUpperCase();
    const detaySayisi = parseInt(String(header?.DETAY_SATIR_SAYISI || ''), 10) || lines.length;
    const tarih = saatRaw.split(' ')[0]; // sadece tarih kısmı
    return { saat, lokasyon, personel, masa, iptalTipi, detaySayisi, tarih };
  }, [header, lines.length]);

  const RED = '#EF4444';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      transparent={Platform.OS !== 'ios'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        {/* Header bar */}
        <View style={[styles.header, { backgroundColor: RED, paddingTop: Platform.OS === 'ios' ? 14 : 18 }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="close-circle" size={22} color="#fff" />
              <Text style={styles.headerTitle}>Fiş İptal</Text>
            </View>
            <Text style={styles.headerSubtitle}>
              {[`#${iptalId}`, tenantName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Body */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={RED} />
            <Text style={{ marginTop: 12, color: colors.textSecondary }}>İptal detayı yükleniyor…</Text>
          </View>
        ) : error ? (
          <View style={styles.loadingWrap}>
            <Ionicons name="warning" size={36} color={colors.error} />
            <Text style={{ marginTop: 8, color: colors.error, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{error}</Text>
            <Text style={{ marginTop: 4, color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 }}>
              Veri henüz cache'e düşmemiş olabilir, birkaç saniye sonra tekrar deneyin.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {/* Hero — Tutar */}
            <View style={[styles.hero, { backgroundColor: RED + '0E', borderColor: RED + '30' }]}>
              <Text style={[styles.heroLabel, { color: RED }]}>{headerInfo.iptalTipi}</Text>
              <Text style={[styles.heroAmount, { color: RED }]}>
                ₺{totals.tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {totals.kalemSayisi} kalem
              </Text>
            </View>

            {/* Info chips: Saat · Lokasyon · Veri Kaynağı · İptal Eden · (Masa) */}
            <View style={styles.chipsWrap}>
              {!!headerInfo.saat && (
                <Chip color={'#3B82F6'} icon="time-outline" label="SAAT" value={headerInfo.saat} />
              )}
              {!!headerInfo.lokasyon && (
                <Chip color={'#F59E0B'} icon="location-outline" label="LOKASYON" value={headerInfo.lokasyon} />
              )}
              {!!tenantName && (
                <Chip color={'#8B5CF6'} icon="business-outline" label="VERİ KAYNAĞI" value={tenantName} />
              )}
              {!!headerInfo.personel && (
                <Chip color={colors.primary} icon="person-outline" label="İPTAL EDEN" value={headerInfo.personel} />
              )}
              {!!headerInfo.masa && (
                <Chip color={'#10B981'} icon="restaurant-outline" label="MASA" value={headerInfo.masa} />
              )}
            </View>

            {/* Lines */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              ÜRÜNLER ({lines.length})
            </Text>

            {lines.length === 0 ? (
              <View style={[styles.emptyWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {refreshing ? (
                  <>
                    <ActivityIndicator size="small" color={RED} />
                    <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Ürün detayları POS&apos;tan getiriliyor…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="document-outline" size={28} color={colors.textSecondary} />
                    <Text style={{ color: colors.textSecondary, marginTop: 6 }}>Detay satırı bulunamadı</Text>
                  </>
                )}
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {lines.map((row, idx) => {
                  const ad = String(row.STOK_ADI || row.STOK_AD || row.AD || row.ACIKLAMA || '-');
                  const miktar = parseFloat(String(row.MIKTAR ?? '0')) || 0;
                  const birim = String(row.BIRIM_ADI || row.BIRIM || '').trim() || 'ad';
                  const tutar = parseFloat(String(row.SATIR_TUTAR ?? row.NET_TUTAR ?? row.TUTAR ?? '0')) || 0;
                  const masa = String(row.MASA || row.MASA_AD || '').trim();
                  const saat = String(row.SAAT || '').trim();
                  const isWeight = (birim === 'Kg' || birim === 'Lt' || birim.toLowerCase() === 'kg' || birim.toLowerCase() === 'lt');
                  const miktarStr = isWeight ? miktar.toFixed(2) : miktar.toFixed(0);
                  return (
                    <View key={idx} style={[styles.lineRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }} numberOfLines={2}>{ad}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                            {miktarStr} {birim}
                          </Text>
                          {!!masa && (
                            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.background }}>
                              <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>Masa: {masa}</Text>
                            </View>
                          )}
                          {!!saat && (
                            <Text style={{ fontSize: 10, color: colors.textSecondary }}>{saat}</Text>
                          )}
                        </View>
                      </View>
                      <Text style={{ fontSize: 15, color: RED, fontWeight: '800' }}>
                        ₺{tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                  );
                })}

                {/* Total row */}
                <View style={[styles.totalRow, { backgroundColor: colors.card, borderColor: RED + '40' }]}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: colors.text }}>TOPLAM</Text>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: RED }}>
                    ₺{totals.tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const Chip: React.FC<{ color: string; icon: any; label: string; value: string }> = ({ color, icon, label, value }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: color + '15' }}>
    <Ionicons name={icon} size={12} color={color} />
    <View>
      <Text style={{ fontSize: 9, color: color, fontWeight: '700', letterSpacing: 0.4 }}>{label}</Text>
      <Text style={{ fontSize: 12, color: color, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: {
    marginHorizontal: 16,
    marginTop: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  heroLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  heroAmount: { fontSize: 32, fontWeight: '900', marginTop: 4 },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
  },
  emptyWrap: {
    marginHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    borderRadius: 10,
    borderWidth: 1,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 8,
  },
});
