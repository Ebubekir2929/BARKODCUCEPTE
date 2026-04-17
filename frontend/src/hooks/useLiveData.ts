import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import {
  BranchSales, HourlySales, CancelledReceipt, OpenTable,
  TopProduct, WaiterLocation,
} from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const DATA_SOURCE_KEYS: DataSource[] = ['data1', 'data2', 'data3'];

export interface DashboardFilter {
  branchId: string | null;
  startDate: Date;
  endDate: Date;
}

export interface DashboardData {
  branchSales: BranchSales[];
  hourlySales: HourlySales[];
  hourlyLocationSales: any[];
  weeklyComparison: {
    thisWeek: { cash: number; card: number; openAccount: number; total: number };
    lastWeek: { cash: number; card: number; openAccount: number; total: number };
  };
  cancelledReceipts: CancelledReceipt[];
  openTables: OpenTable[];
  topSelling: TopProduct[];
  leastSelling: TopProduct[];
  topProducts: TopProduct[];
  worstProducts: TopProduct[];
  waiterLocations: WaiterLocation[];
  waiterSales: any[];
  iptalOzet: any[];
  iptalDetay: any[];
  allLocations: string[];
}

const EMPTY_DATA: DashboardData = {
  branchSales: [],
  hourlySales: [],
  hourlyLocationSales: [],
  weeklyComparison: {
    thisWeek: { cash: 0, card: 0, openAccount: 0, total: 0 },
    lastWeek: { cash: 0, card: 0, openAccount: 0, total: 0 },
  },
  cancelledReceipts: [],
  openTables: [],
  topSelling: [],
  leastSelling: [],
  topProducts: [],
  worstProducts: [],
  waiterLocations: [],
  waiterSales: [],
  iptalOzet: [],
  iptalDetay: [],
  allLocations: [],
};

function formatDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function transformApiData(apiData: any): DashboardData {
  const branchSales: BranchSales[] = [];
  const locationData = apiData?.financial_data_location?.data || [];
  locationData.forEach((loc: any, idx: number) => {
    branchSales.push({
      branchId: `loc-${idx}`,
      branchName: loc.LOKASYON || 'Bilinmeyen',
      sales: {
        cash: parseFloat(loc.NAKIT || '0'),
        card: parseFloat(loc.KREDI_KARTI || '0'),
        openAccount: parseFloat(loc.VERESIYE || '0'),
        total: parseFloat(loc.TOPLAM || loc.GENELTOPLAM || '0'),
      },
      cancellations: [],
    });
  });

  const financialData = apiData?.financial_data?.data?.[0] || {};
  const thisWeek = {
    cash: parseFloat(financialData.NAKIT || '0'),
    card: parseFloat(financialData.KREDI_KARTI || '0'),
    openAccount: 0,
    total: parseFloat(financialData.GENELTOPLAM || '0'),
  };

  const hourlyRaw = apiData?.hourly_data?.data || [];
  const hourlySales: HourlySales[] = hourlyRaw.map((h: any, idx: number) => ({
    hour: h.SAAT_ADI || `${idx}:00`,
    amount: parseFloat(h.TOPLAM || '0'),
    transactions: 0,
    products: [],
  }));

  const topRaw = apiData?.top10_stock_movements?.data || [];
  const topProducts: TopProduct[] = topRaw.map((p: any, idx: number) => ({
    id: `top-${idx}`,
    name: p.STOK_AD || 'Ürün',
    quantity: parseFloat(p.MIKTAR_CIKIS || '0'),
    revenue: parseFloat(p.TUTAR_CIKIS || '0'),
  }));

  const downRaw = apiData?.down10_stock_movements?.data || [];
  const worstProducts: TopProduct[] = downRaw.slice().reverse().map((p: any, idx: number) => ({
    id: `down-${idx}`,
    name: p.STOK_AD || 'Ürün',
    quantity: parseFloat(p.MIKTAR_CIKIS || '0'),
    revenue: parseFloat(p.TUTAR_CIKIS || '0'),
  }));

  const masalarRaw = apiData?.acik_masalar?.data || [];
  const openTables: OpenTable[] = masalarRaw.map((m: any, idx: number) => ({
    id: `table-${m.MASA_ID || idx}`,
    tableNo: String(m.MASA || idx + 1),
    customerName: '',
    customerId: '',
    posId: String(m.POS_ID || ''),
    amount: parseFloat(m.TUTAR || '0'),
    paidAmount: parseFloat(m.ODENEN_TUTAR || '0'),
    remainingAmount: parseFloat(m.KALAN_TUTAR || '0'),
    location: m.LOKASYON || '',
    section: m.BOLUM || '',
    openedAt: m.TARIH || '',
    itemCount: 0,
    dataSource: '',
  }));

  const cancelRaw = apiData?.cancel_data?.data || [];
  const cancelledReceipts: CancelledReceipt[] = cancelRaw
    .filter((c: any) => parseFloat(c.TUTAR_FIS || '0') > 0)
    .map((c: any, idx: number) => ({
      id: `cancel-${idx}`,
      receiptNo: `İPTAL-${idx + 1}`,
      date: new Date().toISOString(),
      amount: parseFloat(c.TUTAR_FIS || '0'),
      reason: c.LOKASYON || 'Bilinmeyen',
      items: [],
    }));

  return {
    branchSales,
    hourlySales,
    hourlyLocationSales: apiData?.hourly_location_data?.data || [],
    weeklyComparison: { 
      thisWeek, 
      lastWeek: apiData?.last_week || { cash: 0, card: 0, openAccount: 0, total: 0 } 
    },
    cancelledReceipts,
    openTables,
    topSelling: topProducts,
    leastSelling: worstProducts,
    topProducts,
    worstProducts,
    waiterLocations: [],
    waiterSales: apiData?.garson_satis_ozet?.data || [],
    iptalOzet: apiData?.iptal_ozet?.data || [],
    iptalDetay: apiData?.iptal_detay?.data || [],
    allLocations: apiData?.all_locations || [],
  };
}

export function useLiveData(filter?: DashboardFilter) {
  const { user, token } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastFilterRef = useRef<string>('');
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedOnce = useRef(false);

  // Determine if filter is active (not today's date)
  const isFilterActive = filter
    ? (filter.branchId !== null || !isToday(filter.startDate) || !isToday(filter.endDate))
    : false;

  const activeTenantId = useCallback(() => {
    if (!user?.tenants || user.tenants.length === 0) return null;
    const index = DATA_SOURCE_KEYS.indexOf(activeSource);
    if (index >= 0 && index < user.tenants.length) {
      return user.tenants[index].tenant_id;
    }
    return user.tenants[0]?.tenant_id || null;
  }, [user?.tenants, activeSource]);

  const fetchDashboard = useCallback(async () => {
    const tenantId = activeTenantId();
    if (!tenantId || !token) {
      setData(EMPTY_DATA);
      setIsFirstLoad(false);
      return;
    }

    // Only show refreshing spinner when filter changes, not auto-refresh
    const currentFilterKey = JSON.stringify(filter || {});
    if (hasLoadedOnce.current && currentFilterKey !== lastFilterRef.current) {
      setIsRefreshing(true);
    }
    lastFilterRef.current = currentFilterKey;
    setError(null);

    try {
      let url = `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(tenantId)}`;
      
      if (isFilterActive && filter) {
        const sdate = formatDateParam(filter.startDate);
        const edate = formatDateParam(filter.endDate);
        url += `&sdate=${sdate}&edate=${edate}`;
      }

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const apiData = await response.json();
      let transformed = transformApiData(apiData);
      
      if (filter?.branchId) {
        const filteredBranch = transformed.branchSales.find(b => b.branchId === filter.branchId);
        if (filteredBranch) {
          transformed = {
            ...transformed,
            branchSales: [filteredBranch],
            weeklyComparison: {
              thisWeek: filteredBranch.sales,
              lastWeek: { cash: 0, card: 0, openAccount: 0, total: 0 },
            },
          };
        }
      }
      
      setData(transformed);
      hasLoadedOnce.current = true;

      const syncTimes = Object.values(apiData)
        .map((v: any) => v?.synced_at)
        .filter(Boolean)
        .sort()
        .reverse();
      if (syncTimes.length > 0) setLastSynced(syncTimes[0] as string);
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'Veri çekilemedi');
    } finally {
      setIsFirstLoad(false);
      setIsRefreshing(false);
    }
  }, [activeTenantId, token, activeSource, isFilterActive, filter?.branchId, filter?.startDate, filter?.endDate]);

  useEffect(() => {
    fetchDashboard();

    // Clear previous interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only auto-refresh when filter is NOT active (real-time mode)
    if (!isFilterActive) {
      intervalRef.current = setInterval(fetchDashboard, 30000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchDashboard, isFilterActive]);

  return {
    data,
    isLoading: isFirstLoad && !hasLoadedOnce.current,
    isRefreshing,
    error,
    lastSynced,
    refresh: fetchDashboard,
    isLive: !!activeTenantId() && !isFilterActive,
    isFilterActive,
  };
}
