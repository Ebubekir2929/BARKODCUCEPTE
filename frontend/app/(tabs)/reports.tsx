import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, FlatList, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// === REPORT DEFINITIONS ===
interface FilterDef {
  name: string; label: string; type: 'multiselect' | 'select_static' | 'date';
  source?: string; // rap_filtre_lookup Kaynak
  options?: { value: any; label: string }[];
  required?: boolean; group?: string;
}
interface ColDef { key: string; label: string; type?: 'money' | 'number' | 'bool'; }
interface CardLayout {
  title: string;          // main product/entity name (e.g. 'AD')
  code?: string;          // secondary code (e.g. 'KOD')
  amount?: string;        // right-side big amount (e.g. 'FIYAT')
  amountType?: 'money' | 'number';
  amountCurrency?: string;// key for currency label (e.g. 'DOVIZ_AD')
  amountLabel?: string;   // optional label below amount (e.g. 'Fiyat')
  chips?: { key: string; label?: string; type?: 'bool' | 'text' | 'number' }[]; // quick-info pills
  meta?: { key: string; label?: string; type?: 'text' | 'number' | 'money' }[]; // footer info
}
interface ReportDef {
  key: string; title: string; icon: keyof typeof Ionicons.glyphMap; description: string;
  datasetKey: string; defaultParams: Record<string, any>;
  columns: ColDef[]; filters: FilterDef[];
  requireNarrowing?: boolean;
  requiredFilters?: string[]; // filter names that MUST have value
  cardLayout?: CardLayout;
}

const FIYAT_LISTELERI: ReportDef = {
  key: 'fiyat_listeleri', title: 'Fiyat Listeleri', icon: 'pricetags-outline',
  description: 'Stok fiyat listeleri ve KDV bilgileri',
  datasetKey: 'rap_fiyat_listeleri_web',
  defaultParams: {
    Aktif: 1, Durum: 0, Resimli: 0, Page: 1, PageSize: 500,
    FiyatAd: '', BirimAd: '', DovizAd: '', Lokasyon: '',
    StokCinsi: '', StokGrup: '', StokMarka: '', StokVergi: '', Stoklar: '',
    StokOzelKod1: '', StokOzelKod2: '', StokOzelKod3: '', StokOzelKod4: '', StokOzelKod5: '',
    StokOzelKod6: '', StokOzelKod7: '', StokOzelKod8: '', StokOzelKod9: '',
  },
  requireNarrowing: true,
  requiredFilters: ['FiyatAd'],
  cardLayout: {
    title: 'AD',
    code: 'KOD',
    amount: 'FIYAT',
    amountType: 'money',
    amountCurrency: 'DOVIZ_AD',
    amountLabel: 'Satış Fiyatı',
    chips: [
      { key: 'STOK_FIYAT_AD' },
      { key: 'KDV_DAHILMI', label: 'KDV Dahil', type: 'bool' },
      { key: 'STOK_BIRIM' },
      { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
    ],
    meta: [
      { key: 'STOK_CINSI' },
      { key: 'STOK_GRUP', label: 'Grup' },
      { key: 'STOK_MARKA', label: 'Marka' },
      { key: 'FIYAT_YEREL', label: 'Yerel', type: 'money' },
    ],
  },
  columns: [
    { key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' },
    { key: 'STOK_FIYAT_AD', label: 'Fiyat Adı' }, { key: 'DOVIZ_AD', label: 'Döviz' },
    { key: 'STOK_BIRIM', label: 'Birim' }, { key: 'FIYAT', label: 'Fiyat', type: 'money' },
    { key: 'FIYAT_YEREL', label: 'Yerel Fiyat', type: 'money' },
    { key: 'KDV_DAHILMI', label: 'KDV Dahil', type: 'bool' },
    { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
    { key: 'STOK_CINSI', label: 'Cinsi' }, { key: 'STOK_GRUP', label: 'Grup' },
    { key: 'STOK_MARKA', label: 'Marka' },
  ],
  filters: [
    { name: 'FiyatAd', label: 'Fiyat Adı', type: 'multiselect', source: 'STOK_FIYAT_AD', required: true, group: 'Temel' },
    { name: 'DovizAd', label: 'Döviz Adı', type: 'multiselect', source: 'DOVIZ_AD', group: 'Temel' },
    { name: 'Aktif', label: 'Aktif', type: 'select_static', options: [{ value: 1, label: 'Aktif' }, { value: 0, label: 'Pasif' }, { value: '', label: 'Tümü' }], group: 'Temel' },
    { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Temel' },
    { name: 'BirimAd', label: 'Birim', type: 'multiselect', source: 'STOK_BIRIM', group: 'Stok' },
    { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI', group: 'Stok' },
    { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP', group: 'Stok' },
    { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA', group: 'Stok' },
    { name: 'StokVergi', label: 'Stok Vergi', type: 'multiselect', source: 'STOK_VERGI', group: 'Stok' },
  ],
};

// Other reports - simplified
const OTHER_REPORTS: ReportDef[] = [
  { key: 'satis_adet_kar', title: 'Satış Adet Kar', icon: 'trending-up-outline', description: 'Satış, adet ve kar analizi', datasetKey: 'rap_satis_adet_kar_web', defaultParams: { BASTARIH: '', BITTARIH: '', KdvDahil: 1, Page: 1, PageSize: 500 }, columns: [{ key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün' }, { key: 'SATIS_MIKTAR', label: 'Satış Mik.', type: 'number' }, { key: 'SATIS_TUTARI', label: 'Satış Tutarı', type: 'money' }, { key: 'KAR_TUTAR', label: 'Kar', type: 'money' }, { key: 'ORAN', label: 'Kar %', type: 'number' }], filters: [{ name: 'BASTARIH', label: 'Başlangıç', type: 'date', group: 'Tarih' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date', group: 'Tarih' }, { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' }, { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP', group: 'Filtre' }] },
  { key: 'stok_envanter', title: 'Stok Envanter', icon: 'cube-outline', description: 'Güncel stok durumu', datasetKey: 'rap_stok_envanter_web', defaultParams: { SONTARIH: '', KdvDahil: 1, Page: 1, PageSize: 500 }, columns: [{ key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün' }, { key: 'MEVCUT', label: 'Mevcut', type: 'number' }, { key: 'LOKASYON', label: 'Lokasyon' }, { key: 'AGIRLIKLI_ORTALAMA___FIYAT', label: 'Ort.Fiyat', type: 'money' }], filters: [{ name: 'SONTARIH', label: 'Son Tarih', type: 'date', group: 'Tarih' }, { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' }, { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP', group: 'Filtre' }] },
  { key: 'gelir_tablosu', title: 'Gelir Tablosu', icon: 'stats-chart-outline', description: 'Gelir ve gider analizi', datasetKey: 'rap_lm_gelir_tablosu', defaultParams: { BASTARIH: '', BITTARIH: '', KdvDahil: 1 }, columns: [{ key: 'AD', label: 'Kalem' }, { key: 'TUTAR', label: 'Tutar', type: 'money' }, { key: 'ORAN', label: 'Oran %', type: 'number' }], filters: [{ name: 'BASTARIH', label: 'Başlangıç', type: 'date', group: 'Tarih' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date', group: 'Tarih' }] },
  { key: 'personel_satis', title: 'Personel Satış Özet', icon: 'people-outline', description: 'Personel satış performansı', datasetKey: 'rap_personel_satis_ozet_web', defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 500 }, columns: [{ key: 'PERSONEL', label: 'Personel' }, { key: 'TOPLAM', label: 'Toplam', type: 'money' }, { key: 'NAKIT', label: 'Nakit', type: 'money' }, { key: 'KREDI_KARTI', label: 'K.Kartı', type: 'money' }, { key: 'FIS_SAYISI', label: 'Fiş', type: 'number' }], filters: [{ name: 'BASTARIH', label: 'Başlangıç', type: 'date', group: 'Tarih' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date', group: 'Tarih' }, { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' }] },
  { key: 'fis_kalem', title: 'Fiş Kalem Listesi', icon: 'receipt-outline', description: 'Fiş ve kalem detayları', datasetKey: 'rap_fis_kalem_listesi_web', defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 500 }, columns: [{ key: 'TARIH', label: 'Tarih' }, { key: 'STOK_ADI', label: 'Ürün' }, { key: 'MIKTAR', label: 'Miktar', type: 'number' }, { key: 'TUTAR', label: 'Tutar', type: 'money' }, { key: 'LOKASYON', label: 'Lokasyon' }], filters: [{ name: 'BASTARIH', label: 'Başlangıç', type: 'date', group: 'Tarih' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date', group: 'Tarih' }, { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' }] },
  { key: 'cari_ekstre', title: 'Cari Hesap Ekstresi', icon: 'wallet-outline', description: 'Borç/alacak ekstresi', datasetKey: 'rap_cari_hesap_ekstresi_web', defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 500 }, columns: [{ key: 'CARI_ADI', label: 'Cari' }, { key: 'TARIH', label: 'Tarih' }, { key: 'BORC', label: 'Borç', type: 'money' }, { key: 'ALACAK', label: 'Alacak', type: 'money' }, { key: 'BAKIYE', label: 'Bakiye', type: 'money' }], filters: [{ name: 'BASTARIH', label: 'Başlangıç', type: 'date', group: 'Tarih' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date', group: 'Tarih' }] },
];

const ALL_REPORTS = [FIYAT_LISTELERI, ...OTHER_REPORTS];

// === COMPONENT ===
export default function ReportsScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const keys = ['data1', 'data2', 'data3'];
    const idx = keys.indexOf(activeSource);
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  // State
  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<FilterDef | null>(null);
  const [pickerOptions, setPickerOptions] = useState<{ value: string; label: string }[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const [filterValues, setFilterValues] = useState<Record<string, any>>({});
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [sortKey, setSortKey] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  // Lookup cache
  const [lookupCache, setLookupCache] = useState<Record<string, { value: string; label: string }[]>>({});

  const getDefDates = () => {
    const now = new Date();
    const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0'); const d = String(now.getDate()).padStart(2, '0');
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${d}` };
  };

  // Open filter modal for a report
  const openReportFilter = (report: ReportDef) => {
    const dd = getDefDates();
    const vals: Record<string, any> = {};
    report.filters.forEach(f => {
      if (f.type === 'date') vals[f.name] = f.name.includes('BAS') ? dd.start : dd.end;
      else if (f.type === 'select_static') vals[f.name] = report.defaultParams[f.name] ?? '';
      else vals[f.name] = ''; // multiselect empty
    });
    setFilterValues(vals);
    setSelectedReport(report);
    setShowFilterModal(true);
    setReportData([]); setSortKey(''); setSearchFilter('');
  };

  // Open picker for multiselect filter (on-demand load)
  const openPicker = useCallback(async (filter: FilterDef) => {
    setPickerFilter(filter);
    setPickerSearch('');
    setShowPickerModal(true);

    if (filter.source && lookupCache[filter.source]) {
      setPickerOptions(lookupCache[filter.source]);
      return;
    }
    if (!filter.source || !activeTenantId) return;

    setPickerLoading(true);
    setPickerOptions([]);
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/report-filter-options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, source: filter.source }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        const opts = data.data.map((r: any) => ({
          value: String(r.ID ?? r.AD ?? r.KOD ?? ''),
          label: String(r.AD || r.KOD || r.ID || ''),
        }));
        setPickerOptions(opts);
        setLookupCache(prev => ({ ...prev, [filter.source!]: opts }));
      }
    } catch (err) { console.error('Lookup error:', err); }
    finally { setPickerLoading(false); }
  }, [activeTenantId, lookupCache]);

  // Toggle selection in multiselect
  const togglePickerValue = (val: string) => {
    if (!pickerFilter) return;
    const current = filterValues[pickerFilter.name] || '';
    const arr = current ? current.split(',') : [];
    const idx = arr.indexOf(val);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(val);
    setFilterValues(prev => ({ ...prev, [pickerFilter.name]: arr.join(',') }));
  };

  const isPickerSelected = (val: string) => {
    if (!pickerFilter) return false;
    const current = filterValues[pickerFilter.name] || '';
    return current.split(',').includes(val);
  };

  // Run report
  const runReport = useCallback(async () => {
    if (!activeTenantId || !selectedReport) return;

    // Check required filters (explicit required filter list takes priority)
    if (selectedReport.requiredFilters && selectedReport.requiredFilters.length > 0) {
      for (const reqName of selectedReport.requiredFilters) {
        const val = filterValues[reqName];
        if (val === undefined || val === null || val === '') {
          const filt = selectedReport.filters.find(f => f.name === reqName);
          Alert.alert('Zorunlu Filtre', `"${filt?.label || reqName}" seçimi zorunludur.`);
          return;
        }
      }
    } else if (selectedReport.requireNarrowing) {
      const hasNarrow = selectedReport.filters.some(f =>
        f.type === 'multiselect' && filterValues[f.name] && filterValues[f.name].length > 0
      );
      if (!hasNarrow) {
        Alert.alert('Filtre Gerekli', 'En az bir daraltıcı filtre seçin');
        return;
      }
    }

    setShowFilterModal(false); setShowResultModal(true);
    setReportLoading(true); setReportData([]);

    const params: Record<string, any> = { ...selectedReport.defaultParams };
    Object.entries(filterValues).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params[k] = v;
    });

    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/report-run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, dataset_key: selectedReport.datasetKey, params, fetch_all: true }),
      });
      const data = await resp.json();
      if (data.ok && data.data) setReportData(data.data);
      else if (!data.ok) Alert.alert('Hata', data.detail || 'Rapor çalıştırılamadı');
    } catch (err) { console.error(err); }
    finally { setReportLoading(false); }
  }, [activeTenantId, selectedReport, filterValues]);

  // Sort & search
  const processedData = useMemo(() => {
    let d = reportData;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      d = d.filter((row: any) => Object.values(row).some((v: any) => String(v || '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      d = [...d].sort((a: any, b: any) => {
        const va = a[sortKey]; const vb = b[sortKey];
        const na = parseFloat(va); const nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
        return sortAsc ? String(va || '').localeCompare(String(vb || ''), 'tr') : String(vb || '').localeCompare(String(va || ''), 'tr');
      });
    }
    return d;
  }, [reportData, searchFilter, sortKey, sortAsc]);

  const toggleSort = (key: string) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); } };

  const renderValue = (val: any, col: ColDef) => {
    if (col.type === 'money') return `₺${parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
    if (col.type === 'number') return parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    if (col.type === 'bool') return val === true || val === 1 || val === '1' ? 'Evet' : 'Hayır';
    return String(val || '-');
  };

  // PDF Export
  const exportPdf = async () => {
    if (!selectedReport || processedData.length === 0) return;
    setExportLoading(true);
    const cols = selectedReport.columns;
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:16px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:5px;text-align:left;font-size:10px}th{background:#f5f5f5;font-weight:bold}h2{font-size:16px}</style></head><body><h2>${selectedReport.title}</h2><p>${processedData.length} kayıt</p><table><thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${processedData.map((r: any) => `<tr>${cols.map(c => `<td>${renderValue(r[c.key], c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (err) { console.error(err); }
    finally { setExportLoading(false); }
  };

  // Excel Export
  const exportExcel = async () => {
    if (!selectedReport || processedData.length === 0) return;
    setExportLoading(true);
    try {
      const cols = selectedReport.columns;
      // Build rows (human-readable values)
      const rows = processedData.map((r: any) => {
        const o: Record<string, any> = {};
        cols.forEach(c => {
          let v = r[c.key];
          if (c.type === 'money' || c.type === 'number') {
            const n = parseFloat(String(v ?? '0'));
            v = isNaN(n) ? 0 : n;
          } else if (c.type === 'bool') {
            v = (v === true || v === 1 || v === '1') ? 'Evet' : 'Hayır';
          } else if (v === null || v === undefined) {
            v = '';
          } else {
            v = String(v);
          }
          o[c.label] = v;
        });
        return o;
      });
      const ws = XLSX.utils.json_to_sheet(rows, { header: cols.map(c => c.label) });
      // Auto-size columns
      const colWidths = cols.map(c => {
        const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[c.label] ?? '').length));
        return { wch: Math.min(40, Math.max(8, maxLen + 2)) };
      });
      (ws as any)['!cols'] = colWidths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (selectedReport.title || 'Rapor').substring(0, 31));

      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const fileName = `${selectedReport.key}_${ts}.xlsx`;

      if (Platform.OS === 'web') {
        // On web: download via Blob
        const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      } else {
        const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        const uri = FileSystem.cacheDirectory + fileName;
        await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          UTI: 'com.microsoft.excel.xlsx',
          dialogTitle: selectedReport.title,
        });
      }
    } catch (err) {
      console.error('Excel export error:', err);
      Alert.alert('Hata', 'Excel oluşturulurken bir hata oluştu.');
    } finally {
      setExportLoading(false);
    }
  };

  // Get selected labels for a filter
  const getSelectedLabels = (filterName: string, source?: string) => {
    const val = filterValues[filterName] || '';
    if (!val) return '';
    const opts = source ? (lookupCache[source] || []) : [];
    const ids = val.split(',');
    if (opts.length > 0) {
      return ids.map((id: string) => opts.find(o => o.value === id)?.label || id).join(', ');
    }
    return val;
  };

  const filteredPickerOpts = useMemo(() => {
    if (!pickerSearch) return pickerOptions;
    const q = pickerSearch.toLowerCase();
    return pickerOptions.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [pickerOptions, pickerSearch]);

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}><Ionicons name="document-text-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>Veri kaynağı seçilmedi</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Raporlar</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 }}>
        {ALL_REPORTS.map(report => (
          <TouchableOpacity key={report.key} style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => openReportFilter(report)} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.reportIcon, { backgroundColor: colors.primary + '15' }]}><Ionicons name={report.icon} size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={[{ fontSize: 15, fontWeight: '700', color: colors.text }]}>{report.title}</Text><Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{report.description}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* FILTER MODAL */}
      <Modal visible={showFilterModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[{ fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 }]}>{selectedReport?.title} - Filtreler</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 10, paddingBottom: 30 }}>
              {selectedReport?.filters.map(filter => (
                <View key={filter.name}>
                  <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 }]}>
                    {filter.label} {filter.required && <Text style={{ color: colors.error }}>*</Text>}
                  </Text>
                  {filter.type === 'date' ? (
                    <TextInput
                      style={[styles.filterInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                      value={filterValues[filter.name] || ''}
                      onChangeText={v => setFilterValues(prev => ({ ...prev, [filter.name]: v }))}
                      placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary}
                    />
                  ) : filter.type === 'select_static' ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {filter.options?.map(opt => (
                        <TouchableOpacity key={String(opt.value)} style={[styles.chip, filterValues[filter.name] === opt.value && { backgroundColor: colors.primary, borderColor: colors.primary }, { borderColor: colors.border }]}
                          onPress={() => setFilterValues(prev => ({ ...prev, [filter.name]: opt.value }))}>
                          <Text style={[{ fontSize: 12, color: filterValues[filter.name] === opt.value ? '#fff' : colors.text }]}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : filter.type === 'multiselect' ? (
                    <TouchableOpacity
                      style={[styles.filterInput, { backgroundColor: colors.card, borderColor: filterValues[filter.name] ? colors.primary : colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                      onPress={() => openPicker(filter)}
                    >
                      <Text style={[{ fontSize: 13, color: filterValues[filter.name] ? colors.text : colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                        {filterValues[filter.name] ? getSelectedLabels(filter.name, filter.source) : 'Seçiniz...'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
              <TouchableOpacity style={[{ backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }]} onPress={runReport}>
                <Text style={[{ color: '#fff', fontWeight: '700', fontSize: 15 }]}>Raporu Çalıştır</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PICKER MODAL (multiselect on-demand) */}
      <Modal visible={showPickerModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '80%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 }]}>{pickerFilter?.label}</Text>
              <TouchableOpacity onPress={() => setShowPickerModal(false)}><Ionicons name="checkmark" size={24} color={colors.primary} /></TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput style={[{ flex: 1, fontSize: 13, color: colors.text }]} placeholder="Ara..." placeholderTextColor={colors.textSecondary} value={pickerSearch} onChangeText={setPickerSearch} />
              </View>
            </View>
            {pickerLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>Seçenekler yükleniyor...</Text></View>
            ) : (
              <FlatList
                data={filteredPickerOpts}
                keyExtractor={(item, idx) => String(idx)}
                contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
                renderItem={({ item }) => {
                  const sel = isPickerSelected(item.value);
                  return (
                    <TouchableOpacity style={[styles.pickerItem, { backgroundColor: sel ? colors.primary + '15' : colors.card, borderColor: sel ? colors.primary : colors.border }]} onPress={() => togglePickerValue(item.value)}>
                      <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={20} color={sel ? colors.primary : colors.textSecondary} />
                      <Text style={[{ fontSize: 14, color: sel ? colors.primary : colors.text, fontWeight: sel ? '600' : '400', flex: 1 }]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={<View style={{ alignItems: 'center', paddingVertical: 20 }}><Text style={[{ color: colors.textSecondary }]}>Seçenek bulunamadı</Text></View>}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* RESULT MODAL */}
      <Modal visible={showResultModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 }]}>{selectedReport?.title}</Text>
              <TouchableOpacity style={{ marginRight: 8 }} onPress={() => { setShowResultModal(false); setShowFilterModal(true); }}><Ionicons name="options-outline" size={22} color={colors.primary} /></TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowResultModal(false); setSelectedReport(null); setReportData([]); }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            {/* Toolbar */}
            <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
              <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                <Ionicons name="search" size={14} color={colors.textSecondary} />
                <TextInput style={[{ flex: 1, fontSize: 12, color: colors.text }]} placeholder="Ara..." placeholderTextColor={colors.textSecondary} value={searchFilter} onChangeText={setSearchFilter} />
              </View>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.success + '18' }]} onPress={exportExcel} disabled={exportLoading}>
                {exportLoading ? <ActivityIndicator size="small" color={colors.success} /> : <Ionicons name="grid-outline" size={14} color={colors.success} />}
                <Text style={[{ fontSize: 10, color: colors.success, fontWeight: '700' }]}>Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.error + '15' }]} onPress={exportPdf} disabled={exportLoading}>
                {exportLoading ? <ActivityIndicator size="small" color={colors.error} /> : <Ionicons name="document-text-outline" size={14} color={colors.error} />}
                <Text style={[{ fontSize: 10, color: colors.error, fontWeight: '700' }]}>PDF</Text>
              </TouchableOpacity>
            </View>
            {/* Sort headers - compact pill style */}
            {selectedReport && !reportLoading && processedData.length > 0 && (() => {
              const sortOpts = (selectedReport.cardLayout
                ? [
                    selectedReport.cardLayout.title ? { key: selectedReport.cardLayout.title, label: selectedReport.columns.find(c => c.key === selectedReport.cardLayout!.title)?.label || 'Ad' } : null,
                    selectedReport.cardLayout.amount ? { key: selectedReport.cardLayout.amount, label: selectedReport.cardLayout.amountLabel || 'Fiyat' } : null,
                    ...(selectedReport.cardLayout.chips || []).map(c => ({ key: c.key, label: c.label || selectedReport.columns.find(col => col.key === c.key)?.label || c.key })),
                  ].filter(Boolean) as { key: string; label: string }[]
                : selectedReport.columns
              );
              return (
                <View style={[styles.sortBar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={styles.sortIconBox}>
                    <Ionicons name="swap-vertical" size={13} color={colors.textSecondary} />
                    <Text style={[{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }]}>Sırala</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, alignItems: 'center' }}>
                    {sortOpts.map(col => {
                      const active = sortKey === col.key;
                      return (
                        <TouchableOpacity
                          key={col.key}
                          style={[
                            styles.sortPill,
                            {
                              backgroundColor: active ? colors.primary : colors.card,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => toggleSort(col.key)}
                          activeOpacity={0.7}
                        >
                          <Text style={[{ fontSize: 11, fontWeight: '700', color: active ? '#fff' : colors.text }]} numberOfLines={1}>{col.label}</Text>
                          {active && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={11} color="#fff" />}
                        </TouchableOpacity>
                      );
                    })}
                    {sortKey !== '' && (
                      <TouchableOpacity onPress={() => { setSortKey(''); setSortAsc(true); }} style={[styles.sortPill, { backgroundColor: 'transparent', borderColor: colors.border }]}>
                        <Ionicons name="close" size={11} color={colors.textSecondary} />
                        <Text style={[{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }]}>Temizle</Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                </View>
              );
            })()}
            <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}><Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{reportLoading ? 'Çalıştırılıyor...' : `${processedData.length} kayıt`}</Text></View>
            {reportLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary }]}>POS'tan veri alınıyor...</Text></View>
            ) : processedData.length > 0 ? (
              <FlatList data={processedData} keyExtractor={(_, idx) => String(idx)} contentContainerStyle={{ padding: 12, paddingBottom: 30, gap: 8 }}
                renderItem={({ item }) => {
                  const cl = selectedReport?.cardLayout;
                  if (cl) {
                    const titleVal = String(item[cl.title] ?? '-');
                    const codeVal = cl.code ? String(item[cl.code] ?? '') : '';
                    const amountRaw = cl.amount ? item[cl.amount] : null;
                    const amountCurrency = cl.amountCurrency ? String(item[cl.amountCurrency] ?? '') : '';
                    const amountText = cl.amount
                      ? (cl.amountType === 'money'
                          ? `₺${parseFloat(amountRaw || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : parseFloat(amountRaw || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 }))
                      : '';
                    return (
                      <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={cardStyles.cardTop}>
                          <View style={{ flex: 1, paddingRight: 12 }}>
                            {codeVal !== '' && (
                              <Text style={[cardStyles.code, { color: colors.textSecondary }]} numberOfLines={1}>{codeVal}</Text>
                            )}
                            <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>{titleVal}</Text>
                          </View>
                          {cl.amount && (
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[cardStyles.amount, { color: colors.primary }]} numberOfLines={1}>{amountText}</Text>
                              {amountCurrency !== '' && (
                                <Text style={[cardStyles.amountCurrency, { color: colors.textSecondary }]}>{amountCurrency}</Text>
                              )}
                            </View>
                          )}
                        </View>
                        {cl.chips && cl.chips.length > 0 && (
                          <View style={cardStyles.chipsRow}>
                            {cl.chips.map(c => {
                              const v = item[c.key];
                              if (v === undefined || v === null || v === '') return null;
                              const col = selectedReport?.columns.find(x => x.key === c.key);
                              let txt = '';
                              let bg = colors.primary + '12';
                              let fg = colors.primary;
                              if (c.type === 'bool' || col?.type === 'bool') {
                                const isTrue = v === true || v === 1 || v === '1';
                                txt = `${c.label || col?.label || c.key}: ${isTrue ? 'Evet' : 'Hayır'}`;
                                bg = isTrue ? (colors.success + '20') : (colors.error + '18');
                                fg = isTrue ? colors.success : colors.error;
                              } else if (c.type === 'number' || col?.type === 'number') {
                                txt = `${c.label || col?.label || c.key}: ${parseFloat(String(v || '0')).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
                              } else {
                                txt = c.label ? `${c.label}: ${v}` : String(v);
                              }
                              return (
                                <View key={c.key} style={[cardStyles.chip, { backgroundColor: bg }]}>
                                  <Text style={[cardStyles.chipText, { color: fg }]} numberOfLines={1}>{txt}</Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                        {cl.meta && cl.meta.length > 0 && (
                          <View style={[cardStyles.metaRow, { borderTopColor: colors.border }]}>
                            {cl.meta.map(m => {
                              const v = item[m.key];
                              if (v === undefined || v === null || v === '' || v === '-') return null;
                              const col = selectedReport?.columns.find(x => x.key === m.key);
                              let val = String(v);
                              if (m.type === 'money' || col?.type === 'money') {
                                val = `₺${parseFloat(String(v || '0')).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
                              } else if (m.type === 'number' || col?.type === 'number') {
                                val = parseFloat(String(v || '0')).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
                              }
                              return (
                                <View key={m.key} style={cardStyles.metaItem}>
                                  <Text style={[cardStyles.metaLabel, { color: colors.textSecondary }]}>{m.label || col?.label || m.key}</Text>
                                  <Text style={[cardStyles.metaValue, { color: colors.text }]} numberOfLines={1}>{val}</Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    );
                  }
                  // Fallback: generic 2-col grid layout
                  return (
                    <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {(selectedReport?.columns || []).map(col => (
                          <View key={col.key} style={styles.resultCell}>
                            <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{col.label}</Text>
                            <Text style={[{ fontSize: 12, fontWeight: '600', color: col.type === 'money' ? colors.primary : colors.text }]} numberOfLines={1}>{renderValue(item[col.key], col)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                }}
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><Ionicons name="document-text-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>Sonuç bulunamadı</Text></View>
            )}
          </View>
        </View>
      </Modal>

      {/* Export overlay */}
      {exportLoading && (
        <View style={styles.exportOverlay}>
          <View style={[styles.exportBox, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12 }]}>Dosya hazırlanıyor...</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  reportCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  reportIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, flex: 1, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  filterInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 6 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 6, borderBottomWidth: 1 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  sortHeader: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 4 },
  sortBar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1 },
  sortIconBox: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingRight: 6, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#ccc', marginRight: 4 },
  sortPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  resultRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resultCell: { minWidth: '40%', flex: 1 },
  exportOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 9998 },
  exportBox: { borderRadius: 16, padding: 30, alignItems: 'center', minWidth: 200 },
});

const cardStyles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  code: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  amount: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  amountCurrency: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  chipText: { fontSize: 11, fontWeight: '600' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  metaItem: { minWidth: 70 },
  metaLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  metaValue: { fontSize: 12, fontWeight: '600' },
});
