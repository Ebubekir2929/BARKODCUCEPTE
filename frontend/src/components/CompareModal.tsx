import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { TenantDetailModal } from './TenantDetailModal';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface Tenant {
  tenant_id: string;
  name: string;
}

interface TopProductRow {
  name: string;
  location: string;
  qty: number;
  amount: number;
  tenantName?: string;
  tenantId?: string;
  colorIdx?: number;
}

export interface TenantSnapshot {
  tenant: Tenant;
  loading: boolean;
  error?: string | null;
  totals: { cash: number; card: number; openAccount: number; total: number };
  branches: {
    branchId: string;
    branchName: string;
    sales: { cash: number; card: number; openAccount: number; total: number };
  }[];
  cancels: { count: number; amount: number };
  /** hour label -> amount */
  hourly: Record<string, number>;
  /** hour label -> receipt count */
  hourlyFis: Record<string, number>;
  /** hour+loc -> amount */
  hourlyLoc: Record<string, { loc: string; hour: string; amount: number; fis: number }>;
  topProducts: TopProductRow[];
}

const COLOR_PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#EF4444', '#84CC16'];
export const getTenantColor = (i: number) => COLOR_PALETTE[i % COLOR_PALETTE.length];

export const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmtTL = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ============ Quick date range presets ============
type PresetKey = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';

const computePreset = (k: PresetKey): { start: Date; end: Date } => {
  const now = new Date();
  const d = (y: number, m: number, day: number) => new Date(y, m, day);
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (k) {
    case 'today':
      return { start: now, end: now };
    case 'yesterday': {
      const yest = new Date(now); yest.setDate(now.getDate() - 1);
      return { start: yest, end: yest };
    }
    case 'last7': {
      const s = new Date(now); s.setDate(now.getDate() - 6);
      return { start: s, end: now };
    }
    case 'thisMonth':
      return { start: d(y, m, 1), end: now };
    case 'lastMonth':
      return { start: d(y, m - 1, 1), end: d(y, m, 0) };
    case 'thisYear':
      return { start: d(y, 0, 1), end: now };
    case 'lastYear':
      return { start: d(y - 1, 0, 1), end: d(y - 1, 11, 31) };
  }
};

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Bugün' },
  { key: 'yesterday', label: 'Dün' },
  { key: 'last7', label: 'Son 7 Gün' },
  { key: 'thisMonth', label: 'Bu Ay' },
  { key: 'lastMonth', label: 'Geçen Ay' },
  { key: 'thisYear', label: 'Bu Yıl' },
  { key: 'lastYear', label: 'Geçen Yıl' },
];

// Small reusable "swipe" hint for horizontal scroll sections
const SwipeHint: React.FC<{ color: string }> = ({ color }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingBottom: 6 }}>
    <Ionicons name="swap-horizontal" size={12} color={color} />
    <Text style={{ color, fontSize: 10, fontWeight: '600', fontStyle: 'italic' }}>
      ← Yana kaydırın →
    </Text>
  </View>
);

const parseFisFromRow = (row: any): number => {
  const v = row?.FIS_ADEDI ?? row?.FIS_SAYISI ?? row?.FIS_SAY ?? row?.ADET ?? row?.FIS_TOPLAM_ADET;
  const n = parseInt(String(v || '0'));
  return isNaN(n) ? 0 : n;
};

export const CompareModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  activeTenantId?: string;
}> = ({ visible, onClose, activeTenantId }) => {
  const { colors } = useThemeStore();
  const { user, token } = useAuthStore();
  const { t } = useLanguageStore();
  const insets = useSafeAreaInsets();

  // Sorted: active tenant first, then rest
  const tenants: Tenant[] = useMemo(() => {
    const list: Tenant[] = user?.tenants || [];
    if (!activeTenantId) return list;
    const active = list.find((x) => x.tenant_id === activeTenantId);
    if (!active) return list;
    return [active, ...list.filter((x) => x.tenant_id !== activeTenantId)];
  }, [user?.tenants, activeTenantId]);

  const today = new Date();
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>(today);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [activePreset, setActivePreset] = useState<PresetKey | null>('today');

  // Is the current range "today only" (no filter)
  const isTodayOnly = useMemo(() => {
    const now = new Date();
    const same = (a: Date, b: Date) => fmtDate(a) === fmtDate(b);
    return same(startDate, now) && same(endDate, now);
  }, [startDate, endDate]);

  const resetFilter = () => {
    const now = new Date();
    setStartDate(now);
    setEndDate(now);
    setActivePreset('today');
  };

  const [snapshots, setSnapshots] = useState<TenantSnapshot[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [silentBadge, setSilentBadge] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [detailTenantIdx, setDetailTenantIdx] = useState<number | null>(null);
  const isFetchingRef = useRef(false);
  // productHourByTenant[tenantId][location][productName][hour] = { qty, amount }
  const [productHourByTenant, setProductHourByTenant] = useState<Record<string, Record<string, Record<string, Record<string, { qty: number; amount: number }>>>>>({});
  const [phLoading, setPhLoading] = useState(false);

  const applyPreset = (p: PresetKey) => {
    const { start, end } = computePreset(p);
    setStartDate(start);
    setEndDate(end);
    setActivePreset(p);
  };

  const emptySnapshot = (tn: Tenant, loading: boolean): TenantSnapshot => ({
    tenant: tn,
    loading,
    error: null,
    totals: { cash: 0, card: 0, openAccount: 0, total: 0 },
    branches: [],
    cancels: { count: 0, amount: 0 },
    hourly: {},
    hourlyFis: {},
    hourlyLoc: {},
    topProducts: [],
  });

  const fetchOne = useCallback(async (tn: Tenant, sdate: string, edate: string): Promise<TenantSnapshot> => {
    try {
      const url = `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(tn.tenant_id)}&sdate=${sdate}&edate=${edate}`;
      const ctrl = new AbortController();
      // Fail fast (20s) so tenants without backend / aborted ones don't block UI
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const apiData = await resp.json();

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

      // Hourly totals + fis (receipt) counts
      const hourlyRaw: any[] = apiData?.hourly_data?.data || [];
      const hourly: Record<string, number> = {};
      const hourlyFis: Record<string, number> = {};
      hourlyRaw.forEach((row: any) => {
        const label = row?.SAAT_ADI || row?.SAAT || '';
        if (!label) return;
        hourly[label] = (hourly[label] || 0) + parseFloat(row?.TOPLAM || '0');
        hourlyFis[label] = (hourlyFis[label] || 0) + parseFisFromRow(row);
      });

      // Hourly per-location
      const hourlyLocRaw: any[] = apiData?.hourly_location_data?.data || [];
      const hourlyLoc: Record<string, { loc: string; hour: string; amount: number; fis: number }> = {};
      hourlyLocRaw.forEach((row: any) => {
        const hour = row?.SAAT_ADI || '';
        const loc = row?.LOKASYON || 'Bilinmeyen';
        if (!hour) return;
        const key = `${hour}__${loc}`;
        if (!hourlyLoc[key]) hourlyLoc[key] = { loc, hour, amount: 0, fis: 0 };
        hourlyLoc[key].amount += parseFloat(row?.TOPLAM || '0');
        hourlyLoc[key].fis += parseFisFromRow(row);
      });

      // Top products — from top10_stock_movements (per STOK_AD + LOKASYON)
      const stockRaw: any[] = apiData?.top10_stock_movements?.data || [];
      const topProducts: TopProductRow[] = stockRaw
        .map((r: any) => ({
          name: r?.STOK_AD || r?.STOK_ADI || '-',
          location: r?.LOKASYON || r?.LOKASYON_ADI || '-',
          qty: parseFloat(r?.MIKTAR_CIKIS || r?.TOPLAM_MIKTAR || '0'),
          amount: parseFloat(r?.TUTAR_CIKIS || r?.KDV_DAHIL_TOPLAM_TUTAR || r?.TOPLAM_TUTAR || '0'),
        }))
        .filter((p) => p.amount > 0 || p.qty > 0)
        .sort((a, b) => b.amount - a.amount);

      return { tenant: tn, loading: false, error: null, totals, branches, cancels, hourly, hourlyFis, hourlyLoc, topProducts };
    } catch (e: any) {
      return { ...emptySnapshot(tn, false), error: e?.message || 'Hata' };
    }
  }, [token]);

  // SILENT fetch-all: never sets big spinner, never unsets existing data.
  // Only internal `silentBadge` indicator shows a tiny dot at refresh time.
  const fetchAll = useCallback(async () => {
    if (!tenants.length || !token) return;
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setSilentBadge(true);

    const sdate = fmtDate(startDate);
    const edate = fmtDate(endDate);

    const CHUNK = 2;
    const all: TenantSnapshot[] = new Array(tenants.length);
    for (let i = 0; i < tenants.length; i += CHUNK) {
      const slice = tenants.slice(i, i + CHUNK);
      const chunkResults = await Promise.all(slice.map((tn) => fetchOne(tn, sdate, edate)));
      chunkResults.forEach((r, k) => (all[i + k] = r));
      // progressive update: keep old data for not-yet-fetched tenants
      setSnapshots((prev) => {
        return tenants.map((tn, idx) => {
          if (all[idx]) return all[idx];
          const prevSnap = prev.find((p) => p.tenant.tenant_id === tn.tenant_id);
          return prevSnap || emptySnapshot(tn, false);
        });
      });
    }
    setHasLoadedOnce(true);
    isFetchingRef.current = false;
    setSilentBadge(false);
  }, [tenants, token, startDate, endDate, fetchOne]);

  // Initial fetch on open
  useEffect(() => {
    if (visible) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Filter change: show spinner during refresh
  useEffect(() => {
    if (!visible || !hasLoadedOnce) return;
    setFilterLoading(true);
    fetchAll().finally(() => setFilterLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // Silent 30s auto-refresh ALWAYS (user requested no visible refresh)
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      if (isTodayOnly) fetchAll();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isTodayOnly]);

  // ─── Fetch per-tenant per-hour product data (on-demand, ONE request per tenant) ───
  useEffect(() => {
    if (!visible || !hasLoadedOnce || !token) return;
    if (snapshots.length === 0) return;

    const sdate = fmtDate(startDate);
    const edate = fmtDate(endDate);
    let cancelled = false;
    setPhLoading(true);

    (async () => {
      const CHUNK = 5; // tenants in parallel (more aggressive)
      const fresh: Record<string, Record<string, Record<string, Record<string, { qty: number; amount: number }>>>> = {};

      // Skip tenants that errored out in the snapshot fetch (they have no backend / aborted)
      const validSnapshots = snapshots.filter((s) => !s.error);

      for (let i = 0; i < validSnapshots.length; i += CHUNK) {
        if (cancelled) return;
        const slice = validSnapshots.slice(i, i + CHUNK);
        await Promise.all(slice.map(async (s) => {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 25000); // fail fast
            const resp = await fetch(`${API_URL}/api/data/hourly-detail-full`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              signal: ctrl.signal,
              body: JSON.stringify({
                tenant_id: s.tenant.tenant_id,
                date: sdate,
                edate: edate,
                lokasyon_id: null,
              }),
            });
            clearTimeout(timer);
            const j = await resp.json();
            const byHour: Record<string, any[]> = j?.by_hour || {};

            // tenant -> location -> product -> hour -> {qty, amount}
            const tMap: Record<string, Record<string, Record<string, { qty: number; amount: number }>>> = {};
            Object.entries(byHour).forEach(([hour, rows]) => {
              rows.forEach((r: any) => {
                const name = r?.STOK_ADI || r?.STOK_AD || r?.URUN_ADI || '-';
                const loc = r?.LOKASYON || r?.LOKASYON_ADI || '-';
                const qty = parseFloat(r?.TOPLAM_MIKTAR || r?.MIKTAR || '0');
                const amount = parseFloat(r?.KDV_DAHIL_TOPLAM_TUTAR || r?.TOPLAM_TUTAR || '0');
                if (!tMap[loc]) tMap[loc] = {};
                if (!tMap[loc][name]) tMap[loc][name] = {};
                if (!tMap[loc][name][hour]) tMap[loc][name][hour] = { qty: 0, amount: 0 };
                tMap[loc][name][hour].qty += qty;
                tMap[loc][name][hour].amount += amount;
              });
            });
            fresh[s.tenant.tenant_id] = tMap;
          } catch {
            // silently skip on per-tenant error
          }
        }));
        if (!cancelled) setProductHourByTenant({ ...fresh });
      }
      if (!cancelled) setPhLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hasLoadedOnce, snapshots.length, startDate.getTime(), endDate.getTime()]);

  const maxTotal = useMemo(
    () => snapshots.reduce((m, s) => Math.max(m, s.totals.total), 0),
    [snapshots]
  );

  const periodLabel = useMemo(() => {
    if (fmtDate(startDate) === fmtDate(endDate)) {
      return startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return `${startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} — ${endDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }, [startDate, endDate]);

  // Hourly receipts comparison — union hours across tenants
  const allHours = useMemo(() => {
    const set = new Set<string>();
    snapshots.forEach((s) => Object.keys(s.hourlyFis).forEach((h) => set.add(h)));
    return Array.from(set).sort();
  }, [snapshots]);
  const maxHourFis = useMemo(() => {
    let m = 0;
    snapshots.forEach((s) => Object.values(s.hourlyFis).forEach((v) => { if (v > m) m = v; }));
    return m || 1;
  }, [snapshots]);
  const totalFisAll = useMemo(
    () => snapshots.reduce((sum, s) => sum + Object.values(s.hourlyFis).reduce((a, b) => a + b, 0), 0),
    [snapshots]
  );

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
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                Veri Kaynağı Karşılaştırması
              </Text>
              {filterLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : silentBadge ? (
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
              ) : null}
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500' }} numberOfLines={1}>
              {filterLoading ? 'Filtre uygulanıyor...' : 'Karta dokun → şube detayı'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => fetchAll()} style={styles.headerBtn} hitSlop={12}>
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Date Range + Presets */}
        <View style={[styles.dateBox, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.dateHeaderRow}>
            <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Karşılaştırma Dönemi</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[{ color: colors.text, fontSize: 12, fontWeight: '700' }]}>{periodLabel}</Text>
              {!isTodayOnly && (
                <TouchableOpacity
                  onPress={resetFilter}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.error + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}
                >
                  <Ionicons name="close-circle" size={12} color={colors.error} />
                  <Text style={{ color: colors.error, fontSize: 11, fontWeight: '700' }}>Temizle</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 10 }}>
            {PRESETS.map((p) => {
              const isActive = activePreset === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: isActive ? colors.primary : colors.background,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => applyPreset(p.key)}
                >
                  <Text style={{ color: isActive ? '#FFF' : colors.text, fontSize: 12, fontWeight: '600' }}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {showStartPicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_e, d) => {
              setShowStartPicker(false);
              if (d) { setStartDate(d); setActivePreset(null); }
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
              if (d) { setEndDate(d); setActivePreset(null); }
            }}
          />
        )}

        {/* Body */}
        {tenants.length < 1 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="analytics-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Karşılaştırmak için veri kaynağı ekleyin
            </Text>
          </View>
        ) : snapshots.length === 0 ? (
          <View style={styles.emptyBox}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero cards — tap to open TenantDetailModal */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              {snapshots.map((snap, idx) => {
                const color = getTenantColor(idx);
                const pct = maxTotal > 0 ? (snap.totals.total / maxTotal) * 100 : 0;
                const n = snapshots.length;
                const width: any = n === 1 ? '100%' : n === 2 ? '48%' : n === 3 ? '31.5%' : '48%';
                const isActive = snap.tenant.tenant_id === activeTenantId;
                const fisTotal = Object.values(snap.hourlyFis).reduce((a, b) => a + b, 0);
                const hasError = !!snap.error;
                return (
                  <TouchableOpacity
                    key={snap.tenant.tenant_id}
                    onPress={() => setDetailTenantIdx(idx)}
                    activeOpacity={0.75}
                    disabled={hasError}
                    style={{
                      width,
                      borderRadius: 16,
                      padding: 14,
                      backgroundColor: hasError ? colors.error + '08' : color + '12',
                      borderWidth: isActive ? 2.5 : 1.5,
                      borderColor: hasError ? colors.error + '40' : (isActive ? color : color + '40'),
                      minWidth: 130,
                      flexGrow: 1,
                      position: 'relative',
                      opacity: hasError ? 0.65 : 1,
                    }}
                  >
                    {hasError && (
                      <View style={{
                        position: 'absolute', top: -10, right: 10,
                        backgroundColor: colors.error, borderRadius: 10,
                        paddingHorizontal: 8, paddingVertical: 2,
                        flexDirection: 'row', alignItems: 'center', gap: 3,
                      }}>
                        <Ionicons name="warning" size={11} color="#FFF" />
                        <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>Veri Yok</Text>
                      </View>
                    )}
                    {!hasError && isActive && (
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
                        {snap.tenant.name || `Veri ${idx + 1}`}
                      </Text>
                      <Ionicons name="open-outline" size={14} color={color} />
                    </View>
                    <Text
                      style={{ color, fontWeight: '800', fontSize: 22, marginBottom: 4 }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      ₺{fmtTL(snap.totals.total)}
                    </Text>
                    <View style={{ height: 4, backgroundColor: color + '22', borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.max(pct, 2)}%`, height: '100%', backgroundColor: color }} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 10 }}>
                        {snap.branches.length} lok · {snap.cancels.count} iptal
                      </Text>
                      {fisTotal > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                          <Ionicons name="receipt-outline" size={10} color={color} />
                          <Text style={{ color, fontSize: 10, fontWeight: '700' }}>{fisTotal} fiş</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Hourly Receipt Count — comparison across tenants */}
            {allHours.length > 0 && totalFisAll > 0 && (
              <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 8 }}>
                  <Ionicons name="receipt-outline" size={16} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
                    Saatlik Fiş Sayısı
                  </Text>
                  <View style={{ backgroundColor: colors.primary + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{totalFisAll} fiş</Text>
                  </View>
                </View>
                <SwipeHint color={colors.primary} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    {/* Header row */}
                    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                      <View style={{ width: 140, paddingVertical: 8, paddingHorizontal: 12 }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>Veri Kaynağı</Text>
                      </View>
                      {allHours.map((h) => (
                        <View key={h} style={{ width: 46, paddingVertical: 8, alignItems: 'center' }}>
                          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>{String(h).slice(0, 5)}</Text>
                        </View>
                      ))}
                      <View style={{ width: 72, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>Toplam</Text>
                      </View>
                    </View>
                    {/* Tenant rows */}
                    {snapshots.map((snap, idx) => {
                      const color = getTenantColor(idx);
                      const rowTotal = Object.values(snap.hourlyFis).reduce((a, b) => a + b, 0);
                      return (
                        <View key={snap.tenant.tenant_id} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <View style={{ width: 140, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                              {snap.tenant.name || `Veri ${idx + 1}`}
                            </Text>
                          </View>
                          {allHours.map((h) => {
                            const fis = snap.hourlyFis[h] || 0;
                            const heightPct = maxHourFis > 0 ? (fis / maxHourFis) * 100 : 0;
                            return (
                              <View key={h} style={{ width: 46, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
                                {fis > 0 ? (
                                  <>
                                    <View style={{ width: 22, height: 34, backgroundColor: color + '18', borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' }}>
                                      <View style={{ width: '100%', height: `${Math.max(heightPct, 10)}%`, backgroundColor: color }} />
                                    </View>
                                    <Text style={{ color: colors.text, fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                                      {fis}
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ color: colors.border, fontSize: 12 }}>·</Text>
                                )}
                              </View>
                            );
                          })}
                          <View style={{ width: 72, paddingHorizontal: 8, alignItems: 'flex-end' }}>
                            <Text style={{ color, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
                              {rowTotal}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 10 }}>fiş</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Per-metric comparison table — horizontal scroll */}
            <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 }}>
                <Ionicons name="grid-outline" size={16} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Metrik Karşılaştırması</Text>
              </View>
              <SwipeHint color={colors.primary} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={[styles.tableRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
                    <Text style={[styles.colMetric, { color: colors.textSecondary, fontSize: 11, fontWeight: '700' }]}>Metrik</Text>
                    {snapshots.map((s, i) => {
                      const isActive = s.tenant.tenant_id === activeTenantId;
                      return (
                        <Text
                          key={s.tenant.tenant_id}
                          style={[styles.colValue, { color: isActive ? getTenantColor(i) : colors.textSecondary, fontSize: 11, fontWeight: '700' }]}
                          numberOfLines={1}
                        >
                          {isActive ? '★ ' : ''}{s.tenant.name || `Veri ${i + 1}`}
                        </Text>
                      );
                    })}
                    <Text style={[styles.colShare, { color: colors.textSecondary, fontSize: 11, fontWeight: '700' }]}>Pay %</Text>
                  </View>

                  {[
                    { key: 'cash', label: 'Nakit', icon: 'cash-outline' as const, color: colors.cash },
                    { key: 'card', label: 'Kart', icon: 'card-outline' as const, color: colors.primary },
                    { key: 'openAccount', label: 'Açık', icon: 'wallet-outline' as const, color: colors.openAccount },
                    { key: 'total', label: 'Toplam', icon: 'stats-chart' as const, color: colors.total },
                  ].map((metric) => {
                    const activeVal = snapshots.find((s) => s.tenant.tenant_id === activeTenantId)?.totals as any;
                    const shareDenom = snapshots.reduce((s, x) => s + ((x.totals as any)[metric.key] || 0), 0);
                    return (
                      <View key={metric.key} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                        <View style={[styles.colMetric, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                          <Ionicons name={metric.icon} size={14} color={metric.color} />
                          <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{metric.label}</Text>
                        </View>
                        {snapshots.map((s) => (
                          <Text
                            key={s.tenant.tenant_id}
                            style={[styles.colValue, { color: colors.text, fontWeight: '700', fontSize: 13 }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                          >
                            ₺{fmtTL((s.totals as any)[metric.key] || 0)}
                          </Text>
                        ))}
                        <Text style={[styles.colShare, { color: colors.primary, fontWeight: '700', fontSize: 12 }]}>
                          {shareDenom > 0 && activeVal ? `${((activeVal[metric.key] / shareDenom) * 100).toFixed(1)}%` : '—'}
                        </Text>
                      </View>
                    );
                  })}

                  <View style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: 0 }]}>
                    <View style={[styles.colMetric, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>İptaller</Text>
                    </View>
                    {snapshots.map((s) => (
                      <Text
                        key={s.tenant.tenant_id}
                        style={[styles.colValue, { color: colors.error, fontWeight: '700', fontSize: 11 }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {`${s.cancels.count} · ₺${fmtTL(s.cancels.amount)}`}
                      </Text>
                    ))}
                    <Text style={[styles.colShare, { color: colors.textSecondary, fontSize: 11 }]}>—</Text>
                  </View>
                </View>
              </ScrollView>
            </View>

            {/* Product Comparison — ALL tenants × ALL products (sorted desc) */}
            {(() => {
              // Build aggregated product map: productName -> { [tenantId]: {qty, amount} }
              const productMap: Record<string, { name: string; totalAmount: number; totalQty: number; perTenant: Record<string, { amount: number; qty: number; location: string }> }> = {};
              snapshots.forEach((snap) => {
                snap.topProducts.forEach((p) => {
                  const key = p.name;
                  if (!productMap[key]) {
                    productMap[key] = { name: p.name, totalAmount: 0, totalQty: 0, perTenant: {} };
                  }
                  productMap[key].totalAmount += p.amount;
                  productMap[key].totalQty += p.qty;
                  const existing = productMap[key].perTenant[snap.tenant.tenant_id];
                  if (existing) {
                    existing.amount += p.amount;
                    existing.qty += p.qty;
                  } else {
                    productMap[key].perTenant[snap.tenant.tenant_id] = {
                      amount: p.amount,
                      qty: p.qty,
                      location: p.location,
                    };
                  }
                });
              });
              const allProductsRows = Object.values(productMap).sort((a, b) => b.totalAmount - a.totalAmount);
              if (allProductsRows.length === 0) return null;
              return (
                <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 8 }}>
                    <Ionicons name="list-outline" size={16} color={colors.primary} />
                    <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
                      Ürün Karşılaştırması · Tüm Veri Kaynakları
                    </Text>
                    <View style={{ backgroundColor: colors.primary + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{allProductsRows.length} ürün</Text>
                    </View>
                  </View>
                  <SwipeHint color={colors.primary} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      {/* Header */}
                      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                        <View style={{ width: 40, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' }}>
                          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>#</Text>
                        </View>
                        <View style={{ width: 180, paddingVertical: 8, paddingHorizontal: 10 }}>
                          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>Ürün</Text>
                        </View>
                        {snapshots.map((s, i) => (
                          <View key={s.tenant.tenant_id} style={{ width: 110, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'flex-end' }}>
                            <Text style={{ color: getTenantColor(i), fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                              {s.tenant.name || `Veri ${i + 1}`}
                            </Text>
                          </View>
                        ))}
                        <View style={{ width: 110, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'flex-end', backgroundColor: colors.primary + '10' }}>
                          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '800' }}>TOPLAM</Text>
                        </View>
                      </View>
                      {/* Rows */}
                      {allProductsRows.map((row, idx) => (
                        <View key={row.name + idx} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <View style={{ width: 40, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' }}>
                            <View style={{
                              minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 6,
                              backgroundColor: idx < 3 ? colors.primary + '20' : colors.background,
                              borderWidth: 1, borderColor: idx < 3 ? colors.primary : colors.border,
                              alignItems: 'center', justifyContent: 'center',
                            }}>
                              <Text style={{ color: idx < 3 ? colors.primary : colors.textSecondary, fontSize: 10, fontWeight: '800' }}>
                                {idx + 1}
                              </Text>
                            </View>
                          </View>
                          <View style={{ width: 180, paddingVertical: 10, paddingHorizontal: 10 }}>
                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }} numberOfLines={2}>
                              {row.name}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 1 }}>
                              {row.totalQty.toFixed(0)} adet
                            </Text>
                          </View>
                          {snapshots.map((s, i) => {
                            const val = row.perTenant[s.tenant.tenant_id];
                            return (
                              <View key={s.tenant.tenant_id} style={{ width: 110, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'flex-end' }}>
                                {val && val.amount > 0 ? (
                                  <>
                                    <Text
                                      style={{ color: getTenantColor(i), fontSize: 12, fontWeight: '800' }}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.7}
                                    >
                                      ₺{fmtTL(val.amount)}
                                    </Text>
                                    <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                                      {val.qty.toFixed(0)} ad
                                    </Text>
                                    <Text style={{ color: colors.textSecondary, fontSize: 8, marginTop: 1 }} numberOfLines={1}>
                                      {val.location}
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ color: colors.border, fontSize: 12 }}>—</Text>
                                )}
                              </View>
                            );
                          })}
                          <View style={{ width: 110, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'flex-end', backgroundColor: colors.primary + '08' }}>
                            <Text
                              style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.7}
                            >
                              ₺{fmtTL(row.totalAmount)}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                              {row.totalQty.toFixed(0)} ad
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              );
            })()}

            {/* Ürünlerin Saatlik Satışları · Lokasyon Bazlı */}
            {(() => {
              // Union of products across tenants × locations
              // productTotals[productName] = total amount across everything
              const productTotals: Record<string, number> = {};
              const tenantLocPairs: { tenantId: string; tenantName: string; tenantIdx: number; location: string }[] = [];
              const seenPairs = new Set<string>();

              snapshots.forEach((s, idx) => {
                const tenantData = productHourByTenant[s.tenant.tenant_id] || {};
                Object.entries(tenantData).forEach(([loc, products]) => {
                  const pairKey = `${s.tenant.tenant_id}__${loc}`;
                  if (!seenPairs.has(pairKey)) {
                    seenPairs.add(pairKey);
                    tenantLocPairs.push({
                      tenantId: s.tenant.tenant_id,
                      tenantName: s.tenant.name || `Veri ${idx + 1}`,
                      tenantIdx: idx,
                      location: loc,
                    });
                  }
                  Object.entries(products).forEach(([name, hours]) => {
                    const sum = Object.values(hours).reduce((a, h) => a + h.amount, 0);
                    productTotals[name] = (productTotals[name] || 0) + sum;
                  });
                });
              });

              const allProducts = Object.keys(productTotals).sort((a, b) => productTotals[b] - productTotals[a]);

              if (allProducts.length === 0 && !phLoading) return null;

              // Union of hours across all tenants
              const hoursUnion = new Set<string>();
              snapshots.forEach((s) => Object.keys(s.hourly).forEach((h) => hoursUnion.add(h)));
              const allHours = Array.from(hoursUnion).sort();

              return (
                <View style={[styles.sectionBox, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 4 }}>
                    <Ionicons name="time-outline" size={16} color={colors.primary} />
                    <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
                      Ürünlerin Saatlik Satışları · Lokasyon Bazlı
                    </Text>
                    {phLoading && <ActivityIndicator size="small" color={colors.primary} />}
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, paddingHorizontal: 14, paddingBottom: 6 }}>
                    En çoktan en aza sıralı · her ürünün veri kaynağı × lokasyon × saat kırılımı
                  </Text>

                  {allProducts.length === 0 && phLoading && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        Saatlik ürün detayları yükleniyor...
                      </Text>
                    </View>
                  )}

                  {allProducts.map((productName, pIdx) => {
                    const productTotal = productTotals[productName];
                    // Collect rows for this product: each row is a (tenant, location) pair
                    // where this product has any sale
                    const rowsForProduct = tenantLocPairs.filter((pair) => {
                      const data = productHourByTenant[pair.tenantId]?.[pair.location]?.[productName];
                      if (!data) return false;
                      return Object.values(data).some((c) => c.qty > 0 || c.amount > 0);
                    });
                    if (rowsForProduct.length === 0) return null;

                    // Hours where this product had sales anywhere
                    const productHours = allHours.filter((h) =>
                      rowsForProduct.some((pair) => {
                        const c = productHourByTenant[pair.tenantId]?.[pair.location]?.[productName]?.[h];
                        return c && (c.qty > 0 || c.amount > 0);
                      })
                    );

                    return (
                      <View key={productName + pIdx} style={{ marginBottom: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                        {/* Product header */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.primary + '06' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                            <View style={{
                              minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 5,
                              backgroundColor: pIdx < 3 ? colors.primary + '22' : colors.background,
                              borderWidth: 1, borderColor: pIdx < 3 ? colors.primary : colors.border,
                              alignItems: 'center', justifyContent: 'center',
                            }}>
                              <Text style={{ color: pIdx < 3 ? colors.primary : colors.textSecondary, fontSize: 10, fontWeight: '800' }}>
                                #{pIdx + 1}
                              </Text>
                            </View>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', flex: 1 }} numberOfLines={2}>
                              {productName}
                            </Text>
                          </View>
                          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                            ₺{fmtTL(productTotal)}
                          </Text>
                        </View>

                        {/* Horizontal matrix: Tenant × Lokasyon as rows, Saat as cols */}
                        <SwipeHint color={colors.primary} />
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View>
                            {/* Header row */}
                            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                              <View style={{ width: 180, paddingVertical: 6, paddingHorizontal: 8 }}>
                                <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>Veri · Lokasyon</Text>
                              </View>
                              {productHours.map((h) => (
                                <View key={h} style={{ width: 72, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center' }}>
                                  <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>{String(h).slice(0, 5)}</Text>
                                </View>
                              ))}
                              <View style={{ width: 90, paddingVertical: 6, paddingHorizontal: 8, alignItems: 'flex-end', backgroundColor: colors.primary + '10' }}>
                                <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '800' }}>TOPLAM</Text>
                              </View>
                            </View>

                            {/* Rows — one per (tenant, location) */}
                            {rowsForProduct.map((pair, rIdx) => {
                              const tenantColor = getTenantColor(pair.tenantIdx);
                              const cellData = productHourByTenant[pair.tenantId]?.[pair.location]?.[productName] || {};
                              let rowQty = 0;
                              let rowAmount = 0;
                              Object.values(cellData).forEach((c) => { rowQty += c.qty; rowAmount += c.amount; });
                              return (
                                <View key={pair.tenantId + pair.location + rIdx} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                                  <View style={{ width: 180, paddingVertical: 8, paddingHorizontal: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: tenantColor }} />
                                      <Text style={{ color: tenantColor, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
                                        {pair.tenantName}
                                      </Text>
                                    </View>
                                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 1 }} numberOfLines={1}>
                                      📍 {pair.location}
                                    </Text>
                                  </View>
                                  {productHours.map((h) => {
                                    const c = cellData[h];
                                    const qty = c?.qty || 0;
                                    const amount = c?.amount || 0;
                                    return (
                                      <View key={h} style={{ width: 72, paddingVertical: 6, paddingHorizontal: 2, alignItems: 'center' }}>
                                        {qty > 0 ? (
                                          <>
                                            <Text style={{ color: tenantColor, fontSize: 10, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                                              ₺{fmtTL(amount)}
                                            </Text>
                                            <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                                              {qty.toFixed(0)} ad
                                            </Text>
                                          </>
                                        ) : (
                                          <Text style={{ color: colors.border, fontSize: 11 }}>—</Text>
                                        )}
                                      </View>
                                    );
                                  })}
                                  <View style={{ width: 90, paddingVertical: 6, paddingHorizontal: 8, alignItems: 'flex-end', backgroundColor: colors.primary + '06' }}>
                                    <Text style={{ color: tenantColor, fontSize: 11, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                                      ₺{fmtTL(rowAmount)}
                                    </Text>
                                    <Text style={{ color: colors.textSecondary, fontSize: 9 }}>
                                      {rowQty.toFixed(0)} ad
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
              );
            })()}

            {/* Errors */}
            {snapshots.filter((s) => s.error).length > 0 && (
              <View style={[styles.errorBox, { backgroundColor: colors.error + '10', borderColor: colors.error }]}>
                <Ionicons name="warning-outline" size={16} color={colors.error} />
                <Text style={{ color: colors.error, fontSize: 12, marginLeft: 6, flex: 1 }}>
                  {snapshots.filter((s) => s.error).map((s) => `${s.tenant.name || 'Veri'}: ${s.error}`).join(' · ')}
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Tenant Detail Modal — opens on card tap */}
      {detailTenantIdx !== null && snapshots[detailTenantIdx] && (
        <TenantDetailModal
          visible={detailTenantIdx !== null}
          onClose={() => setDetailTenantIdx(null)}
          snapshot={snapshots[detailTenantIdx]}
          color={getTenantColor(detailTenantIdx)}
          periodLabel={periodLabel}
          filterDate={fmtDate(startDate)}
          filterEndDate={fmtDate(endDate)}
        />
      )}
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

  dateBox: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
  },
  dateHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, textAlign: 'center' },

  sectionBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, overflow: 'hidden' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },

  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1 },
  colMetric: { width: 110 },
  colValue: { width: 120, textAlign: 'right', paddingLeft: 4 },
  colShare: { width: 70, textAlign: 'right', paddingLeft: 4 },

  errorBox: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 4 },
});
