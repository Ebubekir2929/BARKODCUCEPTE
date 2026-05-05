import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Platform, ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useLanguageStore } from '../store/languageStore';

/**
 * NegativeStockModal — full-screen modal for the "low_stock_summary" push
 * deep-link. Displays a richer overview than just toggling a list filter.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  ⚠️ Eksi Stok Özeti                ✕  │
 *   │                                                │
 *   │  ┌──────┐  ┌─────────────┐  ┌─────────────┐  │
 *   │  │ N adet│  │ ₺ toplam    │  │ Şube        │  │
 *   │  └──────┘  └─────────────┘  └─────────────┘  │
 *   │                                                │
 *   │  [ 📋 Kopyala ]   [ 📤 CSV İndir ]              │
 *   │                                                │
 *   │   Negatif ürünler                               │
 *   │   • DENEME    -3   ₺120,00                      │
 *   │   • DENEME 1  -2   ₺85,00                       │
 *   │   ...                                           │
 *   └────────────────────────────────────────────────┘
 */

export interface NegativeStockItem {
  KOD?: string; STOK_KODU?: string;
  AD?: string; STOK_ADI?: string;
  MIKTAR?: number | string;
  FIYAT?: number | string;
  SON_ALIS_FIYAT?: number | string;
  MARKA?: string; MARKA_AD?: string;
  STOK_GRUP?: string; GRUP?: string;
  BARKOD?: string;
  LOKASYON?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  items: NegativeStockItem[];
  loading?: boolean;
  tenantName?: string;
  /** Optional: callback fired when user taps a row, to drill into stock detail. */
  onItemPress?: (item: NegativeStockItem) => void;
}

export const NegativeStockModal: React.FC<Props> = ({
  visible, onClose, items, loading = false, tenantName, onItemPress,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const [exported, setExported] = useState(false);

  const stats = useMemo(() => {
    let count = 0;
    let totalQty = 0;
    let totalLossTry = 0;
    for (const it of items) {
      const m = parseFloat(String(it.MIKTAR ?? '0'));
      if (!isFinite(m) || m >= 0) continue;
      count += 1;
      totalQty += m; // negative
      const cost = parseFloat(String(it.SON_ALIS_FIYAT ?? it.FIYAT ?? '0'));
      if (isFinite(cost) && cost > 0) totalLossTry += m * cost; // negative * cost
    }
    return { count, totalQty, totalLossTry };
  }, [items]);

  const negativeOnly = useMemo(
    () => items.filter(it => parseFloat(String(it.MIKTAR ?? '0')) < 0)
              .sort((a, b) => parseFloat(String(a.MIKTAR ?? '0')) - parseFloat(String(b.MIKTAR ?? '0'))),
    [items],
  );

  const handleExportCsv = useCallback(async () => {
    const headers = ['Kod', 'Ad', 'Marka', 'Grup', 'Miktar', 'Alış Fiyatı', 'Satış Fiyatı', 'Barkod'];
    const lines = [headers.join(';')];
    for (const it of negativeOnly) {
      lines.push([
        (it.KOD || it.STOK_KODU || '').replace(/[\r\n;]/g, ' '),
        (it.AD || it.STOK_ADI || '').replace(/[\r\n;]/g, ' '),
        (it.MARKA || it.MARKA_AD || '').replace(/[\r\n;]/g, ' '),
        (it.STOK_GRUP || it.GRUP || '').replace(/[\r\n;]/g, ' '),
        String(it.MIKTAR ?? ''),
        String(it.SON_ALIS_FIYAT ?? ''),
        String(it.FIYAT ?? ''),
        (it.BARKOD || '').replace(/[\r\n;]/g, ' '),
      ].join(';'));
    }
    const csv = lines.join('\n');
    try {
      if (Platform.OS === 'web') {
        // Trigger a real CSV download on web
        // eslint-disable-next-line no-undef
        const blob = new (globalThis as any).Blob([csv], { type: 'text/csv;charset=utf-8;' });
        // eslint-disable-next-line no-undef
        const url = (globalThis as any).URL.createObjectURL(blob);
        // eslint-disable-next-line no-undef
        const a = (globalThis as any).document.createElement('a');
        a.href = url;
        a.download = `eksi-stok-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        // eslint-disable-next-line no-undef
        (globalThis as any).URL.revokeObjectURL(url);
      } else {
        const Clipboard = require('expo-clipboard');
        await Clipboard.setStringAsync(csv);
      }
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (e) {
      // best-effort; ignore
    }
  }, [negativeOnly]);

  const renderRow = useCallback(({ item }: { item: NegativeStockItem }) => {
    const m = parseFloat(String(item.MIKTAR ?? '0'));
    const cost = parseFloat(String(item.SON_ALIS_FIYAT ?? item.FIYAT ?? '0'));
    const loss = isFinite(cost) && cost > 0 ? m * cost : 0;
    return (
      <TouchableOpacity
        activeOpacity={onItemPress ? 0.6 : 1}
        onPress={() => onItemPress?.(item)}
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
            {item.AD || item.STOK_ADI || '-'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>
              {item.KOD || item.STOK_KODU || '-'}
            </Text>
            {!!(item.MARKA || item.MARKA_AD) && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.background }}>
                <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }} numberOfLines={1}>
                  {item.MARKA || item.MARKA_AD}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 16, color: colors.error, fontWeight: '800' }}>
            {m.toFixed(2)}
          </Text>
          {!!loss && (
            <Text style={{ fontSize: 11, color: colors.error, fontWeight: '600' }}>
              ₺{Math.abs(loss).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [colors, onItemPress]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.error, paddingTop: Platform.OS === 'ios' ? 56 : 18 }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="warning" size={22} color="#fff" />
              <Text style={styles.headerTitle}>Eksi Stok Özeti</Text>
            </View>
            {!!tenantName && (
              <Text style={styles.headerSubtitle}>{tenantName}</Text>
            )}
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
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ marginTop: 12, color: colors.textSecondary }}>Yükleniyor…</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* Summary cards */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}
            >
              <SummaryCard
                color={colors.error}
                bg={colors.error + '15'}
                icon="cube"
                label="Eksi Ürün"
                value={`${stats.count} adet`}
              />
              <SummaryCard
                color={'#F59E0B'}
                bg={'#F59E0B' + '15'}
                icon="trending-down"
                label="Toplam Eksi Miktar"
                value={stats.totalQty.toFixed(2)}
              />
              <SummaryCard
                color={colors.error}
                bg={colors.error + '15'}
                icon="cash"
                label="Tahmini Maliyet"
                value={`₺${Math.abs(stats.totalLossTry).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
              />
            </ScrollView>

            {/* Action buttons */}
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
              <TouchableOpacity
                onPress={handleExportCsv}
                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name={exported ? 'checkmark-circle' : (Platform.OS === 'web' ? 'download' : 'copy')} size={16} color="#fff" />
                <Text style={styles.actionBtnText}>
                  {exported ? 'Kopyalandı / İndirildi' : (Platform.OS === 'web' ? 'CSV İndir' : 'CSV Kopyala')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* List */}
            <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 16 }}>
              {negativeOnly.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <Ionicons name="checkmark-done-circle" size={48} color={colors.success} />
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 8 }}>
                    Eksi stokta ürün yok 🎉
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
                    Tüm stoklar pozitif görünüyor.
                  </Text>
                </View>
              ) : (
                <FlashList
                  data={negativeOnly}
                  renderItem={renderRow}
                  keyExtractor={(item: any, idx) => String(item.KOD || item.STOK_KODU || idx)}
                  estimatedItemSize={60}
                  showsVerticalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                />
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

const SummaryCard: React.FC<{ color: string; bg: string; icon: any; label: string; value: string }> = ({ color, bg, icon, label, value }) => {
  const { colors } = useThemeStore();
  return (
    <View style={[styles.card, { backgroundColor: bg, borderColor: color + '40' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700' }}>{label.toUpperCase()}</Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '900', color }}>{value}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    minWidth: 160, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10,
  },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, gap: 12,
  },
  rowName: { fontSize: 14, fontWeight: '700' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
});
