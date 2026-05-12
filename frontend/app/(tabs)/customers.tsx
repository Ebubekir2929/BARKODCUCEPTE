import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal,
  ScrollView, ActivityIndicator, Alert, RefreshControl, Platform,
} from 'react-native';
import { webStyles } from '../../src/styles/webModalStyles';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { ScrollFab } from '../../src/components/ScrollFab';
import { useResponsive } from '../../src/hooks/useResponsive';
import { DataTable, TableColumn } from '../../src/components/DataTable';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const getDefDates = () => {
  // 2026-05-12 — Cari ekstre default tarih aralığı: içinde bulunulan ayın 1'i → bugün.
  // Önceden Ocak 1 → bugün idi; kullanıcı isteği üzerine güncel aydan başlatılıyor.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${d}` };
};

export default function CustomersScreen() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const { isDesktop } = useResponsive();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const idx = match ? parseInt(match[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'borclu' | 'alacakli'>('all');
  const [cariList, setCariList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [manualToast, setManualToast] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const cariAbortRef = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<any>(null);
  const [showScrollUp, setShowScrollUp] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  // 2026-05-05 — transient "filtering…" spinner shown right after search /
  // filter mutates while FlashList rebuilds its layout.
  const [isFiltering, setIsFiltering] = useState(false);
  const filterTimerRef = React.useRef<any>(null);

  // ⏹️ Cancel any in-flight POS request when leaving this screen
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        if (cariAbortRef.current) {
          cariAbortRef.current.abort();
          cariAbortRef.current = null;
        }
      };
    }, [])
  );

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    setRefreshNonce((n) => n + 1); // triggers fetch effect
    // give effect a tick to start
    await new Promise((r) => setTimeout(r, 150));
    setRefreshing(false);
    setManualToast(true);
    setTimeout(() => setManualToast(false), 2200);
  }, []);

  // Ekstre
  const [selectedCari, setSelectedCari] = useState<any | null>(null);
  const [extreData, setExtreData] = useState<any[]>([]);
  const [extreLoading, setExtreLoading] = useState(false);
  const [extreStart, setExtreStart] = useState(getDefDates().start);
  const [extreEnd, setExtreEnd] = useState(getDefDates().end);

  // Fiş
  const [selectedFis, setSelectedFis] = useState<any | null>(null);
  const [fisDetail, setFisDetail] = useState<any[]>([]);
  const [fisTotals, setFisTotals] = useState<any | null>(null);
  const [fisLoading, setFisLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const showToast = (msg: string) => { setToastMsg(msg); setToastVisible(true); setTimeout(() => setToastVisible(false), 2000); };

  // Fetch cari list with INCREMENTAL pagination — page 1 instant, rest streamed
  useEffect(() => {
    if (!activeTenantId) return;

    if (cariAbortRef.current) cariAbortRef.current.abort();
    const ctrl = new AbortController();
    cariAbortRef.current = ctrl;

    setLoading(true);
    setCariList([]);
    setLoadProgress(null);

    const PAGE_SIZE = 200;
    const { token } = useAuthStore.getState();

    const fetchPage = async (page: number) => {
      try {
        const resp = await fetch(`${API_URL}/api/data/cari-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          signal: ctrl.signal,
          body: JSON.stringify({ tenant_id: activeTenantId, page, page_size: PAGE_SIZE }),
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

    (async () => {
      try {
        const first = await fetchPage(1);
        if (ctrl.signal.aborted) return;
        if (!first || first.data.length === 0) {
          setLoading(false);
          return;
        }
        setCariList(first.data);
        setLoading(false);

        const totalPages = first.total_pages || 1;
        const totalCount = first.total_count || first.data.length;
        if (totalPages <= 1) return;
        setLoadProgress({ loaded: first.data.length, total: totalCount });

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
            if (r && (r as any).total_count > maxTotalSeen) maxTotalSeen = (r as any).total_count;
          });
          if (newRows.length > 0) {
            setCariList((prev) => [...prev, ...newRows]);
            setLoadProgress((prev) => {
              if (!prev) return null;
              const newLoaded = prev.loaded + newRows.length;
              const newTotal = Math.max(prev.total, maxTotalSeen, newLoaded);
              return { loaded: newLoaded, total: newTotal };
            });
          }
        }
        setLoadProgress(null);
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error(e);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
  }, [activeTenantId]);

  const [filterCities, setFilterCities] = useState<string[]>([]);    // multi-select şehir
  const [filterGroups, setFilterGroups] = useState<string[]>([]);    // multi-select cari grup
  const [showFilterModal, setShowFilterModal] = useState(false);

  // 2026-05-05 — Background auto-refresh (every 60s while on this screen).
  // Quietly hits the cache-aware /cariler endpoint, compares row count + a
  // sample hash, and swaps in the new data only if it actually differs.
  // No UI disruption while the user scrolls. Toast shows when applied.
  const [bgUpdatedToast, setBgUpdatedToast] = useState(false);
  useEffect(() => {
    if (!activeTenantId) return;
    let cancelled = false;
    const INTERVAL_MS = 60 * 1000;
    const _hashList = (rows: any[]) => `${rows.length}|${rows.slice(0, 3).map((r: any) => r.KOD || r.CARI_KODU || '').join(',')}|${rows.slice(-3).map((r: any) => r.KOD || r.CARI_KODU || r.BAKIYE || '').join(',')}`;
    const tick = async () => {
      if (cancelled || loading) return;
      try {
        const { token } = useAuthStore.getState();
        // 2026-05-05 — Use /cari-list with a large page_size for a single
        // cache-aware MySQL fetch.
        const r = await fetch(`${API_URL}/api/data/cari-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            tenant_id: activeTenantId,
            page: 1,
            page_size: 50000,
            force_refresh: false,
          }),
        });
        if (cancelled) return;
        const j = await r.json();
        if (!j.ok || !Array.isArray(j.data)) return;
        setCariList((prev) => {
          if (cancelled) return prev;
          const newSig = _hashList(j.data);
          const oldSig = _hashList(prev);
          if (newSig === oldSig) return prev;
          setBgUpdatedToast(true);
          setTimeout(() => setBgUpdatedToast(false), 2500);
          return j.data;
        });
      } catch { /* ignore poll errors */ }
    };
    const id = setInterval(tick, INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTenantId, loading]);

  // Compute unique cities & groups from the loaded list (for the filter modal)
  const uniqueCities = useMemo(() => {
    const s = new Set<string>();
    cariList.forEach((c: any) => { const v = String(c.SEHIR || c.IL || '').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }, [cariList]);
  const uniqueCariGroups = useMemo(() => {
    const s = new Set<string>();
    cariList.forEach((c: any) => { const v = String(c.GRUP || c.CARI_GRUP || c.GRUP_AD || '').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }, [cariList]);
  const toggleCariList = (current: string[], setter: (v: string[]) => void, val: string) => {
    setter(current.includes(val) ? current.filter(x => x !== val) : [...current, val]);
  };
  const cariActiveFilterCount = (filterType !== 'all' ? 1 : 0) + (filterCities.length > 0 ? 1 : 0) + (filterGroups.length > 0 ? 1 : 0);

  const filteredCaris = useMemo(() => {
    let f = cariList;
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const tokens = q.split(/\s+/).filter(Boolean);
      // 2026-05-03 — wider search across name, code, phone, city, tax id, address
      const haystackOf = (c: any) => [
        c.AD, c.CARI_ADI, c.UNVAN,
        c.KOD, c.CARI_KODU,
        c.TELEFON, c.TEL, c.GSM, c.CEP, c.MOBILE,
        c.SEHIR, c.ILCE, c.ULKE, c.ADRES,
        c.VERGI_NO, c.VERGI_DAIRESI, c.TC_KIMLIK,
        c.GRUP, c.CARI_GRUP, c.GRUP_AD,
        c.YETKILI, c.EMAIL, c.WEB,
        c.OZEL_KOD1, c.OZEL_KOD2, c.OZEL_KOD3,
      ].filter(Boolean).join(' ').toLowerCase();
      f = f.filter((c: any) => {
        const hay = haystackOf(c);
        return tokens.every(tok => hay.includes(tok));
      });
    }
    if (filterType === 'borclu') f = f.filter((c: any) => parseFloat(c.BAKIYE || '0') > 0);
    if (filterType === 'alacakli') f = f.filter((c: any) => parseFloat(c.BAKIYE || '0') < 0);
    if (filterCities.length > 0) f = f.filter((c: any) => filterCities.includes(c.SEHIR || c.IL || ''));
    if (filterGroups.length > 0) f = f.filter((c: any) => filterGroups.includes(c.GRUP || c.CARI_GRUP || c.GRUP_AD || ''));
    return f;
  }, [cariList, searchQuery, filterType, filterCities, filterGroups]);

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
  }, [searchQuery, filterType, filterCities, filterGroups]);

  const summary = useMemo(() => {
    let borc = 0, alacak = 0;
    cariList.forEach((c: any) => { const b = parseFloat(c.BAKIYE || '0'); if (b > 0) borc += b; else alacak += Math.abs(b); });
    return { borc, alacak, bakiye: borc - alacak, borcluCount: cariList.filter((c: any) => parseFloat(c.BAKIYE || '0') > 0).length, alacakliCount: cariList.filter((c: any) => parseFloat(c.BAKIYE || '0') < 0).length };
  }, [cariList]);

  // Ekstre totals
  const extreSummary = useMemo(() => {
    let borc = 0, alacak = 0;
    extreData.forEach((r: any) => { borc += parseFloat(r.BORC || '0'); alacak += parseFloat(r.ALACAK || '0'); });
    const lastBakiye = extreData.length > 0 ? parseFloat(extreData[extreData.length - 1].BAKIYE || '0') : 0;
    return { borc, alacak, bakiye: lastBakiye };
  }, [extreData]);

  // Open ekstre
  const openCariDetail = useCallback(async (cari: any, sDate?: string, eDate?: string) => {
    setSelectedCari(cari); setExtreData([]); setExtreLoading(true);
    const sd = sDate || extreStart; const ed = eDate || extreEnd;
    const cariId = cari.KART || cari.ID;
    if (!cariId || !activeTenantId) { setExtreLoading(false); return; }
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/cari-extre`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, cari_id: cariId, doviz_ad: cari.DOVIZ_AD_ID || 1, tarih_baslangic: sd, tarih_bitis: ed }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        // Sort by date ascending (en eski en üstte)
        const sorted = [...data.data].sort((a: any, b: any) => {
          const da = a.TARIH || ''; const db = b.TARIH || '';
          return da.localeCompare(db);
        });
        setExtreData(sorted);
      }
    } catch (err) { console.error(err); }
    finally { setExtreLoading(false); }
  }, [activeTenantId, extreStart, extreEnd]);

  const refreshExtre = () => { if (selectedCari) openCariDetail(selectedCari, extreStart, extreEnd); };

  // Open fiş detail
  const openFisDetail = useCallback(async (row: any) => {
    // 2026-05-12 — kart_extre_cari farklı POS sürümlerinde belge id'sini farklı
    // alan adlarıyla döndürebiliyor: BELGE_ID, FIS_ID, KAYIT_ID, ID. Hepsini sırasıyla dene.
    const fisId = row.BELGE_ID || row.FIS_ID || row.KAYIT_ID || row.ID || row.BELGEID;
    if (!fisId || !activeTenantId) {
      showToast('Bu satırın fiş detayı bulunamadı');
      return;
    }
    setSelectedFis(row); setFisDetail([]); setFisTotals(null); setFisLoading(true);
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/fis-detail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
    }
    finally { setFisLoading(false); }
  }, [activeTenantId]);

  // Export functions
  const exportExtrePdf = async () => {
    if (!selectedCari || extreData.length === 0) return;
    setExportLoading(true);
    const name = selectedCari.AD || selectedCari.CARI_ADI || t('customer');
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left}th{background:#f5f5f5}</style></head><body>
    <h2>${name} - Cari Ekstre</h2><p>${extreStart} / ${extreEnd}</p>
    <p>Toplam Borç: ₺${extreSummary.borc.toFixed(2)} | Toplam Alacak: ₺${extreSummary.alacak.toFixed(2)} | Bakiye: ₺${extreSummary.bakiye.toFixed(2)}</p>
    <table><thead><tr><th>Tarih</th><th>Belge No</th><th>Açıklama</th><th>{t('debt')}</th><th>{t('credit')}</th><th>Bakiye</th></tr></thead><tbody>
    ${extreData.map((r: any) => `<tr><td>${r.TARIH || ''}</td><td>${r.BELGENO || ''}</td><td>${r.ACIKLAMA || r.AD || ''}</td><td>${parseFloat(r.BORC || '0').toFixed(2)}</td><td>${parseFloat(r.ALACAK || '0').toFixed(2)}</td><td>${parseFloat(r.BAKIYE || '0').toFixed(2)}</td></tr>`).join('')}
    </tbody></table></body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('statement_pdf') });
      showToast('PDF oluşturuldu');
    } catch (err) { console.error(err); showToast('PDF oluşturulamadı'); }
    finally { setExportLoading(false); }
  };

  const exportExtreCsv = async () => {
    if (!selectedCari || extreData.length === 0) return;
    setExportLoading(true);
    const name = selectedCari.AD || selectedCari.CARI_ADI || t('customer');
    const html = `<html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #000;padding:4px;font-size:11px}</style></head><body><h3>${name} - Ekstre</h3><table><thead><tr><th>Tarih</th><th>Belge No</th><th>Açıklama</th><th>{t('debt')}</th><th>{t('credit')}</th><th>Bakiye</th></tr></thead><tbody>${extreData.map((r: any) => `<tr><td>${r.TARIH || ''}</td><td>${r.BELGENO || ''}</td><td>${r.ACIKLAMA || r.AD || ''}</td><td>${parseFloat(r.BORC || '0').toFixed(2)}</td><td>${parseFloat(r.ALACAK || '0').toFixed(2)}</td><td>${parseFloat(r.BAKIYE || '0').toFixed(2)}</td></tr>`).join('')}</tbody></table></body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${name} Excel` });
      showToast(t('excel_created'));
    } catch (err) { console.error('Excel error:', err); showToast(t('excel_error')); }
    finally { setExportLoading(false); }
  };

  const renderCariItem = useCallback(({ item }: { item: any }) => {
    const name = (item.AD || item.CARI_ADI || '').trim();
    const code = (item.KOD || item.CARI_KODU || '').trim();
    // 2026-05-12 — Boş satır guard'ı. POS'tan ara sıra ad/kod'u boş kayıt
    // gelebiliyor; bunlar UI'da boş kart olarak görünmemeli.
    if (!name && !code) return null;
    const bakiye = parseFloat(item.BAKIYE || '0');
    return (
      <TouchableOpacity style={[styles.cariCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => { setExtreStart(getDefDates().start); setExtreEnd(getDefDates().end); openCariDetail(item, getDefDates().start, getDefDates().end); }} activeOpacity={0.7}>
        <View style={styles.cariCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cariName, { color: colors.text }]} numberOfLines={1}>{name || t('customer')}</Text>
            <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{code}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.cariBakiye, { color: bakiye >= 0 ? colors.error : colors.success }]}>₺{Math.abs(bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
            <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{bakiye >= 0 ? t('debtor') : t('creditor')}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [colors, openCariDetail, t]);

  // 2026-05-05 — Desktop Data Table columns (standard layout).
  // Used only when `isDesktop` is true; phone/tablet keeps the card layout.
  const desktopCariColumns = useMemo<TableColumn<any>[]>(() => [
    {
      key: 'KOD', label: t('code') || 'Kod', flex: 1.1, minWidth: 80,
      sortValue: (i: any) => String(i.KOD || i.CARI_KODU || ''),
      render: (i: any) => <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }} numberOfLines={1}>{i.KOD || i.CARI_KODU || '-'}</Text>,
    },
    {
      key: 'AD', label: t('name') || 'Ad', flex: 3, minWidth: 200,
      sortValue: (i: any) => String(i.AD || i.CARI_ADI || ''),
      render: (i: any) => <Text style={{ fontSize: 13, color: colors.text, fontWeight: '700' }} numberOfLines={1}>{i.AD || i.CARI_ADI || i.UNVAN || '-'}</Text>,
    },
    {
      key: 'SEHIR', label: 'Şehir', flex: 1.2, minWidth: 90,
      sortValue: (i: any) => String(i.SEHIR || i.IL || ''),
      render: (i: any) => <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>{i.SEHIR || i.IL || '-'}</Text>,
    },
    {
      key: 'GRUP', label: 'Grup', flex: 1.2, minWidth: 90,
      sortValue: (i: any) => String(i.GRUP || i.CARI_GRUP || i.GRUP_AD || ''),
      render: (i: any) => {
        const g = i.GRUP || i.CARI_GRUP || i.GRUP_AD || '';
        if (!g) return <Text style={{ fontSize: 12, color: colors.textSecondary }}>-</Text>;
        return (
          <View style={{ backgroundColor: colors.primary + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
            <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '700' }} numberOfLines={1}>{g}</Text>
          </View>
        );
      },
    },
    {
      key: 'TELEFON', label: 'Telefon', flex: 1.4, minWidth: 110,
      sortValue: (i: any) => String(i.TELEFON || i.TEL || i.GSM || i.CEP || ''),
      render: (i: any) => {
        const v = i.TELEFON || i.TEL || i.GSM || i.CEP || i.MOBILE || '';
        return <Text style={{ fontSize: 12, color: v ? colors.primary : colors.textSecondary }} numberOfLines={1}>{v || '-'}</Text>;
      },
    },
    {
      key: 'BAKIYE', label: 'Bakiye', flex: 1.3, minWidth: 110, align: 'right', numeric: true,
      sortValue: (i: any) => parseFloat(i.BAKIYE || '0'),
      render: (i: any) => {
        const b = parseFloat(i.BAKIYE || '0');
        const col = b > 0 ? colors.error : b < 0 ? colors.success : colors.textSecondary;
        return (
          <Text style={{ fontSize: 13, color: col, fontWeight: '800' }} numberOfLines={1}>
            ₺{Math.abs(b).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        );
      },
    },
    {
      key: 'DURUM', label: 'Durum', flex: 0.8, minWidth: 80, align: 'center',
      sortValue: (i: any) => parseFloat(i.BAKIYE || '0'),
      render: (i: any) => {
        const b = parseFloat(i.BAKIYE || '0');
        if (b === 0) return <Text style={{ fontSize: 11, color: colors.textSecondary }}>-</Text>;
        const isDebtor = b > 0;
        const c = isDebtor ? colors.error : colors.success;
        return (
          <View style={{ backgroundColor: c + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
            <Text style={{ fontSize: 10.5, color: c, fontWeight: '700' }}>{isDebtor ? t('debtor') : t('creditor')}</Text>
          </View>
        );
      },
    },
  ], [colors, t]);

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}><Ionicons name="people-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>Veri kaynağı seçilmedi</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('customers')}</Text>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.error + '10', borderColor: colors.border }]}>
          <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('debt_total')}</Text>
          <Text style={[{ fontSize: 12, fontWeight: '800', color: colors.error }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>₺{summary.borc.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.success + '10', borderColor: colors.border }]}>
          <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('credit_total')}</Text>
          <Text style={[{ fontSize: 12, fontWeight: '800', color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>₺{summary.alacak.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
          <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('balance_short')}</Text>
          <Text style={[{ fontSize: 12, fontWeight: '800', color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>₺{Math.abs(summary.bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
      </View>

      {/* Filter pills */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 6, marginTop: 6, alignItems: 'center' }}>
        {[{ k: 'all' as const, l: t('all'), c: colors.primary }, { k: 'borclu' as const, l: `${t('debtor')} (${summary.borcluCount})`, c: colors.error }, { k: 'alacakli' as const, l: `${t('creditor')} (${summary.alacakliCount})`, c: colors.success }].map(o => (
          <TouchableOpacity key={o.k} style={[styles.pill, { backgroundColor: filterType === o.k ? o.c + '20' : colors.card, borderColor: filterType === o.k ? o.c : colors.border }]} onPress={() => setFilterType(o.k)}>
            <Text style={[{ fontSize: 11, fontWeight: '600', color: filterType === o.k ? o.c : colors.textSecondary }]}>{o.l}</Text>
          </TouchableOpacity>
        ))}
        {/* 2026-05-03 — extra filters (city / group) */}
        <TouchableOpacity
          onPress={() => setShowFilterModal(true)}
          style={[styles.pill, { backgroundColor: cariActiveFilterCount > 0 ? colors.primary + '15' : colors.card, borderColor: cariActiveFilterCount > 0 ? colors.primary : colors.border, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
        >
          <Ionicons name="options-outline" size={14} color={cariActiveFilterCount > 0 ? colors.primary : colors.textSecondary} />
          <Text style={[{ fontSize: 11, fontWeight: '700', color: cariActiveFilterCount > 0 ? colors.primary : colors.textSecondary }]}>Filtre{cariActiveFilterCount > 0 ? ` (${cariActiveFilterCount})` : ''}</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput style={[styles.searchText, { color: colors.text }]} placeholder={t('search_customer_ph')} placeholderTextColor={colors.textSecondary} value={searchQuery} onChangeText={setSearchQuery} />
          {searchQuery ? <TouchableOpacity onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={18} color={colors.textSecondary} /></TouchableOpacity> : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
        <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>
          {loading
            ? t('loading')
            : (() => {
                const total = loadProgress?.total || cariList.length;
                if (loadProgress && loadProgress.loaded < loadProgress.total) {
                  return `${loadProgress.loaded.toLocaleString('tr-TR')} / ${loadProgress.total.toLocaleString('tr-TR')} ${t('customer_count')}`;
                }
                if (searchQuery && filteredCaris.length !== total) {
                  return `${filteredCaris.length.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} ${t('customer_count')}`;
                }
                return `${total.toLocaleString('tr-TR')} ${t('customer_count')}`;
              })()
          }
        </Text>
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

      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_customers')}</Text></View>
      ) : isDesktop ? (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 16 }}>
          <DataTable
            data={filteredCaris}
            columns={desktopCariColumns}
            keyExtractor={(item: any, idx) => String(item.KART || item.ID || idx)}
            onRowPress={(item) => {
              setExtreStart(getDefDates().start);
              setExtreEnd(getDefDates().end);
              openCariDetail(item, getDefDates().start, getDefDates().end);
            }}
            refreshing={refreshing}
            onRefresh={onRefresh}
            estimatedItemSize={44}
            dense
            ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="people-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>{t('no_customers')}</Text></View>}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
        <FlashList ref={listRef as any} data={filteredCaris} renderItem={renderCariItem} keyExtractor={(item, idx) => String(item.KART || item.ID || idx)} estimatedItemSize={120} extraData={`${searchQuery}|${filterType}|${filterCities.length}|${filterGroups.length}`} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}
          drawDistance={500}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            const layoutH = e.nativeEvent.layoutMeasurement.height;
            setShowScrollUp(y > layoutH * 0.8);
            setShowScrollDown(y < (e.nativeEvent.contentSize.height - layoutH * 1.5));
          }}
          scrollEventThrottle={250}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="people-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>{t('no_customers')}</Text></View>}
          ListFooterComponent={(manualToast ? (
            <View style={{ paddingVertical: 12, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#10B981' + '20', borderWidth: 1, borderColor: '#10B981' }}>
                <Ionicons name="checkmark-circle" size={14} color={'#10B981'} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#10B981' }}>
                  Manuel güncelleme alındı · {new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ) : null)}
        />
        {/* 2026-05-05 — Filter spinner overlay */}
        {isFiltering && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }}>{t('loading') || 'Yükleniyor...'}</Text>
          </View>
        )}
        </View>
      )}

      {/* Floating scroll buttons */}
      <ScrollFab
        showUp={showScrollUp}
        showDown={showScrollDown && filteredCaris.length > 20}
        onUp={() => listRef.current?.scrollToOffset?.({ offset: 0, animated: true })}
        onDown={() => listRef.current?.scrollToEnd?.({ animated: true })}
        primaryColor={colors.primary}
        bottomOffset={100}
      />

      {/* Ekstre Modal */}
      <Modal visible={!!selectedCari} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent onRequestClose={() => { setSelectedCari(null); setExtreData([]); }}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktopWide, { borderColor: colors.border, maxWidth: 900 }]]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>{selectedCari?.AD || selectedCari?.CARI_ADI || t('statement')}</Text>
              <TouchableOpacity onPress={() => { setSelectedCari(null); setExtreData([]); }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>

            {/* Date filter */}
            <View style={[styles.dateRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('start_placeholder')}</Text>
                <TextInput style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} value={extreStart} onChangeText={setExtreStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('end_placeholder')}</Text>
                <TextInput style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} value={extreEnd} onChangeText={setExtreEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
              </View>
              <TouchableOpacity style={[styles.runBtn, { backgroundColor: colors.primary }]} onPress={refreshExtre}>
                <Ionicons name="refresh" size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Ekstre Summary */}
            <View style={[styles.extreSummary, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, alignItems: 'center' }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('debt')}</Text><Text style={[{ fontSize: 14, fontWeight: '800', color: colors.error }]}>₺{extreSummary.borc.toFixed(2)}</Text></View>
              <View style={{ flex: 1, alignItems: 'center' }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('credit')}</Text><Text style={[{ fontSize: 14, fontWeight: '800', color: colors.success }]}>₺{extreSummary.alacak.toFixed(2)}</Text></View>
              <View style={{ flex: 1, alignItems: 'center' }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('balance_short')}</Text><Text style={[{ fontSize: 14, fontWeight: '800', color: colors.primary }]}>₺{extreSummary.bakiye.toFixed(2)}</Text></View>
            </View>

            {/* Export buttons */}
            <View style={[{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 8 }]}>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.error + '15' }]} onPress={exportExtrePdf}>
                <Ionicons name="document-text-outline" size={14} color={colors.error} /><Text style={[{ fontSize: 11, color: colors.error, fontWeight: '600' }]}>PDF</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {extreLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_statement')}</Text></View>
              ) : extreData.length > 0 ? (
                extreData.map((row: any, idx: number) => {
                  const borc = parseFloat(row.BORC || '0');
                  const alacak = parseFloat(row.ALACAK || '0');
                  const bakiye = parseFloat(row.BAKIYE || '0');
                  // 2026-05-12 — POS sürümüne göre fiş id alanı farklı geliyor; hepsini kontrol et.
                  const fisIdVal = row.BELGE_ID || row.FIS_ID || row.KAYIT_ID || row.ID || row.BELGEID;
                  // 2026-05-12 — Sadece GERÇEK fiş satırları tıklanabilir.
                  // FIS_TURU/BELGE_TIP "Devir", "Açılış" gibi bilgi satırlarında detay açılmaz.
                  const turuStr = String(row.BELGE_TIP || row.FIS_TURU || row.ISLEM_TIP || '').toLowerCase();
                  const isInfoRow = turuStr.includes('devir') || turuStr.includes('açılış')
                    || turuStr.includes('acilis') || turuStr.includes('düzeltme')
                    || turuStr.includes('duzeltme');
                  const hasFis = !isInfoRow && !!fisIdVal && String(fisIdVal).trim() !== '' && String(fisIdVal) !== '0' && String(fisIdVal).toLowerCase() !== 'null';
                  return (
                    <TouchableOpacity key={idx} style={[styles.extreRow, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => hasFis ? openFisDetail(row) : null} disabled={!hasFis} activeOpacity={hasFis ? 0.7 : 1}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[{ fontSize: 11, fontWeight: '600', color: colors.text }]}>{row.TARIH || ''}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{row.BELGENO || ''}</Text>
                      </View>
                      <Text style={[{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }]} numberOfLines={1}>{row.ACIKLAMA || row.AD || '-'}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          {borc > 0 && <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.error }]}>B: ₺{borc.toFixed(2)}</Text>}
                          {alacak > 0 && <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.success }]}>A: ₺{alacak.toFixed(2)}</Text>}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.text }]}>₺{bakiye.toFixed(2)}</Text>
                          {hasFis && <Ionicons name="chevron-forward" size={12} color={colors.primary} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>{t('no_statement')}</Text></View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Fiş Detail Modal */}
      <Modal visible={!!selectedFis} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent onRequestClose={() => { setSelectedFis(null); setFisDetail([]); setFisTotals(null); }}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktopWide, { borderColor: colors.border, maxWidth: 800 }]]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => { setSelectedFis(null); setFisDetail([]); setFisTotals(null); }}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1, textAlign: 'center' }]}>{t('receipt_detail')}</Text>
              <View style={{ width: 24 }} />
            </View>
            {selectedFis && (
              <View style={[{ padding: 12, backgroundColor: colors.primary + '08', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.text }]}>{selectedFis.BELGENO || ''}</Text>
                <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{selectedFis.TARIH || ''} · {selectedFis.ACIKLAMA || ''}</Text>
              </View>
            )}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {fisLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_receipt')}</Text></View>
              ) : fisDetail.length > 0 ? (
                <>
                  {fisDetail.map((item: any, idx: number) => (
                    <View key={idx} style={[styles.fisRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.text, flex: 1 }]} numberOfLines={1}>{item.STOK || t('product')}</Text>
                        <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.primary }]}>₺{parseFloat(item.DAHIL_TUTAR || item.TUTAR || '0').toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{item.BIRIM || ''}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('quantity_short')}: {parseFloat(item.MIKTAR_FIS || '0').toFixed(2)}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('price_short')}: ₺{parseFloat(item.DAHIL_FIYAT || item.FIYAT || '0').toFixed(2)}</Text>
                      </View>
                    </View>
                  ))}
                  {fisTotals && (
                    <View style={[styles.fisTotals, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
                      <View style={styles.fisTotalRow}><Text style={[{ color: colors.textSecondary }]}>{t('line_total')}</Text><Text style={[{ fontWeight: '600', color: colors.text }]}>₺{parseFloat(fisTotals.SATIR_TOPLAM || '0').toFixed(2)}</Text></View>
                      <View style={styles.fisTotalRow}><Text style={[{ color: colors.textSecondary }]}>KDV</Text><Text style={[{ fontWeight: '600', color: colors.text }]}>₺{parseFloat(fisTotals.KDV_TOPLAM || '0').toFixed(2)}</Text></View>
                      <View style={[styles.fisTotalRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }]}><Text style={[{ fontSize: 15, fontWeight: '800', color: colors.text }]}>{t('grand_total')}</Text><Text style={[{ fontSize: 16, fontWeight: '800', color: colors.primary }]}>₺{parseFloat(fisTotals.GENELTOPLAM || '0').toFixed(2)}</Text></View>
                    </View>
                  )}
                </>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>{t('no_receipt_detail')}</Text></View>
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
            <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12 }]}>{t('exporting')}</Text>
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

      {/* 2026-05-03 — Cari Filter Modal (city / group multi-select) */}
      <Modal visible={showFilterModal} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent onRequestClose={() => setShowFilterModal(false)}>
        <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
          <View style={[
            { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
            Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border, maxWidth: 560, maxHeight: '85%' }],
          ]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons name="options" size={22} color={colors.primary} />
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Filtrele</Text>
                {cariActiveFilterCount > 0 && (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.primary }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>{cariActiveFilterCount}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={() => setShowFilterModal(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.background }}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16, paddingBottom: 80 }}>
              {/* Şehir */}
              {uniqueCities.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="location" size={16} color={colors.warning} />
                    <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>Şehir</Text>
                    {filterCities.length > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.warning + '25' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.warning }}>{filterCities.length}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                    {uniqueCities.slice(0, 100).map(c => {
                      const on = filterCities.includes(c);
                      return (
                        <TouchableOpacity
                          key={c}
                          style={[
                            { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
                            on ? { backgroundColor: colors.warning, borderColor: colors.warning } : { borderColor: colors.border, backgroundColor: colors.card },
                          ]}
                          onPress={() => toggleCariList(filterCities, setFilterCities, c)}
                        >
                          {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                          <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]}>{c}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
              {/* Grup */}
              {uniqueCariGroups.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="albums" size={16} color={colors.success} />
                    <Text style={[{ fontSize: 14, fontWeight: '800', color: colors.text }]}>Grup</Text>
                    {filterGroups.length > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, backgroundColor: colors.success + '25' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.success }}>{filterGroups.length}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
                    {uniqueCariGroups.slice(0, 100).map(g => {
                      const on = filterGroups.includes(g);
                      return (
                        <TouchableOpacity
                          key={g}
                          style={[
                            { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
                            on ? { backgroundColor: colors.success, borderColor: colors.success } : { borderColor: colors.border, backgroundColor: colors.card },
                          ]}
                          onPress={() => toggleCariList(filterGroups, setFilterGroups, g)}
                        >
                          {on && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                          <Text style={[{ fontSize: 12, color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }]}>{g}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
              {(uniqueCities.length === 0 && uniqueCariGroups.length === 0) && (
                <Text style={[{ color: colors.textSecondary, textAlign: 'center', marginVertical: 30 }]}>
                  Filtre için yeterli veri yok (cari kayıtlarında şehir/grup alanları boş).
                </Text>
              )}
            </ScrollView>
            {/* Sticky bottom apply bar */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 0.4, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.error + '15' }}
                onPress={() => { setFilterCities([]); setFilterGroups([]); setFilterType('all'); }}
              >
                <Text style={{ color: colors.error, fontWeight: '800' }}>Hepsini Sıfırla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 0.6, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary }}
                onPress={() => setShowFilterModal(false)}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>Uygula{cariActiveFilterCount > 0 ? ` (${cariActiveFilterCount})` : ''}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  summaryCard: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  searchContainer: { paddingHorizontal: 16, paddingTop: 8 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 6 },
  searchText: { flex: 1, fontSize: 13 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  cariCard: { borderRadius: 10, borderWidth: 1, marginBottom: 6, overflow: 'hidden', ...Platform.select({ web: { boxShadow: '0 1px 3px rgba(15,23,42,0.04), 0 1px 2px rgba(15,23,42,0.06)' }, default: {} }) },
  cariCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, gap: 10 },
  cariName: { fontSize: 13, fontWeight: '600' },
  cariBakiye: { fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  dateRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1 },
  dateInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, marginTop: 2 },
  runBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  extreSummary: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  extreRow: { marginHorizontal: 12, marginTop: 6, borderRadius: 8, borderWidth: 1, padding: 8 },
  fisRow: { marginHorizontal: 12, marginTop: 6, borderRadius: 8, borderWidth: 1, padding: 8 },
  fisTotals: { margin: 12, borderRadius: 10, borderWidth: 1, padding: 12, gap: 4 },
  fisTotalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  exportOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 9998 },
  exportBox: { borderRadius: 16, padding: 30, alignItems: 'center', minWidth: 200 },
  toast: { position: 'absolute', bottom: 90, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, zIndex: 9999 },
});
