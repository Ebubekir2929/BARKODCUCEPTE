import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Dimensions,
  RefreshControl,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { DataSourceSelector } from '../../src/components/DataSourceSelector';
import { SummaryCard } from '../../src/components/SummaryCard';
import { FilterModal } from '../../src/components/FilterModal';
import { useLiveData } from '../../src/hooks/useLiveData';
import { WaiterSalesSection, HourlyLocationSection } from '../../src/components/DashboardSections';
import { BranchSales, HourlySales, OpenTable } from '../../src/types';

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;

export default function DashboardScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { activeSource } = useDataSourceStore();

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    branchId: null as string | null,
    startDate: new Date(),
    endDate: new Date(),
  });

  // Use live data hook with filter support (must be after filters state)
  const { data: sourceData, isLoading: dataLoading, isRefreshing: dataRefreshing, error: dataError, lastSynced, refresh: refreshData, isLive, isFilterActive: isDataFiltered } = useLiveData(filters);

  // Cache totals per data source - reset when source changes, update only with fresh data
  const [sourceTotals, setSourceTotals] = useState<Record<string, number>>({});
  const prevSourceRef = React.useRef(activeSource);
  
  useEffect(() => {
    // When source changes, clear the new source's cached total first
    if (prevSourceRef.current !== activeSource) {
      prevSourceRef.current = activeSource;
      return; // Wait for fresh data
    }
    const total = sourceData?.weeklyComparison?.thisWeek?.total ?? 0;
    setSourceTotals(prev => ({ ...prev, [activeSource]: total }));
  }, [activeSource, sourceData?.weeklyComparison?.thisWeek?.total]);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedCardType, setSelectedCardType] = useState<'cash' | 'card' | 'openAccount' | 'total' | null>(null);
  const [selectedHour, setSelectedHour] = useState<HourlySales | null>(null);
  const [showHourDetail, setShowHourDetail] = useState(false);
  const [highlightedHourIndex, setHighlightedHourIndex] = useState<number | null>(null);
  
  // Hourly detail state (POS fetch)
  const [hourDetailProducts, setHourDetailProducts] = useState<any[]>([]);
  const [hourDetailLoading, setHourDetailLoading] = useState(false);

  // İptal detail state (POS fetch)
  const [selectedIptalItem, setSelectedIptalItem] = useState<any | null>(null);
  const [iptalDetailItems, setIptalDetailItems] = useState<any[]>([]);
  const [iptalDetailLoading, setIptalDetailLoading] = useState(false);
  const [showIptalListModal, setShowIptalListModal] = useState(false);
  const [iptalListLocation, setIptalListLocation] = useState<string>('');
  const [iptalListItems, setIptalListItems] = useState<any[]>([]);
  const [iptalListLoading, setIptalListLoading] = useState(false);

  // Open Tables state
  const [selectedOpenTable, setSelectedOpenTable] = useState<OpenTable | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [tableDetailItems, setTableDetailItems] = useState<any[]>([]);
  const [tableDetailLoading, setTableDetailLoading] = useState(false);

  // Check if filter is active (from live data hook)
  const isFilterActive = isDataFiltered;

  // Compute active tenant ID based on selected data source
  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const DATA_SOURCE_KEYS = ['data1', 'data2', 'data3'];
    const index = DATA_SOURCE_KEYS.indexOf(activeSource);
    if (index >= 0 && index < user.tenants.length) {
      return user.tenants[index].tenant_id || '';
    }
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const clearFilters = () => {
    const today = new Date();
    setFilters({ branchId: null, startDate: today, endDate: today });
  };

  // Group open tables by location
  const openTablesByLocation = useMemo(() => {
    const tables = sourceData?.openTables || [];
    const grouped: Record<string, OpenTable[]> = {};
    tables.forEach(table => {
      const loc = table.location || 'Diğer';
      if (!grouped[loc]) grouped[loc] = [];
      grouped[loc].push(table);
    });
    return grouped;
  }, [sourceData?.openTables]);

  // Fetch table detail from POS via sync
  const fetchTableDetail = useCallback(async (table: OpenTable) => {
    setSelectedOpenTable(table);
    setTableDetailItems([]);
    setTableDetailLoading(true);
    
    const tenantId = user?.tenants?.[0]?.tenant_id;
    if (!tenantId || !table.posId) {
      setTableDetailLoading(false);
      return;
    }
    
    try {
      const { token: authToken } = useAuthStore.getState();
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/table-detail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ tenant_id: tenantId, pos_id: table.posId }),
      });
      
      const data = await response.json();
      if (data.ok && data.data) {
        setTableDetailItems(data.data);
      }
    } catch (err) {
      console.error('Table detail error:', err);
    } finally {
      setTableDetailLoading(false);
    }
  }, [user?.tenants]);


  // Calculate totals from all branches
  const totals = useMemo(() => {
    const branches = sourceData?.branchSales || [];
    const filteredBranches = filters.branchId
      ? branches.filter((b) => b.branchId === filters.branchId)
      : branches;

    return filteredBranches.reduce(
      (acc, branch) => ({
        cash: acc.cash + branch.sales.cash,
        card: acc.card + branch.sales.card,
        openAccount: acc.openAccount + branch.sales.openAccount,
        total: acc.total + branch.sales.total,
      }),
      { cash: 0, card: 0, openAccount: 0, total: 0 }
    );
  }, [filters.branchId, sourceData]);

  // Best selling hour
  const bestSellingHour = useMemo(() => {
    const hours = sourceData?.hourlySales || [];
    if (hours.length === 0) return { hour: '-', amount: 0, transactions: 0 };
    return hours.reduce((max, hour) => hour.amount > max.amount ? hour : max, hours[0]);
  }, [sourceData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  // Calculate percentage changes for each payment type
  const cardChangePercents = useMemo(() => {
    const calcPercent = (current: number, last: number) => 
      last > 0 ? ((current - last) / last) * 100 : 0;
    
    return {
      cash: calcPercent(totals.cash, sourceData.weeklyComparison.lastWeek.cash),
      card: calcPercent(totals.card, sourceData.weeklyComparison.lastWeek.card),
      openAccount: calcPercent(totals.openAccount, sourceData.weeklyComparison.lastWeek.openAccount),
      total: calcPercent(totals.total, sourceData.weeklyComparison.lastWeek.total),
    };
  }, [totals, sourceData]);

  const maxHourAmount = useMemo(() => {
    const hours = sourceData?.hourlySales || [];
    if (hours.length === 0) return 1;
    return Math.max(...hours.map(h => h.amount));
  }, [sourceData]);

  // Open Tables computed values
  const openTableTotals = useMemo(() => {
    return (sourceData?.openTables || []).reduce(
      (acc, table) => ({
        amount: acc.amount + table.amount,
        paid: acc.paid + table.paidAmount,
        remaining: acc.remaining + table.remainingAmount,
      }),
      { amount: 0, paid: 0, remaining: 0 }
    );
  }, [sourceData]);

  const getPaymentStatusColor = (table: OpenTable) => {
    if (table.remainingAmount === 0) return colors.success;
    if (table.paidAmount > 0) return colors.warning;
    return colors.error;
  };

  const getPaymentStatusText = (table: OpenTable) => {
    if (table.remainingAmount === 0) return t('fully_paid');
    if (table.paidAmount > 0) return t('partially_paid');
    return t('not_paid');
  };

  const handleHourPress = (hour: HourlySales, index: number) => {
    setSelectedHour(hour);
    setHighlightedHourIndex(index);
    setShowHourDetail(true);
    setHourDetailProducts([]);
    setHourDetailLoading(true);
    
    // Fetch real product data from POS
    const fetchHourlyDetail = async () => {
      try {
        const { token: authToken } = useAuthStore.getState();
        const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/hourly-detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ tenant_id: activeTenantId, hour_label: hour.hour, lokasyon_id: null }),
        });
        const data = await response.json();
        if (data.ok && data.data) {
          setHourDetailProducts(data.data);
        }
      } catch (err) {
        console.error('Hourly detail error:', err);
      } finally {
        setHourDetailLoading(false);
      }
    };
    if (activeTenantId) fetchHourlyDetail();
    else setHourDetailLoading(false);
  };

  // İptal detay çekme
  const fetchIptalDetail = useCallback(async (iptalId: string, item: any) => {
    setSelectedIptalItem(item);
    setIptalDetailItems([]);
    setIptalDetailLoading(true);
    
    try {
      const { token: authToken } = useAuthStore.getState();
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/iptal-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ tenant_id: activeTenantId, iptal_id: iptalId }),
      });
      const data = await response.json();
      if (data.ok && data.data) setIptalDetailItems(data.data);
    } catch (err) {
      console.error('Iptal detail error:', err);
    } finally {
      setIptalDetailLoading(false);
    }
  }, [activeTenantId]);

  // Lokasyon bazlı iptal listesini aç ve POS'tan tam listeyi çek
  const openLocationIptalList = useCallback(async (locationName: string) => {
    setIptalListLocation(locationName);
    setIptalListItems([]);
    setIptalListLoading(true);
    setShowIptalListModal(true);
    
    try {
      const { token: authToken } = useAuthStore.getState();
      const body: any = { tenant_id: activeTenantId };
      
      // Send date range if filter is active
      if (filters?.startDate && filters?.endDate) {
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        body.sdate = fmt(filters.startDate);
        body.edate = fmt(filters.endDate);
      } else if (filters?.startDate) {
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        body.date = fmt(filters.startDate);
      }
      
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/iptal-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data.ok && data.data) {
        const filtered = data.data.filter((d: any) => d.LOKASYON === locationName);
        setIptalListItems(filtered);
      }
    } catch (err) {
      console.error('Iptal list error:', err);
    } finally {
      setIptalListLoading(false);
    }
  }, [activeTenantId, filters]);

  const getCardTypeLabel = (type: string) => {
    switch (type) {
      case 'cash': return 'Nakit';
      case 'card': return 'Kredi Kartı';
      case 'openAccount': return 'Açık Hesap';
      case 'total': return 'Toplam';
      default: return '';
    }
  };

  const getCardTypeColor = (type: string) => {
    switch (type) {
      case 'cash': return colors.cash;
      case 'card': return colors.primary;
      case 'openAccount': return colors.openAccount;
      case 'total': return colors.total;
      default: return colors.primary;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Status bar separator */}
      <View style={[styles.statusBarLine, { backgroundColor: colors.border }]} />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>Hoş geldiniz,</Text>
          <Text style={[styles.userName, { color: colors.text }]}>{user?.full_name || 'Kullanıcı'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowFilterModal(true)}
        >
          <Ionicons name="filter" size={20} color={colors.primary} />
          <Text style={[styles.filterText, { color: colors.primary }]}>Filtre</Text>
        </TouchableOpacity>
      </View>

      {/* Global Data Source Selector */}
      <DataSourceSelector totals={sourceTotals} />

      {/* Active Filter Banner */}
      {isFilterActive && (
        <View style={[styles.filterBanner, { backgroundColor: colors.primary + '10', borderBottomColor: colors.border }]}>
          <View style={styles.filterBannerLeft}>
            <Ionicons name="funnel" size={14} color={colors.primary} />
            <Text style={[styles.filterBannerText, { color: colors.primary }]} numberOfLines={1}>
              {filters.branchId
                ? (sourceData?.branchSales || []).find(b => b.branchId === filters.branchId)?.branchName || 'Şube'
                : 'Tüm Şubeler'
              }
              {' · '}
              {filters.startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
              {' - '}
              {filters.endDate.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
            </Text>
          </View>
          <TouchableOpacity style={styles.filterBannerClear} onPress={clearFilters}>
            <Ionicons name="close-circle" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Live data indicator */}
      {isLive && (
        <View style={[styles.liveIndicator, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.liveIndicatorLeft}>
            <View style={[styles.liveDot, { backgroundColor: dataError ? '#EF4444' : '#10B981' }]} />
            <Text style={[styles.liveText, { color: dataError ? '#EF4444' : '#10B981' }]}>
              {dataLoading ? 'Güncelleniyor...' : dataError ? 'Bağlantı hatası' : 'Canlı Veri · 30sn'}
            </Text>
          </View>
          {lastSynced && (
            <Text style={[styles.syncText, { color: colors.textSecondary }]}>
              Son: {new Date(lastSynced).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      )}
      {isDataFiltered && (
        <View style={[styles.liveIndicator, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.liveIndicatorLeft}>
            <View style={[styles.liveDot, { backgroundColor: colors.warning }]} />
            <Text style={[styles.liveText, { color: colors.warning }]}>
              {dataLoading ? 'Filtreleniyor...' : 'Filtrelenmiş Veri'}
            </Text>
          </View>
          <Text style={[styles.syncText, { color: colors.textSecondary }]}>Otomatik yenileme durdu</Text>
        </View>
      )}

      {/* Loading state */}
      {dataLoading && !sourceData?.weeklyComparison?.thisWeek?.total ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Veriler yükleniyor...</Text>
        </View>
      ) : (
      <>
      {/* Filter loading banner */}
      {dataRefreshing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 8, backgroundColor: colors.primary + '10' }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[{ fontSize: 13, color: colors.primary, fontWeight: '600' }]}>Filtreleniyor...</Text>
        </View>
      )}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Summary Cards */}
        <View style={styles.cardsContainer}>
          <View style={styles.cardRow}>
            <SummaryCard
              title="Nakit"
              amount={totals.cash}
              icon="cash-outline"
              color={colors.cash}
              onPress={() => setSelectedCardType('cash')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.cash}
              changePercent={cardChangePercents.cash}
            />
            <SummaryCard
              title="Kredi Kartı"
              amount={totals.card}
              icon="card-outline"
              color={colors.primary}
              onPress={() => setSelectedCardType('card')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.card}
              changePercent={cardChangePercents.card}
            />
          </View>
          <View style={styles.cardRow}>
            <SummaryCard
              title="Açık Hesap"
              amount={totals.openAccount}
              icon="wallet-outline"
              color={colors.openAccount}
              onPress={() => setSelectedCardType('openAccount')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.openAccount}
              changePercent={cardChangePercents.openAccount}
            />
            <SummaryCard
              title="Toplam"
              amount={totals.total}
              icon="stats-chart"
              color={colors.total}
              onPress={() => setSelectedCardType('total')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.total}
              changePercent={cardChangePercents.total}
            />
          </View>
        </View>

        {/* Open Tables Section - Only for Restoran */}
        {user?.business_type === 'restoran' && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>{t('open_tables')}</Text>
              <View style={[styles.liveBadge, { backgroundColor: colors.error + '20' }]}>
                <View style={[styles.liveDot, { backgroundColor: colors.error }]} />
                <Text style={[styles.liveText, { color: colors.error }]}>{t('open_tables_live')}</Text>
              </View>
            </View>
            <View style={[styles.openTableCount, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.openTableCountText, { color: colors.primary }]}>{(sourceData?.openTables || []).length}</Text>
            </View>
          </View>

          {/* Open Tables Summary Row */}
          <View style={[styles.openTablesSummary, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.openTablesSummaryItem}>
              <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_open_amount')}</Text>
              <Text style={[styles.openTablesSummaryValue, { color: colors.text }]}>
                ₺{openTableTotals.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={[styles.openTablesSummaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.openTablesSummaryItem}>
              <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_paid')}</Text>
              <Text style={[styles.openTablesSummaryValue, { color: colors.success }]}>
                ₺{openTableTotals.paid.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={[styles.openTablesSummaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.openTablesSummaryItem}>
              <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_remaining')}</Text>
              <Text style={[styles.openTablesSummaryValue, { color: colors.error }]}>
                ₺{openTableTotals.remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>

          {/* Open Tables List - Grouped by Location */}
          {Object.keys(openTablesByLocation).length > 0 ? (
            Object.entries(openTablesByLocation).map(([location, tables]) => (
              <View key={location}>
                <TouchableOpacity
                  style={[styles.locationGroupHeader, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setExpandedLocation(expandedLocation === location ? null : location)}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="location-outline" size={18} color={colors.primary} />
                    <Text style={[styles.locationGroupName, { color: colors.text }]}>{location}</Text>
                    <View style={[styles.locationGroupCount, { backgroundColor: colors.primary + '15' }]}>
                      <Text style={[styles.locationGroupCountText, { color: colors.primary }]}>{tables.length}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.locationGroupTotal, { color: colors.textSecondary }]}>
                      ₺{tables.reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                    <Ionicons
                      name={expandedLocation === location ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.textSecondary}
                    />
                  </View>
                </TouchableOpacity>

                {expandedLocation === location && tables.map((table) => (
                  <TouchableOpacity
                    key={table.id}
                    style={[styles.openTableCard, { backgroundColor: colors.background, borderColor: colors.border, marginLeft: 12 }]}
                    onPress={() => fetchTableDetail(table)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.openTableCardTop}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.tableIcon, { backgroundColor: getPaymentStatusColor(table) + '15' }]}>
                          <Ionicons name="restaurant-outline" size={16} color={getPaymentStatusColor(table)} />
                        </View>
                        <View>
                          <Text style={[styles.openTableName, { color: colors.text }]}>Masa {table.tableNo}</Text>
                          {table.section ? (
                            <Text style={[styles.openTableLocation, { color: colors.textSecondary }]}>{table.section}</Text>
                          ) : null}
                        </View>
                      </View>
                      <Text style={[styles.openTableStatValue, { color: colors.text }]}>
                        ₺{table.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="restaurant-outline" size={40} color={colors.textSecondary} />
              <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>{t('no_open_tables')}</Text>
            </View>
          )}
        </View>
        )}

        {/* Garson Satışları - Live Data */}
        {user?.business_type === 'restoran' && (sourceData?.waiterSales || []).length > 0 && (
          <WaiterSalesSection data={sourceData.waiterSales} />
        )}

        {/* Hourly Sales Chart */}
        {(sourceData?.hourlySales || []).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Saatlik Satışlar</Text>
            <View style={[styles.bestHourBadge, { backgroundColor: colors.success + '20' }]}>
              <Ionicons name="trophy" size={14} color={colors.success} />
              <Text style={[styles.bestHourText, { color: colors.success }]}>
                En Çok: {bestSellingHour.hour}
              </Text>
            </View>
          </View>

          {/* Bar Chart */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartScroll}>
            <View style={styles.barChart}>
              {(sourceData?.hourlySales || []).map((hour, index) => {
                const barHeight = (hour.amount / maxHourAmount) * 150;
                const isHighlighted = highlightedHourIndex === index;
                const isBest = hour.hour === bestSellingHour.hour;
                return (
                  <TouchableOpacity
                    key={hour.hour}
                    style={styles.barContainer}
                    onPress={() => handleHourPress(hour, index)}
                  >
                    <Text style={[styles.barValue, { color: colors.textSecondary }]}>
                      {(hour.amount / 1000).toFixed(0)}K
                    </Text>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barHeight,
                          backgroundColor: isHighlighted
                            ? colors.primary
                            : isBest
                            ? colors.success
                            : colors.primary + '60',
                        },
                      ]}
                    />
                    <Text style={[styles.barLabel, { color: isHighlighted ? colors.primary : colors.textSecondary }]}>
                      {hour.hour.slice(0, 2)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <Text style={[styles.chartHint, { color: colors.textSecondary }]}>
            Saate dokunarak detay görüntüleyin
          </Text>
        </View>
        )}

        {/* Top Selling Products */}
        {(sourceData?.topSelling || []).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>En Çok Satan Ürünler</Text>
          {(sourceData.topSelling || []).slice(0, 5).map((product, index) => (
            <View key={product.id} style={[styles.productItem, { borderBottomColor: colors.border }]}>
              <View style={[styles.productRank, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.productRankText, { color: colors.success }]}>{index + 1}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.text }]}>{product.name}</Text>
                <Text style={[styles.productQty, { color: colors.textSecondary }]}>
                  {product.quantity} adet satıldı
                </Text>
              </View>
              <Text style={[styles.productRevenue, { color: colors.success }]}>
                ₺{product.revenue.toLocaleString('tr-TR')}
              </Text>
            </View>
          ))}
        </View>
        )}

        {/* Least Selling Products */}
        {(sourceData?.leastSelling || []).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>En Az Satan Ürünler</Text>
          {(sourceData.leastSelling || []).slice(0, 5).map((product, index) => (
            <View key={product.id} style={[styles.productItem, { borderBottomColor: colors.border }]}>
              <View style={[styles.productRank, { backgroundColor: colors.error + '20' }]}>
                <Text style={[styles.productRankText, { color: colors.error }]}>{index + 1}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.text }]}>{product.name}</Text>
                <Text style={[styles.productQty, { color: colors.textSecondary }]}>
                  {product.quantity} adet satıldı
                </Text>
              </View>
              <Text style={[styles.productRevenue, { color: colors.error }]}>
                ₺{product.revenue.toLocaleString('tr-TR')}
              </Text>
            </View>
          ))}
        </View>
        )}

        {/* Location Summary */}
        {(sourceData?.branchSales || []).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Lokasyon Özeti</Text>
          {(sourceData?.branchSales || []).map((branch, index) => {
            // Find iptal data for this location from iptal_ozet
            const locOzetRows = (sourceData?.iptalOzet || []).filter(
              (o: any) => o.LOKASYON && o.LOKASYON === branch.branchName
            );
            const iptalAdet = locOzetRows.reduce((s: number, o: any) => 
              s + parseInt(o.FIS_IPTAL_ADET || '0') + parseInt(o.SATIR_IPTAL_ADET || '0'), 0);
            const iptalTutar = locOzetRows.reduce((s: number, o: any) => 
              s + parseFloat(o.FIS_IPTAL_TUTAR || '0') + parseFloat(o.SATIR_IPTAL_TUTAR || '0'), 0);
            
            return (
            <View 
              key={branch.branchId} 
              style={[
                styles.locationCard, 
                { borderBottomColor: colors.border },
                index === (sourceData?.branchSales || []).length - 1 && { borderBottomWidth: 0 }
              ]}
            >
              <Text style={[styles.locationName, { color: colors.text }]}>{branch.branchName}</Text>
              <View style={styles.locationDetails}>
                <View style={styles.locationRow}>
                  <View style={styles.locationStat}>
                    <Ionicons name="cash-outline" size={14} color={colors.cash} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Nakit</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.cash.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <View style={styles.locationStat}>
                    <Ionicons name="card-outline" size={14} color={colors.primary} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Kart</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.card.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                </View>
                <View style={styles.locationRow}>
                  <View style={styles.locationStat}>
                    <Ionicons name="wallet-outline" size={14} color={colors.openAccount} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Açık</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.openAccount.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <View style={styles.locationStat}>
                    <Ionicons name="stats-chart" size={14} color={colors.total} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Toplam</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.total.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                </View>
              </View>
              {iptalAdet > 0 && (
              <TouchableOpacity
                style={[styles.cancellationButton, { backgroundColor: colors.error + '15' }]}
                onPress={() => openLocationIptalList(branch.branchName)}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.cancellationText, { color: colors.error }]}>
                  {iptalAdet} İptal · ₺{iptalTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.error} />
              </TouchableOpacity>
              )}
            </View>
            );
          })}
        </View>
        )}

        {/* Lokasyon Saatlik Satışlar */}
        {(sourceData?.hourlyLocationSales || []).length > 0 && (
          <HourlyLocationSection data={sourceData.hourlyLocationSales} tenantId={activeTenantId} />
        )}

        {/* Bottom Spacing - Reduced */}
        <View style={{ height: 20 }} />
      </ScrollView>
      </>
      )}

      {/* Filter Modal */}
      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={setFilters}
        currentFilters={filters}
        branches={[
          ...(sourceData?.allLocations || []).map((loc: string) => ({ id: loc, name: loc })),
          ...(sourceData?.branchSales || [])
            .filter(b => !(sourceData?.allLocations || []).includes(b.branchName))
            .map(b => ({ id: b.branchId, name: b.branchName || b.branchId })),
        ]}
      />

      {/* Card Type Location Modal */}
      <Modal visible={!!selectedCardType} animationType="slide" transparent statusBarTranslucent>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedCardType(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {getCardTypeLabel(selectedCardType || '')} - Lokasyon Dağılımı
              </Text>
              <TouchableOpacity onPress={() => setSelectedCardType(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={[styles.modalBody, { backgroundColor: colors.surface }]}>
              {(sourceData?.branchSales || []).map((branch) => {
                const value = selectedCardType === 'cash' ? branch.sales.cash
                  : selectedCardType === 'card' ? branch.sales.card
                  : selectedCardType === 'openAccount' ? branch.sales.openAccount
                  : branch.sales.total;
                const percentage = (value / totals[selectedCardType || 'total']) * 100;
                return (
                  <View key={branch.branchId} style={[styles.locationModalItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.locationModalInfo}>
                      <View style={[styles.locationModalIcon, { backgroundColor: getCardTypeColor(selectedCardType || '') + '20' }]}>
                        <Ionicons name="storefront" size={18} color={getCardTypeColor(selectedCardType || '')} />
                      </View>
                      <View>
                        <Text style={[styles.locationModalName, { color: colors.text }]}>{branch.branchName}</Text>
                        <Text style={[styles.locationModalPercent, { color: colors.textSecondary }]}>
                          %{percentage.toFixed(1)} pay
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.locationModalValue, { color: getCardTypeColor(selectedCardType || '') }]}>
                      ₺{value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                );
              })}
              <View style={[styles.totalRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Toplam</Text>
                <Text style={[styles.totalValue, { color: getCardTypeColor(selectedCardType || '') }]}>
                  ₺{totals[selectedCardType || 'total'].toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
              {/* Geçen hafta karşılaştırma */}
              {(() => {
                const lw = sourceData?.weeklyComparison?.lastWeek;
                const lwValue = selectedCardType === 'cash' ? (lw?.cash || 0) : selectedCardType === 'card' ? (lw?.card || 0) : selectedCardType === 'openAccount' ? (lw?.openAccount || 0) : (lw?.total || 0);
                const currentValue = totals[selectedCardType || 'total'];
                const diff = currentValue - lwValue;
                const pct = lwValue > 0 ? ((diff / lwValue) * 100) : 0;
                return lwValue > 0 ? (
                  <View>
                    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, marginTop: 8, borderRadius: 12, backgroundColor: diff >= 0 ? colors.success + '10' : colors.error + '10' }]}>
                      <View>
                        <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>Geçen Hafta</Text>
                        <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text }]}>₺{lwValue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>Fark</Text>
                        <Text style={[{ fontSize: 14, fontWeight: '700', color: diff >= 0 ? colors.success : colors.error }]}>
                          {diff >= 0 ? '+' : ''}₺{diff.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                        </Text>
                      </View>
                    </View>
                    {/* Lokasyon dağılımı - geçen hafta */}
                    {lw?.locations && Object.keys(lw.locations).length > 0 && (
                      <View style={[{ marginTop: 8, borderRadius: 12, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
                        <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 }]}>Geçen Hafta Lokasyon Dağılımı</Text>
                        {Object.entries(lw.locations as Record<string, any>).map(([locName, locData]: [string, any]) => {
                          const locVal = selectedCardType === 'cash' ? locData.cash : selectedCardType === 'card' ? locData.card : selectedCardType === 'openAccount' ? locData.openAccount : locData.total;
                          return locVal > 0 ? (
                            <View key={locName} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                              <Text style={[{ fontSize: 12, color: colors.text }]}>{locName}</Text>
                              <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.textSecondary }]}>₺{locVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                            </View>
                          ) : null;
                        })}
                      </View>
                    )}
                  </View>
                ) : null;
              })()}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Hour Detail Modal */}
      <Modal visible={showHourDetail} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedHour?.hour} Satış Detayı
              </Text>
              <TouchableOpacity onPress={() => { setShowHourDetail(false); setHighlightedHourIndex(null); setHourDetailProducts([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedHour && (
              <ScrollView style={[styles.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={styles.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
                {/* Compact Hour Summary */}
                <View style={[styles.hourDetailCompact, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
                  <View style={styles.hourDetailCompactLeft}>
                    <Ionicons name="time-outline" size={28} color={colors.primary} />
                    <View>
                      <Text style={[styles.hourDetailTime, { color: colors.text, fontSize: 18 }]}>{selectedHour.hour}</Text>
                      <Text style={[styles.hourDetailTx, { color: colors.textSecondary }]}>Tüm Lokasyonlar</Text>
                    </View>
                  </View>
                  <Text style={[styles.hourDetailAmount, { color: colors.primary }]}>
                    ₺{selectedHour.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>

                {/* POS Product Detail */}
                <Text style={[{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 8 }]}>Ürün Detayı</Text>
                
                {hourDetailLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }]}>POS'tan veri alınıyor...</Text>
                  </View>
                ) : hourDetailProducts.length > 0 ? (
                  <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }]}>
                    <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 3, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>Ürün</Text>
                      <Text style={[{ flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>Miktar</Text>
                      <Text style={[{ flex: 1.5, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>Tutar</Text>
                    </View>
                    {hourDetailProducts.map((item: any, idx: number) => {
                      const tutar = parseFloat(item.KDV_DAHIL_TOPLAM_TUTAR || item.TOPLAM_TUTAR || '0');
                      return (
                        <View key={idx} style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' }]}>
                          <View style={{ flex: 3 }}>
                            <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]} numberOfLines={1}>{item.STOK_ADI || 'Ürün'}</Text>
                            <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{item.LOKASYON || ''}</Text>
                          </View>
                          <Text style={[{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'center' }]}>
                            {parseFloat(item.TOPLAM_MIKTAR || '0').toFixed(0)}
                          </Text>
                          <Text style={[{ flex: 1.5, fontSize: 14, fontWeight: '700', color: colors.primary, textAlign: 'right' }]}>
                            ₺{tutar.toFixed(2)}
                          </Text>
                        </View>
                      );
                    })}
                    {/* Total row */}
                    <View style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 4, fontSize: 14, fontWeight: '800', color: colors.text, textAlign: 'right', paddingRight: 12 }]}>Toplam</Text>
                      <Text style={[{ flex: 1.5, fontSize: 16, fontWeight: '800', color: colors.primary, textAlign: 'right' }]}>
                        ₺{hourDetailProducts.reduce((sum: number, item: any) => sum + parseFloat(item.KDV_DAHIL_TOPLAM_TUTAR || item.TOPLAM_TUTAR || '0'), 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 8, fontSize: 14 }]}>Ürün detayı bulunamadı</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Lokasyon İptal Listesi Modal */}
      <Modal visible={showIptalListModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {iptalListLocation} - İptal Fişleri
              </Text>
              <TouchableOpacity onPress={() => { setShowIptalListModal(false); setIptalListItems([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={[styles.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={styles.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
              {/* Özet */}
              {(() => {
                const locOzetRows = (sourceData?.iptalOzet || []).filter(
                  (o: any) => o.LOKASYON && o.LOKASYON === iptalListLocation
                );
                const totalFisTutar = locOzetRows.reduce((s: number, o: any) => s + parseFloat(o.FIS_IPTAL_TUTAR || '0'), 0);
                const totalSatirTutar = locOzetRows.reduce((s: number, o: any) => s + parseFloat(o.SATIR_IPTAL_TUTAR || '0'), 0);
                const totalFisAdet = locOzetRows.reduce((s: number, o: any) => s + parseInt(o.FIS_IPTAL_ADET || '0'), 0);
                const totalSatirAdet = locOzetRows.reduce((s: number, o: any) => s + parseInt(o.SATIR_IPTAL_ADET || '0'), 0);
                
                return (
                  <View style={[styles.cancellationSummary, { backgroundColor: colors.error + '15' }]}>
                    <Ionicons name="alert-circle" size={24} color={colors.error} />
                    <View style={styles.cancellationSummaryText}>
                      <Text style={[styles.cancellationCount, { color: colors.error }]}>
                        {totalFisAdet + totalSatirAdet} İptal ({totalFisAdet} fiş, {totalSatirAdet} satır)
                      </Text>
                      <Text style={[styles.cancellationTotal, { color: colors.text }]}>
                        Toplam: ₺{(totalFisTutar + totalSatirTutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                  </View>
                );
              })()}

              {/* İptal Fiş Listesi - POS'tan çekilmiş */}
              {iptalListLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <ActivityIndicator size="large" color={colors.error} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>İptal listesi yükleniyor...</Text>
                </View>
              ) : iptalListItems.length > 0 ? (
                iptalListItems.map((item: any, idx: number) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => fetchIptalDetail(String(item.IPTAL_ID), item)}
                  >
                    <View style={styles.receiptCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.receiptCardNo, { color: colors.text }]}>{item.PERSONEL_AD || 'Personel'}</Text>
                        <Text style={[styles.receiptCardDate, { color: colors.textSecondary }]}>
                          {item.IPTAL_TIPI || 'İptal'} · {item.DETAY_SATIR_SAYISI || 0} satır
                        </Text>
                      </View>
                      <Text style={[styles.receiptCardAmount, { color: colors.error }]}>
                        ₺{parseFloat(item.TUTAR || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                    <View style={styles.receiptCardFooter}>
                      <Text style={[styles.receiptCardReason, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.TARIH_IPTAL || item.TARIH || ''}
                      </Text>
                      <View style={styles.receiptCardAction}>
                        <Text style={[styles.receiptCardActionText, { color: colors.primary }]}>Detay</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                      </View>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <Text style={[{ color: colors.textSecondary }]}>İptal fişi bulunamadı</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* İptal Detay Modal (POS'tan çekilmiş) */}
      <Modal visible={!!selectedIptalItem} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
              <TouchableOpacity onPress={() => { setSelectedIptalItem(null); setIptalDetailItems([]); }}>
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1, textAlign: 'center' }]}>
                İptal Detayı
              </Text>
              <View style={{ width: 24 }} />
            </View>
            {selectedIptalItem && (
              <ScrollView style={[styles.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={styles.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
                <View style={[{ alignItems: 'center', padding: 16, borderRadius: 12, backgroundColor: '#EF4444' + '10', gap: 4, marginBottom: 12 }]}>
                  <Ionicons name="close-circle" size={28} color="#EF4444" />
                  <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text }]}>{selectedIptalItem.PERSONEL_AD || 'İptal'}</Text>
                  <Text style={[{ fontSize: 13, color: colors.textSecondary }]}>{selectedIptalItem.LOKASYON} · {selectedIptalItem.IPTAL_TIPI}</Text>
                  <Text style={[{ fontSize: 20, fontWeight: '800', color: '#EF4444', marginTop: 4 }]}>₺{parseFloat(selectedIptalItem.TUTAR || '0').toFixed(2)}</Text>
                </View>

                {iptalDetailLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>POS'tan veri alınıyor...</Text>
                  </View>
                ) : iptalDetailItems.length > 0 ? (
                  <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }]}>
                    <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 3, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>Ürün</Text>
                      <Text style={[{ flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>Miktar</Text>
                      <Text style={[{ flex: 1.5, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>Tutar</Text>
                    </View>
                    {iptalDetailItems.map((item: any, idx: number) => (
                      <View key={idx} style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border }]}>
                        <View style={{ flex: 3 }}>
                          <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]}>{item.STOK_ADI || 'Ürün'}</Text>
                          <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Masa: {item.MASA || '-'} · {item.SAAT || ''}</Text>
                        </View>
                        <Text style={[{ flex: 1, fontSize: 14, color: colors.text, textAlign: 'center' }]}>{parseFloat(item.MIKTAR || '0').toFixed(0)}</Text>
                        <Text style={[{ flex: 1.5, fontSize: 14, fontWeight: '700', color: '#EF4444', textAlign: 'right' }]}>₺{parseFloat(item.SATIR_TUTAR || '0').toFixed(2)}</Text>
                      </View>
                    ))}
                    {/* Total row */}
                    <View style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 4, fontSize: 14, fontWeight: '800', color: colors.text, textAlign: 'right', paddingRight: 12 }]}>Toplam</Text>
                      <Text style={[{ flex: 1.5, fontSize: 16, fontWeight: '800', color: '#EF4444', textAlign: 'right' }]}>
                        ₺{iptalDetailItems.reduce((sum: number, item: any) => sum + parseFloat(item.SATIR_TUTAR || '0'), 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 8 }]}>Detay bilgisi bulunamadı</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Open Table Detail Modal */}
      <Modal visible={!!selectedOpenTable} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Masa Detayı
              </Text>
              <TouchableOpacity onPress={() => { setSelectedOpenTable(null); setTableDetailItems([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedOpenTable && (
              <ScrollView style={[styles.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={styles.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
                {/* Table Info */}
                <View style={[styles.tableDetailHeader, { backgroundColor: colors.primary + '10' }]}>
                  <View style={[styles.tableDetailIcon, { backgroundColor: colors.primary + '20' }]}>
                    <Ionicons name="restaurant" size={32} color={colors.primary} />
                  </View>
                  <Text style={[styles.tableDetailTitle, { color: colors.text }]}>Masa {selectedOpenTable.tableNo}</Text>
                  {selectedOpenTable.section ? (
                    <Text style={[styles.tableDetailCustomer, { color: colors.textSecondary }]}>{selectedOpenTable.section} · {selectedOpenTable.location}</Text>
                  ) : (
                    <Text style={[styles.tableDetailCustomer, { color: colors.textSecondary }]}>{selectedOpenTable.location}</Text>
                  )}
                  <Text style={[{ fontSize: 22, fontWeight: '800', color: colors.primary, marginTop: 8 }]}>
                    ₺{selectedOpenTable.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>

                {/* Detail Items */}
                <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>Sipariş Detayı</Text>
                
                {tableDetailLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }]}>POS'tan veri alınıyor...</Text>
                  </View>
                ) : tableDetailItems.length > 0 ? (
                  <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }]}>
                    {/* Table Header */}
                    <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 3, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>Ürün</Text>
                      <Text style={[{ flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>Miktar</Text>
                      <Text style={[{ flex: 1.5, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>Tutar</Text>
                    </View>
                    {tableDetailItems.map((item: any, idx: number) => {
                      const tutar = item.TUTAR ? parseFloat(item.TUTAR) : (parseFloat(item.MIKTAR || '0') * parseFloat(item.FIYAT || '0'));
                      return (
                        <View key={idx} style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' }]}>
                          <View style={{ flex: 3 }}>
                            <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]}>{item.AD || 'Ürün'}</Text>
                            <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>₺{parseFloat(item.FIYAT || '0').toFixed(2)} / {item.STOK_BIRIM_AD || 'Adet'}</Text>
                          </View>
                          <Text style={[{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'center' }]}>
                            {parseFloat(item.MIKTAR || '0').toFixed(item.STOK_BIRIM_AD === 'Kg' ? 3 : 0)}
                          </Text>
                          <Text style={[{ flex: 1.5, fontSize: 14, fontWeight: '700', color: colors.primary, textAlign: 'right' }]}>
                            ₺{tutar.toFixed(2)}
                          </Text>
                        </View>
                      );
                    })}
                    {/* Total row */}
                    <View style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 4, fontSize: 14, fontWeight: '800', color: colors.text, textAlign: 'right', paddingRight: 12 }]}>Toplam</Text>
                      <Text style={[{ flex: 1.5, fontSize: 16, fontWeight: '800', color: colors.primary, textAlign: 'right' }]}>
                        ₺{tableDetailItems.reduce((sum: number, item: any) => {
                          const tutar = item.TUTAR ? parseFloat(item.TUTAR) : (parseFloat(item.MIKTAR || '0') * parseFloat(item.FIYAT || '0'));
                          return sum + tutar;
                        }, 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 8, fontSize: 14 }]}>Detay bilgisi bulunamadı</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Waiter Detail Modal - Handled in DashboardSections */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusBarLine: {
    height: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  greeting: {
    fontSize: 13,
    marginBottom: 2,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  cardsContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  bestHourBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  bestHourText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chartScroll: {
    marginBottom: 8,
  },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 200,
    paddingTop: 20,
  },
  barContainer: {
    alignItems: 'center',
    marginHorizontal: 6,
    width: 32,
  },
  barValue: {
    fontSize: 9,
    marginBottom: 4,
  },
  bar: {
    width: 24,
    borderRadius: 6,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    marginTop: 6,
    fontWeight: '500',
  },
  chartHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  productItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  productRankText: {
    fontSize: 13,
    fontWeight: '700',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  productQty: {
    fontSize: 12,
  },
  productRevenue: {
    fontSize: 14,
    fontWeight: '600',
  },
  locationCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  locationName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  locationDetails: {
    gap: 8,
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  locationStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationLabel: {
    fontSize: 12,
  },
  locationValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  cancellationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  cancellationText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: screenHeight * 0.85,
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    alignSelf: 'flex-end',
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    padding: 20,
  },
  modalBodyContent: {
    paddingBottom: 50,
    flexGrow: 0,
  },
  locationModalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  locationModalInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  locationModalIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationModalName: {
    fontSize: 15,
    fontWeight: '600',
  },
  locationModalPercent: {
    fontSize: 12,
  },
  locationModalValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  hourDetailCard: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    marginBottom: 16,
  },
  hourDetailCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  hourDetailCompactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hourDetailTime: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 12,
  },
  hourDetailAmount: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 8,
  },
  hourDetailTx: {
    fontSize: 14,
    marginTop: 8,
  },
  hourStats: {
    flexDirection: 'row',
    gap: 12,
  },
  hourStatItem: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  hourStatLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  hourStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  cancellationSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  cancellationSummaryText: {
    flex: 1,
  },
  cancellationCount: {
    fontSize: 16,
    fontWeight: '700',
  },
  cancellationTotal: {
    fontSize: 14,
    marginTop: 2,
  },
  receiptCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  receiptCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  receiptCardNo: {
    fontSize: 15,
    fontWeight: '600',
  },
  receiptCardDate: {
    fontSize: 12,
    marginTop: 2,
  },
  receiptCardAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  receiptCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptCardReason: {
    fontSize: 13,
    flex: 1,
    marginRight: 10,
  },
  receiptCardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  receiptCardActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  receiptHeader: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  receiptNo: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  receiptDate: {
    fontSize: 13,
    marginBottom: 8,
  },
  receiptReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  receiptReason: {
    fontSize: 14,
    flex: 1,
  },
  receiptItemsTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  receiptItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  receiptItemInfo: {
    flex: 1,
  },
  receiptItemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  receiptItemQty: {
    fontSize: 12,
  },
  receiptItemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  receiptTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  receiptTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  receiptTotalValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  // Open Tables Styles
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
  },
  openTableCount: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  openTableCountText: {
    fontSize: 13,
    fontWeight: '700',
  },
  locationFilterScroll: {
    marginBottom: 12,
    marginTop: -4,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  locationChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  openTablesSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  openTablesSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  openTablesSummaryLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  openTablesSummaryValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  openTablesSummaryDivider: {
    width: 1,
    height: 30,
    marginHorizontal: 4,
  },
  customerGroup: {
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  customerGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customerGroupName: {
    fontSize: 14,
    fontWeight: '600',
  },
  customerGroupSub: {
    fontSize: 11,
    marginTop: 1,
  },
  customerGroupTotal: {
    fontSize: 13,
    fontWeight: '700',
  },
  openTableCard: {
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  openTableCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tableIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  openTableName: {
    fontSize: 14,
    fontWeight: '600',
  },
  openTableLocation: {
    fontSize: 11,
    marginTop: 1,
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  paymentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  openTableCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  openTableStat: {
    flex: 1,
    alignItems: 'center',
  },
  openTableStatLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  openTableStatValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  dataSourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  dataSourceText: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 14,
  },
  // Table Detail Modal
  tableDetailHeader: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    marginBottom: 16,
  },
  tableDetailIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  tableDetailTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  tableDetailCustomer: {
    fontSize: 14,
    marginTop: 4,
  },
  tableDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  tableDetailGridItem: {
    width: '48%',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  tableDetailGridLabel: {
    fontSize: 11,
  },
  tableDetailGridValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  tableDetailInfo: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableDetailInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
  },
  tableDetailInfoLabel: {
    fontSize: 13,
  },
  tableDetailInfoValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Customer Modal
  customerModalSummary: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  customerModalAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  customerModalName: {
    fontSize: 18,
    fontWeight: '700',
  },
  customerModalSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  customerModalTotals: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 16,
  },
  customerModalTotalItem: {
    alignItems: 'center',
  },
  customerModalTotalLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  customerModalTotalValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  customerModalTableCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  customerModalTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  customerModalTableFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: 1,
  },
  // Waiter Sales Styles
  waiterLocationCard: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  waiterLocationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  waiterLocationIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waiterLocationName: {
    fontSize: 15,
    fontWeight: '700',
  },
  waiterLocationSub: {
    fontSize: 12,
    marginTop: 2,
  },
  waiterList: {
    padding: 8,
    paddingTop: 0,
  },
  waiterCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  waiterCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  waiterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waiterName: {
    fontSize: 14,
    fontWeight: '600',
  },
  waiterHours: {
    fontSize: 11,
    marginTop: 1,
  },
  waiterCardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  waiterStat: {
    flex: 1,
    alignItems: 'center',
  },
  waiterStatLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  waiterStatValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Waiter Modal Styles
  waiterModalHeader: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    marginBottom: 16,
  },
  waiterModalAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  waiterModalName: {
    fontSize: 20,
    fontWeight: '800',
  },
  waiterModalLocation: {
    fontSize: 13,
  },
  waiterModalProgress: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 16,
  },
  waiterProgressTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressFillCash: {
    height: '100%',
  },
  progressFillCard: {
    height: '100%',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressLabelText: {
    fontSize: 11,
  },
  // Hourly Product Table Styles
  hourlyProductsSection: {
    marginTop: 16,
  },
  hourlyProductsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  hourlyProductsTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  productTableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 2,
  },
  productTableHeaderText: {
    fontSize: 11,
    fontWeight: '600',
  },
  productTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  productTableName: {
    fontSize: 13,
    fontWeight: '500',
  },
  productTableQty: {
    fontSize: 13,
    fontWeight: '700',
  },
  productTableRevenue: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Live data indicator
  liveIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  liveIndicatorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
  },
  syncText: {
    fontSize: 11,
  },
  // Filter Banner
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  filterBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  filterBannerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  filterBannerClear: {
    padding: 4,
  },
  // Location Group (Open Tables)
  locationGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    marginTop: 6,
  },
  locationGroupName: {
    fontSize: 14,
    fontWeight: '700',
  },
  locationGroupCount: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  locationGroupCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  locationGroupTotal: {
    fontSize: 13,
    fontWeight: '600',
  },
});
