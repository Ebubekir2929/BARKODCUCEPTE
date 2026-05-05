import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';

/**
 * HighSaleDetailModal — shown when user taps a "💰 Yüksek Satış" push.
 *
 * Fetches `POST /api/data/fis-detail { tenant_id, fis_id }` which is served
 * cache-first from MySQL `dataset_cache` (fis_detay_toplam) → falls back to
 * sync.php only if the cache is missing.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  tenantId: string;
  fisId: string | number | null;
  /** Optional pre-known belge no for the header before the API resolves. */
  belgeno?: string;
  /** Optional pre-known amount for the header before the API resolves. */
  amount?: string;
  tenantName?: string;
}

export const HighSaleDetailModal: React.FC<Props> = ({
  visible, onClose, tenantId, fisId, belgeno, amount, tenantName,
}) => {
  const { colors } = useThemeStore();
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<any[]>([]);
  const [totals, setTotals] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env.EXPO_PUBLIC_BACKEND_URL || '';

  const reset = useCallback(() => {
    setDetails([]); setTotals(null); setError(null); setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible || !fisId || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { token: authToken } = useAuthStore.getState();
        // 2026-05-05 — Use /high-sale-detail which reads fis_gunluk_bildirim_feed
        // from MySQL cache (the user is going to extend that dataset's rows
        // with a `URUNLER` array). Falls back to fis_detay_toplam internally.
        const r = await fetch(`${apiBase}/api/data/high-sale-detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken || ''}` },
          body: JSON.stringify({ tenant_id: tenantId, fis_id: fisId }),
        });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setError(j.detail || 'Fiş detayı alınamadı');
          setLoading(false);
          return;
        }
        setDetails(Array.isArray(j.details) ? j.details : []);
        setTotals(Array.isArray(j.totals) && j.totals.length ? j.totals[0] : null);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, fisId, tenantId, apiBase]);

  // Read auth token from AsyncStorage / SecureStore via authStore
  // The authStore exports the token via state, but to keep this component pure
  // we read the global header set by the api client. Fallback: try the
  // stored token from useAuthStore.
  // (Implemented above with __authToken; the dashboard sets this on init.)

  const summary = useMemo(() => {
    if (totals) return totals;
    // derive from details if backend didn't provide totals
    let net = 0, kdv = 0, indirim = 0, count = 0;
    for (const d of details) {
      net += parseFloat(d.NET_TUTAR || d.TUTAR || '0') || 0;
      kdv += parseFloat(d.KDV_TUTAR || '0') || 0;
      indirim += parseFloat(d.ISKONTO_TUTAR || d.INDIRIM_TUTAR || '0') || 0;
      count += 1;
    }
    return { TOPLAM: net, KDV_TUTAR: kdv, ISKONTO_TUTAR: indirim, KALEM_SAYISI: count };
  }, [totals, details]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'} transparent={Platform.OS !== 'ios'} onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: '#10B981', paddingTop: Platform.OS === 'ios' ? 14 : 18 }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="cash" size={22} color="#fff" />
              <Text style={styles.headerTitle}>Yüksek Satış</Text>
            </View>
            <Text style={styles.headerSubtitle}>
              {[belgeno && `#${belgeno}`, tenantName].filter(Boolean).join(' · ') || 'Fiş Detayı'}
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

        {/* Hero amount */}
        {!!amount && (
          <View style={{ paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700', marginBottom: 4, letterSpacing: 0.4 }}>TOPLAM TUTAR</Text>
            <Text style={{ fontSize: 32, color: '#10B981', fontWeight: '900' }}>
              ₺{parseFloat(amount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>
        )}

        {/* Body */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ marginTop: 12, color: colors.textSecondary }}>Fiş detayı yükleniyor…</Text>
          </View>
        ) : error ? (
          <View style={styles.loadingWrap}>
            <Ionicons name="warning" size={36} color={colors.error} />
            <Text style={{ marginTop: 8, color: colors.error, fontSize: 14, fontWeight: '700' }}>{error}</Text>
            <Text style={{ marginTop: 4, color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 }}>
              Fiş detayı henüz cache'e düşmemiş olabilir. Birkaç saniye sonra tekrar deneyin.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {/* Summary row */}
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
              <SummaryPill label="Kalem" value={String(summary?.KALEM_SAYISI || details.length)} color={colors.primary} bg={colors.primary + '15'} />
              <SummaryPill label="İndirim" value={`₺${(parseFloat(summary?.ISKONTO_TUTAR || '0') || 0).toFixed(2)}`} color={'#F59E0B'} bg={'#F59E0B' + '15'} />
              <SummaryPill label="KDV" value={`₺${(parseFloat(summary?.KDV_TUTAR || '0') || 0).toFixed(2)}`} color={'#8B5CF6'} bg={'#8B5CF6' + '15'} />
            </View>

            {/* Lines */}
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textSecondary, paddingHorizontal: 16, marginTop: 4, marginBottom: 8, letterSpacing: 0.4 }}>
              ÜRÜNLER ({details.length})
            </Text>
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              {details.length === 0 ? (
                <View style={[styles.emptyWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons name="document-outline" size={28} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, marginTop: 6 }}>Detay satırı bulunamadı</Text>
                </View>
              ) : details.map((row: any, idx: number) => {
                // 2026-05-05 — POS gönderdiği `DETAYLAR` JSON şeması.
                const ad = row.STOK_ADI || row.STOK_AD || row.AD || row.ACIKLAMA || '-';
                const kod = row.STOK_KODU || row.STOK_KOD || row.KOD || '';
                const birim = row.BIRIM_ADI || row.BIRIM || '';
                const lokasyon = row.LOKASYON || row.LOKASYON_AD || '';
                const miktar = parseFloat(row.MIKTAR || '0');
                const fiyat = parseFloat(row.DAHIL_FIYAT || row.FIYAT || row.BIRIM_FIYAT || '0');
                const tutar = parseFloat(
                  row.KDV_DAHIL_NET_TUTAR || row.DAHIL_TUTAR || row.TUTAR || row.NET_TUTAR || '0'
                ) || (miktar * fiyat);
                const indirim = parseFloat(
                  row.SATIR_ISKONTO_TUTARI || row.TOPLAM_ISKONTO_TUTARI || row.ISKONTO_TUTARI || row.INDIRIM_TUTARI || '0'
                );
                return (
                  <View key={idx} style={[styles.lineRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }} numberOfLines={2}>{ad}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                        {!!kod && <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>{kod}</Text>}
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                          {miktar.toFixed(miktar % 1 === 0 ? 0 : 2)}{birim ? ` ${birim}` : ''} × ₺{fiyat.toFixed(2)}
                        </Text>
                        {!!lokasyon && (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.background }}>
                            <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>{lokasyon}</Text>
                          </View>
                        )}
                        {indirim > 0 && (
                          <Text style={{ fontSize: 11, color: '#F59E0B', fontWeight: '700' }}>
                            -₺{indirim.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '800' }}>
                        ₺{tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const SummaryPill: React.FC<{ label: string; value: string; color: string; bg: string }> = ({ label, value, color, bg }) => (
  <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: bg, borderWidth: 1, borderColor: color + '40' }}>
    <Text style={{ fontSize: 10, fontWeight: '800', color, letterSpacing: 0.4 }}>{label.toUpperCase()}</Text>
    <Text style={{ fontSize: 14, color, fontWeight: '900', marginTop: 4 }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyWrap: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 30, borderRadius: 10, borderWidth: 1,
  },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, gap: 8,
  },
});
