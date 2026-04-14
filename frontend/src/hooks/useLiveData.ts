import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import { getDataBySource } from '../data/mockData';
import {
  BranchSales, HourlySales, CancelledReceipt, OpenTable,
  TopProduct, WaiterLocation, WaiterSale,
} from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const DATA_SOURCE_KEYS: DataSource[] = ['data1', 'data2', 'data3'];

interface DashboardData {
  branchSales: BranchSales[];
  hourlySales: HourlySales[];
  weeklyComparison: {
    thisWeek: { cash: number; card: number; openAccount: number; total: number };
    lastWeek: { cash: number; card: number; openAccount: number; total: number };
  };
  cancelledReceipts: CancelledReceipt[];
  openTables: OpenTable[];
  topProducts: TopProduct[];
  worstProducts: TopProduct[];
  waiterLocations: WaiterLocation[];
}

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

  // Transform financial_data → weeklyComparison (thisWeek)
  const financialData = apiData?.financial_data?.data?.[0] || {};
  const thisWeek = {
    cash: parseFloat(financialData.NAKIT || '0'),
    card: parseFloat(financialData.KREDI_KARTI || '0'),
    openAccount: 0,
    total: parseFloat(financialData.GENELTOPLAM || '0'),
  };

  // Transform hourly_data → hourlySales
  const hourlyRaw = apiData?.hourly_data?.data || [];
  const hourlySales: HourlySales[] = hourlyRaw.map((h: any, idx: number) => ({
    hour: h.SAAT_ADI || `${idx}:00`,
    amount: parseFloat(h.TOPLAM || '0'),
    transactions: 0,
    products: [],
  }));

  // Transform top10_stock_movements → topProducts
  const topRaw = apiData?.top10_stock_movements?.data || [];
  const topProducts: TopProduct[] = topRaw.map((p: any, idx: number) => ({
    id: `top-${idx}`,
    name: p.STOK_AD || 'Ürün',
    quantity: parseFloat(p.MIKTAR_CIKIS || '0'),
    revenue: parseFloat(p.TUTAR_CIKIS || '0'),
  }));

  // Transform down10_stock_movements → worstProducts
  const downRaw = apiData?.down10_stock_movements?.data || [];
  const worstProducts: TopProduct[] = downRaw
    .slice()
    .reverse()
    .map((p: any, idx: number) => ({
      id: `down-${idx}`,
      name: p.STOK_AD || 'Ürün',
      quantity: parseFloat(p.MIKTAR_CIKIS || '0'),
      revenue: parseFloat(p.TUTAR_CIKIS || '0'),
    }));

  // Transform acik_masalar → openTables
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

  // Cancel data → cancelledReceipts
  const cancelRaw = apiData?.cancel_data?.data || [];
  const cancelledReceipts: CancelledReceipt[] = cancelRaw.map((c: any, idx: number) => ({
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
    topProducts,
    worstProducts,
    waiterLocations: [],
  };
}

export function useLiveData() {
  const { user, token } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Resolve tenant_id from active data source
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
      // No tenant → use mock data
      const mock = getDataBySource(activeSource);
      setData(mock);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(tenantId)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const apiData = await response.json();
      const transformed = transformApiData(apiData);
      setData(transformed);

      // Get latest sync time
      const syncTimes = Object.values(apiData)
        .map((v: any) => v?.synced_at)
        .filter(Boolean)
        .sort()
        .reverse();
      if (syncTimes.length > 0) {
        setLastSynced(syncTimes[0] as string);
      }
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'Veri çekilemedi');
      // Fallback to mock
      const mock = getDataBySource(activeSource);
      setData(mock);
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId, token, activeSource]);

  // Initial fetch + auto refresh every 30 seconds
  useEffect(() => {
    fetchDashboard();

    // Auto refresh
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchDashboard, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchDashboard]);

  return {
    data: data || getDataBySource(activeSource),
    isLoading,
    error,
    lastSynced,
    refresh: fetchDashboard,
    isLive: !!activeTenantId(),
  };
}
