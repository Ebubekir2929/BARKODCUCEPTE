import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import {
  BranchSales, HourlySales, CancelledReceipt, OpenTable,
  TopProduct, WaiterLocation,
} from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const DATA_SOURCE_KEYS: DataSource[] = ['data1', 'data2', 'data3'];

export interface DashboardData {
  branchSales: BranchSales[];
  hourlySales: HourlySales[];
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
}

const EMPTY_DATA: DashboardData = {
  branchSales: [],
  hourlySales: [],
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
};

function transformApiData(apiData: any): DashboardData {
  // Transform financial_data_location → branchSales
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

  // financial_data → weeklyComparison (thisWeek)
  const financialData = apiData?.financial_data?.data?.[0] || {};
  const thisWeek = {
    cash: parseFloat(financialData.NAKIT || '0'),
    card: parseFloat(financialData.KREDI_KARTI || '0'),
    openAccount: 0,
    total: parseFloat(financialData.GENELTOPLAM || '0'),
  };

  // hourly_data → hourlySales
  const hourlyRaw = apiData?.hourly_data?.data || [];
  const hourlySales: HourlySales[] = hourlyRaw.map((h: any, idx: number) => ({
    hour: h.SAAT_ADI || `${idx}:00`,
    amount: parseFloat(h.TOPLAM || '0'),
    transactions: 0,
    products: [],
  }));

  // top10 → topProducts / topSelling
  const topRaw = apiData?.top10_stock_movements?.data || [];
  const topProducts: TopProduct[] = topRaw.map((p: any, idx: number) => ({
    id: `top-${idx}`,
    name: p.STOK_AD || 'Ürün',
    quantity: parseFloat(p.MIKTAR_CIKIS || '0'),
    revenue: parseFloat(p.TUTAR_CIKIS || '0'),
  }));

  // down10 → worstProducts / leastSelling
  const downRaw = apiData?.down10_stock_movements?.data || [];
  const worstProducts: TopProduct[] = downRaw.slice().reverse().map((p: any, idx: number) => ({
    id: `down-${idx}`,
    name: p.STOK_AD || 'Ürün',
    quantity: parseFloat(p.MIKTAR_CIKIS || '0'),
    revenue: parseFloat(p.TUTAR_CIKIS || '0'),
  }));

  // acik_masalar → openTables
  const masalarRaw = apiData?.acik_masalar?.data || [];
  const openTables: OpenTable[] = masalarRaw.map((m: any, idx: number) => ({
    id: `table-${m.MASA_ID || idx}`,
    tableNo: String(m.MASA || idx + 1),
    customerName: '',
    customerId: '',
    amount: parseFloat(m.TUTAR || '0'),
    paidAmount: parseFloat(m.ODENEN_TUTAR || '0'),
    remainingAmount: parseFloat(m.KALAN_TUTAR || '0'),
    location: m.LOKASYON || '',
    openedAt: m.TARIH || '',
    itemCount: 0,
    dataSource: '',
  }));

  // cancel_data → cancelledReceipts
  const cancelRaw = apiData?.cancel_data?.data || [];
  const cancelledReceipts: CancelledReceipt[] = cancelRaw.filter((c: any) => {
    const amount = parseFloat(c.TUTAR_FIS || '0');
    return amount > 0;
  }).map((c: any, idx: number) => ({
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
    weeklyComparison: {
      thisWeek,
      lastWeek: { cash: 0, card: 0, openAccount: 0, total: 0 },
    },
    cancelledReceipts,
    openTables,
    topSelling: topProducts,
    leastSelling: worstProducts,
    topProducts,
    worstProducts,
    waiterLocations: [],
  };
}

export function useLiveData() {
  const { user, token } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(tenantId)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const apiData = await response.json();
      const transformed = transformApiData(apiData);
      setData(transformed);

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
      setIsLoading(false);
    }
  }, [activeTenantId, token, activeSource]);

  useEffect(() => {
    fetchDashboard();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchDashboard, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchDashboard]);

  return {
    data,
    isLoading,
    error,
    lastSynced,
    refresh: fetchDashboard,
    isLive: !!activeTenantId(),
  };
}
