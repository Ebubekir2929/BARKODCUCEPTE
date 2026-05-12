import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal,
  ScrollView, ActivityIndicator, Alert, RefreshControl, Platform,
  FlatList, DeviceEventEmitter,
} from 'react-native';
import { webStyles } from '../../src/styles/webModalStyles';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { readPendingTap, clearPendingTap, NOTIFICATION_TAP_EVENT } from '../../src/services/notificationTapHandler';
import { useFocusEffect } from 'expo-router';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { ScrollFab } from '../../src/components/ScrollFab';
import { useResponsive } from '../../src/hooks/useResponsive';
import { DataTable, TableColumn } from '../../src/components/DataTable';
import { NegativeStockModal } from '../../src/components/NegativeStockModal';
import DateField from '../../src/components/DateField';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function StockScreen() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { showError, showWarning, alertProps } = useAlert();
  const { user } = useAuthStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { isDesktop } = useResponsive();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const idx = match ? parseInt(match[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true); // Start with loading true
  const [priceNames, setPriceNames] = useState<any[]>([]);
  const [selectedPriceName, setSelectedPriceName] = useState<string>('');
  const [stockList, setStockList] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(true); // Start with loading true
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  };

  // Filters
  const [filterGroups, setFilterGroups] = useState<string[]>([]);   // multi-select
  const [filterProfit, setFilterProfit] = useState<'all' | 'profit' | 'loss'>('all');
  const [filterQty, setFilterQty] = useState<'all' | 'low' | 'mid' | 'high' | 'negative'>('all');
  const [filterKdvs, setFilterKdvs] = useState<string[]>([]);       // multi-select
  // 2026-05-03 — extra filter dimensions (atama / depo baremleri)
  const [filterMarkalar, setFilterMarkalar] = useState<string[]>([]);
  const [filterCinsler, setFilterCinsler] = useState<string[]>([]);
  const [filterOzelKod1, setFilterOzelKod1] = useState<string[]>([]);
  const [filterOzelKod2, setFilterOzelKod2] = useState<string[]>([]);

  // 2026-05-05 — Full-screen "Eksi Stok Özeti" modal opened by the
  // low_stock_summary push deep-link. Local filter still flips to "negative"
  // beneath the modal so the user can keep browsing after dismiss.
  const [showNegativeStockModal, setShowNegativeStockModal] = useState(false);

  // 2026-05-06 — Notification tap (negative stock summary) — sade AsyncStorage
  // tabanlı flow, useDeepLinkStore kaldırıldı.
  const _stockTapProcessing = React.useRef(false);
  const processStockTap = React.useCallback(async () => {
    if (_stockTapProcessing.current) return;
    _stockTapProcessing.current = true;
    try {
      const tap = await readPendingTap();
      if (!tap) return;
      const type = String(tap.type || '').toLowerCase();
      const isStock = (type === 'low_stock_summary' || type === 'eksi_stok' || type === 'low_stock');
      if (!isStock) return;
      const targetTenant = String(tap.tenant || '');
      if (targetTenant && user?.tenants) {
        const idx = user.tenants.findIndex((t: any) => t.tenant_id === targetTenant);
        if (idx >= 0) { try { setActiveSource(`data${idx + 1}`); } catch {} }
      }
      setFilterQty('negative');
      setSearchQuery('');
      setTimeout(() => setShowNegativeStockModal(true), 400);
      await clearPendingTap();
    } catch (e) {
      console.log('[stock tap] failed:', e);
    } finally {
      _stockTapProcessing.current = false;
    }
  }, [user, setActiveSource]);

  useFocusEffect(
    React.useCallback(() => {
      processStockTap();
    }, [processStockTap])
  );

  // 2026-05-06 — Foreground tap: bildirim banner'ına tıklama olduğunda
  // notificationTapHandler emit eder, biz hemen okuruz (focus zaten bizdeyse
  // useFocusEffect tetiklenmediği için bu ek dinleyiciye ihtiyacımız var).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(NOTIFICATION_TAP_EVENT, () => {
      processStockTap();
    });
    return () => { try { sub.remove(); } catch {} };
  }, [processStockTap]);

  // 2026-05-03 — deep-link from notification taps (low_stock_summary push)
  // Handles `onlyNegative=1` query param → switches the filter to "negative" so
  // the user lands directly on negative-stock items.
  const navParams = useLocalSearchParams<{ onlyNegative?: string; openLowStockSummary?: string; tenant?: string }>();
  const _stockDeepLinkRef = React.useRef<string | null>(null);
  useEffect(() => {
    const sig = String(navParams?.onlyNegative || '') + '|' + String(navParams?.openLowStockSummary || '') + '|' + String(navParams?.tenant || '');
    if (sig === _stockDeepLinkRef.current) return;
    if (!navParams?.onlyNegative && !navParams?.openLowStockSummary) return;
    _stockDeepLinkRef.current = sig;
    // 2026-05-05 — Switch tenant if the push originated from a different branch,
    // otherwise the modal would show stock for the wrong tenant.
    const targetTenant = String(navParams?.tenant || '');
    if (targetTenant && user?.tenants) {
      const idx = user.tenants.findIndex(t => t.tenant_id === targetTenant);
      if (idx >= 0) setActiveSource(`data${idx + 1}`);
    }
    if (navParams?.onlyNegative === '1' || navParams?.openLowStockSummary === '1') {
      setFilterQty('negative');
      setSearchQuery('');
    }
    // 2026-05-05 — when the watcher fires the low_stock_summary push, present
    // the dedicated full-screen modal instead of just toggling the filter.
    if (navParams?.openLowStockSummary === '1') {
      // Slight delay so the tenant switch + stock list refresh has a chance to
      // hit the network before the modal renders an empty body.
      setTimeout(() => setShowNegativeStockModal(true), 800);
    }
    try { router.setParams({ onlyNegative: '', openLowStockSummary: '', tenant: '' } as any); } catch {}
  }, [navParams?.onlyNegative, navParams?.openLowStockSummary, navParams?.tenant]);

  const toggleGroup = (g: string) => {
    setFilterGroups((prev) => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };
  const toggleKdv = (k: string) => {
    setFilterKdvs((prev) => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  };

  // Detail modal
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [detailMiktar, setDetailMiktar] = useState<any[]>([]);
  const [detailExtre, setDetailExtre] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'miktar' | 'extre'>('miktar');
  const [exportLoading, setExportLoading] = useState(false);

  // 2026-05-12 — Stok ekstre tarih filtresi (varsayılan: bu ayın 1'i → bugün)
  const _initExtreDates = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${d}` };
  })();
  const [extreStart, setExtreStart] = useState<string>(_initExtreDates.start);
  const [extreEnd, setExtreEnd] = useState<string>(_initExtreDates.end);
  // 2026-05-12 — Tarih seçimi DateField bileşeni içinde lokal state ile yönetiliyor.

  // Fiş detay modal (cari ile aynı yapı)
  const [selectedFis, setSelectedFis] = useState<any | null>(null);
  const [fisDetail, setFisDetail] = useState<any[]>([]);
  const [fisTotals, setFisTotals] = useState<any | null>(null);
  const [fisLoading, setFisLoading] = useState(false);

  // Ekstre satırlarını tarih aralığına göre filtrele (client-side)
  const filteredExtre = React.useMemo(() => {
    if (!detailExtre || detailExtre.length === 0) return [];
    return detailExtre.filter((row: any) => {
      const t = (row.TARIH || row.TARIHI || row.ISLEM_TARIHI || '').toString().slice(0, 10);
      if (!t) return true; // tarihi olmayanları gizleme
      return t >= extreStart && t <= extreEnd;
    });
  }, [detailExtre, extreStart, extreEnd]);

  // Fiş detayını aç
  const openFisDetail = useCallback(async (row: any) => {
    const fisId = row.BELGE_ID || row.FIS_ID || row.KAYIT_ID || row.ID || row.BELGEID || row.FIS;
    if (!fisId || !activeTenantId) {
      showToast('Bu satırın fiş detayı bulunamadı');
      return;
    }
    setSelectedFis(row);
    setFisDetail([]);
    setFisTotals(null);
    setFisLoading(true);
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/fis-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, fis_id: fisId }),
      });
      const data = await resp.json();
      if (data.ok) {
        setFisDetail(data.details || []);
        setFisTotals(data.totals && data.totals.length > 0 ? data.totals[0] : null);
        if (!data.details || data.details.length === 0) {
          showToast('Fiş detayı boş döndü');
        }
      } else {
        showToast(data.detail || 'Fiş detayı yüklenemedi');
      }
    } catch (err) {
      console.error('Fis detail error:', err);
      showToast('Fiş detayı yüklenirken hata oluştu');
    } finally {
      setFisLoading(false);
    }
  }, [activeTenantId]);

  // Fetch price names
  useEffect(() => {
    if (!activeTenantId) return;
    const fetchPN = async () => {
      setLoading(true);
      try {
        const { token } = useAuthStore.getState();
        const resp = await fetch(`${API_URL}/api/data/stock-price-names`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId }),
        });
        const data = await resp.json();
        if (data.ok && data.data) {
          setPriceNames(data.data);
          if (data.data.length > 0 && !selectedPriceName) {
            setSelectedPriceName(String(data.data[0].ID || data.data[0].AD || ''));
          }
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchPN();
  }, [activeTenantId]);

  // Loading progress for incremental fetching
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const fetchAbortRef = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<any>(null);
  const [showScrollUp, setShowScrollUp] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  // 2026-05-05 — transient "filtering…" spinner shown right after search /
  // filter mutates while FlashList rebuilds its layout. Without it the user
  // sees a blank/black region until the recycler redraws.
  const [isFiltering, setIsFiltering] = useState(false);
  const filterTimerRef = React.useRef<any>(null);

  // Fetch stock list incrementally — page 1 instantly, rest streamed in background
  const fetchStockList = useCallback(async (force: boolean = false) => {
    if (!activeTenantId || !selectedPriceName) return;

    // Cancel any in-flight stream
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;

    setStockLoading(true);
    setStockList([]);
    setLoadProgress(null);

    const PAGE_SIZE = 200;
    const { token } = useAuthStore.getState();

    const fetchPage = async (page: number): Promise<{ data: any[]; total_pages: number; total_count: number } | null> => {
      try {
        const resp = await fetch(`${API_URL}/api/data/stock-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          signal: ctrl.signal,
          body: JSON.stringify({
            tenant_id: activeTenantId,
            fiyat_ad: selectedPriceName,
            page,
            page_size: PAGE_SIZE,
            force_refresh: force,
          }),
        });
        if (!resp.ok) return null;
        const j = await resp.json();
        return {
          data: Array.isArray(j?.data) ? j.data : [],
          total_pages: parseInt(j?.total_pages || 1),
          total_count: parseInt(j?.total_count || 0),
        };
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        return null;
      }
    };

    try {
      // PAGE 1 — instant render
      const first = await fetchPage(1);
      if (ctrl.signal.aborted) return;
      if (!first || first.data.length === 0) {
        setStockLoading(false);
        return;
      }
      setStockList(first.data);
      setStockLoading(false); // user can scroll/search the first 200 immediately

      const totalPages = first.total_pages || 1;
      const totalCount = first.total_count || first.data.length;

      if (totalPages <= 1) {
        setLoadProgress(null);
        return;
      }

      setLoadProgress({ loaded: first.data.length, total: totalCount });

      // PAGES 2..N — stream in parallel batches of 5
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const BATCH = 5;
      for (let i = 0; i < remaining.length; i += BATCH) {
        if (ctrl.signal.aborted) return;
        const batch = remaining.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(fetchPage));
        if (ctrl.signal.aborted) return;
        const newRows: any[] = [];
        let maxTotalSeen = 0;
        results.forEach((r) => {
          if (r && Array.isArray(r.data)) newRows.push(...r.data);
          if (r && r.total_count > maxTotalSeen) maxTotalSeen = r.total_count;
        });
        if (newRows.length > 0) {
          // Functional update so concurrent batches don't stomp each other
          setStockList((prev) => [...prev, ...newRows]);
          setLoadProgress((prev) => {
            if (!prev) return null;
            const newLoaded = prev.loaded + newRows.length;
            // total can never be < loaded (handles backend total_count bug)
            const newTotal = Math.max(prev.total, maxTotalSeen, newLoaded);
            // Auto-clear when fully loaded
            if (newLoaded >= newTotal) return null;
            return { loaded: newLoaded, total: newTotal };
          });
        }
      }
      setLoadProgress(null);
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error(e);
    } finally {
      if (!ctrl.signal.aborted) {
        setStockLoading(false);
        setLoadProgress(null);  // belt-and-suspenders: always clear when done
      }
    }
  }, [activeTenantId, selectedPriceName]);

  useEffect(() => {
    fetchStockList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId, selectedPriceName]);

  // 2026-05-05 — Background auto-refresh (every 60s while on this screen).
  // Quietly hits the cache-aware /stoklar endpoint, compares row count + a
  // sample hash of the response to the current list and swaps in the new
  // data only if it actually differs. No spinner, no list clear → no UI
  // disruption while the user is scrolling. Toast pill shows briefly when
  // an update is applied.
  const _bgUpdatedRef = React.useRef(false);
  const [bgUpdatedToast, setBgUpdatedToast] = useState(false);
  useEffect(() => {
    if (!activeTenantId) return;
    let cancelled = false;
    const INTERVAL_MS = 60 * 1000;
    const _hashList = (rows: any[]) => `${rows.length}|${rows.slice(0, 3).map((r: any) => r.KOD || r.STOK_KODU || '').join(',')}|${rows.slice(-3).map((r: any) => r.KOD || r.STOK_KODU || r.MIKTAR || '').join(',')}`;
    const tick = async () => {
      if (cancelled || stockLoading) return;
      try {
        const { token } = useAuthStore.getState();
        // 2026-05-05 — Use /stock-list with a large page_size to grab the
        // entire catalog in a single hop (cache-aware MySQL read).
        const r = await fetch(`${API_URL}/api/data/stock-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            tenant_id: activeTenantId,
            fiyat_ad: selectedPriceName,
            page: 1,
            page_size: 50000,
            force_refresh: false,
          }),
        });
        if (cancelled) return;
        const j = await r.json();
        if (!j.ok || !Array.isArray(j.data)) return;
        // Compare hashes — only update if changed
        setStockList((prev) => {
          if (cancelled) return prev;
          const newSig = _hashList(j.data);
          const oldSig = _hashList(prev);
          if (newSig === oldSig) return prev;
          // Update applied — flash a brief toast
          _bgUpdatedRef.current = true;
          setBgUpdatedToast(true);
          setTimeout(() => setBgUpdatedToast(false), 2500);
          return j.data;
        });
      } catch { /* ignore poll errors */ }
    };
    const id = setInterval(tick, INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTenantId, selectedPriceName, stockLoading]);

  // ⏹️ Cancel any in-flight POS request when leaving this screen
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        if (fetchAbortRef.current) {
          fetchAbortRef.current.abort();
          fetchAbortRef.current = null;
        }
      };
    }, [])
  );

  const [refreshing, setRefreshing] = useState(false);
  const [manualToast, setManualToast] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStockList(true);
    setRefreshing(false);
    setManualToast(true);
    setTimeout(() => setManualToast(false), 2200);
  }, [fetchStockList]);

  // Groups and KDV values for filter
  const groups = useMemo(() => {
    const s = new Set<string>();
    stockList.forEach((i: any) => { if (i.STOK_GRUP || i.GRUP) s.add(i.STOK_GRUP || i.GRUP); });
    return Array.from(s).sort();
  }, [stockList]);

  const kdvValues = useMemo(() => {
    const s = new Set<string>();
    stockList.forEach((i: any) => { 
      const v = String(i.KDV_PAREKENDE || i.KDV || '').replace('.00', ''); 
      if (v && v !== '0' && v !== '' && v !== 'null') s.add(v); 
    });
    return Array.from(s).sort((a, b) => parseFloat(a) - parseFloat(b));
  }, [stockList]);

  // 2026-05-03 — extra filter dimensions for the filter modal.
  const uniqueMarkalar = useMemo(() => {
    const s = new Set<string>();
    stockList.forEach((i: any) => { const v = String(i.MARKA || i.MARKA_AD || '').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }, [stockList]);
  const uniqueCinsler = useMemo(() => {
    const s = new Set<string>();
    stockList.forEach((i: any) => { const v = String(i.CINS || i.CINS_AD || '').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }, [stockList]);
  const uniqueOzelKod1 = useMemo(() => {
    const s = new Set<string>();
    stockList.forEach((i: any) => { const v = String(i.STOK_OZEL_KOD1 || '').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }, [stockList]);
  const uniqueOzelKod2 = useMemo(() => {
    const s = new Set<string>();
    stockList.forEach((i: any) => { const v = String(i.STOK_OZEL_KOD2 || '').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }, [stockList]);
  const toggleInList = (current: string[], setter: (v: string[]) => void, val: string) => {
    setter(current.includes(val) ? current.filter(x => x !== val) : [...current, val]);
  };

  // Filtered list
  const filteredStocks = useMemo(() => {
    let list = stockList;
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const tokens = q.split(/\s+/).filter(Boolean);
      // 2026-05-03 (user request) — wider search: scan AD, KOD, BARKOD, MARKA,
      // CINS, GRUP, ACIKLAMA, REF_KOD, plus STOK_OZEL_KOD1..9 (atama/depo
      // baremleri). All tokens must match somewhere (AND across tokens).
      const haystackOf = (s: any) => [
        s.AD, s.STOK_AD, s.STOK_ADI,
        s.KOD, s.STOK_KODU,
        s.BARKOD, s.BARKOD2, s.BARKOD3,
        s.MARKA, s.MARKA_AD,
        s.CINS, s.CINS_AD,
        s.GRUP, s.STOK_GRUP, s.GRUP_AD,
        s.ACIKLAMA, s.NOTLAR,
        s.REF_KOD, s.URETICI_KOD,
        s.STOK_OZEL_KOD1, s.STOK_OZEL_KOD2, s.STOK_OZEL_KOD3,
        s.STOK_OZEL_KOD4, s.STOK_OZEL_KOD5, s.STOK_OZEL_KOD6,
        s.STOK_OZEL_KOD7, s.STOK_OZEL_KOD8, s.STOK_OZEL_KOD9,
      ].filter(Boolean).join(' ').toLowerCase();
      list = list.filter((s: any) => {
        const hay = haystackOf(s);
        return tokens.every(tok => hay.includes(tok));
      });
    }
    if (filterGroups.length > 0) list = list.filter((s: any) => filterGroups.includes(s.STOK_GRUP || s.GRUP || ''));
    if (filterProfit === 'profit') list = list.filter((s: any) => {
      const sell = parseFloat(s.FIYAT || '0');
      const buy = parseFloat(s.SON_ALIS_FIYAT || '0');
      return sell > 0 && buy > 0 && sell > buy;
    });
    if (filterProfit === 'loss') list = list.filter((s: any) => {
      const sell = parseFloat(s.FIYAT || '0');
      const buy = parseFloat(s.SON_ALIS_FIYAT || '0');
      return buy > 0 && sell <= buy;
    });
    if (filterQty === 'low') list = list.filter((s: any) => { const m = parseFloat(s.MIKTAR || '0'); return m > 0 && m < 10; });
    if (filterQty === 'mid') list = list.filter((s: any) => { const m = parseFloat(s.MIKTAR || '0'); return m >= 10 && m < 100; });
    if (filterQty === 'high') list = list.filter((s: any) => parseFloat(s.MIKTAR || '0') >= 100);
    // 2026-05-03 — "Eksi Stok" filter (deep-link from low_stock_summary push)
    if (filterQty === 'negative') list = list.filter((s: any) => parseFloat(s.MIKTAR || '0') < 0);
    if (filterKdvs.length > 0) list = list.filter((s: any) => {
      const v = String(s.KDV_PAREKENDE || s.KDV || '').replace('.00', '');
      return filterKdvs.includes(v);
    });
    if (filterMarkalar.length > 0) list = list.filter((s: any) => filterMarkalar.includes(s.MARKA || s.MARKA_AD || ''));
    if (filterCinsler.length > 0) list = list.filter((s: any) => filterCinsler.includes(s.CINS || s.CINS_AD || ''));
    if (filterOzelKod1.length > 0) list = list.filter((s: any) => filterOzelKod1.includes(s.STOK_OZEL_KOD1 || ''));
    if (filterOzelKod2.length > 0) list = list.filter((s: any) => filterOzelKod2.includes(s.STOK_OZEL_KOD2 || ''));
    return list;
  }, [stockList, searchQuery, filterGroups, filterProfit, filterQty, filterKdvs, filterMarkalar, filterCinsler, filterOzelKod1, filterOzelKod2]);

  // 2026-05-05 — When the search query OR active filters mutate, FlashList may
  // keep the scroll offset from the previous (longer) list which causes a
  // black/empty viewport. Force scroll to top + show a brief spinner so the
  // user always sees fresh content from the start.
  useEffect(() => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    setIsFiltering(true);
    try { listRef.current?.scrollToOffset?.({ offset: 0, animated: false }); } catch {}
    filterTimerRef.current = setTimeout(() => setIsFiltering(false), 220);
    return () => { if (filterTimerRef.current) clearTimeout(filterTimerRef.current); };
  }, [searchQuery, filterGroups, filterProfit, filterQty, filterKdvs, filterMarkalar, filterCinsler, filterOzelKod1, filterOzelKod2]);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filterGroups.length > 0) c++;
    if (filterProfit !== 'all') c++;
    if (filterQty !== 'all') c++;
    if (filterKdvs.length > 0) c++;
    if (filterMarkalar.length > 0) c++;
    if (filterCinsler.length > 0) c++;
    if (filterOzelKod1.length > 0) c++;
    if (filterOzelKod2.length > 0) c++;
    return c;
  }, [filterGroups, filterProfit, filterQty, filterKdvs, filterMarkalar, filterCinsler, filterOzelKod1, filterOzelKod2]);

  const selectedPriceLabel = useMemo(() => {
    const f = priceNames.find((p: any) => String(p.ID) === selectedPriceName || String(p.AD) === selectedPriceName);
    return f ? (f.AD || `${t('price_name')} #${f.ID}`) : t('price_name_select');
  }, [priceNames, selectedPriceName]);

  // Barcode scan
  const openScanner = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) { showWarning(t('permission_required'), t('camera_permission')); return; }
    }
    setShowScanner(true);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setShowScanner(false);
    setSearchQuery(data);
    const found = stockList.find((s: any) => (s.BARKOD || '') === data);
    if (found) openStockDetail(found);
    else showError(t('not_found'), `"${data}" ${t('product_not_found_barcode')}.`);
  };

  // Detail
  const openStockDetail = useCallback(async (stock: any) => {
    setSelectedStock(stock); setDetailMiktar([]); setDetailExtre([]); setDetailLoading(true); setDetailTab('miktar');
    const stockId = stock.ID || stock.STOK_ID;
    if (!stockId || !activeTenantId) { setDetailLoading(false); return; }
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/stock-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, stock_id: stockId }),
      });
      const data = await resp.json();
      if (data.ok) { setDetailMiktar(data.miktar || []); setDetailExtre(data.extre || []); }
    } catch (err) { console.error(err); }
    finally { setDetailLoading(false); }
  }, [activeTenantId]);

  const renderStockItem = useCallback(({ item }: { item: any }) => {
    const name = item.AD || t('product');
    const code = item.KOD || '';
    const barcode = item.BARKOD || '';
    const price = parseFloat(item.FIYAT || '0');
    const buyPrice = parseFloat(item.SON_ALIS_FIYAT || '0');
    const kdvRate = String(item.KDV_PAREKENDE || '').replace('.00', '').replace('.0', '');
    const grup = item.STOK_GRUP || '';
    const miktar = parseFloat(item.MIKTAR || '0');
    const profit = price > 0 && buyPrice > 0 ? price - buyPrice : 0;
    const profitPct = buyPrice > 0 ? ((profit / buyPrice) * 100) : 0;
    // 2026-05-05 — Stable height: only show detailRow if it has content,
    // otherwise FlashList's recycler leaves random gaps mid-list.
    const hasDetailRow = buyPrice > 0 || profit !== 0 || !!barcode;

    return (
      <TouchableOpacity
        style={[styles.stockCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => openStockDetail(item)}
        activeOpacity={0.7}
      >
        {/* Üst satır: İsim + Fiyat */}
        <View style={styles.stockCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.stockName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {code ? <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{code}</Text> : null}
              {grup ? <View style={[{ backgroundColor: colors.primary + '15', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }]}><Text style={[{ fontSize: 9, color: colors.primary, fontWeight: '600' }]}>{grup}</Text></View> : null}
              {kdvRate ? <View style={[{ backgroundColor: colors.warning + '15', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }]}><Text style={[{ fontSize: 9, color: colors.warning, fontWeight: '600' }]}>KDV %{kdvRate}</Text></View> : null}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.stockPrice, { color: colors.primary }]}>₺{price > 0 ? price.toFixed(2) : '0.00'}</Text>
            {miktar !== 0 && <Text style={[{ fontSize: 11, fontWeight: '700', color: miktar > 0 ? colors.success : colors.error }]}>Stok: {miktar.toFixed(2)}</Text>}
          </View>
        </View>

        {/* Alt satır: Alış + Kar + Barkod — sadece içerik varsa render edilir */}
        {hasDetailRow && (
          <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
            {buyPrice > 0 ? (
              <View style={styles.detailItem}>
                <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>Alış</Text>
                <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.warning }]}>₺{buyPrice.toFixed(2)}</Text>
              </View>
            ) : null}
            {profit !== 0 ? (
              <View style={styles.detailItem}>
                <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('profit')}</Text>
                <Text style={[{ fontSize: 12, fontWeight: '700', color: profit >= 0 ? colors.success : colors.error }]}>
                  {profit >= 0 ? '+' : ''}₺{profit.toFixed(2)} ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(0)}%)
                </Text>
              </View>
            ) : null}
            {barcode ? (
              <TouchableOpacity 
                style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                onPress={(e) => { e.stopPropagation(); Clipboard.setStringAsync(barcode); showToast(`${barcode} kopyalandı`); }}>
                <Ionicons name="barcode-outline" size={14} color={colors.primary} />
                <Text style={[{ fontSize: 12, color: colors.primary, flexShrink: 1 }]} numberOfLines={1}>{barcode}</Text>
                <View style={[{ backgroundColor: colors.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }]}>
                  <Ionicons name="copy-outline" size={12} color={colors.primary} />
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [colors, openStockDetail]);

  // 2026-05-06 — Removed FlashList getItemType helper after migrating to FlatList.
  // FlatList renders variable-height rows natively, eliminating the recycler
  // gap bug that plagued FlashList during dynamic search/filter mutations.

  // 2026-05-05 — Desktop Data Table columns (standard layout).
  // Used only when `isDesktop` is true; phone/tablet keeps the card layout.
  const desktopStockColumns = useMemo<TableColumn<any>[]>(() => [
    {
      key: 'KOD', label: t('code') || 'Kod', flex: 1.2, minWidth: 90,
      sortValue: (i: any) => String(i.KOD || i.STOK_KODU || ''),
      render: (i: any) => <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }} numberOfLines={1}>{i.KOD || i.STOK_KODU || '-'}</Text>,
    },
    {
      key: 'AD', label: t('name') || 'Ad', flex: 3, minWidth: 180,
      sortValue: (i: any) => String(i.AD || i.STOK_ADI || ''),
      render: (i: any) => <Text style={{ fontSize: 13, color: colors.text, fontWeight: '700' }} numberOfLines={1}>{i.AD || i.STOK_ADI || '-'}</Text>,
    },
    {
      key: 'MARKA', label: 'Marka', flex: 1.3, minWidth: 90,
      sortValue: (i: any) => String(i.MARKA || i.MARKA_AD || ''),
      render: (i: any) => <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>{i.MARKA || i.MARKA_AD || '-'}</Text>,
    },
    {
      key: 'STOK_GRUP', label: 'Grup', flex: 1.3, minWidth: 90,
      sortValue: (i: any) => String(i.STOK_GRUP || i.GRUP || ''),
      render: (i: any) => {
        const g = i.STOK_GRUP || i.GRUP || '';
        if (!g) return <Text style={{ fontSize: 12, color: colors.textSecondary }}>-</Text>;
        return (
          <View style={{ backgroundColor: colors.primary + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
            <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '700' }} numberOfLines={1}>{g}</Text>
          </View>
        );
      },
    },
    {
      key: 'MIKTAR', label: 'Stok', flex: 0.9, minWidth: 70, align: 'right', numeric: true,
      sortValue: (i: any) => parseFloat(i.MIKTAR || '0'),
      render: (i: any) => {
        const m = parseFloat(i.MIKTAR || '0');
        const color = m < 0 ? colors.error : m === 0 ? colors.textSecondary : colors.success;
        return <Text style={{ fontSize: 12.5, color, fontWeight: '700' }}>{m.toFixed(2)}</Text>;
      },
    },
    {
      key: 'SON_ALIS_FIYAT', label: 'Alış', flex: 1, minWidth: 80, align: 'right', numeric: true,
      sortValue: (i: any) => parseFloat(i.SON_ALIS_FIYAT || '0'),
      render: (i: any) => {
        const v = parseFloat(i.SON_ALIS_FIYAT || '0');
        return <Text style={{ fontSize: 12.5, color: colors.warning, fontWeight: '600' }}>₺{v > 0 ? v.toFixed(2) : '-'}</Text>;
      },
    },
    {
      key: 'FIYAT', label: 'Satış', flex: 1, minWidth: 80, align: 'right', numeric: true,
      sortValue: (i: any) => parseFloat(i.FIYAT || '0'),
      render: (i: any) => {
        const v = parseFloat(i.FIYAT || '0');
        return <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '800' }}>₺{v > 0 ? v.toFixed(2) : '-'}</Text>;
      },
    },
    {
      key: 'KDV_PAREKENDE', label: 'KDV', flex: 0.6, minWidth: 50, align: 'center',
      sortValue: (i: any) => parseFloat(i.KDV_PAREKENDE || '0'),
      render: (i: any) => {
        const v = String(i.KDV_PAREKENDE || '').replace('.00', '').replace('.0', '');
        if (!v) return <Text style={{ fontSize: 12, color: colors.textSecondary }}>-</Text>;
        return <Text style={{ fontSize: 11, color: colors.warning, fontWeight: '700' }}>%{v}</Text>;
      },
    },
    {
      key: 'PROFIT', label: 'Kar', flex: 1, minWidth: 80, align: 'right', numeric: true,
      sortValue: (i: any) => {
        const p = parseFloat(i.FIYAT || '0');
        const b = parseFloat(i.SON_ALIS_FIYAT || '0');
        return p > 0 && b > 0 ? (p - b) : -Infinity;
      },
      render: (i: any) => {
        const p = parseFloat(i.FIYAT || '0');
        const b = parseFloat(i.SON_ALIS_FIYAT || '0');
        if (!(p > 0 && b > 0)) return <Text style={{ fontSize: 12, color: colors.textSecondary }}>-</Text>;
        const d = p - b;
        const pct = b > 0 ? (d / b) * 100 : 0;
        const col = d >= 0 ? colors.success : colors.error;
        return (
          <Text style={{ fontSize: 12, color: col, fontWeight: '700' }} numberOfLines={1}>
            {d >= 0 ? '+' : ''}{pct.toFixed(0)}%
          </Text>
        );
      },
    },
    {
      key: 'BARKOD', label: 'Barkod', flex: 1.5, minWidth: 110,
      sortValue: (i: any) => String(i.BARKOD || ''),
      render: (i: any) => i.BARKOD
        ? <Text style={{ fontSize: 11, color: colors.primary }} numberOfLines={1}>{i.BARKOD}</Text>
        : <Text style={{ fontSize: 12, color: colors.textSecondary }}>-</Text>,
    },
  ], [colors, t]);

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
          <Text style={[{ color: colors.textSecondary, fontSize: 15 }]}>Veri kaynağı seçilmedi</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('stock_management')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.success + '20' }]} onPress={openScanner}>
            <Ionicons name="barcode-outline" size={20} color={colors.success} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.primary + '20' }]} onPress={() => setShowFilterModal(true)}>
            <Ionicons name="filter" size={20} color={colors.primary} />
            {activeFilterCount > 0 && <View style={[styles.badge, { backgroundColor: colors.primary }]}><Text style={styles.badgeText}>{activeFilterCount}</Text></View>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Price Name Selector */}
      <TouchableOpacity style={[styles.priceSelector, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setShowPriceModal(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Ionicons name="pricetag-outline" size={16} color={colors.primary} />
          <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 }]} numberOfLines={1}>
            {loading ? t('loading') : selectedPriceLabel}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput style={[styles.searchText, { color: colors.text }]} placeholder={t('search_stock_placeholder')} placeholderTextColor={colors.textSecondary} value={searchQuery} onChangeText={setSearchQuery} />
          {searchQuery ? <TouchableOpacity onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={18} color={colors.textSecondary} /></TouchableOpacity> : null}
        </View>
      </View>

      {/* Active Filters */}
      {activeFilterCount > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center', paddingRight: 60 }}>
            {filterGroups.map((g) => (
              <View key={`g-${g}`} style={[styles.chip, { backgroundColor: colors.primary + '15' }]}>
                <Text style={[styles.chipText, { color: colors.primary }]}>{g}</Text>
                <TouchableOpacity onPress={() => toggleGroup(g)}><Ionicons name="close" size={12} color={colors.primary} /></TouchableOpacity>
              </View>
            ))}
            {filterProfit !== 'all' ? <View style={[styles.chip, { backgroundColor: filterProfit === 'profit' ? colors.success + '15' : colors.error + '15' }]}><Text style={[styles.chipText, { color: filterProfit === 'profit' ? colors.success : colors.error }]}>{filterProfit === 'profit' ? t('profitable') : t('unprofitable')}</Text><TouchableOpacity onPress={() => setFilterProfit('all')}><Ionicons name="close" size={12} color={filterProfit === 'profit' ? colors.success : colors.error} /></TouchableOpacity></View> : null}
            {filterQty !== 'all' ? <View style={[styles.chip, { backgroundColor: (filterQty === 'negative' ? colors.error : colors.warning) + '15' }]}><Text style={[styles.chipText, { color: filterQty === 'negative' ? colors.error : colors.warning }]}>{filterQty === 'negative' ? 'Eksi Stok' : filterQty === 'low' ? t('low_stock_label') : filterQty === 'mid' ? t('mid_stock_label') : t('high_stock_label')}</Text><TouchableOpacity onPress={() => setFilterQty('all')}><Ionicons name="close" size={12} color={filterQty === 'negative' ? colors.error : colors.warning} /></TouchableOpacity></View> : null}
            {filterKdvs.map((k) => (
              <View key={`k-${k}`} style={[styles.chip, { backgroundColor: colors.info + '15' }]}>
                <Text style={[styles.chipText, { color: colors.info }]}>KDV %{k}</Text>
                <TouchableOpacity onPress={() => toggleKdv(k)}><Ionicons name="close" size={12} color={colors.info} /></TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={{ position: 'absolute', right: 16, top: 4, backgroundColor: colors.error + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }} onPress={() => { setFilterGroups([]); setFilterProfit('all'); setFilterQty('all'); setFilterKdvs([]); }}>
            <Text style={[{ fontSize: 12, color: colors.error, fontWeight: '700' }]}>{t('clear')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>
          {stockLoading
            ? t('loading_pos')
            : (() => {
                const total = loadProgress?.total || stockList.length;
                if (loadProgress && loadProgress.loaded < loadProgress.total) {
                  return `${loadProgress.loaded.toLocaleString('tr-TR')} / ${loadProgress.total.toLocaleString('tr-TR')} ${t('product_singular')}`;
                }
                if (searchQuery && filteredStocks.length !== total) {
                  return `${filteredStocks.length.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} ${t('product_singular')}`;
                }
                return `${total.toLocaleString('tr-TR')} ${t('product_singular')}`;
              })()
          }
        </Text>
        {manualToast && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#10B981' + '20', borderWidth: 1, borderColor: '#10B981' }}>
            <Ionicons name="checkmark-circle" size={12} color={'#10B981'} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#10B981' }}>
              Güncellendi · {new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
      </View>

      {/* Top progress bar — visible only while streaming */}
      {loadProgress && loadProgress.loaded < loadProgress.total && (
        <View style={{ height: 2, marginHorizontal: 16, backgroundColor: colors.border, borderRadius: 1, overflow: 'hidden' }}>
          <View
            style={{
              height: 2,
              width: `${Math.min(100, (loadProgress.loaded / Math.max(1, loadProgress.total)) * 100)}%`,
              backgroundColor: colors.primary,
            }}
          />
        </View>
      )}

      {stockLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_stock_list')}</Text>
        </View>
      ) : isDesktop ? (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 16 }}>
          <DataTable
            data={filteredStocks}
            columns={desktopStockColumns}
            keyExtractor={(item: any, idx) => String(item?.KOD || item?.STOK_KODU || item?.ID || idx)}
            onRowPress={(item) => openStockDetail(item)}
            refreshing={refreshing}
            onRefresh={onRefresh}
            estimatedItemSize={44}
            dense
            ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="cube-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>{t('no_stock_found')}</Text></View>}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* 2026-05-06 — Switched FlashList → FlatList to eliminate the recycler
              "boşluk" bug that left empty vertical gaps after dynamic filtering /
              search. FlatList handles variable-height items natively and is
              perfectly fast for this dataset size. */}
          <FlatList
          ref={listRef as any}
          data={filteredStocks}
          renderItem={renderStockItem}
          keyExtractor={(item: any, idx) => String(item?.KOD || item?.STOK_KODU || item?.ID || idx)}
          extraData={`${searchQuery}|${filterQty}|${filterProfit}|${filterGroups.length}|${filterKdvs.length}|${filterMarkalar.length}|${filterCinsler.length}|${filterOzelKod1.length}|${filterOzelKod2.length}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={12}
          windowSize={11}
          removeClippedSubviews={Platform.OS === 'android'}
          updateCellsBatchingPeriod={40}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            const layoutH = e.nativeEvent.layoutMeasurement.height;
            setShowScrollUp(y > layoutH * 0.8);
            setShowScrollDown(y < (e.nativeEvent.contentSize.height - layoutH * 1.5));
          }}
          scrollEventThrottle={250}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="cube-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>{t('no_stock_found')}</Text></View>}
        />
        {/* 2026-05-05 — Filter spinner overlay (light, non-blocking) */}
        {isFiltering && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }}>{t('loading') || 'Yükleniyor...'}</Text>
          </View>
        )}
        </View>
      )}

      {/* Floating scroll buttons
          2026-05-05 — Use animated:false on Android FlashList to avoid the
          "siyah ekran" glitch reported when scrolling back to top. The
          recycler briefly drops all rendered cells while it animates and
          flashes the empty/black background. Instant jump = no glitch. */}
      <ScrollFab
        showUp={showScrollUp}
        showDown={showScrollDown && filteredStocks.length > 20}
        onUp={() => listRef.current?.scrollToOffset?.({ offset: 0, animated: false })}
        onDown={() => listRef.current?.scrollToEnd?.({ animated: false })}
        primaryColor={colors.primary}
        bottomOffset={100}
      />

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent onRequestClose={() => setShowFilterModal(false)}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border }]]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <Ionicons name="options" size={22} color={colors.primary} />
                <Text style={[styles.modalTitle, { color: colors.text, flex: 0 }]}>{t('filters')}</Text>
                {activeFilterCount > 0 && (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.primary }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>{activeFilterCount} aktif</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 12 }} contentContainerStyle={{ paddingBottom: 100 }}>
              {/* Grup — multi-select */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="folder" size={16} color={colors.primary} />
                  <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>
                    {t('stock_group')}
                  </Text>
                  {filterGroups.length > 0 && (
                    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.primary + '25' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: colors.primary }}>{filterGroups.length}</Text>
                    </View>
                  )}
                </View>
                {filterGroups.length > 0 && (
                  <TouchableOpacity onPress={() => setFilterGroups([])} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.error + '15' }}>
                    <Text style={{ fontSize: 11, color: colors.error, fontWeight: '700' }}>Temizle</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                {groups.map(g => {
                  const on = filterGroups.includes(g);
                  return (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.filterChip,
                        on
                          ? { backgroundColor: colors.primary, borderColor: colors.primary }
                          : { borderColor: colors.border, backgroundColor: colors.card },
                      ]}
                      onPress={() => toggleGroup(g)}
                      activeOpacity={0.7}
                    >
                      {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                      <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]}>{g}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Kar/Zarar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Ionicons name="trending-up" size={16} color={colors.success} />
                <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>{t('profit_loss')}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
                {[{ k: 'all' as const, l: t('all'), c: colors.textSecondary }, { k: 'profit' as const, l: t('profitable'), c: colors.success }, { k: 'loss' as const, l: t('unprofitable'), c: colors.error }].map(o => {
                  const on = filterProfit === o.k;
                  return (
                    <TouchableOpacity key={o.k} style={[styles.filterChip, on ? { backgroundColor: o.c, borderColor: o.c } : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setFilterProfit(o.k)} activeOpacity={0.7}>
                      {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                      <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]}>{o.l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Miktar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Ionicons name="cube" size={16} color={colors.warning} />
                <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>{t('quantity')}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {[{ k: 'all' as const, l: t('all') }, { k: 'negative' as const, l: 'Eksi (<0)' }, { k: 'low' as const, l: '<10' }, { k: 'mid' as const, l: '10-100' }, { k: 'high' as const, l: '100+' }].map(o => {
                  const on = filterQty === o.k;
                  const negative = o.k === 'negative';
                  return (
                    <TouchableOpacity key={o.k} style={[styles.filterChip, on ? (negative ? { backgroundColor: colors.error, borderColor: colors.error } : { backgroundColor: colors.warning, borderColor: colors.warning }) : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setFilterQty(o.k)} activeOpacity={0.7}>
                      {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                      <Text style={[{ fontSize: 12, color: on ? '#fff' : (negative ? colors.error : colors.text), fontWeight: on ? '700' : '500' }]}>{o.l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* KDV — multi-select */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="receipt" size={16} color={colors.info} />
                  <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>
                    {t('vat_rate')}
                  </Text>
                  {filterKdvs.length > 0 && (
                    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.info + '25' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: colors.info }}>{filterKdvs.length}</Text>
                    </View>
                  )}
                </View>
                {filterKdvs.length > 0 && (
                  <TouchableOpacity onPress={() => setFilterKdvs([])} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.error + '15' }}>
                    <Text style={{ fontSize: 11, color: colors.error, fontWeight: '700' }}>Temizle</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
                {kdvValues.map(k => {
                  const on = filterKdvs.includes(k);
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[
                        styles.filterChip,
                        on ? { backgroundColor: colors.info, borderColor: colors.info } : { borderColor: colors.border, backgroundColor: colors.card },
                      ]}
                      onPress={() => toggleKdv(k)}
                      activeOpacity={0.7}
                    >
                      {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                      <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]}>%{k}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Marka — multi-select */}
              {uniqueMarkalar.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="bookmark" size={16} color={colors.success} />
                    <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>Marka</Text>
                    {filterMarkalar.length > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.success + '25' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.success }}>{filterMarkalar.length}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                    {uniqueMarkalar.slice(0, 80).map(m => {
                      const on = filterMarkalar.includes(m);
                      return (
                        <TouchableOpacity key={m} style={[styles.filterChip, on ? { backgroundColor: colors.success, borderColor: colors.success } : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => toggleInList(filterMarkalar, setFilterMarkalar, m)} activeOpacity={0.7}>
                          {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                          <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]} numberOfLines={1}>{m}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Cins — multi-select */}
              {uniqueCinsler.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="apps" size={16} color={colors.warning} />
                    <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>Cins</Text>
                    {filterCinsler.length > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.warning + '25' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.warning }}>{filterCinsler.length}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                    {uniqueCinsler.slice(0, 80).map(c => {
                      const on = filterCinsler.includes(c);
                      return (
                        <TouchableOpacity key={c} style={[styles.filterChip, on ? { backgroundColor: colors.warning, borderColor: colors.warning } : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => toggleInList(filterCinsler, setFilterCinsler, c)} activeOpacity={0.7}>
                          {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                          <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]} numberOfLines={1}>{c}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Atama Baremi 1 (Stok Özel Kod 1) — multi-select */}
              {uniqueOzelKod1.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="pricetag" size={16} color={colors.primary} />
                    <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>Atama Baremi 1</Text>
                    {filterOzelKod1.length > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.primary + '25' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.primary }}>{filterOzelKod1.length}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                    {uniqueOzelKod1.slice(0, 60).map(o => {
                      const on = filterOzelKod1.includes(o);
                      return (
                        <TouchableOpacity key={o} style={[styles.filterChip, on ? { backgroundColor: colors.primary, borderColor: colors.primary } : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => toggleInList(filterOzelKod1, setFilterOzelKod1, o)} activeOpacity={0.7}>
                          {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                          <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]} numberOfLines={1}>{o}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Atama Baremi 2 (Stok Özel Kod 2) — multi-select */}
              {uniqueOzelKod2.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="pricetags" size={16} color={colors.info} />
                    <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>Atama Baremi 2</Text>
                    {filterOzelKod2.length > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.info + '25' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.info }}>{filterOzelKod2.length}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
                    {uniqueOzelKod2.slice(0, 60).map(o => {
                      const on = filterOzelKod2.includes(o);
                      return (
                        <TouchableOpacity key={o} style={[styles.filterChip, on ? { backgroundColor: colors.info, borderColor: colors.info } : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => toggleInList(filterOzelKod2, setFilterOzelKod2, o)} activeOpacity={0.7}>
                          {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                          <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]} numberOfLines={1}>{o}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </ScrollView>
            {/* Sticky bottom apply bar */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 0.4, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.error + '15' }}
                onPress={() => { setFilterGroups([]); setFilterProfit('all'); setFilterQty('all'); setFilterKdvs([]); setFilterMarkalar([]); setFilterCinsler([]); setFilterOzelKod1([]); setFilterOzelKod2([]); }}
                activeOpacity={0.8}
              >
                <Text style={{ color: colors.error, fontWeight: '800' }}>Hepsini Sıfırla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 0.6, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary }}
                onPress={() => setShowFilterModal(false)}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>{t('apply')} {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Price Name Modal */}
      <Modal visible={showPriceModal} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent onRequestClose={() => setShowPriceModal(false)}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[
            { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
            Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border, maxWidth: 480, maxHeight: '70%' }],
          ]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Fiyat Adı Seç</Text>
              <TouchableOpacity onPress={() => setShowPriceModal(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }}>
              {priceNames.map((pn: any, idx: number) => {
                const sel = String(pn.ID) === selectedPriceName || String(pn.AD) === selectedPriceName;
                return (
                  <TouchableOpacity key={idx} style={[styles.priceOpt, { backgroundColor: sel ? colors.primary + '15' : colors.card, borderColor: sel ? colors.primary : colors.border }]}
                    onPress={() => { setSelectedPriceName(String(pn.ID || pn.AD || '')); setShowPriceModal(false); }}>
                    <Text style={[{ fontSize: 14, fontWeight: sel ? '700' : '500', color: sel ? colors.primary : colors.text }]}>{pn.AD || `Fiyat #${pn.ID}`}</Text>
                    {sel && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Barcode Scanner */}
      <Modal visible={showScanner} animationType="slide" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr'] }} onBarcodeScanned={handleBarCodeScanned} />
          <View style={{ position: 'absolute', top: 50, left: 0, right: 0, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Barkod Okutun</Text>
          </View>
          <TouchableOpacity style={{ position: 'absolute', top: 50, right: 20 }} onPress={() => setShowScanner(false)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Stock Detail Modal */}
      <Modal visible={!!selectedStock} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent onRequestClose={() => { setSelectedStock(null); setDetailMiktar([]); setDetailExtre([]); }}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktopWide, { borderColor: colors.border, maxWidth: 900 }]]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>{selectedStock?.AD || selectedStock?.STOK_ADI || t('stock_label')}</Text>
              <TouchableOpacity onPress={() => { setSelectedStock(null); setDetailMiktar([]); setDetailExtre([]); }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            {selectedStock && (
              <View style={[{ padding: 12, backgroundColor: colors.primary + '08', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{selectedStock.KOD || ''} · Barkod: {selectedStock.BARKOD || '-'}</Text>
                <View style={{ flexDirection: 'row', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                  <View><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>Satış</Text><Text style={[{ fontSize: 16, fontWeight: '700', color: colors.primary }]}>₺{parseFloat(selectedStock.FIYAT || '0').toFixed(2)}</Text></View>
                  {parseFloat(selectedStock.SON_ALIS_FIYAT || '0') > 0 && <View><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>Alış</Text><Text style={[{ fontSize: 16, fontWeight: '700', color: colors.warning }]}>₺{parseFloat(selectedStock.SON_ALIS_FIYAT || '0').toFixed(2)}</Text></View>}
                  {selectedStock.KDV_PAREKENDE && <View><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>KDV</Text><Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text }]}>%{String(selectedStock.KDV_PAREKENDE).replace('.00','')}</Text></View>}
                  <View><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('stock_label')}</Text><Text style={[{ fontSize: 16, fontWeight: '700', color: parseFloat(selectedStock.MIKTAR || '0') > 0 ? colors.success : colors.error }]}>{parseFloat(selectedStock.MIKTAR || '0').toFixed(2)}</Text></View>
                </View>
              </View>
            )}
            <View style={[{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <TouchableOpacity style={[styles.tab, detailTab === 'miktar' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} onPress={() => setDetailTab('miktar')}>
                <Text style={[{ fontSize: 13, fontWeight: '600', color: detailTab === 'miktar' ? colors.primary : colors.textSecondary }]}>{t('quantity')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tab, detailTab === 'extre' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} onPress={() => setDetailTab('extre')}>
                <Text style={[{ fontSize: 13, fontWeight: '600', color: detailTab === 'extre' ? colors.primary : colors.textSecondary }]}>{t('statement')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {detailLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>POS'tan veri alınıyor...</Text></View>
              ) : detailTab === 'miktar' ? (
                detailMiktar.length > 0 ? <View style={{ padding: 16 }}>{detailMiktar.map((loc: any, idx: number) => (
                  <View key={idx} style={[styles.miktarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 }]}>{loc.AD || t('location_label')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {[{ k: 'MIKTAR', l: t('available'), c: colors.text }, { k: 'MIKTAR_GIRIS', l: t('in'), c: colors.success }, { k: 'MIKTAR_CIKIS', l: t('out'), c: colors.error }, { k: 'SATIS', l: t('sales_short'), c: colors.primary }].map(f => (
                        <View key={f.k} style={{ minWidth: 70 }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{f.l}</Text><Text style={[{ fontSize: 14, fontWeight: '700', color: f.c }]}>{parseFloat(loc[f.k] || '0').toFixed(2)}</Text></View>
                      ))}
                    </View>
                  </View>
                ))}</View> : <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>Miktar bilgisi bulunamadı</Text></View>
              ) : (
                detailExtre.length > 0 ? <View style={{ padding: 12 }}>
                  {/* 2026-05-12 — Tarih filtresi (Native DatePicker) */}
                  <View style={{
                    flexDirection: 'row', gap: 8, marginBottom: 10,
                    padding: 10, backgroundColor: colors.background,
                    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
                  }}>
                    <DateField
                      value={extreStart}
                      onChange={setExtreStart}
                      label="Başlangıç"
                      maxDate={extreEnd}
                      colors={colors}
                    />
                    <DateField
                      value={extreEnd}
                      onChange={setExtreEnd}
                      label="Bitiş"
                      minDate={extreStart}
                      colors={colors}
                    />
                  </View>

                  {/* Sayım özet */}
                  <Text style={[{ fontSize: 10, color: colors.textSecondary, marginBottom: 6 }]}>
                    {filteredExtre.length} / {detailExtre.length} hareket
                  </Text>

                  {/* Export buttons for ekstre */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <TouchableOpacity disabled={exportLoading} style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.error + '15', opacity: exportLoading ? 0.5 : 1 }]} onPress={async () => {
                      setExportLoading(true); showToast('PDF hazırlanıyor...');
                      const name = selectedStock?.AD || t('stock_label');
                      const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;font-size:11px}th{background:#f5f5f5}</style></head><body><h2>${name} - Stok Ekstre (${extreStart} → ${extreEnd})</h2><table><thead><tr><th>Tarih</th><th>Belge No</th><th>Lokasyon</th><th>Cari</th><th>Fiş Türü</th><th>Giriş</th><th>Çıkış</th><th>Bakiye</th></tr></thead><tbody>${filteredExtre.map((r:any) => `<tr><td>${r.TARIH||''}</td><td>${r.BELGENO||''}</td><td>${r.LOKASYON_AD||''}</td><td>${r.CARI_AD||''}</td><td>${r.FIS_TURU||''}</td><td>${parseFloat(r.MIKTAR_GIRIS||'0').toFixed(2)}</td><td>${parseFloat(r.MIKTAR_CIKIS||'0').toFixed(2)}</td><td>${parseFloat(r.BAKIYE||'0').toFixed(2)}</td></tr>`).join('')}</tbody></table></body></html>`;
                      try { const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf' }); showToast('PDF oluşturuldu'); } catch(e) { console.error('PDF error:', e); showToast('PDF oluşturulamadı'); }
                      finally { setExportLoading(false); }
                    }}>
                      {exportLoading ? <ActivityIndicator size="small" color={colors.error} /> : <Ionicons name="document-text-outline" size={14} color={colors.error} />}
                      <Text style={[{ fontSize: 11, color: colors.error, fontWeight: '600' }]}>PDF</Text>
                    </TouchableOpacity>
                  </View>
                  {filteredExtre.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                      <Text style={[{ color: colors.textSecondary, fontSize: 12 }]}>Bu tarih aralığında hareket yok</Text>
                    </View>
                  ) : (
                  filteredExtre.map((row: any, idx: number) => {
                    // 2026-05-12 — Stok extre POS alanları:
                    //   - FIS_ID: gerçek fiş id (pozitif int)
                    //   - FIS_TURU: "Satış fişi", "Tahsilat", "Alış fişi", "Çek Ödeme" vb.
                    //   - FIS_DETAY: satır id (kullanmıyoruz)
                    const fisIdVal = row.FIS_ID || row.BELGE_ID || row.KAYIT_ID || row.ID || row.BELGEID;
                    const fisIdNum = Number(fisIdVal);
                    const fisTuruStr = String(row.FIS_TURU || row.ACIKLAMA || '').toLowerCase().trim();
                    const isInfoRow = (
                      fisIdNum <= 0
                      || fisTuruStr.includes('devir') || fisTuruStr.includes('devreden')
                      || fisTuruStr.includes('açılış') || fisTuruStr.includes('acilis')
                      || fisTuruStr.includes('düzeltme') || fisTuruStr.includes('duzeltme')
                      || fisTuruStr.includes('tahsilat') || fisTuruStr.includes('tahsilât')
                      || fisTuruStr.includes('ödeme') || fisTuruStr.includes('odeme')
                      || fisTuruStr.includes('tediye')
                      || fisTuruStr.includes('çek') || (fisTuruStr.match(/\bcek\b/) !== null)
                      || fisTuruStr.includes('senet')
                      || fisTuruStr.includes('havale') || fisTuruStr.includes('eft')
                      || fisTuruStr.includes('virman') || fisTuruStr.includes('mahsup')
                    );
                    const hasFis = !isInfoRow && !!fisIdVal
                      && String(fisIdVal).trim() !== '' && String(fisIdVal) !== '0' && String(fisIdVal) !== '-1'
                      && String(fisIdVal).toLowerCase() !== 'null';
                    return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.extreRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: hasFis ? 1 : 0.85 }]}
                    onPress={() => { if (hasFis) openFisDetail(row); }}
                    activeOpacity={hasFis ? 0.7 : 1}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                      <Text style={[{ fontSize: 11, fontWeight: '600', color: colors.text }]}>{row.TARIH || ''}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{row.FIS_TURU || ''}</Text>
                        {hasFis && <Ionicons name="chevron-forward" size={12} color={colors.primary} />}
                      </View>
                    </View>
                    <Text style={[{ fontSize: 11, color: colors.textSecondary, marginBottom: 3 }]} numberOfLines={1}>{row.CARI_AD || row.ACIKLAMA || row.LOKASYON_AD || '-'}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {parseFloat(row.MIKTAR_GIRIS || '0') > 0 && <Text style={[{ fontSize: 11, color: colors.success }]}>+{parseFloat(row.MIKTAR_GIRIS).toFixed(2)}</Text>}
                        {parseFloat(row.MIKTAR_CIKIS || '0') > 0 && <Text style={[{ fontSize: 11, color: colors.error }]}>-{parseFloat(row.MIKTAR_CIKIS).toFixed(2)}</Text>}
                      </View>
                      <Text style={[{ fontSize: 11, fontWeight: '700', color: colors.text }]}>Bakiye: {parseFloat(row.BAKIYE || '0').toFixed(2)}</Text>
                    </View>
                  </TouchableOpacity>
                    );
                  })
                  )}
                </View> : <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>Ekstre bulunamadı</Text></View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 2026-05-12 — Fiş Detay Modal (Stok ekstre satırına tıklayınca açılır) */}
      <Modal visible={!!selectedFis} animationType="slide" transparent statusBarTranslucent onRequestClose={() => { setSelectedFis(null); setFisDetail([]); setFisTotals(null); }}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                  Fiş Detayı
                </Text>
                {selectedFis && (
                  <Text style={[{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
                    {selectedFis.TARIH || ''} · {selectedFis.FIS_TURU || ''} · {selectedFis.BELGENO || ''}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => { setSelectedFis(null); setFisDetail([]); setFisTotals(null); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {fisLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>POS'tan veri alınıyor...</Text>
                </View>
              ) : fisDetail.length > 0 ? (
                <View style={{ padding: 12 }}>
                  {fisDetail.map((item: any, idx: number) => (
                    <View key={idx} style={{
                      padding: 10, marginBottom: 6, borderRadius: 8,
                      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                    }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.text, flex: 1 }]} numberOfLines={1}>
                          {item.STOK || 'Ürün'}
                        </Text>
                        <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.primary }]}>
                          ₺{parseFloat(item.DAHIL_TUTAR || item.TUTAR || '0').toFixed(2)}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                        {item.BIRIM ? <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{item.BIRIM}</Text> : null}
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>Miktar: {parseFloat(item.MIKTAR_FIS || '0').toFixed(2)}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>Fiyat: ₺{parseFloat(item.DAHIL_FIYAT || item.FIYAT || '0').toFixed(2)}</Text>
                        {parseFloat(item.ISKONTO || '0') > 0 && <Text style={[{ fontSize: 10, color: colors.warning }]}>İsk: %{parseFloat(item.ISKONTO).toFixed(1)}</Text>}
                      </View>
                    </View>
                  ))}
                  {fisTotals && (
                    <View style={{
                      margin: 4, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
                      padding: 12, gap: 4, backgroundColor: colors.primary + '10',
                    }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={[{ color: colors.textSecondary, fontSize: 12 }]}>Satır Toplam</Text>
                        <Text style={[{ fontWeight: '600', color: colors.text, fontSize: 12 }]}>₺{parseFloat(fisTotals.SATIR_TOPLAM || '0').toFixed(2)}</Text>
                      </View>
                      {parseFloat(fisTotals.FIS_ISKONTO_TOPLAM || '0') > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={[{ color: colors.textSecondary, fontSize: 12 }]}>Fiş İskonto</Text>
                          <Text style={[{ fontWeight: '600', color: colors.warning, fontSize: 12 }]}>₺{parseFloat(fisTotals.FIS_ISKONTO_TOPLAM).toFixed(2)}</Text>
                        </View>
                      )}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={[{ color: colors.textSecondary, fontSize: 12 }]}>KDV</Text>
                        <Text style={[{ fontWeight: '600', color: colors.text, fontSize: 12 }]}>₺{parseFloat(fisTotals.KDV_TOPLAM || '0').toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, marginTop: 4 }}>
                        <Text style={[{ fontSize: 15, fontWeight: '800', color: colors.text }]}>Genel Toplam</Text>
                        <Text style={[{ fontSize: 16, fontWeight: '800', color: colors.primary }]}>₺{parseFloat(fisTotals.GENELTOPLAM || '0').toFixed(2)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Text style={[{ color: colors.textSecondary }]}>Fiş detayı bulunamadı</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 2026-05-12 — Tarih seçimi artık DateField bileşeni ile yapılıyor (yukarıda inline) */}

      {/* Export Loading Overlay */}
      {exportLoading && (
        <View style={styles.exportOverlay}>
          <View style={[styles.exportBox, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12 }]}>Dışa aktarılıyor...</Text>
          </View>
        </View>
      )}

      {/* Toast */}
      {toastVisible && (
        <View style={[styles.toast, { backgroundColor: colors.text }]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={[{ color: '#fff', fontSize: 13, fontWeight: '600' }]}>{toastMsg}</Text>
        </View>
      )}
      <CustomAlert {...alertProps} />

      {/* 2026-05-05 — Eksi Stok Özeti modal (push deep-link target) */}
      <NegativeStockModal
        visible={showNegativeStockModal}
        onClose={() => setShowNegativeStockModal(false)}
        items={stockList}
        loading={stockLoading}
        tenantName={
          user?.tenants?.find?.((x: any) => x.tenant_id === activeTenantId)?.name
          || user?.tenants?.find?.((x: any) => x.tenant_id === activeTenantId)?.tenant_name
          || ''
        }
        onItemPress={(item) => {
          setShowNegativeStockModal(false);
          // Tiny delay so the modal close animation completes before opening detail
          setTimeout(() => openStockDetail(item as any), 250);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  priceSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  searchContainer: { paddingHorizontal: 16, paddingTop: 8 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 6 },
  searchText: { flex: 1, fontSize: 13 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipText: { fontSize: 12, fontWeight: '600' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  stockCard: { borderRadius: 10, borderWidth: 1, marginBottom: 8, overflow: 'hidden', ...Platform.select({ web: { boxShadow: '0 1px 3px rgba(15,23,42,0.04), 0 1px 2px rgba(15,23,42,0.06)' }, default: {} }) },
  stockCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 10, gap: 10 },
  stockName: { fontSize: 13, fontWeight: '600' },
  stockCode: { fontSize: 11, marginTop: 1 },
  stockPrice: { fontSize: 15, fontWeight: '700' },
  detailRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: 1, gap: 12, flexWrap: 'wrap' },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailLabel: { fontSize: 11 },
  detailValue: { fontSize: 12, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  filterLabel: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  filterChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#ddd' },
  fabBtn: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  priceOpt: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  miktarCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  extreRow: { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 4 },
  toast: { position: 'absolute', bottom: 90, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, zIndex: 9999 },
  exportOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 9998 },
  exportBox: { borderRadius: 16, padding: 30, alignItems: 'center', minWidth: 200 },
});
