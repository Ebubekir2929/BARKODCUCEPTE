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
}> = ({ visible, onClose }) => {
  const { colors } = useThemeStore();
  const { user, token } = useAuthStore();
  const { t } = useLanguageStore();

  const tenants: Tenant[] = useMemo(() => user?.tenants || [], [user?.tenants]);

  const today = new Date();
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>(today);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const [snapshots, setSnapshots] = useState<TenantSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch dashboard data for each tenant
  const fetchAll = async () => {
    if (!tenants.length || !token) return;
    setLoading(true);
    const sdate = fmtDate(startDate);
    const edate = fmtDate(endDate);

    const results = await Promise.all(
      tenants.map(async (tn, idx): Promise<TenantSnapshot> => {
        try {
          const url = `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(tn.tenant_id)}&sdate=${sdate}&edate=${edate}`;
          const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
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

          return {
            tenant: tn,
            loading: false,
            error: null,
            totals,
            branches,
            cancels,
          };
        } catch (e: any) {
          return {
            tenant: tn,
            loading: false,
            error: e?.message || 'Hata',
            totals: { cash: 0, card: 0, openAccount: 0, total: 0 },
            branches: [],
            cancels: { count: 0, amount: 0 },
          };
        }
      })
    );

    setSnapshots(results);
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
            {/* Summary comparison bar chart */}
            <View style={[styles.summaryBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('total')} — {t('compare')}
              </Text>
              {snapshots.map((snap, idx) => {
                const pct = maxTotal > 0 ? (snap.totals.total / maxTotal) * 100 : 0;
                const color = [colors.primary, colors.total, colors.openAccount][idx % 3];
                return (
                  <View key={snap.tenant.tenant_id} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                        {snap.tenant.tenant_name || DATA_SOURCE_LABELS[idx]}
                      </Text>
                      <Text style={{ color: color, fontWeight: '700', fontSize: 13 }}>
                        ₺{fmtTL(snap.totals.total)}
                      </Text>
                    </View>
                    <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.background, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.max(pct, 1)}%`, height: '100%', backgroundColor: color, borderRadius: 5 }} />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Per-metric comparison table */}
            <View style={[styles.tableBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.tableCol, styles.colLabel, { color: colors.textSecondary }]}>Metrik</Text>
                {snapshots.map((s, i) => (
                  <Text
                    key={s.tenant.tenant_id}
                    style={[styles.tableCol, styles.colVal, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {s.tenant.tenant_name || DATA_SOURCE_LABELS[i]}
                  </Text>
                ))}
              </View>

              {[
                { key: 'cash', label: t('cash_short'), icon: 'cash-outline' as const, color: colors.cash },
                { key: 'card', label: t('card_short'), icon: 'card-outline' as const, color: colors.primary },
                { key: 'openAccount', label: t('open_short'), icon: 'wallet-outline' as const, color: colors.openAccount },
                { key: 'total', label: t('total_short'), icon: 'stats-chart' as const, color: colors.total },
              ].map((metric) => (
                <View key={metric.key} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                  <View style={[styles.tableCol, styles.colLabel, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    <Ionicons name={metric.icon} size={14} color={metric.color} />
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{metric.label}</Text>
                  </View>
                  {snapshots.map((s) => (
                    <Text
                      key={s.tenant.tenant_id}
                      style={[styles.tableCol, styles.colVal, { color: colors.text, fontWeight: '700', fontSize: 13 }]}
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
                <View style={[styles.tableCol, styles.colLabel, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                  <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{t('compare_cancels_label')}</Text>
                </View>
                {snapshots.map((s) => (
                  <Text
                    key={s.tenant.tenant_id}
                    style={[styles.tableCol, styles.colVal, { color: colors.error, fontWeight: '700', fontSize: 12 }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {s.cancels.count} · ₺{fmtTL(s.cancels.amount)}
                  </Text>
                ))}
              </View>
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
