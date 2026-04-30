import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal,
  ScrollView, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { ScrollFab } from '../../src/components/ScrollFab';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function StockScreen() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { showError, showWarning, alertProps } = useAlert();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

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
  const [filterQty, setFilterQty] = useState<'all' | 'low' | 'mid' | 'high'>('all');
  const [filterKdvs, setFilterKdvs] = useState<string[]>([]);       // multi-select

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

  // Filtered list
  const filteredStocks = useMemo(() => {
    let list = stockList;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s: any) =>
        (s.AD || '').toLowerCase().includes(q) ||
        (s.KOD || '').toLowerCase().includes(q) ||
        (s.BARKOD || '').includes(q)
      );
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
    if (filterKdvs.length > 0) list = list.filter((s: any) => {
      const v = String(s.KDV_PAREKENDE || s.KDV || '').replace('.00', '');
      return filterKdvs.includes(v);
    });
    return list;
  }, [stockList, searchQuery, filterGroups, filterProfit, filterQty, filterKdvs]);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filterGroups.length > 0) c++;
    if (filterProfit !== 'all') c++;
    if (filterQty !== 'all') c++;
    if (filterKdvs.length > 0) c++;
    return c;
  }, [filterGroups, filterProfit, filterQty, filterKdvs]);

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

    return (
      <TouchableOpacity
        style={[styles.stockCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => openStockDetail(item)}
        activeOpacity={0.7}
      >
        {/* Üst satır: İsim + Fiyat */}
        <View style={styles.stockCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.stockName, { color: colors.text }]} numberOfLines={2}>{name}</Text>
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

        {/* Alt satır: Alış + Kar + Barkod */}
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
      </TouchableOpacity>
    );
  }, [colors, openStockDetail]);

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
            {filterQty !== 'all' ? <View style={[styles.chip, { backgroundColor: colors.warning + '15' }]}><Text style={[styles.chipText, { color: colors.warning }]}>{filterQty === 'low' ? t('low_stock_label') : filterQty === 'mid' ? t('mid_stock_label') : t('high_stock_label')}</Text><TouchableOpacity onPress={() => setFilterQty('all')}><Ionicons name="close" size={12} color={colors.warning} /></TouchableOpacity></View> : null}
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
      ) : (
        <FlashList
          ref={listRef as any}
          data={filteredStocks}
          renderItem={renderStockItem}
          keyExtractor={(item: any, idx) => String(item?.KOD || item?.STOK_KODU || item?.ID || idx)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          drawDistance={800}
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
      )}

      {/* Floating scroll buttons */}
      <ScrollFab
        showUp={showScrollUp}
        showDown={showScrollDown && filteredStocks.length > 20}
        onUp={() => listRef.current?.scrollToOffset?.({ offset: 0, animated: true })}
        onDown={() => listRef.current?.scrollToEnd?.({ animated: true })}
        primaryColor={colors.primary}
        bottomOffset={100}
      />

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
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
                {[{ k: 'all' as const, l: t('all') }, { k: 'low' as const, l: '<10' }, { k: 'mid' as const, l: '10-100' }, { k: 'high' as const, l: '100+' }].map(o => {
                  const on = filterQty === o.k;
                  return (
                    <TouchableOpacity key={o.k} style={[styles.filterChip, on ? { backgroundColor: colors.warning, borderColor: colors.warning } : { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setFilterQty(o.k)} activeOpacity={0.7}>
                      {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                      <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]}>{o.l}</Text>
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
            </ScrollView>
            {/* Sticky bottom apply bar */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 0.4, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.error + '15' }}
                onPress={() => { setFilterGroups([]); setFilterProfit('all'); setFilterQty('all'); setFilterKdvs([]); }}
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
      <Modal visible={showPriceModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
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
      <Modal visible={!!selectedStock} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
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
                  {/* Export buttons for ekstre */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <TouchableOpacity disabled={exportLoading} style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.error + '15', opacity: exportLoading ? 0.5 : 1 }]} onPress={async () => {
                      setExportLoading(true); showToast('PDF hazırlanıyor...');
                      const name = selectedStock?.AD || t('stock_label');
                      const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;font-size:11px}th{background:#f5f5f5}</style></head><body><h2>${name} - Stok Ekstre</h2><table><thead><tr><th>Tarih</th><th>Belge No</th><th>Lokasyon</th><th>Cari</th><th>Fiş Türü</th><th>Giriş</th><th>Çıkış</th><th>Bakiye</th></tr></thead><tbody>${detailExtre.map((r:any) => `<tr><td>${r.TARIH||''}</td><td>${r.BELGENO||''}</td><td>${r.LOKASYON_AD||''}</td><td>${r.CARI_AD||''}</td><td>${r.FIS_TURU||''}</td><td>${parseFloat(r.MIKTAR_GIRIS||'0').toFixed(2)}</td><td>${parseFloat(r.MIKTAR_CIKIS||'0').toFixed(2)}</td><td>${parseFloat(r.BAKIYE||'0').toFixed(2)}</td></tr>`).join('')}</tbody></table></body></html>`;
                      try { const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf' }); showToast('PDF oluşturuldu'); } catch(e) { console.error('PDF error:', e); showToast('PDF oluşturulamadı'); }
                      finally { setExportLoading(false); }
                    }}>
                      {exportLoading ? <ActivityIndicator size="small" color={colors.error} /> : <Ionicons name="document-text-outline" size={14} color={colors.error} />}
                      <Text style={[{ fontSize: 11, color: colors.error, fontWeight: '600' }]}>PDF</Text>
                    </TouchableOpacity>
                  </View>
                  {detailExtre.map((row: any, idx: number) => (
                  <View key={idx} style={[styles.extreRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                      <Text style={[{ fontSize: 11, fontWeight: '600', color: colors.text }]}>{row.TARIH || ''}</Text>
                      <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{row.FIS_TURU || ''}</Text>
                    </View>
                    <Text style={[{ fontSize: 11, color: colors.textSecondary, marginBottom: 3 }]} numberOfLines={1}>{row.CARI_AD || row.ACIKLAMA || '-'}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {parseFloat(row.MIKTAR_GIRIS || '0') > 0 && <Text style={[{ fontSize: 11, color: colors.success }]}>+{parseFloat(row.MIKTAR_GIRIS).toFixed(2)}</Text>}
                        {parseFloat(row.MIKTAR_CIKIS || '0') > 0 && <Text style={[{ fontSize: 11, color: colors.error }]}>-{parseFloat(row.MIKTAR_CIKIS).toFixed(2)}</Text>}
                      </View>
                      <Text style={[{ fontSize: 11, fontWeight: '700', color: colors.text }]}>Bakiye: {parseFloat(row.BAKIYE || '0').toFixed(2)}</Text>
                    </View>
                  </View>
                ))}</View> : <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>Ekstre bulunamadı</Text></View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  stockCard: { borderRadius: 10, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
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
