import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import type { TenantSnapshot } from './CompareModal';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const fmtTL = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Give each branch a stable color via hashing
const BRANCH_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#EF4444', '#84CC16', '#F97316', '#14B8A6'];
const hashBranch = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return BRANCH_COLORS[Math.abs(h) % BRANCH_COLORS.length];
};

// Small reusable "swipe" hint for horizontal scroll sections
const SwipeHint: React.FC<{ color: string }> = ({ color }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 6 }}>
    <Ionicons name="swap-horizontal" size={12} color={color} />
    <Text style={{ color, fontSize: 10, fontWeight: '600', fontStyle: 'italic' }}>
      ← Yana kaydırın →
    </Text>
  </View>
);

export const TenantDetailModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  snapshot: TenantSnapshot;
  color: string;
  periodLabel: string;
  filterDate?: string; // YYYY-MM-DD for on-demand product-hour fetch
}> = ({ visible, onClose, snapshot, color, periodLabel, filterDate }) => {
  const { colors } = useThemeStore();
  const { token } = useAuthStore();
  const insets = useSafeAreaInsets();

  const { branches, hourlyLoc, topProducts, totals, cancels, hourlyFis } = snapshot;

  // Distinct hours
  const allHours = useMemo(() => {
    const s = new Set<string>();
    Object.values(hourlyLoc).forEach((x) => s.add(x.hour));
    Object.keys(hourlyFis).forEach((h) => s.add(h));
    return Array.from(s).sort();
  }, [hourlyLoc, hourlyFis]);

  const branchNames = useMemo(() => branches.map((b) => b.branchName), [branches]);

  // Map of branch -> {hour -> {amount, fis}}
  const branchHourMap = useMemo(() => {
    const m: Record<string, Record<string, { amount: number; fis: number }>> = {};
    Object.values(hourlyLoc).forEach(({ loc, hour, amount, fis }) => {
      if (!m[loc]) m[loc] = {};
      m[loc][hour] = { amount, fis };
    });
    return m;
  }, [hourlyLoc]);

  const maxHourAmount = useMemo(() => {
    let m = 0;
    Object.values(hourlyLoc).forEach((x) => { if (x.amount > m) m = x.amount; });
    return m || 1;
  }, [hourlyLoc]);

  // Group products by branch
  const productsByBranch = useMemo(() => {
    const m: Record<string, typeof topProducts> = {};
    topProducts.forEach((p) => {
      if (!m[p.location]) m[p.location] = [];
      m[p.location].push(p);
    });
    Object.keys(m).forEach((k) => m[k].sort((a, b) => b.amount - a.amount));
    return m;
  }, [topProducts]);

  const totalFis = useMemo(
    () => Object.values(hourlyFis).reduce((a, b) => a + b, 0),
    [hourlyFis]
  );

  // ─── Per-product × per-hour qty/amount via on-demand hourly-detail ───
  // productHourMap[branch][productName][hour] = { qty, amount }
  const [productHourMap, setProductHourMap] = useState<Record<string, Record<string, Record<string, { qty: number; amount: number }>>>>({});
  const [phLoading, setPhLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (!token) return;
    if (allHours.length === 0) return;
    let cancelled = false;
    setPhLoading(true);
    setProductHourMap({});

    (async () => {
      // Fire one /hourly-detail per unique (hour) — it aggregates across all locations
      const results: { hour: string; rows: any[] }[] = [];
      const CHUNK = 3;
      for (let i = 0; i < allHours.length; i += CHUNK) {
        if (cancelled) return;
        const slice = allHours.slice(i, i + CHUNK);
        const chunk = await Promise.all(slice.map(async (h) => {
          try {
            const resp = await fetch(`${API_URL}/api/data/hourly-detail`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                tenant_id: snapshot.tenant.tenant_id,
                hour_label: h,
                lokasyon_id: null,
                ...(filterDate ? { date: filterDate } : {}),
              }),
            });
            const j = await resp.json();
            return { hour: h, rows: Array.isArray(j?.data) ? j.data : [] };
          } catch {
            return { hour: h, rows: [] };
          }
        }));
        results.push(...chunk);
      }
      if (cancelled) return;

      // Build the map
      const map: Record<string, Record<string, Record<string, { qty: number; amount: number }>>> = {};
      results.forEach(({ hour, rows }) => {
        rows.forEach((r: any) => {
          const name = r?.STOK_ADI || r?.STOK_AD || r?.URUN_ADI || '-';
          const loc = r?.LOKASYON || r?.LOKASYON_ADI || '-';
          const qty = parseFloat(r?.TOPLAM_MIKTAR || r?.MIKTAR || '0');
          const amount = parseFloat(r?.KDV_DAHIL_TOPLAM_TUTAR || r?.TOPLAM_TUTAR || '0');
          if (!map[loc]) map[loc] = {};
          if (!map[loc][name]) map[loc][name] = {};
          if (!map[loc][name][hour]) map[loc][name][hour] = { qty: 0, amount: 0 };
          map[loc][name][hour].qty += qty;
          map[loc][name][hour].amount += amount;
        });
      });
      setProductHourMap(map);
      setPhLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, snapshot.tenant.tenant_id, filterDate, allHours.join('|')]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
              <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                {snapshot.tenant.name || 'Veri Detayı'}
              </Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500' }} numberOfLines={1}>
              {periodLabel} · Şube Karşılaştırması
            </Text>
          </View>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* Tenant totals */}
          <View style={[styles.sectionBox, { backgroundColor: color + '10', borderColor: color + '50' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Toplam Satış</Text>
              <Text style={{ color, fontSize: 26, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                ₺{fmtTL(totals.total)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <View style={[styles.chipBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Ionicons name="cash-outline" size={12} color={colors.cash} />
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>₺{fmtTL(totals.cash)}</Text>
              </View>
              <View style={[styles.chipBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Ionicons name="card-outline" size={12} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>₺{fmtTL(totals.card)}</Text>
              </View>
              <View style={[styles.chipBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Ionicons name="wallet-outline" size={12} color={colors.openAccount} />
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>₺{fmtTL(totals.openAccount)}</Text>
              </View>
              <View style={[styles.chipBox, { backgroundColor: colors.error + '15', borderColor: colors.error + '40' }]}>
                <Ionicons name="close-circle-outline" size={12} color={colors.error} />
                <Text style={{ color: colors.error, fontSize: 11, fontWeight: '700' }}>{cancels.count} iptal · ₺{fmtTL(cancels.amount)}</Text>
              </View>
              {totalFis > 0 && (
                <View style={[styles.chipBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
                  <Ionicons name="receipt-outline" size={12} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{totalFis} fiş</Text>
                </View>
              )}
            </View>
          </View>

          {/* Branches comparison */}
          {branches.length > 0 && (
            <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Ionicons name="business-outline" size={16} color={color} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Şube Karşılaştırması</Text>
              </View>
              {branches
                .slice()
                .sort((a, b) => b.sales.total - a.sales.total)
                .map((b, i) => {
                  const pct = totals.total > 0 ? (b.sales.total / totals.total) * 100 : 0;
                  const bColor = hashBranch(b.branchName);
                  return (
                    <View key={b.branchId + i} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: bColor }} />
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
                            {b.branchName}
                          </Text>
                        </View>
                        <Text style={{ color: bColor, fontSize: 14, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          ₺{fmtTL(b.sales.total)}
                        </Text>
                      </View>
                      <View style={{ height: 6, backgroundColor: bColor + '22', borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ width: `${Math.max(pct, 1)}%`, height: '100%', backgroundColor: bColor }} />
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 3 }}>
                        %{pct.toFixed(1)} · Nakit ₺{fmtTL(b.sales.cash)} · Kart ₺{fmtTL(b.sales.card)} · Açık ₺{fmtTL(b.sales.openAccount)}
                      </Text>
                    </View>
                  );
                })}
            </View>
          )}

          {/* Şube Bazlı TÜM Ürünler + Saatlik Dağılım */}
          {Object.keys(productsByBranch).length > 0 && (
            <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 4 }}>
                <Ionicons name="cube-outline" size={16} color={color} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flex: 1 }]}>Şube Bazlı Tüm Ürünler</Text>
                {phLoading && <ActivityIndicator size="small" color={color} />}
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 11, paddingHorizontal: 14, paddingBottom: 6 }}>
                En çoktan en aza sıralı · her ürünün saatlik dağılımı
              </Text>

              {Object.entries(productsByBranch).map(([branch, products]) => {
                const bColor = hashBranch(branch);
                const branchTotal = products.reduce((s, p) => s + p.amount, 0);
                const branchPH = productHourMap[branch] || {};
                return (
                  <View key={branch} style={{ marginBottom: 6 }}>
                    {/* Branch header */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: bColor + '08', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="location" size={13} color={bColor} />
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
                          {branch}
                        </Text>
                        <View style={{ backgroundColor: bColor + '20', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 }}>
                          <Text style={{ color: bColor, fontSize: 10, fontWeight: '700' }}>{products.length} ürün</Text>
                        </View>
                      </View>
                      <Text style={{ color: bColor, fontSize: 13, fontWeight: '800' }}>
                        ₺{fmtTL(branchTotal)}
                      </Text>
                    </View>

                    {/* Horizontal scroll: product × hour matrix */}
                    <SwipeHint color={bColor} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View>
                        {/* Hour header row */}
                        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                          <View style={{ width: 40, paddingVertical: 6, alignItems: 'center' }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>#</Text>
                          </View>
                          <View style={{ width: 160, paddingVertical: 6, paddingHorizontal: 8 }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>Ürün</Text>
                          </View>
                          {allHours.map((h) => (
                            <View key={h} style={{ width: 44, paddingVertical: 6, alignItems: 'center' }}>
                              <Text style={{ color: colors.textSecondary, fontSize: 9, fontWeight: '700' }}>{String(h).slice(0, 5)}</Text>
                            </View>
                          ))}
                          <View style={{ width: 95, paddingVertical: 6, paddingHorizontal: 8, alignItems: 'flex-end' }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>Toplam</Text>
                          </View>
                        </View>

                        {/* Product rows (ALL) */}
                        {products.map((p, i) => {
                          const phEntry = branchPH[p.name] || {};
                          const hasAnyHour = Object.keys(phEntry).length > 0;
                          // Per-product max qty for bar scaling
                          const maxQtyThis = Math.max(1, ...Object.values(phEntry).map((v) => v.qty));
                          return (
                            <View key={p.name + i} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                              <View style={{ width: 40, paddingVertical: 8, alignItems: 'center' }}>
                                <View style={{
                                  minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 5,
                                  backgroundColor: i < 3 ? bColor + '22' : colors.background,
                                  borderWidth: 1, borderColor: i < 3 ? bColor : colors.border,
                                  alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <Text style={{ color: i < 3 ? bColor : colors.textSecondary, fontSize: 9, fontWeight: '800' }}>
                                    {i + 1}
                                  </Text>
                                </View>
                              </View>
                              <View style={{ width: 160, paddingVertical: 8, paddingHorizontal: 8 }}>
                                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }} numberOfLines={2}>
                                  {p.name}
                                </Text>
                                <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                                  {p.qty.toFixed(0)} adet
                                </Text>
                              </View>
                              {allHours.map((h) => {
                                const cell = phEntry[h];
                                const qty = cell?.qty || 0;
                                const heightPct = maxQtyThis > 0 ? (qty / maxQtyThis) * 100 : 0;
                                return (
                                  <View key={h} style={{ width: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
                                    {qty > 0 ? (
                                      <>
                                        <View style={{ width: 18, height: 26, backgroundColor: bColor + '18', borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' }}>
                                          <View style={{ width: '100%', height: `${Math.max(heightPct, 10)}%`, backgroundColor: bColor }} />
                                        </View>
                                        <Text style={{ color: colors.text, fontSize: 9, fontWeight: '700', marginTop: 2 }}>
                                          {qty.toFixed(0)}
                                        </Text>
                                      </>
                                    ) : (
                                      <Text style={{ color: colors.border, fontSize: 11 }}>
                                        {!hasAnyHour && phLoading ? '…' : '·'}
                                      </Text>
                                    )}
                                  </View>
                                );
                              })}
                              <View style={{ width: 95, paddingHorizontal: 8, alignItems: 'flex-end' }}>
                                <Text style={{ color: bColor, fontSize: 11, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                                  ₺{fmtTL(p.amount)}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                );
              })}
            </View>
          )}

          {/* Saatlik Fiş Sayısı — dikey bar chart (zaten yatay scroll) */}
          {totalFis > 0 && allHours.length > 0 && (
            <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 4 }}>
                <Ionicons name="receipt-outline" size={16} color={color} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
                  Saatlik Fiş Sayısı
                </Text>
                <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{totalFis} fiş</Text>
              </View>
              <SwipeHint color={color} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, paddingTop: 0, alignItems: 'flex-end', gap: 6 }}>
                {(() => {
                  const maxFis = Math.max(...allHours.map((h) => hourlyFis[h] || 0), 1);
                  return allHours.map((h) => {
                    const fis = hourlyFis[h] || 0;
                    const heightPct = maxFis > 0 ? (fis / maxFis) * 100 : 0;
                    return (
                      <View key={h} style={{ alignItems: 'center', width: 44 }}>
                        <Text style={{ color: colors.text, fontSize: 10, fontWeight: '700', marginBottom: 3 }}>
                          {fis}
                        </Text>
                        <View style={{ width: 26, height: 80, backgroundColor: color + '18', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' }}>
                          <View style={{ width: '100%', height: `${Math.max(heightPct, 4)}%`, backgroundColor: color, borderRadius: 3 }} />
                        </View>
                        <Text style={{ color: colors.textSecondary, fontSize: 9, marginTop: 4 }}>
                          {String(h).slice(0, 5)}
                        </Text>
                      </View>
                    );
                  });
                })()}
              </ScrollView>
            </View>
          )}

          {/* Saatlik Satış Matrisi — branch × hour */}
          {Object.keys(hourlyLoc).length > 0 && branchNames.length > 0 && (
            <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 4 }}>
                <Ionicons name="bar-chart-outline" size={16} color={color} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
                  Şube × Saatlik Satış Matrisi
                </Text>
              </View>
              <SwipeHint color={color} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                    <View style={{ width: 130, paddingVertical: 8, paddingHorizontal: 12 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>Şube</Text>
                    </View>
                    {allHours.map((h) => (
                      <View key={h} style={{ width: 52, paddingVertical: 8, alignItems: 'center' }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>{String(h).slice(0, 5)}</Text>
                      </View>
                    ))}
                    <View style={{ width: 92, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>Toplam</Text>
                    </View>
                  </View>
                  {branchNames.map((bn) => {
                    const bColor = hashBranch(bn);
                    const hourMap = branchHourMap[bn] || {};
                    const rowTotal = Object.values(hourMap).reduce((s, x) => s + x.amount, 0);
                    return (
                      <View key={bn} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <View style={{ width: 130, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: bColor }} />
                          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                            {bn}
                          </Text>
                        </View>
                        {allHours.map((h) => {
                          const cell = hourMap[h];
                          const amount = cell?.amount || 0;
                          const fis = cell?.fis || 0;
                          const heightPct = maxHourAmount > 0 ? (amount / maxHourAmount) * 100 : 0;
                          return (
                            <View key={h} style={{ width: 52, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
                              {amount > 0 ? (
                                <>
                                  <View style={{ width: 22, height: 34, backgroundColor: bColor + '18', borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' }}>
                                    <View style={{ width: '100%', height: `${Math.max(heightPct, 10)}%`, backgroundColor: bColor }} />
                                  </View>
                                  <Text style={{ color: colors.text, fontSize: 9, fontWeight: '700', marginTop: 2 }}>
                                    {amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount.toFixed(0)}
                                  </Text>
                                  {fis > 0 && (
                                    <Text style={{ color: colors.textSecondary, fontSize: 8 }}>
                                      {fis}f
                                    </Text>
                                  )}
                                </>
                              ) : (
                                <Text style={{ color: colors.border, fontSize: 12 }}>·</Text>
                              )}
                            </View>
                          );
                        })}
                        <View style={{ width: 92, paddingHorizontal: 8, alignItems: 'flex-end' }}>
                          <Text style={{ color: bColor, fontSize: 12, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                            ₺{fmtTL(rowTotal)}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  sectionBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, overflow: 'hidden' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 0 },
  chipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
});
