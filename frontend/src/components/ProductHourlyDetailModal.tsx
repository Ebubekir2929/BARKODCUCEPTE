/**
 * ProductHourlyDetailModal — opens when the user taps a product card in the
 * comparison ranking list. Shows the hourly × (tenant × location) breakdown
 * for ONE product only.
 *
 * 2026-05-06 — Full redesign. The previous inline-matrix approach rendered
 * 30 products × 5 (tenant×loc) rows × 24 hours = ~10 000 Text nodes inside
 * the parent ScrollView and crashed Android. By isolating the heavy matrix
 * into its own modal that is only mounted when the user explicitly taps a
 * product, the comparison screen itself stays light and responsive.
 */
import React, { useMemo } from 'react';
import {
  View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';

type Cell = { qty: number; amount: number; iskonto: number; brut: number; kdv: number; birim: string };

interface Snapshot {
  tenant: { tenant_id: string; name?: string };
}

interface Props {
  visible: boolean;
  onClose: () => void;
  productName: string | null;
  snapshots: Snapshot[];
  productHourByTenant: Record<string, Record<string, Record<string, Record<string, Cell>>>>;
  getTenantColor: (idx: number) => string;
  fmtTL: (n: number) => string;
  /** 2026-06-12 — Kullanıcı tarih filtresinin bu ekranda da uygulandığını
   *  görsün diye dönem etiketi gösterilir. */
  periodLabel?: string;
}

const fmt2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ProductHourlyDetailModal: React.FC<Props> = ({
  visible, onClose, productName, snapshots, productHourByTenant, getTenantColor, fmtTL, periodLabel,
}) => {
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();

  // Build per-tenant aggregate + (tenant×location) rows + union of hours.
  // 2026-05-06 — Cheap memo: only runs when productName / data actually change.
  const data = useMemo(() => {
    if (!productName) return null;
    const hoursSet = new Set<string>();
    type LocRow = { tenantIdx: number; tenantId: string; tenantName: string; location: string; cellByHour: Record<string, Cell>; rowQty: number; rowAmount: number; rowIskonto: number; birim: string };
    type TenantRow = { tenantIdx: number; tenantId: string; tenantName: string; cellByHour: Record<string, Cell>; rowQty: number; rowAmount: number; rowIskonto: number; locCount: number; birim: string };

    const tenantRows: TenantRow[] = [];
    const locRows: LocRow[] = [];
    // 2026-05-06 — Ürünün ana birimi: tüm satırlardan toplanır, "Kg/Lt" gibi
    // birim varsa "ad" yerine onu kullanırız.
    let productBirim = 'ad';

    snapshots.forEach((s, idx) => {
      const tenantData = productHourByTenant[s.tenant.tenant_id] || {};
      let tenantQty = 0; let tenantAmount = 0; let tenantIskonto = 0; let locCount = 0;
      let tenantBirim = '';
      const tenantByHour: Record<string, Cell> = {};

      Object.entries(tenantData).forEach(([loc, products]) => {
        const cellByHour = products[productName];
        if (!cellByHour) return;
        let rowQty = 0; let rowAmount = 0; let rowIskonto = 0;
        let rowBirim = '';
        Object.entries(cellByHour).forEach(([h, c]) => {
          if (c.qty <= 0 && c.amount <= 0) return;
          hoursSet.add(h);
          rowQty += c.qty; rowAmount += c.amount; rowIskonto += c.iskonto;
          if (c.birim && c.birim !== 'ad') { rowBirim = c.birim; productBirim = c.birim; }
          else if (c.birim && !rowBirim) rowBirim = c.birim;
          if (!tenantByHour[h]) tenantByHour[h] = { qty: 0, amount: 0, iskonto: 0, brut: 0, kdv: 0, birim: c.birim || 'ad' };
          tenantByHour[h].qty += c.qty;
          tenantByHour[h].amount += c.amount;
          tenantByHour[h].iskonto += c.iskonto;
          if (c.birim && c.birim !== 'ad') tenantByHour[h].birim = c.birim;
        });
        if (rowQty > 0 || rowAmount > 0) {
          locCount += 1;
          tenantQty += rowQty; tenantAmount += rowAmount; tenantIskonto += rowIskonto;
          if (rowBirim && rowBirim !== 'ad') tenantBirim = rowBirim;
          else if (rowBirim && !tenantBirim) tenantBirim = rowBirim;
          locRows.push({
            tenantIdx: idx,
            tenantId: s.tenant.tenant_id,
            tenantName: s.tenant.name || `Veri ${idx + 1}`,
            location: loc,
            cellByHour,
            rowQty, rowAmount, rowIskonto,
            birim: rowBirim || 'ad',
          });
        }
      });

      // 2026-05-06 — Kullanıcı isteği: bu ürün için satışı OLMASA bile her veri
      // kaynağı (tenant) tabloda satır olarak gösterilsin. "—" gösterilir,
      // toplamı ₺0 olur. Filtreleme yok → her zaman tüm tenants görünür.
      tenantRows.push({
        tenantIdx: idx,
        tenantId: s.tenant.tenant_id,
        tenantName: s.tenant.name || `Veri ${idx + 1}`,
        cellByHour: tenantByHour,
        rowQty: tenantQty,
        rowAmount: tenantAmount,
        rowIskonto: tenantIskonto,
        locCount,
        birim: tenantBirim || productBirim || 'ad',
      });
    });

    const allHours = Array.from(hoursSet).sort();
    const grandAmount = tenantRows.reduce((s, r) => s + r.rowAmount, 0);
    const grandQty = tenantRows.reduce((s, r) => s + r.rowQty, 0);
    return { allHours, tenantRows, locRows, grandAmount, grandQty, productBirim };
  }, [productName, snapshots, productHourByTenant]);

  if (!productName) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent={Platform.OS === 'android'}>
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: colors.background },
          // 2026-06-12 — Android'de statusBarTranslucent=true olunca
          // header status bar'a giriyordu (saat/notification ile çakışma).
          // Hem iOS hem Android için top padding zorunlu.
          Platform.OS === 'ios' && { paddingTop: Math.max(insets.top, 12) },
          Platform.OS === 'android' && { paddingTop: Math.max(insets.top, StatusBar.currentHeight || 24) },
        ]}
        edges={['left', 'right']}
      >
        <StatusBar barStyle="light-content" backgroundColor={colors.primary} translucent={false} />

        {/* Header — ürün adı + kapat */}
        <View style={[styles.header, { backgroundColor: colors.primary }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerLabel}>
              SAATLİK ÜRÜN DETAYI{periodLabel ? ` · ${periodLabel}` : ''}
            </Text>
            <Text style={styles.headerTitle} numberOfLines={2}>{productName}</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Hero — büyük toplam tutar */}
        {data && (
          <View style={[{ paddingVertical: 14, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.4 }}>TOPLAM SATIŞ</Text>
            <Text style={{ fontSize: 28, color: colors.primary, fontWeight: '900', marginTop: 4 }}>
              ₺{fmt2(data.grandAmount)}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
              {((data.productBirim === 'Kg' || data.productBirim === 'Lt' || data.productBirim?.toLowerCase?.() === 'kg' || data.productBirim?.toLowerCase?.() === 'lt') ? data.grandQty.toFixed(2) : data.grandQty.toFixed(0))} {data.productBirim} · {data.tenantRows.length} veri kaynağı · {data.locRows.length} lokasyon
            </Text>
          </View>
        )}

        {/* Body — saatlik matrix yatay scroll */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Yatay swipe ipucu */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Ionicons name="swap-horizontal" size={12} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', fontStyle: 'italic' }}>
              ← Yana kaydırın →
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'}>
            <View>
              {/* Header row */}
              <View style={[styles.tableRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.firstCol, { borderRightColor: colors.border }]}>
                  <Text style={[styles.headerCell, { color: colors.textSecondary }]}>Veri · Lokasyon</Text>
                </View>
                {data?.allHours.map((h) => (
                  <View key={h} style={styles.hourCol}>
                    <Text style={[styles.headerCell, { color: colors.textSecondary }]}>{String(h).slice(0, 5)}</Text>
                  </View>
                ))}
                <View style={[styles.totalCol, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={[styles.headerCell, { color: colors.primary, fontWeight: '900' }]}>TOPLAM</Text>
                </View>
              </View>

              {/* Tenant aggregate rows (üst — her tenant için tüm lokasyonların toplamı) */}
              {data?.tenantRows.map((t) => {
                const tenantColor = getTenantColor(t.tenantIdx);
                return (
                  <View key={'agg-' + t.tenantId} style={[styles.tableRow, { backgroundColor: tenantColor + '0E', borderColor: colors.border }]}>
                    <View style={[styles.firstCol, { borderRightColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Ionicons name="business" size={11} color={tenantColor} />
                        <Text style={{ color: tenantColor, fontSize: 11, fontWeight: '900' }} numberOfLines={1}>{t.tenantName}</Text>
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 9, fontWeight: '700', marginTop: 2 }}>
                        ⭐ Tüm Lokasyonlar ({t.locCount})
                      </Text>
                    </View>
                    {data.allHours.map((h) => {
                      const c = t.cellByHour[h];
                      const qty = c?.qty || 0;
                      const amount = c?.amount || 0;
                      const cellBirim = c?.birim || t.birim;
                      const fmtQ = (cellBirim === 'Kg' || cellBirim === 'Lt' || cellBirim?.toLowerCase?.() === 'kg' || cellBirim?.toLowerCase?.() === 'lt') ? qty.toFixed(2) : qty.toFixed(0);
                      return (
                        <View key={h} style={styles.hourCol}>
                          {qty > 0 ? (
                            <>
                              <Text style={{ color: tenantColor, fontSize: 10, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                                ₺{fmtTL(amount)}
                              </Text>
                              <Text style={{ color: colors.textSecondary, fontSize: 9, fontWeight: '700' }}>
                                {fmtQ} {cellBirim}
                              </Text>
                            </>
                          ) : (
                            <Text style={{ color: colors.border, fontSize: 11 }}>—</Text>
                          )}
                        </View>
                      );
                    })}
                    <View style={[styles.totalCol, { backgroundColor: tenantColor + '15' }]}>
                      <Text style={{ color: tenantColor, fontSize: 11, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        ₺{fmtTL(t.rowAmount)}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 9, fontWeight: '700' }}>
                        {(t.birim === 'Kg' || t.birim === 'Lt' || t.birim?.toLowerCase?.() === 'kg' || t.birim?.toLowerCase?.() === 'lt') ? t.rowQty.toFixed(2) : t.rowQty.toFixed(0)} {t.birim}
                      </Text>
                    </View>
                  </View>
                );
              })}

              {/* Per-(tenant,location) rows (alt — kırılım) */}
              {data?.locRows.map((row, idx) => {
                const tenantColor = getTenantColor(row.tenantIdx);
                return (
                  <View key={'loc-' + idx + '-' + row.tenantId + '-' + row.location} style={[styles.tableRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.firstCol, { borderRightColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tenantColor }} />
                        <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>{row.tenantName}</Text>
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
                        📍 {row.location}
                      </Text>
                    </View>
                    {data.allHours.map((h) => {
                      const c = row.cellByHour[h];
                      const qty = c?.qty || 0;
                      const amount = c?.amount || 0;
                      const cellBirim = c?.birim || row.birim;
                      const fmtQ = (cellBirim === 'Kg' || cellBirim === 'Lt' || cellBirim?.toLowerCase?.() === 'kg' || cellBirim?.toLowerCase?.() === 'lt') ? qty.toFixed(2) : qty.toFixed(0);
                      return (
                        <View key={h} style={styles.hourCol}>
                          {qty > 0 ? (
                            <>
                              <Text style={{ color: colors.text, fontSize: 10, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                                ₺{fmtTL(amount)}
                              </Text>
                              <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                                {fmtQ} {cellBirim}
                              </Text>
                            </>
                          ) : (
                            <Text style={{ color: colors.border, fontSize: 11 }}>—</Text>
                          )}
                        </View>
                      );
                    })}
                    <View style={[styles.totalCol, { backgroundColor: colors.primary + '08' }]}>
                      <Text style={{ color: tenantColor, fontSize: 11, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        ₺{fmtTL(row.rowAmount)}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                        {(row.birim === 'Kg' || row.birim === 'Lt' || row.birim?.toLowerCase?.() === 'kg' || row.birim?.toLowerCase?.() === 'lt') ? row.rowQty.toFixed(2) : row.rowQty.toFixed(0)} {row.birim}
                      </Text>
                    </View>
                  </View>
                );
              })}

              {(!data || data.grandQty === 0) && (
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Ionicons name="information-circle-outline" size={32} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8 }}>
                    Bu ürün için saatlik veri yok
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  headerLabel: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6, opacity: 0.85 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 2 },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)' },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  firstCol: { width: 170, paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1 },
  hourCol: { width: 76, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  totalCol: { width: 92, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'flex-end' },
  headerCell: { fontSize: 10, fontWeight: '700' },
});
