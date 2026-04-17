import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface FilterField {
  name: string; label: string;
  type: 'date' | 'select_static' | 'multiselect';
  source?: string; // for multiselect lookup
  options?: { value: any; label: string }[];
}

interface ReportDef {
  key: string; title: string; icon: keyof typeof Ionicons.glyphMap; description: string;
  datasetKey: string; defaultParams: Record<string, any>;
  columns: { key: string; label: string; numeric?: boolean }[];
  filters: FilterField[];
}

const REPORTS: ReportDef[] = [
  { key: 'fiyat_listeleri', title: 'Fiyat Listeleri', icon: 'pricetags-outline', description: 'Stok fiyat listeleri', datasetKey: 'rap_fiyat_listeleri_web',
    defaultParams: { FiyatAd: '', DovizAd: '', Aktif: 1, Lokasyon: '', Durum: 0, BirimAd: '', Stoklar: '', StokCinsi: '', StokGrup: '', StokMarka: '', StokVergi: '', Page: 1, PageSize: 200 },
    columns: [{ key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' }, { key: 'FIYAT', label: 'Fiyat', numeric: true }, { key: 'FIYAT_YEREL', label: 'Yerel Fiyat', numeric: true }, { key: 'STOK_BIRIM', label: 'Birim' }, { key: 'STOK_GRUP', label: 'Grup' }],
    filters: [
      { name: 'FiyatAd', label: 'Fiyat Adı', type: 'multiselect', source: 'STOK_FIYAT_AD' },
      { name: 'DovizAd', label: 'Döviz Adı', type: 'multiselect', source: 'DOVIZ_AD' },
      { name: 'Aktif', label: 'Aktif', type: 'select_static', options: [{ value: 1, label: 'Aktif' }, { value: 0, label: 'Pasif' }] },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON' },
      { name: 'BirimAd', label: 'Birim', type: 'multiselect', source: 'STOK_BIRIM' },
      { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP' },
      { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI' },
      { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA' },
    ] },
  { key: 'satis_adet_kar', title: 'Satış Adet Kar', icon: 'trending-up-outline', description: 'Satış, adet ve kar analizi', datasetKey: 'rap_satis_adet_kar_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', KdvDahil: 1, FisTipi: 0, Lokasyon: '', StokGrup: '', StokCinsi: '', StokMarka: '', Page: 1, PageSize: 200 },
    columns: [{ key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' }, { key: 'SATIS_MIKTAR', label: 'Satış Mik.', numeric: true }, { key: 'SATIS_TUTARI', label: 'Satış Tutarı', numeric: true }, { key: 'KAR_TUTAR', label: 'Kar', numeric: true }, { key: 'ORAN', label: 'Kar %', numeric: true }],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç', type: 'date' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date' },
      { name: 'KdvDahil', label: 'KDV Dahil', type: 'select_static', options: [{ value: 1, label: 'Evet' }, { value: 0, label: 'Hayır' }] },
      { name: 'FisTipi', label: 'Fiş Tipi', type: 'select_static', options: [{ value: 0, label: 'Tümü' }, { value: 1, label: 'Tip 1' }, { value: 2, label: 'Tip 2' }, { value: 3, label: 'Tip 3' }] },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON' },
      { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP' },
      { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI' },
      { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA' },
    ] },
  { key: 'stok_envanter', title: 'Stok Envanter', icon: 'cube-outline', description: 'Güncel stok durumu', datasetKey: 'rap_stok_envanter_web',
    defaultParams: { SONTARIH: '', KdvDahil: 1, Lokasyon: '', Durum: 0, StokGrup: '', StokCinsi: '', StokMarka: '', Page: 1, PageSize: 200 },
    columns: [{ key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün' }, { key: 'MEVCUT', label: 'Mevcut', numeric: true }, { key: 'LOKASYON', label: 'Lokasyon' }, { key: 'AGIRLIKLI_ORTALAMA___FIYAT', label: 'Ort.Fiyat', numeric: true }],
    filters: [
      { name: 'SONTARIH', label: 'Son Tarih', type: 'date' },
      { name: 'KdvDahil', label: 'KDV Dahil', type: 'select_static', options: [{ value: 1, label: 'Evet' }, { value: 0, label: 'Hayır' }] },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON' },
      { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP' },
      { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI' },
      { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA' },
    ] },
  { key: 'gelir_tablosu', title: 'Gelir Tablosu', icon: 'stats-chart-outline', description: 'Gelir ve gider analizi', datasetKey: 'rap_lm_gelir_tablosu',
    defaultParams: { BASTARIH: '', BITTARIH: '', KdvDahil: 1 },
    columns: [{ key: 'AD', label: 'Kalem' }, { key: 'TUTAR', label: 'Tutar', numeric: true }, { key: 'ORAN', label: 'Oran %', numeric: true }],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç', type: 'date' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date' },
      { name: 'KdvDahil', label: 'KDV Dahil', type: 'select_static', options: [{ value: 1, label: 'Evet' }, { value: 0, label: 'Hayır' }] },
    ] },
  { key: 'personel_satis', title: 'Personel Satış Özet', icon: 'people-outline', description: 'Personel satış performansı', datasetKey: 'rap_personel_satis_ozet_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', Lokasyon: '', Page: 1, PageSize: 200 },
    columns: [{ key: 'PERSONEL', label: 'Personel' }, { key: 'TOPLAM', label: 'Toplam', numeric: true }, { key: 'NAKIT', label: 'Nakit', numeric: true }, { key: 'KREDI_KARTI', label: 'K.Kartı', numeric: true }, { key: 'FIS_SAYISI', label: 'Fiş', numeric: true }],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç', type: 'date' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date' },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON' },
    ] },
  { key: 'fis_kalem', title: 'Fiş Kalem Listesi', icon: 'receipt-outline', description: 'Fiş ve kalem detayları', datasetKey: 'rap_fis_kalem_listesi_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', Lokasyon: '', StokGrup: '', Page: 1, PageSize: 200 },
    columns: [{ key: 'TARIH', label: 'Tarih' }, { key: 'STOK_ADI', label: 'Ürün' }, { key: 'MIKTAR', label: 'Miktar', numeric: true }, { key: 'TUTAR', label: 'Tutar', numeric: true }, { key: 'LOKASYON', label: 'Lokasyon' }],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç', type: 'date' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date' },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON' },
      { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP' },
    ] },
  { key: 'cari_ekstre', title: 'Cari Hesap Ekstresi', icon: 'wallet-outline', description: 'Borç/alacak ekstresi', datasetKey: 'rap_cari_hesap_ekstresi_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 200 },
    columns: [{ key: 'CARI_ADI', label: 'Cari' }, { key: 'TARIH', label: 'Tarih' }, { key: 'BORC', label: 'Borç', numeric: true }, { key: 'ALACAK', label: 'Alacak', numeric: true }, { key: 'BAKIYE', label: 'Bakiye', numeric: true }],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç', type: 'date' }, { name: 'BITTARIH', label: 'Bitiş', type: 'date' },
    ] },
];

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

  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});
  const [lookupCache, setLookupCache] = useState<Record<string, any[]>>({});
  const [lookupLoading, setLookupLoading] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

  const getDefDates = () => {
    const now = new Date();
    const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0'); const d = String(now.getDate()).padStart(2, '0');
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${d}` };
  };

  // Fetch lookup options for a filter
  const fetchLookup = useCallback(async (source: string) => {
    if (lookupCache[source] || lookupLoading[source] || !activeTenantId) return;
    setLookupLoading(prev => ({ ...prev, [source]: true }));
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/report-filter-options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, source }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        const opts = data.data.map((r: any) => ({ value: r.ID || r.AD || r.KOD || '', label: r.AD || r.KOD || String(r.ID || '') }));
        setLookupCache(prev => ({ ...prev, [source]: opts }));
      }
    } catch (err) { console.error('Lookup error:', err); }
    finally { setLookupLoading(prev => ({ ...prev, [source]: false })); }
  }, [activeTenantId, lookupCache, lookupLoading]);

  const openReportFilter = (report: ReportDef) => {
    const dd = getDefDates();
    const vals: Record<string, any> = {};
    report.filters.forEach(f => {
      if (f.type === 'date') vals[f.name] = f.name.includes('BAS') || f.name === 'BASTARIH' ? dd.start : dd.end;
      else if (f.type === 'select_static') vals[f.name] = report.defaultParams[f.name] ?? (f.options?.[0]?.value ?? '');
      else vals[f.name] = '';
    });
    setFilterValues(vals);
    setSelectedReport(report);
    setShowFilterModal(true);
    setReportData([]); setSortKey(''); setSearchFilter('');
    // Pre-fetch lookups
    report.filters.filter(f => f.type === 'multiselect' && f.source).forEach(f => fetchLookup(f.source!));
  };

  const runReport = useCallback(async () => {
    if (!activeTenantId || !selectedReport) return;
    setShowFilterModal(false); setShowResultModal(true);
    setReportLoading(true); setReportData([]);

    const params = { ...selectedReport.defaultParams };
    Object.entries(filterValues).forEach(([k, v]) => { if (v !== undefined && v !== null) params[k] = v; });

    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/report-run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, dataset_key: selectedReport.datasetKey, params }),
      });
      const data = await resp.json();
      if (data.ok && data.data) setReportData(data.data);
    } catch (err) { console.error(err); }
    finally { setReportLoading(false); }
  }, [activeTenantId, selectedReport, filterValues]);

  const processedData = useMemo(() => {
    let d = reportData;
    if (searchFilter) { const q = searchFilter.toLowerCase(); d = d.filter((row: any) => Object.values(row).some((v: any) => String(v || '').toLowerCase().includes(q))); }
    if (sortKey) { d = [...d].sort((a: any, b: any) => { const va = a[sortKey]; const vb = b[sortKey]; const na = parseFloat(va); const nb = parseFloat(vb); if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na; return sortAsc ? String(va || '').localeCompare(String(vb || ''), 'tr') : String(vb || '').localeCompare(String(va || ''), 'tr'); }); }
    return d;
  }, [reportData, searchFilter, sortKey, sortAsc]);

  const toggleSort = (key: string) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); } };

  const exportPdf = async () => {
    if (!selectedReport || processedData.length === 0) return;
    const cols = selectedReport.columns;
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;font-size:11px;text-align:left}th{background:#f5f5f5;font-size:10px}</style></head><body><h2>${selectedReport.title}</h2><p>${processedData.length} kayıt</p><table><thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${processedData.map((r: any) => `<tr>${cols.map(c => `<td>${c.numeric ? parseFloat(r[c.key] || '0').toFixed(2) : (r[c.key] || '-')}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    try { const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf' }); } catch (err) { console.error(err); }
  };

  const exportCsv = async () => {
    if (!selectedReport || processedData.length === 0) return;
    const cols = selectedReport.columns;
    let csv = cols.map(c => c.label).join(';') + '\n';
    processedData.forEach((r: any) => { csv += cols.map(c => c.numeric ? parseFloat(r[c.key] || '0').toFixed(2) : String(r[c.key] || '').replace(/;/g, ',')).join(';') + '\n'; });
    try { const path = `${FileSystem.cacheDirectory}${selectedReport.key}.csv`; await FileSystem.writeAsStringAsync(path, csv); await Sharing.shareAsync(path, { mimeType: 'text/csv' }); } catch (err) { console.error(err); }
  };

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {REPORTS.map(report => (
          <TouchableOpacity key={report.key} style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => openReportFilter(report)} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.reportIcon, { backgroundColor: colors.primary + '15' }]}><Ionicons name={report.icon} size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={[styles.reportTitle, { color: colors.text }]}>{report.title}</Text><Text style={[styles.reportDesc, { color: colors.textSecondary }]}>{report.description}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '80%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{selectedReport?.title} - Filtreler</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 12, paddingBottom: 30 }}>
              {selectedReport?.filters.map(filter => (
                <View key={filter.name}>
                  <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 }]}>{filter.label}</Text>
                  {filter.type === 'date' ? (
                    <TextInput style={[styles.filterInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                      value={filterValues[filter.name] || ''} onChangeText={v => setFilterValues(prev => ({ ...prev, [filter.name]: v }))}
                      placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
                  ) : filter.type === 'select_static' ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {filter.options?.map(opt => (
                        <TouchableOpacity key={String(opt.value)} style={[styles.optChip, filterValues[filter.name] === opt.value && { backgroundColor: colors.primary, borderColor: colors.primary }, { borderColor: colors.border }]}
                          onPress={() => setFilterValues(prev => ({ ...prev, [filter.name]: opt.value }))}>
                          <Text style={[{ fontSize: 12, color: filterValues[filter.name] === opt.value ? '#fff' : colors.text }]}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : filter.type === 'multiselect' && filter.source ? (
                    <View>
                      {lookupLoading[filter.source] ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>Yükleniyor...</Text>
                        </View>
                      ) : (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
                          <TouchableOpacity style={[styles.optChip, !filterValues[filter.name] && { backgroundColor: colors.primary, borderColor: colors.primary }, { borderColor: colors.border }]}
                            onPress={() => setFilterValues(prev => ({ ...prev, [filter.name]: '' }))}>
                            <Text style={[{ fontSize: 11, color: !filterValues[filter.name] ? '#fff' : colors.text }]}>Tümü</Text>
                          </TouchableOpacity>
                          {(lookupCache[filter.source] || []).slice(0, 20).map((opt: any, i: number) => (
                            <TouchableOpacity key={i} style={[styles.optChip, filterValues[filter.name] === String(opt.value) && { backgroundColor: colors.primary, borderColor: colors.primary }, { borderColor: colors.border }]}
                              onPress={() => setFilterValues(prev => ({ ...prev, [filter.name]: String(opt.value) }))}>
                              <Text style={[{ fontSize: 11, color: filterValues[filter.name] === String(opt.value) ? '#fff' : colors.text }]} numberOfLines={1}>{opt.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      )}
                    </View>
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

      {/* Result Modal */}
      <Modal visible={showResultModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>{selectedReport?.title}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => { setShowResultModal(false); setShowFilterModal(true); }}><Ionicons name="options-outline" size={22} color={colors.primary} /></TouchableOpacity>
                <TouchableOpacity onPress={() => { setShowResultModal(false); setSelectedReport(null); setReportData([]); }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
              </View>
            </View>
            <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
              <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                <Ionicons name="search" size={14} color={colors.textSecondary} />
                <TextInput style={[{ flex: 1, fontSize: 12, color: colors.text }]} placeholder="Filtrele..." placeholderTextColor={colors.textSecondary} value={searchFilter} onChangeText={setSearchFilter} />
              </View>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.error + '15' }]} onPress={exportPdf}><Ionicons name="document-text-outline" size={14} color={colors.error} /><Text style={[{ fontSize: 10, color: colors.error, fontWeight: '600' }]}>PDF</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.success + '15' }]} onPress={exportCsv}><Ionicons name="grid-outline" size={14} color={colors.success} /><Text style={[{ fontSize: 10, color: colors.success, fontWeight: '600' }]}>Excel</Text></TouchableOpacity>
            </View>
            {selectedReport && !reportLoading && processedData.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 32, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: 'row', paddingHorizontal: 12 }}>
                  {selectedReport.columns.map(col => (
                    <TouchableOpacity key={col.key} style={[styles.sortHeader, sortKey === col.key && { backgroundColor: colors.primary + '15' }]} onPress={() => toggleSort(col.key)}>
                      <Text style={[{ fontSize: 10, fontWeight: '700', color: sortKey === col.key ? colors.primary : colors.textSecondary }]}>{col.label}</Text>
                      {sortKey === col.key && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={10} color={colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
            <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}><Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{reportLoading ? 'Çalıştırılıyor...' : `${processedData.length} kayıt`}</Text></View>
            {reportLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary }]}>POS'tan veri alınıyor...</Text></View>
            ) : processedData.length > 0 ? (
              <FlatList data={processedData} keyExtractor={(_, idx) => String(idx)} contentContainerStyle={{ paddingBottom: 30 }}
                renderItem={({ item, index }) => (
                  <View style={[styles.resultRow, { backgroundColor: index % 2 === 0 ? colors.card : colors.background, borderBottomColor: colors.border }]}>
                    {(selectedReport?.columns || []).map(col => (
                      <View key={col.key} style={styles.resultCell}>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{col.label}</Text>
                        <Text style={[{ fontSize: 12, fontWeight: '600', color: col.numeric ? colors.primary : colors.text }]} numberOfLines={1}>{col.numeric ? `₺${parseFloat(item[col.key] || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : String(item[col.key] || '-')}</Text>
                      </View>
                    ))}
                  </View>
                )}
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><Ionicons name="document-text-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>Sonuç bulunamadı</Text></View>
            )}
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
  reportCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  reportIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reportTitle: { fontSize: 15, fontWeight: '700' },
  reportDesc: { fontSize: 12, marginTop: 2 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, flex: 1, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  filterInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  optChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#ddd' },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 6, borderBottomWidth: 1 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1, gap: 4 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  sortHeader: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 4 },
  resultRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resultCell: { minWidth: '40%', flex: 1 },
});
