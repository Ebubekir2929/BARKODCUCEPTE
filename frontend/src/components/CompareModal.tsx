import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface Tenant {
  tenant_id: string;
  tenant_name: string;
}

interface BranchRow {
  LOKASYON?: string;
  branchName?: string;
  sales: { cash: number; card: number; openAccount: number; total: number };
}

interface TenantSnapshot {
  tenant: Tenant;
  loading: boolean;
  error?: string | null;
  totals: { cash: number; card: number; openAccount: number; total: number };
  branches: { branchId: string; branchName: string; sales: { cash: number; card: number; openAccount: number; total: number } }[];
  cancels: { count: number; amount: number };
  /** Map of hour label -> amount for that tenant */
  hourly: Record<string, number>;
}

const DATA_SOURCE_LABELS = ['Data 1', 'Data 2', 'Data 3'];

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fmtTL = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtTL2 = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CompareModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  activeTenantId?: string;
}> = ({ visible, onClose, activeTenantId }) => {
  const { colors } = useThemeStore();
  const { user, token } = useAuthStore();
  const { t } = useLanguageStore();

  // Sorted: active tenant first, then the rest in original order
  const tenants: Tenant[] = useMemo(() => {
    const list = user?.tenants || [];
    if (!activeTenantId) return list;
    const active = list.find((t) => t.tenant_id === activeTenantId);
    if (!active) return list;
    return [active, ...list.filter((t) => t.tenant_id !== activeTenantId)];
  }, [user?.tenants, activeTenantId]);

  const today = new Date();
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>(today);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const [snapshots, setSnapshots] = useState<TenantSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch dashboard data for each tenant (throttled to 2 parallel to avoid
  // overwhelming the POS sync endpoint when user has many tenants)
  const fetchAll = async () => {
    if (!tenants.length || !token) return;
    setLoading(true);
    const sdate = fmtDate(startDate);
    const edate = fmtDate(endDate);

    const fetchOne = async (tn: Tenant): Promise<TenantSnapshot> => {
      try {
        const url = `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(tn.tenant_id)}&sdate=${sdate}&edate=${edate}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const apiData = await resp.json();

        // Parse branchSales from financial_data_location.data (matches useLiveData)
        const branchRaw: any[] = apiData?.financial_data_location?.data || [];
        const branches = branchRaw.map((b: any, i: number) => ({
          branchId: `loc-${i}`,
          branchName: b?.LOKASYON || 'Bilinmeyen',
          sales: {
            cash: parseFloat(b?.NAKIT || '0'),
            card: parseFloat(b?.KREDI_KARTI || '0'),
            openAccount: parseFloat(b?.VERESIYE || b?.ACIK_HESAP || '0'),
            total: parseFloat(b?.TOPLAM || b?.GENELTOPLAM || '0'),
          },
        }));
        const totals = branches.reduce(
          (acc, b) => ({
            cash: acc.cash + b.sales.cash,
            card: acc.card + b.sales.card,
            openAccount: acc.openAccount + b.sales.openAccount,
            total: acc.total + b.sales.total,
          }),
          { cash: 0, card: 0, openAccount: 0, total: 0 }
        );

        // Parse cancellations from iptal_ozet
        const iptalRaw: any[] = apiData?.iptal_ozet?.data || [];
        const cancels = iptalRaw.reduce(
          (acc, row: any) => ({
            count:
              acc.count +
              parseInt(row.FIS_IPTAL_ADET || '0') +
              parseInt(row.SATIR_IPTAL_ADET || '0'),
            amount:
              acc.amount +
              parseFloat(row.FIS_IPTAL_TUTAR || '0') +
              parseFloat(row.SATIR_IPTAL_TUTAR || '0'),
          }),
          { count: 0, amount: 0 }
        );

        // Parse hourly data (hourly_data.data)
        const hourlyRaw: any[] = apiData?.hourly_data?.data || [];
        const hourly: Record<string, number> = {};
        hourlyRaw.forEach((row: any) => {
          const label = row?.SAAT_ADI || row?.SAAT || '';
          if (!label) return;
          hourly[label] = (hourly[label] || 0) + parseFloat(row?.TOPLAM || '0');
        });

        return {
          tenant: tn,
          loading: false,
          error: null,
          totals,
          branches,
          cancels,
          hourly,
        };
      } catch (e: any) {
        return {
          tenant: tn,
          loading: false,
          error: e?.message || 'Hata',
          totals: { cash: 0, card: 0, openAccount: 0, total: 0 },
          branches: [],
          cancels: { count: 0, amount: 0 },
          hourly: {},
        };
      }
    };

    // Chunked parallel execution: 2 at a time
    const CHUNK = 2;
    const all: TenantSnapshot[] = new Array(tenants.length);
    // Initialize with loading placeholders so UI can render incrementally
    setSnapshots(
      tenants.map((tn) => ({
        tenant: tn,
        loading: true,
        error: null,
        totals: { cash: 0, card: 0, openAccount: 0, total: 0 },
        branches: [],
        cancels: { count: 0, amount: 0 },
        hourly: {},
      }))
    );
    for (let i = 0; i < tenants.length; i += CHUNK) {
      const slice = tenants.slice(i, i + CHUNK);
      const chunkResults = await Promise.all(slice.map((tn) => fetchOne(tn)));
      chunkResults.forEach((r, k) => (all[i + k] = r));
      // Progressive update
      setSnapshots(
        tenants.map((tn, idx) =>
          all[idx] || {
            tenant: tn,
            loading: idx >= i + CHUNK,
            error: null,
            totals: { cash: 0, card: 0, openAccount: 0, total: 0 },
            branches: [],
            cancels: { count: 0, amount: 0 },
            hourly: {},
          }
        )
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (visible) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, startDate, endDate, tenants.length]);

  const maxTotal = useMemo(
    () => snapshots.reduce((m, s) => Math.max(m, s.totals.total), 0),
    [snapshots]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === 'ios' ? 50 : 16,
            },
          ]}
        >
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {t('compare_title')}
          </Text>
          <TouchableOpacity onPress={fetchAll} style={styles.headerBtn} hitSlop={12}>
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Date Range */}
        <View
          style={[
            styles.dateRow,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
            {t('compare_period')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={[styles.dateBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => setShowStartPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={colors.primary} />
              <Text style={[styles.dateBtnText, { color: colors.text }]}>
                {startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
              </Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textSecondary, alignSelf: 'center' }}>—</Text>
            <TouchableOpacity
              style={[styles.dateBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => setShowEndPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={colors.primary} />
              <Text style={[styles.dateBtnText, { color: colors.text }]}>
                {endDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {showStartPicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_e, d) => {
              setShowStartPicker(false);
              if (d) setStartDate(d);
            }}
          />
        )}
        {showEndPicker && (
          <DateTimePicker
            value={endDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_e, d) => {
              setShowEndPicker(false);
              if (d) setEndDate(d);
            }}
          />
        )}

        {/* Body */}
        {tenants.length < 2 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="analytics-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t('compare_no_data')}
            </Text>
          </View>
        ) : loading && snapshots.length === 0 ? (
          <View style={styles.emptyBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
              {t('compare_loading')}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero summary cards — one per tenant, gradient-ish look */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              {snapshots.map((snap, idx) => {
                const color = [colors.primary, colors.total, colors.openAccount, colors.cash, '#8B5CF6', '#F59E0B'][idx % 6];
                const pct = maxTotal > 0 ? (snap.totals.total / maxTotal) * 100 : 0;
                const totalTenants = snapshots.length;
                // Better widths for many tenants:
                //  1 -> 100%,  2 -> 48%,  3 -> 31.5%,  4+ -> 48% (2 per row)
                const width =
                  totalTenants === 1 ? '100%' :
                  totalTenants === 2 ? '48%' :
                  totalTenants === 3 ? '31.5%' : '48%';
                const isActive = snap.tenant.tenant_id === activeTenantId;
                return (
                  <View
                    key={snap.tenant.tenant_id}
                    style={{
                      width: width as any,
                      borderRadius: 16,
                      padding: 14,
                      backgroundColor: color + '12',
                      borderWidth: isActive ? 2.5 : 1.5,
                      borderColor: isActive ? color : color + '40',
                      minWidth: 130,
                      flexGrow: 1,
                      position: 'relative',
                    }}
                  >
                    {isActive && (
                      <View style={{
                        position: 'absolute', top: -10, right: 10,
                        backgroundColor: color, borderRadius: 10,
                        paddingHorizontal: 8, paddingVertical: 2,
                        flexDirection: 'row', alignItems: 'center', gap: 3,
                      }}>
                        <Ionicons name="checkmark-circle" size={11} color="#FFF" />
                        <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>Seçili</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                      <Text
                        style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', flex: 1 }}
                        numberOfLines={1}
                      >
                        {snap.tenant.tenant_name || DATA_SOURCE_LABELS[idx] || `Data ${idx + 1}`}
                      </Text>
                    </View>
                    <Text
                      style={{ color: color, fontWeight: '800', fontSize: 22, marginBottom: 4 }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      ₺{fmtTL(snap.totals.total)}
                    </Text>
                    <View style={{ height: 4, backgroundColor: color + '22', borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.max(pct, 2)}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 6 }}>
                      {snap.branches.length} lokasyon · {snap.cancels.count} iptal
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Hourly sales comparison chart */}
            {(() => {
              // Collect union of hour labels across all tenants
              const hourSet = new Set<string>();
              snapshots.forEach((s) => Object.keys(s.hourly).forEach((h) => hourSet.add(h)));
              const hoursArr = Array.from(hourSet).sort();
              if (hoursArr.length === 0) return null;
              const maxHourly = Math.max(
                1,
                ...hoursArr.flatMap((h) => snapshots.map((s) => s.hourly[h] || 0))
              );
              return (
                <View style={[styles.summaryBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="time-outline" size={16} color={colors.primary} />
                      <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                        Saatlik Satış Karşılaştırması
                      </Text>
                    </View>
                  </View>
                  {/* Legend */}
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    {snapshots.map((s, i) => {
                      const color = [colors.primary, colors.total, colors.openAccount, colors.cash, '#8B5CF6', '#F59E0B'][i % 6];
                      return (
                        <View key={s.tenant.tenant_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
                          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
                            {s.tenant.tenant_name || DATA_SOURCE_LABELS[i]}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  {/* Chart */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingVertical: 6, minHeight: 150 }}>
                      {hoursArr.map((h) => (
                        <View key={h} style={{ alignItems: 'center', width: 42 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 120 }}>
                            {snapshots.map((s, i) => {
                              const amt = s.hourly[h] || 0;
                              const bh = Math.max((amt / maxHourly) * 110, amt > 0 ? 3 : 0);
                              const color = [colors.primary, colors.total, colors.openAccount, colors.cash, '#8B5CF6', '#F59E0B'][i % 6];
                              return (
                                <View
                                  key={s.tenant.tenant_id}
                                  style={{ width: 10, height: bh, backgroundColor: color, borderTopLeftRadius: 3, borderTopRightRadius: 3 }}
                                />
                              );
                            })}
                          </View>
                          <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 4, fontWeight: '600' }}>
                            {h.slice(0, 5)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              );
            })()}

            {/* Per-metric comparison table — horizontally scrollable for many tenants */}
            <View style={[styles.tableBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
                    <Text style={[{ width: 120, fontSize: 12, fontWeight: '700' }, { color: colors.textSecondary }]}>Metrik</Text>
                    {snapshots.map((s, i) => {
                      const isActive = s.tenant.tenant_id === activeTenantId;
                      return (
                        <Text
                          key={s.tenant.tenant_id}
                          style={[{ width: 120, fontSize: 12, fontWeight: '700', textAlign: 'right' }, { color: isActive ? colors.primary : colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {isActive ? '★ ' : ''}{s.tenant.tenant_name || DATA_SOURCE_LABELS[i] || `Data ${i + 1}`}
                        </Text>
                      );
                    })}
                  </View>

                  {[
                    { key: 'cash', label: t('cash_short'), icon: 'cash-outline' as const, color: colors.cash },
                    { key: 'card', label: t('card_short'), icon: 'card-outline' as const, color: colors.primary },
                    { key: 'openAccount', label: t('open_short'), icon: 'wallet-outline' as const, color: colors.openAccount },
                    { key: 'total', label: t('total_short'), icon: 'stats-chart' as const, color: colors.total },
                  ].map((metric) => (
                    <View key={metric.key} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                      <View style={{ width: 120, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name={metric.icon} size={14} color={metric.color} />
                        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{metric.label}</Text>
                      </View>
                      {snapshots.map((s) => (
                        <Text
                          key={s.tenant.tenant_id}
                          style={[{ width: 120, fontSize: 13, fontWeight: '700', textAlign: 'right', paddingLeft: 4 }, { color: colors.text }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          ₺{fmtTL((s.totals as any)[metric.key])}
                        </Text>
                      ))}
                    </View>
                  ))}

                  {/* Cancellations row */}
                  <View style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: 0 }]}>
                    <View style={{ width: 120, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{t('compare_cancels_label')}</Text>
                    </View>
                    {snapshots.map((s) => (
                      <Text
                        key={s.tenant.tenant_id}
                        style={[{ width: 120, fontSize: 12, fontWeight: '700', textAlign: 'right', paddingLeft: 4 }, { color: colors.error }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {s.cancels.count} · ₺{fmtTL(s.cancels.amount)}
                      </Text>
                    ))}
                  </View>
                </View>
              </ScrollView>
            </View>

            {/* Per-tenant branch breakdown */}
            {snapshots
              .filter((s) => s.branches.length > 1)
              .map((snap, idx) => {
                const label = snap.tenant.tenant_name || DATA_SOURCE_LABELS[idx];
                return (
                  <View
                    key={snap.tenant.tenant_id}
                    style={[styles.tableBox, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.groupHeader, { borderBottomColor: colors.border }]}>
                      <Ionicons name="business-outline" size={16} color={colors.primary} />
                      <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 6 }]}>
                        {label} — {t('compare_branches_label')}
                      </Text>
                    </View>
                    {snap.branches.map((b) => {
                      const pct = snap.totals.total > 0 ? (b.sales.total / snap.totals.total) * 100 : 0;
                      return (
                        <View key={b.branchId} style={[styles.branchItem, { borderBottomColor: colors.border }]}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                              {b.branchName}
                            </Text>
                            <View
                              style={{ height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: 'hidden', marginTop: 6 }}
                            >
                              <View
                                style={{
                                  width: `${Math.max(pct, 1)}%`,
                                  height: '100%',
                                  backgroundColor: colors.primary,
                                  borderRadius: 3,
                                }}
                              />
                            </View>
                            <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 3 }}>
                              {pct.toFixed(1)}% · Nakit ₺{fmtTL(b.sales.cash)} · Kart ₺{fmtTL(b.sales.card)}
                            </Text>
                          </View>
                          <Text
                            style={{ color: colors.primary, fontWeight: '700', fontSize: 14, minWidth: 90, textAlign: 'right' }}
                            adjustsFontSizeToFit
                            numberOfLines={1}
                            minimumFontScale={0.7}
                          >
                            ₺{fmtTL(b.sales.total)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}

            {/* Errors */}
            {snapshots.filter((s) => s.error).length > 0 && (
              <View style={[styles.errorBox, { backgroundColor: colors.error + '10', borderColor: colors.error }]}>
                <Ionicons name="warning-outline" size={16} color={colors.error} />
                <Text style={{ color: colors.error, fontSize: 12, marginLeft: 6, flex: 1 }}>
                  {snapshots.filter((s) => s.error).map((s) => `${s.tenant.tenant_name}: ${s.error}`).join(' · ')}
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
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
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  dateLabel: { fontSize: 12, fontWeight: '600' },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dateBtnText: { fontSize: 13, fontWeight: '600' },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, textAlign: 'center' },

  summaryBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },

  tableBox: { borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1 },
  tableCol: {},
  colLabel: { flex: 1.2 },
  colVal: { flex: 1, textAlign: 'right', paddingLeft: 4 },

  groupHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1 },
  branchItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1 },

  errorBox: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 4 },
});
