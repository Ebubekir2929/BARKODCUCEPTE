import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  FlatList,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface ReportDef {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  datasetKey: string;
  defaultParams: Record<string, any>;
  columns: { key: string; label: string; numeric?: boolean }[];
}

const REPORTS: ReportDef[] = [
  {
    key: 'fiyat_listeleri', title: 'Fiyat Listeleri', icon: 'pricetags-outline',
    description: 'Stok fiyat listeleri ve KDV bilgileri',
    datasetKey: 'rap_fiyat_listeleri_web',
    defaultParams: { FiyatAd: '', DovizAd: '', Aktif: 1, Page: 1, PageSize: 100 },
    columns: [
      { key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' },
      { key: 'FIYAT', label: 'Fiyat', numeric: true }, { key: 'FIYAT_YEREL', label: 'Yerel Fiyat', numeric: true },
      { key: 'STOK_BIRIM', label: 'Birim' }, { key: 'STOK_GRUP', label: 'Grup' },
    ],
  },
  {
    key: 'satis_adet_kar', title: 'Satış Adet Kar', icon: 'trending-up-outline',
    description: 'Ürün bazlı satış, adet ve kar analizi',
    datasetKey: 'rap_satis_adet_kar_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', KdvDahil: 1, Page: 1, PageSize: 100 },
    columns: [
      { key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' },
      { key: 'SATIS_MIKTAR', label: 'Satış Mik.', numeric: true },
      { key: 'SATIS_TUTARI', label: 'Satış Tutarı', numeric: true },
      { key: 'KAR_TUTAR', label: 'Kar', numeric: true }, { key: 'ORAN', label: 'Kar %', numeric: true },
    ],
  },
  {
    key: 'stok_envanter', title: 'Stok Envanter', icon: 'cube-outline',
    description: 'Güncel stok envanter durumu',
    datasetKey: 'rap_stok_envanter_web',
    defaultParams: { SONTARIH: '', KdvDahil: 1, Page: 1, PageSize: 100 },
    columns: [
      { key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' },
      { key: 'MEVCUT', label: 'Mevcut', numeric: true }, { key: 'LOKASYON', label: 'Lokasyon' },
      { key: 'AGIRLIKLI_ORTALAMA___FIYAT', label: 'Ort. Fiyat', numeric: true },
      { key: 'AGIRLIKLI_ORTALAMA___TUTAR', label: 'Ort. Tutar', numeric: true },
    ],
  },
  {
    key: 'gelir_tablosu', title: 'Gelir Tablosu', icon: 'stats-chart-outline',
    description: 'Toplam gelir ve gider analizi',
    datasetKey: 'rap_lm_gelir_tablosu',
    defaultParams: { BASTARIH: '', BITTARIH: '', KdvDahil: 1 },
    columns: [
      { key: 'AD', label: 'Kalem' }, { key: 'TUTAR', label: 'Tutar', numeric: true },
      { key: 'ORAN', label: 'Oran %', numeric: true },
    ],
  },
  {
    key: 'personel_satis', title: 'Personel Satış Özet', icon: 'people-outline',
    description: 'Personel bazlı satış performansı',
    datasetKey: 'rap_personel_satis_ozet_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 100 },
    columns: [
      { key: 'PERSONEL', label: 'Personel' }, { key: 'TOPLAM', label: 'Toplam', numeric: true },
      { key: 'NAKIT', label: 'Nakit', numeric: true }, { key: 'KREDI_KARTI', label: 'K.Kartı', numeric: true },
      { key: 'FIS_SAYISI', label: 'Fiş', numeric: true },
    ],
  },
  {
    key: 'fis_kalem', title: 'Fiş Kalem Listesi', icon: 'receipt-outline',
    description: 'Detaylı fiş ve kalem listesi',
    datasetKey: 'rap_fis_kalem_listesi_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 100 },
    columns: [
      { key: 'TARIH', label: 'Tarih' }, { key: 'STOK_ADI', label: 'Ürün' },
      { key: 'MIKTAR', label: 'Miktar', numeric: true }, { key: 'TUTAR', label: 'Tutar', numeric: true },
      { key: 'LOKASYON', label: 'Lokasyon' },
    ],
  },
  {
    key: 'cari_ekstre', title: 'Cari Hesap Ekstresi', icon: 'wallet-outline',
    description: 'Cari hesap borç/alacak ekstresi',
    datasetKey: 'rap_cari_hesap_ekstresi_web',
    defaultParams: { BASTARIH: '', BITTARIH: '', Page: 1, PageSize: 100 },
    columns: [
      { key: 'CARI_ADI', label: 'Cari' }, { key: 'TARIH', label: 'Tarih' },
      { key: 'BORC', label: 'Borç', numeric: true }, { key: 'ALACAK', label: 'Alacak', numeric: true },
      { key: 'BAKIYE', label: 'Bakiye', numeric: true },
    ],
  },
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
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Set default dates
  const getDefaultDates = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${d}` };
  };

  const runReport = useCallback(async (report: ReportDef, sDate?: string, eDate?: string) => {
    if (!activeTenantId) return;
    
    setReportLoading(true);
    setReportData([]);

    const dates = getDefaultDates();
    const sd = sDate || startDate || dates.start;
    const ed = eDate || endDate || dates.end;

    const params = { ...report.defaultParams };
    if (params.BASTARIH !== undefined) params.BASTARIH = sd;
    if (params.BITTARIH !== undefined) params.BITTARIH = ed;
    if (params.SONTARIH !== undefined) params.SONTARIH = ed;

    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/report-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, dataset_key: report.datasetKey, params }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        setReportData(data.data);
      }
    } catch (err) {
      console.error('Report run error:', err);
    } finally {
      setReportLoading(false);
    }
  }, [activeTenantId, startDate, endDate]);

  const openReport = (report: ReportDef) => {
    const dates = getDefaultDates();
    setStartDate(dates.start);
    setEndDate(dates.end);
    setSelectedReport(report);
    setReportData([]);
    runReport(report, dates.start, dates.end);
  };

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Veri kaynağı seçilmedi</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Raporlar</Text>
        <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{REPORTS.length} rapor</Text>
      </View>

      {/* Report Grid */}
      <ScrollView contentContainerStyle={styles.gridContent} showsVerticalScrollIndicator={false}>
        {REPORTS.map((report) => (
          <TouchableOpacity
            key={report.key}
            style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => openReport(report)}
            activeOpacity={0.7}
          >
            <View style={[styles.reportIcon, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name={report.icon} size={24} color={colors.primary} />
            </View>
            <Text style={[styles.reportTitle, { color: colors.text }]}>{report.title}</Text>
            <Text style={[styles.reportDesc, { color: colors.textSecondary }]} numberOfLines={2}>{report.description}</Text>
            <View style={styles.reportAction}>
              <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.primary }]}>Rapor Çalıştır</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.primary} />
            </View>
          </TouchableOpacity>
        ))}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Report Result Modal */}
      <Modal visible={!!selectedReport} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            {/* Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedReport?.title}
              </Text>
              <TouchableOpacity onPress={() => { setSelectedReport(null); setReportData([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Date Filters */}
            <View style={[styles.dateRow, { borderBottomColor: colors.border }]}>
              <View style={styles.dateField}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Başlangıç</Text>
                <TextInput
                  style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={styles.dateField}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Bitiş</Text>
                <TextInput
                  style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <TouchableOpacity
                style={[styles.runBtn, { backgroundColor: colors.primary }]}
                onPress={() => selectedReport && runReport(selectedReport)}
              >
                <Ionicons name="play" size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Results */}
            {reportLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[{ color: colors.textSecondary }]}>Rapor çalıştırılıyor...</Text>
                <Text style={[{ color: colors.textSecondary, fontSize: 12 }]}>POS'tan veri alınıyor, lütfen bekleyin</Text>
              </View>
            ) : reportData.length > 0 ? (
              <View style={{ flex: 1 }}>
                <View style={[styles.resultCount, { borderBottomColor: colors.border }]}>
                  <Text style={[{ fontSize: 13, color: colors.textSecondary }]}>{reportData.length} kayıt</Text>
                </View>
                <FlatList
                  data={reportData}
                  keyExtractor={(_, idx) => String(idx)}
                  contentContainerStyle={{ paddingBottom: 30 }}
                  renderItem={({ item, index }) => (
                    <View style={[styles.resultRow, { backgroundColor: index % 2 === 0 ? colors.card : colors.background, borderBottomColor: colors.border }]}>
                      {(selectedReport?.columns || []).map((col) => {
                        const val = item[col.key];
                        const displayVal = col.numeric
                          ? `₺${parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
                          : String(val || '-');
                        return (
                          <View key={col.key} style={styles.resultCell}>
                            <Text style={[styles.resultCellLabel, { color: colors.textSecondary }]}>{col.label}</Text>
                            <Text style={[styles.resultCellValue, { color: col.numeric ? colors.primary : colors.text }]} numberOfLines={1}>
                              {displayVal}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                />
              </View>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
                <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
                <Text style={[{ color: colors.textSecondary }]}>Rapor sonucu bekleniyor</Text>
                <Text style={[{ color: colors.textSecondary, fontSize: 12 }]}>Tarih seçip çalıştırın</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  gridContent: { paddingHorizontal: 16, paddingTop: 12 },
  reportCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  reportIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  reportTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  reportDesc: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  reportAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, flex: 1, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  dateRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  dateField: { flex: 1 },
  dateLabel: { fontSize: 11, marginBottom: 4 },
  dateInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  runBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  resultCount: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  resultRow: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resultCell: { minWidth: '40%', flex: 1 },
  resultCellLabel: { fontSize: 10, textTransform: 'uppercase' },
  resultCellValue: { fontSize: 13, fontWeight: '600' },
});
