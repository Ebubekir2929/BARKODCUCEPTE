import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useDataSourceStore } from '../store/dataSourceStore';
import {
  BranchSales, HourlySales, CancelledReceipt, OpenTable,
  TopProduct, WaiterLocation,
} from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export interface DashboardFilter {
  branchId: string | null;
  startDate: Date;
  endDate: Date;
}

export interface FinancialBreakdown {
  total: number;
  perakende: number;
  erp12: number;
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
  // NEW: ERP12/Perakende breakdowns + iskonto + fiş sayıları
  financialBreakdown: {
    nakit: FinancialBreakdown;
    krediKarti: FinancialBreakdown;
    geneltoplam: FinancialBreakdown;
    iskonto: FinancialBreakdown;
    fisSayisi: { total: number; perakende: number; erp12: number };
  };
  // Per-location breakdown (for branch detail in modal)
  branchBreakdowns: Array<{
    branchName: string;
    perakende_nakit: number;
    erp12_nakit: number;
    perakende_kart: number;
    erp12_kart: number;
    perakende_iskonto: number;
    erp12_iskonto: number;
    toplam_iskonto: number;
    perakende_fis: number;
    erp12_fis: number;
    toplam_fis: number;
  }>;
  // NEW: KDV / Matrah breakdown by KDV rate (from financial_data_location cache).
  // Şube bazında ayrı + genel toplam. Tenant total ile tutarlı.
  kdvBreakdown: {
    branches: Array<{
      branchName: string;
      rates: Array<{ rate: number; matrah: number; kdv: number; total: number }>;
      totalMatrah: number;
      totalKdv: number;
    }>;
    grandRates: Array<{ rate: number; matrah: number; kdv: number; total: number }>;
    grandTotalMatrah: number;
    grandTotalKdv: number;
  };
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
  financialBreakdown: {
    nakit: { total: 0, perakende: 0, erp12: 0 },
    krediKarti: { total: 0, perakende: 0, erp12: 0 },
    geneltoplam: { total: 0, perakende: 0, erp12: 0 },
    iskonto: { total: 0, perakende: 0, erp12: 0 },
    fisSayisi: { total: 0, perakende: 0, erp12: 0 },
  },
  branchBreakdowns: [],
  kdvBreakdown: { branches: [], grandRates: [], grandTotalMatrah: 0, grandTotalKdv: 0 },
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
  const branchBreakdowns: DashboardData['branchBreakdowns'] = [];
  const locationData = apiData?.financial_data_location?.data || [];
  locationData.forEach((loc: any, idx: number) => {
    branchSales.push({
      branchId: `loc-${idx}`,
      branchName: loc.LOKASYON || 'Bilinmeyen',
      sales: {
        cash: parseFloat(loc.NAKIT || '0'),
        card: parseFloat(loc.KREDI_KARTI || '0'),
        openAccount: parseFloat(loc.VERESIYE || '0'),
        // Use GENELTOPLAM (Perakende + ERP12 combined) to ensure ERP12 sales are included
        total: parseFloat(loc.GENELTOPLAM || loc.TOPLAM || '0'),
      },
      cancellations: [],
    });
    branchBreakdowns.push({
      branchName: loc.LOKASYON || 'Bilinmeyen',
      perakende_nakit: parseFloat(loc.PERAKENDE_NAKIT || '0'),
      erp12_nakit: parseFloat(loc.ERP12_NAKIT || '0'),
      perakende_kart: parseFloat(loc.PERAKENDE_KREDI_KARTI || '0'),
      erp12_kart: parseFloat(loc.ERP12_KREDI_KARTI || '0'),
      perakende_iskonto: parseFloat(loc.PERAKENDE_TOPLAM_ISKONTO || '0'),
      erp12_iskonto: parseFloat(loc.ERP12_TOPLAM_ISKONTO || '0'),
      toplam_iskonto: parseFloat(loc.TOPLAM_ISKONTO || '0'),
      perakende_fis: parseInt(loc.PERAKENDE_FIS_SAYISI || '0'),
      erp12_fis: parseInt(loc.ERP12_FIS_SAYISI || '0'),
      toplam_fis: parseInt(loc.TOPLAM_FIS_SAYISI || '0'),
    });
  });

  const financialData = apiData?.financial_data?.data?.[0] || {};
  const thisWeek = {
    cash: parseFloat(financialData.NAKIT || '0'),
    card: parseFloat(financialData.KREDI_KARTI || '0'),
    openAccount: 0,
    total: parseFloat(financialData.GENELTOPLAM || '0'),
  };

  // NEW: Financial breakdown — ERP12/Perakende splits + iskonto + fiş
  const financialBreakdown = {
    nakit: {
      total: parseFloat(financialData.NAKIT || '0'),
      perakende: parseFloat(financialData.PERAKENDE_NAKIT || '0'),
      erp12: parseFloat(financialData.ERP12_NAKIT || '0'),
    },
    krediKarti: {
      total: parseFloat(financialData.KREDI_KARTI || '0'),
      perakende: parseFloat(financialData.PERAKENDE_KREDI_KARTI || '0'),
      erp12: parseFloat(financialData.ERP12_KREDI_KARTI || '0'),
    },
    geneltoplam: {
      total: parseFloat(financialData.GENELTOPLAM || '0'),
      perakende: parseFloat(financialData.PERAKENDE_GENELTOPLAM || '0'),
      erp12: parseFloat(financialData.ERP12_GENELTOPLAM || '0'),
    },
    iskonto: {
      total: parseFloat(financialData.TOPLAM_ISKONTO || '0'),
      perakende: parseFloat(financialData.PERAKENDE_TOPLAM_ISKONTO || '0'),
      erp12: parseFloat(financialData.ERP12_TOPLAM_ISKONTO || '0'),
    },
    fisSayisi: {
      total: parseInt(financialData.TOPLAM_FIS_SAYISI || '0'),
      perakende: parseInt(financialData.PERAKENDE_FIS_SAYISI || '0'),
      erp12: parseInt(financialData.ERP12_FIS_SAYISI || '0'),
    },
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

  // KDV / Matrah breakdown by rate from financial_data_location cache.
  // Şube bazında ayrı + genel toplam.
  const kdvRateKeys: Array<{ rate: number; matrahField: string; kdvField: string }> = [
    { rate: 0, matrahField: 'MATRAH_0', kdvField: 'KDV_0' },
    { rate: 1, matrahField: 'MATRAH_1', kdvField: 'KDV_1' },
    { rate: 8, matrahField: 'MATRAH_8', kdvField: 'KDV_8' },
    { rate: 10, matrahField: 'MATRAH_10', kdvField: 'KDV_10' },
    { rate: 18, matrahField: 'MATRAH_18', kdvField: 'KDV_18' },
    { rate: 20, matrahField: 'MATRAH_20', kdvField: 'KDV_20' },
  ];
  const kdvBranches: Array<{
    branchName: string;
    rates: Array<{ rate: number; matrah: number; kdv: number; total: number }>;
    totalMatrah: number;
    totalKdv: number;
  }> = [];
  // Grand totals for ALL branches combined
  const grandPerRate: Record<number, { matrah: number; kdv: number }> = {};
  let grandTotalMatrahAll = 0;
  let grandTotalKdvAll = 0;

  for (const loc of locationData as any[]) {
    const branchName = loc?.LOKASYON || 'Bilinmeyen';
    const branchRates: Array<{ rate: number; matrah: number; kdv: number; total: number }> = [];
    let bMatrah = 0;
    let bKdv = 0;
    for (const def of kdvRateKeys) {
      const matrah = parseFloat(loc?.[def.matrahField] || '0');
      const kdv = parseFloat(loc?.[def.kdvField] || '0');
      if (matrah > 0 || kdv > 0) {
        branchRates.push({ rate: def.rate, matrah, kdv, total: matrah + kdv });
        bMatrah += matrah;
        bKdv += kdv;
        if (!grandPerRate[def.rate]) grandPerRate[def.rate] = { matrah: 0, kdv: 0 };
        grandPerRate[def.rate].matrah += matrah;
        grandPerRate[def.rate].kdv += kdv;
        grandTotalMatrahAll += matrah;
        grandTotalKdvAll += kdv;
      }
    }
    if (branchRates.length > 0) {
      kdvBranches.push({ branchName, rates: branchRates, totalMatrah: bMatrah, totalKdv: bKdv });
    }
  }
  // Sort branches by total desc
  kdvBranches.sort((a, b) => (b.totalMatrah + b.totalKdv) - (a.totalMatrah + a.totalKdv));
  const grandRates = Object.entries(grandPerRate)
    .map(([r, v]) => ({ rate: parseInt(r, 10), matrah: v.matrah, kdv: v.kdv, total: v.matrah + v.kdv }))
    .sort((a, b) => a.rate - b.rate);

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
    financialBreakdown,
    branchBreakdowns,
    kdvBreakdown: {
      branches: kdvBranches,
      grandRates,
      grandTotalMatrah: grandTotalMatrahAll,
      grandTotalKdv: grandTotalKdvAll,
    },
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
    const match = /^data(\d+)$/.exec(activeSource || '');
    const index = match ? parseInt(match[1], 10) - 1 : -1;
    if (index >= 0 && index < user.tenants.length) {
      return user.tenants[index].tenant_id;
    }
    return user.tenants[0]?.tenant_id || null;
  }, [user?.tenants, activeSource]);

  // AbortController to cancel in-flight fetch when tenant/filter changes — prevents
  // stale data from a previous tenant bleeding into the new tenant's view.
  const abortRef = useRef<AbortController | null>(null);

  const fetchDashboard = useCallback(async () => {
    const tenantId = activeTenantId();
    if (!tenantId || !token) {
      setData(EMPTY_DATA);
      setIsFirstLoad(false);
      return;
    }

    // Abort previous in-flight request (tenant changed, or rapid switching)
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // If switching to a different tenant, immediately clear stale data so
    // the user doesn't see the previous tenant's numbers while fresh data loads.
    const currentFilterKey = JSON.stringify(filter || {}) + '|' + tenantId;
    const tenantChanged = lastFilterRef.current && !lastFilterRef.current.endsWith('|' + tenantId);
    if (tenantChanged) {
      setData(EMPTY_DATA);
    }
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
        signal: ctrl.signal,
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const apiData = await response.json();
      // If our controller was aborted while parsing, abandon results
      if (ctrl.signal.aborted) return;
      let transformed = transformApiData(apiData);
      
      if (filter?.branchId) {
        // 2026-05-16 — filter.branchId might be either branchId or location name
        // (when selected from allLocations dropdown). Match against both.
        const filteredBranch = transformed.branchSales.find(b =>
          b.branchId === filter.branchId || b.branchName === filter.branchId
        );
        // The location MAY exist in allLocations but not in branchSales (e.g. no
        // sales today). In that case, treat the filter as STILL active and
        // strictly filter all sections by location-name match. If branchSales
        // doesn't have it, totals/branches should be zero, not "fall back to all".
        const wantedName = String(
          (filteredBranch?.branchName) || filter.branchId || ''
        ).toLowerCase();
        const wantedId = String(filter.branchId || '').toLowerCase();
        const wantedBranchId = String(filteredBranch?.branchId || '').toLowerCase();

        // Generic row-matcher for any list whose rows carry LOKASYON/LOKASYON_ID/SUBE_AD
        const matchLoc = (r: any): boolean => {
          if (!r || typeof r !== 'object') return false;
          const id = String(r.LOKASYON_ID ?? r.SUBE_ID ?? '').toLowerCase();
          const name = String(r.LOKASYON ?? r.LOKASYON_AD ?? r.SUBE ?? r.SUBE_AD ?? '').toLowerCase();
          return (
            (!!wantedName && (name === wantedName || id === wantedName)) ||
            (!!wantedId && (id === wantedId || name === wantedId)) ||
            (!!wantedBranchId && (id === wantedBranchId || name === wantedBranchId))
          );
        };

        const filterList = (arr: any[]): any[] => {
          if (!Array.isArray(arr) || arr.length === 0) return arr || [];
          return arr.filter(matchLoc);
        };

        const zeroSales = { cash: 0, card: 0, openAccount: 0, total: 0 };

        transformed = {
          ...transformed,
          // Even if filteredBranch undefined we still scope to that single (empty) branch
          branchSales: filteredBranch
            ? [filteredBranch]
            : [{ branchId: filter.branchId, branchName: filter.branchId, sales: zeroSales, cancellations: [] } as any],
          hourlyLocationSales: filterList(transformed.hourlyLocationSales || []),
          iptalOzet: filterList(transformed.iptalOzet || []),
          iptalDetay: filterList(transformed.iptalDetay || []),
          waiterSales: filterList(transformed.waiterSales || []),
          topProducts: filterList(transformed.topProducts || []),
          worstProducts: filterList(transformed.worstProducts || []),
          topSelling: filterList(transformed.topSelling || []),
          leastSelling: filterList(transformed.leastSelling || []),
          cancelledReceipts: filterList(transformed.cancelledReceipts || []),
          openTables: filterList(transformed.openTables || []),
          weeklyComparison: {
            thisWeek: filteredBranch ? filteredBranch.sales : zeroSales,
            lastWeek: zeroSales,
          },
        };
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
      // AbortError is expected when tenant switches — silently ignore
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'Veri çekilemedi');
    } finally {
      if (!ctrl.signal.aborted) {
        setIsFirstLoad(false);
        setIsRefreshing(false);
      }
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
