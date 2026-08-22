import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  PixelRatio,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { usePrefsStore } from '../../src/store/prefsStore';
import { readPendingTap, clearPendingTap, NOTIFICATION_TAP_EVENT } from '../../src/services/notificationTapHandler';
import { DataSourceSelector } from '../../src/components/DataSourceSelector';
import { SummaryCard } from '../../src/components/SummaryCard';
import { FilterModal } from '../../src/components/FilterModal';
import { CompareModal } from '../../src/components/CompareModal';
import { HighSaleDetailModal } from '../../src/components/HighSaleDetailModal';
import { IptalDetailModal } from '../../src/components/IptalDetailModal';
import { DashboardPdfExport } from '../../src/components/DashboardPdfExport';
import { useLiveData } from '../../src/hooks/useLiveData';
import { useResponsive } from '../../src/hooks/useResponsive';
import { webStyles } from '../../src/styles/webModalStyles';
import { WaiterSalesSection, HourlyLocationSection } from '../../src/components/DashboardSections';
import { KdvMatrahSection } from '../../src/components/dashboard/KdvMatrahSection';
import { WeeklyTrendChart } from '../../src/components/dashboard/WeeklyTrendChart';
import { MonthlyCompareCard } from '../../src/components/dashboard/MonthlyCompareCard';
import { CardTypeLocationModal } from '../../src/components/dashboard/CardTypeLocationModal';
import { HourDetailModal } from '../../src/components/dashboard/HourDetailModal';
import { LocationIptalModal } from '../../src/components/dashboard/LocationIptalModal';
import { BranchSales, HourlySales, OpenTable } from '../../src/types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;

export default function DashboardScreen() {
  const { colors } = useThemeStore();
  const { user, isAuthenticated } = useAuthStore();
  const { t } = useLanguageStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { isXLarge, isWideWeb, isDesktop, width: winWidth } = useResponsive();
  // 2026-06 — Dar ekran/büyük sistem fontu: başlıkta buton etiketlerini gizle,
  // "Hoş geldiniz + isim" alanı ezilmesin (kullanıcı bildirimi: harf harf kırılma).
  // Font ölçeği (erişilebilirlik büyük yazı) genişliği efektif olarak daraltır.
  const compactHeader = (winWidth / Math.max(1, PixelRatio.getFontScale())) < 400;

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showPdfExport, setShowPdfExport] = useState(false); // 2026-07 — PDF dışa aktarma
  const [filters, setFilters] = useState({
    branchId: null as string | null,
    startDate: new Date(),
    endDate: new Date(),
  });

  // Use live data hook with filter support (must be after filters state)
  const { data: sourceData, isLoading: dataLoading, isRefreshing: dataRefreshing, error: dataError, lastSynced, isOffline: dataOffline, cachedAt: dataCachedAt, refresh: refreshData, isLive, isFilterActive: isDataFiltered } = useLiveData(filters, { paused: showFilterModal });

  // User-configurable auto-refresh cadence (Settings → "Veri Yenileme Sıklığı")
  const refreshInterval = usePrefsStore((s) => s.refreshInterval);
  // Track whether the Dashboard tab is currently focused; background refreshers
  // must PAUSE when the user navigates to Stok / Cari / Raporlar so their own
  // fetches aren't slowed down by parallel Dashboard traffic.
  const [isTabFocused, setIsTabFocused] = useState(true);
  useFocusEffect(
    React.useCallback(() => {
      setIsTabFocused(true);
      return () => setIsTabFocused(false);
    }, [])
  );

  useEffect(() => {
    if (!refreshInterval || refreshInterval <= 0) return; // 0 = manual only
    if (!isTabFocused) return; // pause while on another tab
    if (showFilterModal) return; // 2026-07 bugfix: tarih seçilirken yenileme → çark bugüne sıfırlanıyordu
    const id = setInterval(() => {
      refreshData();
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [refreshInterval, refreshData, isTabFocused, showFilterModal]);

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

  // BACKGROUND FETCHER for ALL tenants' totals so the upper banner shows
  // accurate amounts even when the user hasn't switched to those tenants yet.
  // Refreshes on app open + every 60s.
  useEffect(() => {
    if (!user?.tenants || user.tenants.length === 0) return;
    if (!isTabFocused) return; // pause while on another tab — user explicitly asked
    if (showFilterModal) return; // 2026-07 bugfix: tarih seçilirken re-render → çark bugüne sıfırlanıyordu
    const { token } = useAuthStore.getState();
    if (!token) return;

    let cancelled = false;
    const ctrls: AbortController[] = [];

    const fetchAllTotals = async () => {
      if (cancelled) return;
      const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const sdate = fmtDate(filters.startDate);
      const edate = fmtDate(filters.endDate);

      // Fetch all tenants in parallel (chunked to 5 to avoid backend overload)
      const tenants = user.tenants || [];
      const CHUNK = 5;
      const updates: Record<string, number> = {};

      for (let i = 0; i < tenants.length; i += CHUNK) {
        if (cancelled) return;
        const batch = tenants.slice(i, i + CHUNK).map(async (t, idx) => {
          const sourceKey = `data${i + idx + 1}`;
          try {
            const ctrl = new AbortController();
            ctrls.push(ctrl);
            const timer = setTimeout(() => ctrl.abort(), 25000);
            const resp = await fetch(
              `${API_URL}/api/data/dashboard?tenant_id=${encodeURIComponent(t.tenant_id)}&sdate=${sdate}&edate=${edate}`,
              { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal }
            );
            clearTimeout(timer);
            if (!resp.ok) return;
            const j = await resp.json();
            const locs: any[] = j?.financial_data_location?.data || [];
            // 2026-05-16 — Lokasyon filtresi aktifse sadece seçili lokasyonun
            // toplamını al; aksi halde tüm lokasyonların toplamı.
            let scopedLocs = locs;
            if (filters.branchId) {
              const wanted = String(filters.branchId).toLowerCase();
              scopedLocs = locs.filter((l: any) => {
                const id = String(l?.LOKASYON_ID || l?.SUBE_ID || '').toLowerCase();
                const name = String(l?.LOKASYON || l?.SUBE || l?.LOKASYON_AD || '').toLowerCase();
                return id === wanted || name === wanted;
              });
            }
            const total = scopedLocs.reduce(
              (s, l) => s + parseFloat(l?.GENELTOPLAM || l?.TOPLAM || '0'),
              0
            );
            updates[sourceKey] = total;
          } catch {
            // skip
          }
        });
        await Promise.all(batch);
      }

      if (!cancelled && Object.keys(updates).length > 0) {
        setSourceTotals(prev => ({ ...prev, ...updates }));
      }
    };

    fetchAllTotals();
    const interval = setInterval(fetchAllTotals, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      // Abort any pending fetches so we don't waste backend cycles
      ctrls.forEach(c => { try { c.abort(); } catch {} });
    };
  }, [user?.tenants?.length, filters.startDate.getTime(), filters.endDate.getTime(), isTabFocused, showFilterModal]);

  // 🚀 ONE-TIME BACKGROUND PREFETCH: Warm stock-list + cari-list cache for ALL
  // tenants on app start so navigation to those tabs is instant. Fire-and-forget.
  // ⚠️ DISABLED — was causing app to freeze on slow networks / large tenants.
  const prefetchedRef = useRef(false);
  // useEffect(() => {
  //   if (prefetchedRef.current) return;
  //   if (!user?.tenants || user.tenants.length === 0) return;
  //   const { token } = useAuthStore.getState();
  //   if (!token) return;
  //   prefetchedRef.current = true;
  //
  //   const prefetch = async () => {
  //     const tenants = user.tenants || [];
  //     await Promise.all(tenants.flatMap((t: any) => [
  //       fetch(`${API_URL}/api/data/stock-list`, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  //         body: JSON.stringify({ tenant_id: t.tenant_id, page: 1, page_size: 200 }),
  //       }).catch(() => {}),
  //       fetch(`${API_URL}/api/data/cari-list`, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  //         body: JSON.stringify({ tenant_id: t.tenant_id, page: 1, page_size: 200 }),
  //       }).catch(() => {}),
  //     ]));
  //     console.log('[prefetch] stock+cari warmed for', tenants.length, 'tenants');
  //   };
  //   const t = setTimeout(prefetch, 1500);
  //   return () => clearTimeout(t);
  // }, [user?.tenants?.length]);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedCardType, setSelectedCardType] = useState<'cash' | 'card' | 'openAccount' | 'total' | null>(null);
  const [selectedHour, setSelectedHour] = useState<HourlySales | null>(null);
  const [showHourDetail, setShowHourDetail] = useState(false);
  const [highlightedHourIndex, setHighlightedHourIndex] = useState<number | null>(null);
  
  // Hourly detail state (POS fetch)
  const [hourDetailProducts, setHourDetailProducts] = useState<any[]>([]);
  const [hourDetailLoading, setHourDetailLoading] = useState(false);

  // 2026-06-12 — Aggregate parent satırları (STOK_ADI boş, sadece hour+lokasyon
  // toplamları) `hourDetailProducts` içinde kalıyor. Ürün listesi bunları
  // filtreyle atıyor ama diğer toplam/reduce hesapları TÜM listeyi topluyor
  // → dip Toplam ve KDV Kırılım şişiyordu (kullanıcı raporu: 11:00-12:00 dilimi
  // için ₺54.030 dip toplam, gerçekte gerektiğinden çok yüksek).
  // Tek bir yerden filtrelenmiş listeyi türetip her hesapta onu kullan.
  const hourDetailRows = useMemo(() => {
    return (hourDetailProducts || []).filter((p: any) => {
      const ad = String(p?.STOK_ADI || '').trim();
      const miktar = parseFloat(p?.TOPLAM_MIKTAR || '0');
      const tutar = parseFloat(p?.KDV_DAHIL_TOPLAM_TUTAR || p?.TOPLAM_TUTAR || '0');
      return ad && (miktar !== 0 || tutar !== 0);
    });
  }, [hourDetailProducts]);

  // İptal detail state — 2026-05-06 yenilendi: artık standalone IptalDetailModal kullanılıyor
  // (eski selectedIptalItem/iptalDetailItems/iptalDetailLoading/fetchIptalDetail silindi).
  const [iptalDetailVisible, setIptalDetailVisible] = useState(false);
  const [iptalDetailIptalId, setIptalDetailIptalId] = useState<string>('');
  const [iptalDetailTenantId, setIptalDetailTenantId] = useState<string>('');
  const [iptalDetailTenantName, setIptalDetailTenantName] = useState<string>('');
  const [showIptalListModal, setShowIptalListModal] = useState(false);
  const [iptalListLocation, setIptalListLocation] = useState<string>('');
  const [iptalListItems, setIptalListItems] = useState<any[]>([]);
  const [iptalListLoading, setIptalListLoading] = useState(false);
  // 2026-05-16 — Detay kapatılınca liste modalını geri açabilmek için.
  // iOS nested modal sorunu nedeniyle liste detayın altında değil yan yana açılıyor;
  // bu state detay kapanırken listeyi geri açar.
  const [iptalDetailCameFromList, setIptalDetailCameFromList] = useState(false);

  // Open Tables state
  const [selectedOpenTable, setSelectedOpenTable] = useState<OpenTable | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [tableDetailItems, setTableDetailItems] = useState<any[]>([]);
  const [tableDetailLoading, setTableDetailLoading] = useState(false);

  // Fresh hourly sales (post-discount KDV_DAHIL_TOPLAM_TUTAR) from new procedure GET_HOURLY_STOCK_DETAIL
  const [freshHourlySales, setFreshHourlySales] = useState<HourlySales[] | null>(null);

  // 2026-05-03 — deep-link from notification taps (notificationTapHandler)
  // 2026-05-06 — SIFIRDAN YAZILDI. Eski Zustand store kaldırıldı, sade
  // AsyncStorage tabanlı flow:
  //   1. Bildirim tap → notificationTapHandler AsyncStorage'a yazar
  //   2. Dashboard her odaklandığında AsyncStorage'ı kontrol eder
  //   3. Pending tap varsa modal açar ve AsyncStorage'ı temizler
  // Avantajları: race condition yok, store hidrate olmadan çalışır, crash yok.

  // 2026-05-05 — High-sale receipt detail modal state (push deep-link)
  const [highSaleVisible, setHighSaleVisible] = useState(false);
  const [highSaleFisId, setHighSaleFisId] = useState<string>('');
  const [highSaleBelgeno, setHighSaleBelgeno] = useState<string>('');
  const [highSaleAmount, setHighSaleAmount] = useState<string>('');
  const [highSaleTenantId, setHighSaleTenantId] = useState<string>('');

  // 2026-05-06 — processPendingTap ve diğer notification-tap helper'ları
  // `activeTenantId` tanımlandıktan sonra (aşağıda) kuruluyor — aksi halde
  // TDZ ("Cannot access 'activeTenantId' before initialization") çöker.

  // Check if filter is active (from live data hook)
  const isFilterActive = isDataFiltered;

  // Compute active tenant ID based on selected data source key (dataN → index N-1)
  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const index = match ? parseInt(match[1], 10) - 1 : -1;
    if (index >= 0 && index < user.tenants.length) {
      return user.tenants[index].tenant_id || '';
    }
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  // 2026-08 — Market + Restoran ayrı tenant: aktif kaynak dışındaki
  // kaynakların açık masaları da dashboard'da gösterilir (kaynak etiketiyle).
  const [digerMasalar, setDigerMasalar] = useState<{ name: string; tables: OpenTable[] }[]>([]);
  useEffect(() => {
    let iptalEdildi = false;
    const { token: tok } = useAuthStore.getState();
    const yukle = async () => {
      try {
        const tenants = user?.tenants || [];
        if (tenants.length < 2 || !tok) { if (!iptalEdildi) setDigerMasalar([]); return; }
        const digerler = tenants.filter((tn) => tn.tenant_id !== activeTenantId);
        if (digerler.length === 0) { if (!iptalEdildi) setDigerMasalar([]); return; }
        const resp = await fetch(`${API_URL}/api/data/acik-masalar-coklu`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ tenant_ids: digerler.map((tn) => tn.tenant_id) }),
        });
        const j = await resp.json();
        if (iptalEdildi || !j?.ok) return;
        const sonuc: { name: string; tables: OpenTable[] }[] = [];
        for (const s of j.sources || []) {
          const tn = digerler.find((x) => x.tenant_id === s.tenant_id);
          const tables: OpenTable[] = (s.masalar || []).map((m: any, idx: number) => ({
            id: `dt-${s.tenant_id}-${m.MASA_ID || idx}`,
            tableNo: String(m.MASA || idx + 1),
            customerName: '', customerId: '',
            posId: String(m.POS_ID || ''),
            amount: parseFloat(m.TUTAR || '0'),
            paidAmount: parseFloat(m.ODENEN_TUTAR || '0'),
            remainingAmount: parseFloat(m.KALAN_TUTAR || '0'),
            location: m.LOKASYON || '', section: m.BOLUM || '',
            openedAt: m.TARIH || '', itemCount: 0, dataSource: tn?.name || '',
          }));
          if (tables.length > 0) sonuc.push({ name: tn?.name || 'Diğer Kaynak', tables });
        }
        setDigerMasalar(sonuc);
      } catch { /* sessiz — çevrimdışı olabilir */ }
    };
    yukle();
    const zamanlayici = setInterval(yukle, 30000);
    return () => { iptalEdildi = true; clearInterval(zamanlayici); };
  }, [user?.tenants, activeTenantId]);

  // 2026-05-06 — Pending notification tap işleme — sade AsyncStorage flow.
  // activeTenantId'nin TANIMLANMASI bekleniyor (TDZ fix). Eğer auth hazır
  // değilse return — cold start race condition'ı önler.
  const _processingTapRef = React.useRef(false);
  const processPendingTap = React.useCallback(async () => {
    if (_processingTapRef.current) return;
    if (!user || !isAuthenticated) return;
    _processingTapRef.current = true;
    try {
      const tap = await readPendingTap();
      if (!tap) return;
      // Eski tap'lar (1 saatten eski) → temizle, açma
      if (tap.receivedAt && Date.now() - tap.receivedAt > 60 * 60 * 1000) {
        await clearPendingTap();
        return;
      }
      const type = String(tap.type || '').toLowerCase();
      // 2026-06 — Backend satır iptalinde `line_cancellation`, fiş iptalinde
      // `cancellation` gönderir. İkisi de aynı iptal detay modalını açar.
      const isIptal = (type === 'iptal' || type === 'iptal_satir' || type === 'satir_iptal' || type === 'line_cancellation' || type === 'cancel' || type === 'cancellation');
      const isHighSale = (type === 'high_sale' || type === 'yuksek_satis');
      const isLowStock = (type === 'low_stock_summary' || type === 'eksi_stok' || type === 'low_stock');
      let resolvedTenantId = activeTenantId;
      const targetTenant = String(tap.tenant || '');
      if (targetTenant && user?.tenants) {
        const idx = user.tenants.findIndex((t: any) => t.tenant_id === targetTenant);
        if (idx >= 0) {
          try { setActiveSource(`data${idx + 1}`); } catch {}
          resolvedTenantId = targetTenant;
        }
      }
      if (isIptal) {
        const iptalId = String(tap.iptal_id || '');
        if (iptalId) {
          setTimeout(() => {
            try { openIptalDetail(iptalId, resolvedTenantId); } catch (e) { console.log('[deepLink] openIptalDetail failed:', e); }
          }, 250);
        }
        await clearPendingTap();
      } else if (isHighSale) {
        const fisId = String(tap.fis_id || '');
        const belge = String(tap.belgeno || '');
        const tutar = String(tap.amount || '');
        try {
          setHighSaleFisId(fisId);
          setHighSaleBelgeno(belge);
          setHighSaleAmount(tutar);
          setHighSaleTenantId(resolvedTenantId);
          setTimeout(() => setHighSaleVisible(true), 250);
        } catch (e) { console.log('[deepLink] setHighSale failed:', e); }
        await clearPendingTap();
      } else if (isLowStock) {
        // Stock tab will pick this up via its own readPendingTap.
        // We DO NOT clear here — only navigate.
        try { router.replace('/(tabs)/stock' as any); } catch (e) { console.log('[deepLink] stock nav failed:', e); }
      } else {
        // Unknown type — clear so it doesn't linger.
        await clearPendingTap();
      }
    } catch (e) {
      console.log('[deepLink] processPendingTap failed:', e);
    } finally {
      _processingTapRef.current = false;
    }
    // openIptalDetail intentionally not in deps to avoid stale-closure churn;
    // it's stable thanks to its own useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAuthenticated, activeTenantId, setActiveSource]);

  useFocusEffect(
    React.useCallback(() => { processPendingTap(); }, [processPendingTap])
  );

  useEffect(() => {
    if (!user || !isAuthenticated) return;
    processPendingTap();
  }, [user, isAuthenticated, processPendingTap]);

  // 2026-05-06 — Foreground tap fix: uygulama açıkken (dashboard zaten focus'ta)
  // bildirime tıklanırsa useFocusEffect tekrar tetiklenmez. DeviceEventEmitter
  // üzerinden notificationTapHandler'ın yaydığı event'i dinleyerek anında işler.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(NOTIFICATION_TAP_EVENT, () => {
      processPendingTap();
    });
    return () => { try { sub.remove(); } catch {} };
  }, [processPendingTap]);

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

  // Fetch fresh hourly sales from /hourly-detail-full (post-discount KDV_DAHIL_TOPLAM_TUTAR
  // from new SQL procedure GET_HOURLY_STOCK_DETAIL). Aggregates across ALL locations.
  // ─── freshHourlySales fetch DEVRE DIŞI ───
  // Saatlik grafik artık /api/data/dashboard endpoint'inin `hourly_data`
  // alanından geliyor (dataset_cache.data_json blob, çok hızlı). /hourly-detail-full
  // ekstra istek atmaya gerek yok ve büyük tenant'larda telefonu donduruyor.
  // Eski kullanım için freshHourlySales state'i tutuldu ama hep null kalır.
  useEffect(() => {
    setFreshHourlySales(null);
  }, [activeTenantId, filters.startDate.getTime(), filters.endDate.getTime()]);

  // Effective hourly sales: prefer fresh procedure data; fall back to legacy hourly_data
  const effectiveHourlySales = useMemo<HourlySales[]>(() => {
    if (freshHourlySales && freshHourlySales.length > 0) return freshHourlySales;
    return sourceData?.hourlySales || [];
  }, [freshHourlySales, sourceData?.hourlySales]);

  // Fetch table detail from POS via sync
  const fetchTableDetail = useCallback(async (table: OpenTable) => {
    setSelectedOpenTable(table);
    setTableDetailItems([]);
    setTableDetailLoading(true);
    
    if (!activeTenantId || !table.posId) {
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
        body: JSON.stringify({ tenant_id: activeTenantId, pos_id: table.posId }),
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
  }, [activeTenantId]);


  // Calculate totals from all branches
  const totals = useMemo(() => {
    const branches = sourceData?.branchSales || [];
    // 2026-05-16 — Filter id can be either branchId OR location name (when
    // selected from allLocations dropdown). Match against both fields.
    const filteredBranches = filters.branchId
      ? branches.filter((b) => b.branchId === filters.branchId || b.branchName === filters.branchId)
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
    const hours = effectiveHourlySales;
    if (hours.length === 0) return { hour: '-', amount: 0, transactions: 0 };
    return hours.reduce((max, hour) => hour.amount > max.amount ? hour : max, hours[0]);
  }, [effectiveHourlySales]);

  // Manuel refresh toast — short feedback that confirms data was just refreshed
  const [manualRefreshToast, setManualRefreshToast] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
    setManualRefreshToast(true);
    setTimeout(() => setManualRefreshToast(false), 2200);
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

  // 2026-06-12 — Kullanıcı isteği: kartlarda "Geçen hafta:" yerine gerçek
  // tarih(ler) gösterilsin. Backend lastWeek = seçili aralığın 7 gün öncesi.
  //   Tek gün:     "19 Haziran 2026" (start - 7)
  //   Aynı ay:     "13 - 19 Haziran 2026"
  //   Farklı ay:   "30 May - 5 Haz 2026"
  //   Farklı yıl:  "30 Ara 2025 - 5 Oca 2026"
  const lastWeekLabel = useMemo(() => {
    const dayMs = 86400000;
    const lwStart = new Date(filters.startDate.getTime() - 7 * dayMs);
    const lwEnd = new Date(filters.endDate.getTime() - 7 * dayMs);
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fmtFull = (d: Date) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    const fmtShort = (d: Date) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });

    if (ymd(lwStart) === ymd(lwEnd)) {
      // Tek gün: "19 Haziran 2026"
      return fmtFull(lwStart);
    }
    if (lwStart.getFullYear() !== lwEnd.getFullYear()) {
      // Farklı yıl: "30 Ara 2025 - 5 Oca 2026"
      const fmtShortYr = (d: Date) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
      return `${fmtShortYr(lwStart)} - ${fmtShortYr(lwEnd)}`;
    }
    if (lwStart.getMonth() === lwEnd.getMonth()) {
      // Aynı ay: "13 - 19 Haziran 2026"
      const sd = lwStart.toLocaleDateString('tr-TR', { day: '2-digit' });
      const ed = lwEnd.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
      return `${sd} - ${ed}`;
    }
    // Farklı ay, aynı yıl: "30 May - 5 Haz 2026"
    return `${fmtShort(lwStart)} - ${lwEnd.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }, [filters.startDate, filters.endDate]);

  const maxHourAmount = useMemo(() => {
    const hours = effectiveHourlySales;
    if (hours.length === 0) return 1;
    return Math.max(...hours.map(h => h.amount));
  }, [effectiveHourlySales]);

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
        // Respect currently-active dashboard filters (date + branch)
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const filterDate = filters?.startDate ? fmt(filters.startDate) : undefined;
        const lokasyonId = filters?.branchId ? parseInt(filters.branchId) : null;
        const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/hourly-detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({
            tenant_id: activeTenantId,
            hour_label: hour.hour,
            lokasyon_id: lokasyonId,
            ...(filterDate ? { date: filterDate } : {}),
          }),
        });
        const data = await response.json();
        if (data.ok && data.data) {
          // 2026-05-15 — VERESİYE/NAKİT/KART vb. LOKASYON adları aslında ödeme
          // tipidir, gerçek lokasyon değil. POS bunları fake "lokasyon" olarak
          // dönüyor ve toplam değerleri 2x'liyor. Filtreleyerek hero ile detay
          // tutarları tutarlı hale getirelim.
          const PAYMENT_TYPES = new Set([
            'VERESİYE', 'VERESIYE',
            'NAKİT', 'NAKIT',
            'KART', 'KREDİ KARTI', 'KREDI KARTI', 'KREDİ', 'KREDI',
            'ÇEK', 'CEK',
            'BANKA', 'HAVALE',
            'PUAN', 'YEMEK ÇEKİ', 'YEMEK CEKI',
          ]);
          // 2026-05-16 — Aktif filtre lokasyonunun adı (varsa) — modal verisi
          // de filtreye sadık kalsın.
          const selectedBranchName = (() => {
            if (!filters?.branchId) return null;
            const found = (sourceData?.branchSales || []).find(
              (b) => b.branchId === filters.branchId || b.branchName === filters.branchId
            );
            return (found?.branchName || filters.branchId || '').toString().toUpperCase();
          })();
          const filtered = (Array.isArray(data.data) ? data.data : []).filter((row: any) => {
            const lok = String(row?.LOKASYON || '').trim().toUpperCase();
            if (PAYMENT_TYPES.has(lok)) return false;
            if (selectedBranchName && lok !== selectedBranchName) return false;
            return true;
          });
          setHourDetailProducts(filtered);
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

  // İptal detay açma helper'ı — yeni standalone IptalDetailModal'ı tetikler.
  // 2026-05-06 — Eski fetchIptalDetail (POS API + state mutation karmaşası) tamamen silindi.
  // 2026-05-15 — iOS nested Modal sorunu: IptalListModal açıkken IptalDetailModal'ı
  // doğrudan açarsak iOS hiç göstermiyor (Android'de çalışıyor). Önce parent
  // modal'ı kapatıp animasyon bitince detayı açıyoruz.
  const openIptalDetail = useCallback((iptalId: string, tenantOverride?: string) => {
    if (!iptalId) return;
    const tid = tenantOverride || activeTenantId;
    const t = user?.tenants?.find?.((x: any) => x.tenant_id === tid);
    const wasInListModal = showIptalListModal;
    // 2026-05-16 — Detay kapanırken listeyi geri açabilmek için bayrak set et.
    setIptalDetailCameFromList(wasInListModal);
    if (wasInListModal) {
      // Close parent first to avoid iOS nested-modal blockage
      setShowIptalListModal(false);
    }
    const apply = () => {
      setIptalDetailIptalId(String(iptalId));
      setIptalDetailTenantId(String(tid || ''));
      setIptalDetailTenantName(String(t?.name || ''));
      setIptalDetailVisible(true);
    };
    if (Platform.OS === 'ios' && wasInListModal) {
      // iOS Modal dismiss animation takes ~300ms; wait before presenting next.
      setTimeout(apply, 350);
    } else {
      apply();
    }
  }, [activeTenantId, user, showIptalListModal]);

  // Lokasyon bazlı iptal listesini aç ve POS'tan tam listeyi çek
  const openLocationIptalList = useCallback(async (locationName: string) => {
    setIptalListLocation(locationName);
    setIptalListItems([]);
    setIptalListLoading(true);
    setShowIptalListModal(true);
    
    try {
      const { token: authToken } = useAuthStore.getState();
      const body: any = { tenant_id: activeTenantId, allow_fetch: true };
      
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
      case 'cash': return t('cash');
      case 'card': return t('credit_card');
      case 'openAccount': return t('open_account');
      case 'total': return t('total');
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
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text
            style={[styles.greeting, { color: colors.textSecondary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={1.2}
          >
            {t('welcome_greeting')}
          </Text>
          <Text
            style={[styles.userName, { color: colors.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            maxFontSizeMultiplier={1.2}
          >
            {user?.full_name || 'Kullanıcı'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 8 }]}
          onPress={() => router.push('/giderler')}
          hitSlop={6}
        >
          <Ionicons name="trending-down-outline" size={20} color={colors.error} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 8 }]}
          onPress={() => router.push('/fiyat-gor')}
          hitSlop={6}
        >
          <Ionicons name="pricetags-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 8 }]}
          onPress={() => setShowPdfExport(true)}
          hitSlop={6}
        >
          <Ionicons name="document-text-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border, marginRight: 8, position: 'relative' }]}
          onPress={() => setShowCompareModal(true)}
          hitSlop={6}
        >
          <Ionicons name="git-compare-outline" size={20} color={colors.primary} />
          {!compactHeader && (
            <Text style={[styles.filterText, { color: colors.primary }]} maxFontSizeMultiplier={1.2}>{t('compare')}</Text>
          )}
          <View style={{
            position: 'absolute', top: -6, right: -6,
            backgroundColor: '#8B5CF6',
            paddingHorizontal: 6, paddingVertical: 1,
            borderRadius: 8,
            borderWidth: 1.5, borderColor: colors.background,
          }}>
            <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.3 }}>AI</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowFilterModal(true)}
        >
          <Ionicons name="filter" size={20} color={colors.primary} />
          {!compactHeader && (
            <Text style={[styles.filterText, { color: colors.primary }]} maxFontSizeMultiplier={1.2}>{t('filter_short')}</Text>
          )}
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
                ? (
                    // 2026-05-16 — Filter id can be branchId or location name; try both.
                    (sourceData?.branchSales || []).find(b => b.branchId === filters.branchId)?.branchName
                    || (sourceData?.branchSales || []).find(b => b.branchName === filters.branchId)?.branchName
                    || filters.branchId
                  )
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
            <View style={[styles.liveDot, { backgroundColor: dataError ? '#EF4444' : dataOffline ? '#F59E0B' : '#10B981' }]} />
            <Text style={[styles.liveText, { color: dataError ? '#EF4444' : dataOffline ? '#F59E0B' : '#10B981' }]}>
              {dataLoading
                ? t('updating')
                : dataError
                  ? t('connection_error')
                  : dataOffline
                    ? `Çevrimdışı · Son veriler${dataCachedAt ? ` (${new Date(dataCachedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})` : ''}`
                    : refreshInterval === 0
                    ? 'Manuel · Canlı'
                    : refreshInterval < 60
                      ? `Canlı Veri · ${refreshInterval} sn`
                      : `Canlı Veri · ${refreshInterval / 60} dk`}
            </Text>
          </View>
          {lastSynced && (
            <Text style={[styles.syncText, { color: colors.textSecondary }]}>
              {(() => {
                const d = new Date(lastSynced);
                const today = new Date();
                const isToday = d.toDateString() === today.toDateString();
                const dateStr = isToday ? 'Bugün' : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
                const timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return `${dateStr} ${timeStr}`;
              })()}
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
          <Text style={[styles.syncText, { color: colors.textSecondary }]}>{t('auto_refresh_stopped')}</Text>
        </View>
      )}

      {/* Loading state */}
      {dataLoading && !sourceData?.weeklyComparison?.thisWeek?.total ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{t('loading_all_data')}</Text>
        </View>
      ) : (
      <>
      {/* Filter loading banner */}
      {dataRefreshing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 8, backgroundColor: colors.primary + '10' }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[{ fontSize: 13, color: colors.primary, fontWeight: '600' }]}>{t('filtering')}</Text>
        </View>
      )}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={Platform.OS === 'web' && isDesktop ? { width: '100%', paddingHorizontal: 0 } : { paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onScroll={(e) => { try { require('../../src/store/uiStore').useUIStore.getState().reportScroll(e.nativeEvent.contentOffset.y); } catch {} }}
        scrollEventThrottle={16}
      >
        {/* Manuel refresh confirmation toast */}
        {manualRefreshToast && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#10B981' + '20', borderWidth: 1, borderColor: '#10B981' }}>
              <Ionicons name="checkmark-circle" size={18} color={'#10B981'} />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: '#10B981' }}>
                Manuel güncelleme alındı · {new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
            </View>
          </View>
        )}
        {/* Summary Cards
            2026-05-05 — On extra-wide desktops (≥1280px web) render all four
            cards in a single row instead of the mobile 2×2 grid. */}
        <View style={[styles.cardsContainer, isXLarge && { flexDirection: 'row', gap: 12 }]}>
          <View style={[styles.cardRow, isXLarge && { flex: 1 }]}>
            <SummaryCard
              title={t('cash')}
              amount={totals.cash}
              icon="cash-outline"
              color={colors.cash}
              onPress={() => setSelectedCardType('cash')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.cash}
              lastWeekLabel={lastWeekLabel}
              changePercent={cardChangePercents.cash}
            />
            <SummaryCard
              title={t('credit_card')}
              amount={totals.card}
              icon="card-outline"
              color={colors.primary}
              onPress={() => setSelectedCardType('card')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.card}
              lastWeekLabel={lastWeekLabel}
              changePercent={cardChangePercents.card}
            />
          </View>
          <View style={[styles.cardRow, isXLarge && { flex: 1 }]}>
            <SummaryCard
              title={t('open_account')}
              amount={totals.openAccount}
              icon="wallet-outline"
              color={colors.openAccount}
              onPress={() => setSelectedCardType('openAccount')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.openAccount}
              lastWeekLabel={lastWeekLabel}
              changePercent={cardChangePercents.openAccount}
            />
            <SummaryCard
              title={t('total')}
              amount={totals.total}
              icon="stats-chart"
              color={colors.total}
              onPress={() => setSelectedCardType('total')}
              lastWeekAmount={sourceData.weeklyComparison.lastWeek.total}
              lastWeekLabel={lastWeekLabel}
              changePercent={cardChangePercents.total}
            />
          </View>
        </View>

        {/* Open Tables Section — Restoran + has open tables */}
        {(sourceData?.openTables || []).length > 0 && (
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
                          <Text style={[styles.openTableName, { color: colors.text }]}>{t('table_short')} {table.tableNo}</Text>
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

        {/* 2026-08 — Diğer veri kaynaklarının açık masaları (Market + Restoran senaryosu) */}
        {digerMasalar.map((kaynak) => (
          <View key={`dk-${kaynak.name}`} style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons name="restaurant-outline" size={18} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, flexShrink: 1 }]} numberOfLines={1}>
                  {t('open_tables')} — {kaynak.name}
                </Text>
              </View>
              <View style={[styles.openTableCount, { backgroundColor: colors.primary + '15' }]}>
                <Text style={[styles.openTableCountText, { color: colors.primary }]}>{kaynak.tables.length}</Text>
              </View>
            </View>
            <View style={[styles.openTablesSummary, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.openTablesSummaryItem}>
                <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_open_amount')}</Text>
                <Text style={[styles.openTablesSummaryValue, { color: colors.text }]}>
                  ₺{kaynak.tables.reduce((s, x) => s + x.amount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={[styles.openTablesSummaryDivider, { backgroundColor: colors.border }]} />
              <View style={styles.openTablesSummaryItem}>
                <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_remaining')}</Text>
                <Text style={[styles.openTablesSummaryValue, { color: colors.error }]}>
                  ₺{kaynak.tables.reduce((s, x) => s + x.remainingAmount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            </View>
            {kaynak.tables.map((table) => (
              <View
                key={table.id}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Ionicons name="restaurant-outline" size={15} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                      {t('table_short')} {table.tableNo}
                    </Text>
                    {!!(table.location || table.section) && (
                      <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>
                        {[table.location, table.section].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
                  ₺{table.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {/* Garson / Personel Satışları - Live Data (POS + ERP12) */}
        {(sourceData?.waiterSales || []).length > 0 && (
          <WaiterSalesSection data={sourceData.waiterSales} />
        )}

        {/* Hourly Sales Chart — only show if at least one hour has actual sales */}
        {(sourceData?.hourlySales || []).some((h: any) => (h?.amount || 0) > 0) && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('hourly_sales')}</Text>
            <View style={[styles.bestHourBadge, { backgroundColor: colors.success + '20' }]}>
              <Ionicons name="trophy" size={14} color={colors.success} />
              <Text style={[styles.bestHourText, { color: colors.success }]}>
                En Çok: {bestSellingHour.hour}
              </Text>
            </View>
          </View>

          {/* Total amount — prominent sum of all hours */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 4, marginBottom: 8 }}>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>TOPLAM</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: colors.primary, letterSpacing: 0.3 }}>
              ₺{(sourceData?.hourlySales || []).reduce((s: number, h: any) => s + (h?.amount || 0), 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>

          {/* Bar Chart — yatay kaydırılabilir (web'de scrollbar görünür) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingBottom: 6 }}>
            <Ionicons name="swap-horizontal" size={12} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '600', fontStyle: 'italic' }}>
              ← Yana kaydırın →
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={Platform.OS === 'web'}
            style={styles.chartScroll}
            contentContainerStyle={Platform.OS === 'web' && isDesktop ? { minWidth: '100%', justifyContent: 'space-between' } : undefined}
          >
            <View style={[
              styles.barChart,
              Platform.OS === 'web' && isDesktop && { flex: 1, justifyContent: 'space-between' as const },
            ]}>
              {(sourceData?.hourlySales || []).filter((h: any) => (h?.amount || 0) > 0).map((hour, index) => {
                const amt = hour.amount || 0;
                const barHeight = maxHourAmount > 0 ? (amt / maxHourAmount) * 150 : 0;
                const isHighlighted = highlightedHourIndex === index;
                const isBest = hour.hour === bestSellingHour.hour;
                const hasSales = amt > 0;
                // Format amount: <1K = exact TL, 1K-999K = "12K", >=1M = "1.2M"
                const formatted = amt === 0
                  ? '—'
                  : amt < 1000
                    ? amt.toFixed(0)
                    : amt < 1000000
                      ? `${(amt / 1000).toFixed(amt < 10000 ? 1 : 0)}K`
                      : `${(amt / 1000000).toFixed(1)}M`;
                return (
                  <TouchableOpacity
                    key={hour.hour}
                    style={styles.barContainer}
                    onPress={() => handleHourPress(hour, index)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.barValue,
                      {
                        color: isHighlighted ? colors.primary : isBest ? colors.success : hasSales ? colors.text : colors.textSecondary,
                        opacity: hasSales ? 1 : 0.4,
                      },
                    ]}>
                      {formatted}
                    </Text>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: hasSales ? Math.max(barHeight, 6) : 2,
                          backgroundColor: isHighlighted
                            ? colors.primary
                            : isBest
                            ? colors.success
                            : hasSales
                              ? colors.primary + '60'
                              : colors.border,
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
            {t('tap_hour_detail')}
          </Text>
        </View>
        )}

        {/* Top Selling Products */}
        {(sourceData?.topSelling || []).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('top_selling')}</Text>
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
                ₺{product.revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
          ))}
        </View>
        )}

        {/* Least Selling Products */}
        {(sourceData?.leastSelling || []).length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('least_selling')}</Text>
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
                ₺{product.revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
          ))}
        </View>
        )}

        {/* Cancellations Summary — shows as soon as any iptal data arrives, regardless of branchSales */}
        {(sourceData?.iptalOzet || []).length > 0 && (() => {
          const rows: any[] = sourceData?.iptalOzet || [];
          const fisIptalAdet = rows.reduce((s, o: any) => s + parseInt(o.FIS_IPTAL_ADET || '0'), 0);
          const satirIptalAdet = rows.reduce((s, o: any) => s + parseInt(o.SATIR_IPTAL_ADET || '0'), 0);
          const totalAdet = fisIptalAdet + satirIptalAdet;
          const fisIptalTutar = rows.reduce((s, o: any) => s + parseFloat(o.FIS_IPTAL_TUTAR || '0'), 0);
          const satirIptalTutar = rows.reduce((s, o: any) => s + parseFloat(o.SATIR_IPTAL_TUTAR || '0'), 0);
          const totalTutar = fisIptalTutar + satirIptalTutar;
          if (totalAdet <= 0 && totalTutar <= 0) return null;
          // Collect unique locations
          const locations = Array.from(new Set(rows.map((o: any) => o.LOKASYON || '-')));
          return (
            <View style={[styles.section, { backgroundColor: colors.error + '08', borderColor: colors.error + '40', borderWidth: 1.5 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="close-circle" size={20} color={colors.error} />
                <Text style={[styles.sectionTitle, { color: colors.error, marginBottom: 0 }]}>{t('cancellations')}</Text>
                <View style={{ flex: 1 }} />
                <Text style={[{ fontSize: 18, fontWeight: '800', color: colors.error }]}>₺{totalTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <View style={{ backgroundColor: colors.error + '12', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                  <Text style={[{ fontSize: 10, color: colors.error, fontWeight: '700' }]}>{t('fis_iptal_label')}: {fisIptalAdet}</Text>
                </View>
                <View style={{ backgroundColor: colors.error + '12', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                  <Text style={[{ fontSize: 10, color: colors.error, fontWeight: '700' }]}>{t('satir_iptal_label')}: {satirIptalAdet}</Text>
                </View>
                <View style={{ backgroundColor: colors.error + '12', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                  <Text style={[{ fontSize: 10, color: colors.error, fontWeight: '700' }]}>{t('total_short')}: {totalAdet}</Text>
                </View>
              </View>
              {locations.map((lok: string, idx: number) => {
                const locRows = rows.filter((o: any) => (o.LOKASYON || '-') === lok);
                const adet = locRows.reduce((s, o: any) => s + parseInt(o.FIS_IPTAL_ADET || '0') + parseInt(o.SATIR_IPTAL_ADET || '0'), 0);
                const tutar = locRows.reduce((s, o: any) => s + parseFloat(o.FIS_IPTAL_TUTAR || '0') + parseFloat(o.SATIR_IPTAL_TUTAR || '0'), 0);
                if (adet <= 0 && tutar <= 0) return null;
                return (
                  <TouchableOpacity
                    key={`iptal-lok-${idx}-${lok}`}
                    style={[styles.cancellationButton, { backgroundColor: colors.error + '12', marginBottom: 6 }]}
                    onPress={() => openLocationIptalList(lok)}
                  >
                    <Ionicons name="location-outline" size={14} color={colors.error} />
                    <Text style={[styles.cancellationText, { color: colors.error }]}>
                      {lok} · {adet} {t('cancel_label')} · ₺{tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.error} />
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })()}

        {/* Son 7 Gün Satış Trendi — 2026-08 yeni mini grafik (güne dokun → o günün özeti) */}
        <WeeklyTrendChart
          tenantId={activeTenantId}
          colors={colors}
          style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}
          onDayPress={(tarih) => {
            const gun = new Date(tarih + 'T12:00:00');
            setFilters((f) => ({ ...f, startDate: gun, endDate: gun }));
          }}
        />

        {/* Aylık Karşılaştırma — 2026-08 yeni kart */}
        <MonthlyCompareCard
          tenantId={activeTenantId}
          colors={colors}
          style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}
        />

        {/* KDV / Matrah Detayı — 2026-08 refactor: ayrı komponent */}
        <KdvMatrahSection
          kdvBreakdown={sourceData?.kdvBreakdown}
          colors={colors}
          style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}
        />

        {/* 2026-05-05 — On ≥1280px web, render Location Summary +
            Lokasyon Saatlik Satışlar side-by-side as a 2-column grid so the
            full content width of the desktop is used. On phone/tablet the
            sections stack vertically as before. */}
        <View style={isXLarge ? { flexDirection: 'row', gap: 14, alignItems: 'flex-start' } : undefined}>
        {/* Location Summary */}
        {(sourceData?.branchSales || []).length > 0 && (
        <View style={[styles.section, isXLarge && { flex: 1, marginRight: 0 }, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('location_summary')}</Text>

          {/* Comparison Chart - sorted by Total desc */}
          {(() => {
            const sorted = [...(sourceData?.branchSales || [])]
              .filter(b => (b?.sales?.total || 0) > 0 || (b?.sales?.cash || 0) > 0 || (b?.sales?.card || 0) > 0)
              .sort((a, b) => (b?.sales?.total || 0) - (a?.sales?.total || 0));
            if (sorted.length < 1) return null;
            const maxVal = Math.max(
              ...sorted.map(b => Math.max(b?.sales?.cash || 0, b?.sales?.card || 0, b?.sales?.total || 0)),
              1
            );
            const fmt = (v: number) => {
              if (v >= 1000000) return `₺${(v / 1000000).toFixed(1)}M`;
              if (v >= 1000) return `₺${(v / 1000).toFixed(1)}K`;
              return `₺${v.toFixed(0)}`;
            };
            const cashColor = colors.cash || '#10B981';
            const cardColor = colors.primary || '#3B82F6';
            const totalColor = colors.total || '#8B5CF6';
            return (
              <View style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 12,
                marginBottom: 14,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="bar-chart" size={14} color={colors.textSecondary} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>
                      Şube Karşılaştırma
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: cashColor }} />
                      <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>Nakit</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: cardColor }} />
                      <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>Kart</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: totalColor }} />
                      <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>Toplam</Text>
                    </View>
                  </View>
                </View>
                {sorted.map((b, i) => {
                  const cashVal = b?.sales?.cash || 0;
                  const cardVal = b?.sales?.card || 0;
                  const totalVal = b?.sales?.total || 0;
                  const cashW = Math.max((cashVal / maxVal) * 100, cashVal > 0 ? 2 : 0);
                  const cardW = Math.max((cardVal / maxVal) * 100, cardVal > 0 ? 2 : 0);
                  const totalW = Math.max((totalVal / maxVal) * 100, totalVal > 0 ? 2 : 0);
                  return (
                    <View key={b.branchId} style={{ marginBottom: i === sorted.length - 1 ? 0 : 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>
                          {b.branchName}
                        </Text>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: totalColor }}>
                          {fmt(totalVal)}
                        </Text>
                      </View>
                      {/* Three bars stacked */}
                      <View style={{ gap: 3 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ flex: 1, height: 6, backgroundColor: cashColor + '20', borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ width: `${cashW}%`, height: '100%', backgroundColor: cashColor, borderRadius: 3 }} />
                          </View>
                          <Text style={{ fontSize: 9, color: colors.textSecondary, fontWeight: '600', minWidth: 50, textAlign: 'right' }}>
                            {fmt(cashVal)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ flex: 1, height: 6, backgroundColor: cardColor + '20', borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ width: `${cardW}%`, height: '100%', backgroundColor: cardColor, borderRadius: 3 }} />
                          </View>
                          <Text style={{ fontSize: 9, color: colors.textSecondary, fontWeight: '600', minWidth: 50, textAlign: 'right' }}>
                            {fmt(cardVal)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ flex: 1, height: 6, backgroundColor: totalColor + '20', borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ width: `${totalW}%`, height: '100%', backgroundColor: totalColor, borderRadius: 3 }} />
                          </View>
                          <Text style={{ fontSize: 9, color: colors.textSecondary, fontWeight: '700', minWidth: 50, textAlign: 'right' }}>
                            {fmt(totalVal)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}

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
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>{t('cash_short')}</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.cash.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.locationStat}>
                    <Ionicons name="card-outline" size={14} color={colors.primary} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>{t('card_short')}</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.card.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
                <View style={styles.locationRow}>
                  <View style={styles.locationStat}>
                    <Ionicons name="wallet-outline" size={14} color={colors.openAccount} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>{t('open_short')}</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.openAccount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.locationStat}>
                    <Ionicons name="stats-chart" size={14} color={colors.total} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>{t('total_short')}</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.total.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                  {iptalAdet} {t('cancel_label')} · ₺{iptalTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
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
          <View style={isXLarge ? { flex: 1 } : undefined}>
          <HourlyLocationSection
            data={sourceData.hourlyLocationSales}
            tenantId={activeTenantId}
            filterDate={filters?.startDate ? filters.startDate.toISOString().slice(0, 10) : undefined}
            filterEndDate={filters?.endDate ? filters.endDate.toISOString().slice(0, 10) : undefined}
            branchTotalsByName={(sourceData?.branchSales || []).reduce((acc: Record<string, number>, b: any) => {
              if (b?.branchName) acc[b.branchName] = (b?.sales?.total ?? 0);
              return acc;
            }, {} as Record<string, number>)}
          />
          </View>
        )}
        </View>{/* /isXLarge row wrapper */}

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

      {/* Compare Modal - tenant (data source) comparison */}
      <CompareModal
        visible={showCompareModal}
        onClose={() => {
          setShowCompareModal(false);
          // Refresh dashboard to live data when compare modal closes
          refreshData();
        }}
        activeTenantId={activeTenantId}
      />

      {/* Card Type Location Modal — 2026-08 refactor: ayrı komponent */}
      <CardTypeLocationModal
        selectedCardType={selectedCardType}
        onClose={() => setSelectedCardType(null)}
        sourceData={sourceData}
        totals={totals}
        colors={colors}
        isDesktop={isDesktop}
        t={t}
        activeTenantId={activeTenantId}
        sdate={`${filters.startDate.getFullYear()}-${String(filters.startDate.getMonth() + 1).padStart(2, '0')}-${String(filters.startDate.getDate()).padStart(2, '0')}`}
        edate={`${filters.endDate.getFullYear()}-${String(filters.endDate.getMonth() + 1).padStart(2, '0')}-${String(filters.endDate.getDate()).padStart(2, '0')}`}
        getCardTypeLabel={getCardTypeLabel}
        getCardTypeColor={getCardTypeColor}
      />

      {/* Hour Detail Modal — 2026-08 refactor: ayrı komponent */}
      <HourDetailModal
        visible={showHourDetail}
        onClose={() => { setShowHourDetail(false); setHighlightedHourIndex(null); setHourDetailProducts([]); }}
        selectedHour={selectedHour}
        hourDetailRows={hourDetailRows}
        hourDetailLoading={hourDetailLoading}
        colors={colors}
        isDesktop={isDesktop}
        t={t}
      />

      {/* Lokasyon İptal Listesi Modal — 2026-08 refactor: ayrı komponent */}
      <LocationIptalModal
        visible={showIptalListModal}
        onClose={() => { setShowIptalListModal(false); setIptalListItems([]); }}
        location={iptalListLocation}
        items={iptalListItems}
        loading={iptalListLoading}
        iptalOzet={sourceData?.iptalOzet || []}
        colors={colors}
        isDesktop={isDesktop}
        t={t}
        onOpenDetail={(id) => openIptalDetail(id)}
      />

      {/* 2026-05-06 — Eski inline iptal Modal (Modal+ScrollView+iptalDetailItems)
          tamamen silindi. Artık standalone IptalDetailModal komponenti kullanılıyor.
          Render'ı return'in en altında, HighSaleDetailModal'ın yanında yapılıyor. */}

      {/* Open Table Detail Modal */}
      <Modal visible={!!selectedOpenTable} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent={Platform.OS === "android"} onRequestClose={() => { setSelectedOpenTable(null); setTableDetailItems([]); }}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border, maxWidth: 720 }]]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('table_detail_title')}</Text>
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
                  <Text style={[styles.tableDetailTitle, { color: colors.text }]}>{t('table_short')} {selectedOpenTable.tableNo}</Text>
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
                <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 16, marginBottom: 8 }]}>{t('order_detail')}</Text>
                
                {tableDetailLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }]}>POS'tan veri alınıyor...</Text>
                  </View>
                ) : tableDetailItems.length > 0 ? (
                  <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }]}>
                    {/* Table Header */}
                    <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                      <Text style={[{ flex: 2.4, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>{t('product')}</Text>
                      <Text style={[{ flex: 0.8, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>{t('quantity_short')}</Text>
                      <Text style={[{ flex: 1.8, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>{t('amount_col')}</Text>
                    </View>
                    {tableDetailItems.map((item: any, idx: number) => {
                      const tutar = item.TUTAR ? parseFloat(item.TUTAR) : (parseFloat(item.MIKTAR || '0') * parseFloat(item.FIYAT || '0'));
                      return (
                        <View key={idx} style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' }]}>
                          <View style={{ flex: 2.4, paddingRight: 6 }}>
                            <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]} numberOfLines={1}>{item.AD || 'Ürün'}</Text>
                            <Text style={[{ fontSize: 11, color: colors.textSecondary }]} numberOfLines={1}>₺{parseFloat(item.FIYAT || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {item.STOK_BIRIM_AD || 'Adet'}</Text>
                          </View>
                          <Text style={[{ flex: 0.8, fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'center' }]}>
                            {parseFloat(item.MIKTAR || '0').toFixed(item.STOK_BIRIM_AD === 'Kg' ? 3 : 0)}
                          </Text>
                          <Text
                            style={[{ flex: 1.8, fontSize: 13, fontWeight: '700', color: colors.primary, textAlign: 'right' }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                          >
                            ₺{tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        </View>
                      );
                    })}
                    {/* Total row */}
                    <View style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }]}>
                      <Text style={[{ flex: 3.2, fontSize: 14, fontWeight: '800', color: colors.text, textAlign: 'right', paddingRight: 12 }]}>{t('total_short')}</Text>
                      <Text
                        style={[{ flex: 1.8, fontSize: 15, fontWeight: '800', color: colors.primary, textAlign: 'right' }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                      >
                        ₺{tableDetailItems.reduce((sum: number, item: any) => {
                          const tutar = item.TUTAR ? parseFloat(item.TUTAR) : (parseFloat(item.MIKTAR || '0') * parseFloat(item.FIYAT || '0'));
                          return sum + tutar;
                        }, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
                    <Text style={[{ color: colors.textSecondary, marginTop: 8, fontSize: 14 }]}>{t('no_detail_info')}</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Waiter Detail Modal - Handled in DashboardSections */}

      {/* 2026-05-05 — Yüksek Satış Detay Modal (push deep-link target).
          Pulls receipt lines from MySQL cache via /api/data/high-sale-detail. */}
      <HighSaleDetailModal
        visible={highSaleVisible}
        onClose={() => { setHighSaleVisible(false); setHighSaleTenantId(''); }}
        tenantId={highSaleTenantId || activeTenantId}
        fisId={highSaleFisId}
        belgeno={highSaleBelgeno}
        amount={highSaleAmount}
        tenantName={user?.tenants?.find?.((x: any) => x.tenant_id === (highSaleTenantId || activeTenantId))?.name || ''}
      />

      {/* 2026-05-06 — Fiş İptal Detay Modal (push deep-link target + iptal listesi).
          Pulls header (LOKASYON/PERSONEL_AD/TARIH_IPTAL/TUTAR) and line items
          from MySQL cache via /api/data/iptal-detail (iptal_detay dataset). */}
      <IptalDetailModal
        visible={iptalDetailVisible}
        onClose={() => {
          const shouldReopenList = iptalDetailCameFromList;
          setIptalDetailVisible(false);
          setIptalDetailIptalId('');
          setIptalDetailTenantId('');
          setIptalDetailTenantName('');
          setIptalDetailCameFromList(false);
          // 2026-05-16 — Detay listeden açıldıysa kapanınca listeyi geri aç.
          // iOS'ta animasyon çakışmasını önlemek için kısa gecikme veriyoruz.
          if (shouldReopenList) {
            if (Platform.OS === 'ios') {
              setTimeout(() => setShowIptalListModal(true), 350);
            } else {
              setShowIptalListModal(true);
            }
          }
        }}
        tenantId={iptalDetailTenantId || activeTenantId}
        iptalId={iptalDetailIptalId}
        tenantName={iptalDetailTenantName || user?.tenants?.find?.((x: any) => x.tenant_id === (iptalDetailTenantId || activeTenantId))?.name || ''}
      />

      {/* 2026-07 — Ana sayfa PDF dışa aktarma (bölüm seçimli) */}
      <DashboardPdfExport
        visible={showPdfExport}
        onClose={() => setShowPdfExport(false)}
        tenantName={user?.tenants?.find?.((x: any) => x.tenant_id === activeTenantId)?.name || ''}
        dateLabel={`${filters.startDate.toLocaleDateString('tr-TR')} - ${filters.endDate.toLocaleDateString('tr-TR')}`}
        totals={totals}
        branchSales={sourceData?.branchSales || []}
        hourlySales={effectiveHourlySales}
        openTables={sourceData?.openTables || []}
        iptalOzet={sourceData?.iptalOzet || []}
      />
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
    fontSize: Platform.select({ web: 12, ios: 12, android: 14, default: 13 }),
    marginBottom: 2,
    fontWeight: Platform.OS === 'web' ? '600' : '400',
    ...(Platform.OS === 'web' ? { letterSpacing: 0.4, textTransform: 'uppercase' as const } : {}),
  },
  userName: {
    fontSize: Platform.select({ web: 22, ios: 20, android: 22, default: 21 }),
    fontWeight: Platform.OS === 'web' ? '800' : '700',
    ...(Platform.OS === 'web' ? { letterSpacing: -0.5 } : {}),
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Platform.OS === 'ios' ? 9 : 11,
    paddingVertical: Platform.OS === 'ios' ? 8 : 9,
    borderRadius: 20,
    borderWidth: 1,
    gap: 4,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        transition: 'background-color 160ms ease, transform 160ms ease',
      } as any,
      default: {},
    }),
  },
  filterText: {
    fontSize: Platform.OS === 'ios' ? 12 : 14,
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
    borderRadius: 18,
    borderWidth: 1,
    ...Platform.select({
      web: {
        // Premium SaaS-style multi-layer shadow (Linear / Notion / Vercel inspired)
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.03)',
      },
      default: {},
    }),
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
    letterSpacing: -0.2,
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
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    minWidth: 34,
    textAlign: 'center',
  },
  bar: {
    width: 26,
    borderRadius: 6,
    minHeight: 2,
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
    alignSelf: Platform.OS === 'web' ? 'center' : 'flex-end',
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
  hourDetailCard: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    marginBottom: 16,
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
