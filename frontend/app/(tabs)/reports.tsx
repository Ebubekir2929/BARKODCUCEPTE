/**
 * Raporlar sekmesi — rapor listesi + filtre modalı + sonuç modalı.
 * 2026-11 refactor: tanımlar `src/reports/`, veri akışı `src/hooks/useReport*`,
 * görsel parçalar `src/components/reports/` altında.
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { useUIStore } from '../../src/store/uiStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import { useAlert } from '../../src/components/CustomAlert';
import { RecentRun, useReportPrefsStore } from '../../src/store/reportPrefsStore';
import { ALL_REPORTS } from '../../src/reports/definitions';
import { FilterValues, ReportDef } from '../../src/reports/types';
import { reportDesc, reportTitle } from '../../src/reports/labels';
import { buildInitialFilterValues, validateFilters } from '../../src/reports/params';
import { exportReportPdf } from '../../src/reports/exportPdf';
import { exportReportExcel } from '../../src/reports/exportExcel';
import { useReportLookups } from '../../src/hooks/useReportLookups';
import { useReportRunner } from '../../src/hooks/useReportRunner';
import { useProcessedRows } from '../../src/hooks/useProcessedRows';
import { ReportFilterModal } from '../../src/components/reports/ReportFilterModal';
import { ReportResultModal } from '../../src/components/reports/ReportResultModal';
import { PdfProgress } from '../../src/components/reports/PdfProgressOverlay';
import { RecentReportsRow } from '../../src/components/reports/RecentReportsRow';
import { PosOfflineBanner } from '../../src/components/reports/PosOfflineBanner';

const EMPTY_RUNS: RecentRun[] = [];

export default function ReportsScreen() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  // İki ayrı uyarı kutusu: filtre modalı içi (zorunlu filtre, favori) ve sonuç modalı içi
  // (rapor / dışa aktarma hataları). Aynı alertProps iki yerde çizilince uyarı çiftleniyordu.
  const filterAlert = useAlert();
  const resultAlert = useAlert();
  const { showWarning: showResultWarning, showError: showResultError, showInfo: showResultInfo } = resultAlert;

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const idx = match ? parseInt(match[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [exportLoading, setExportLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null);

  const { lookupCache, fetchLookupSource } = useReportLookups(activeTenantId, selectedReport);
  const runner = useReportRunner(activeTenantId, showResultError);
  const rows = useProcessedRows(runner.reportData, selectedReport, filterValues);

  const hydratePrefs = useReportPrefsStore(s => s.hydrate);
  const recentRuns = useReportPrefsStore(s => s.recent[activeTenantId]) || EMPTY_RUNS;
  useEffect(() => { hydratePrefs(); }, [hydratePrefs]);

  // Sekmeden ayrılınca uçuştaki istekleri iptal et. expo-router sekme geçişinde ekranı
  // unmount etmez; useEffect cleanup çıkışta çalışmaz — doğru kanca useFocusEffect.
  const { cancel } = runner;
  useFocusEffect(useCallback(() => () => cancel(), [cancel]));

  const title = selectedReport ? reportTitle(selectedReport, t) : '';

  const openReportFilter = (report: ReportDef) => {
    setFilterValues(buildInitialFilterValues(report));
    setSelectedReport(report);
    setShowFilterModal(true);
    runner.clear();
    rows.reset();
  };

  const onFilterChange = useCallback((name: string, value: any) => {
    setFilterValues(prev => ({ ...prev, [name]: value }));
  }, []);

  /** Favori: tarih dışı tüm filtreler favorideki değerlerle değiştirilir, tarihler korunur. */
  const applyFavoriteValues = useCallback((values: FilterValues) => {
    if (!selectedReport) return;
    setFilterValues(prev => {
      const next = buildInitialFilterValues(selectedReport);
      selectedReport.filters.forEach(f => { if (f.type === 'date' && prev[f.name]) next[f.name] = prev[f.name]; });
      return { ...next, ...values };
    });
  }, [selectedReport]);

  const openResultAndRun = async (report: ReportDef, values: FilterValues) => {
    Keyboard.dismiss();
    setShowFilterModal(false);
    // iOS: arka arkaya modal geçişini stabilize et
    if (Platform.OS === 'ios') await new Promise(r => setTimeout(r, 350));
    setShowResultModal(true);
    useReportPrefsStore.getState().addRecent(activeTenantId, report.key, values);
    runner.run(report, values);
  };

  const runReport = () => {
    if (!activeTenantId || !selectedReport) return;
    const err = validateFilters(selectedReport, filterValues);
    if (err) { filterAlert.showWarning(err.title, err.message, [{ text: 'Tamam', style: 'default' }]); return; }
    openResultAndRun(selectedReport, filterValues);
  };

  /** Son Raporlar kartı: aynı filtrelerle tek dokunuşta yeniden çalıştır. */
  const rerunRecent = (run: RecentRun) => {
    const report = ALL_REPORTS.find(r => r.key === run.reportKey);
    if (!report || !activeTenantId) return;
    setSelectedReport(report);
    setFilterValues(run.filterValues);
    runner.clear();
    rows.reset();
    openResultAndRun(report, run.filterValues);
  };

  const backToFilters = () => {
    runner.cancel();
    Keyboard.dismiss();
    setShowResultModal(false);
    setTimeout(() => setShowFilterModal(true), Platform.OS === 'ios' ? 350 : 50);
  };

  const closeResult = () => {
    runner.cancel();
    setShowResultModal(false);
    setSelectedReport(null);
    runner.clear();
  };

  const exportPdf = async () => {
    if (!selectedReport || rows.processedData.length === 0) return;
    setExportLoading(true);
    try {
      const res = await exportReportPdf({
        report: selectedReport, rows: rows.processedData, filterValues,
        onProgress: (done, total) => setPdfProgress({ done, total }),
      });
      if (res === 'popup_blocked') showResultWarning('Popup engellendi', 'Tarayıcı yeni sekme açmaya izin vermedi. Popup izni verin.');
      else if (typeof res === 'object') showResultInfo('PDF hazır', `Dosya: ${res.savedUri}`);
    } catch (err) {
      console.error('PDF export error:', err);
      showResultError('PDF Hatası', 'PDF oluşturulurken bir hata oluştu. Veri çok büyükse Excel/CSV deneyin.');
    } finally {
      setExportLoading(false);
      setPdfProgress(null);
    }
  };

  const exportExcel = async () => {
    if (!selectedReport || rows.processedData.length === 0) return;
    setExportLoading(true);
    await new Promise(resolve => setTimeout(resolve, 0)); // overlay önce çizilsin
    try {
      await exportReportExcel(selectedReport, rows.processedData);
    } catch (err) {
      console.error('Excel export error:', err);
      showResultError('Excel Hatası', 'Excel oluşturulurken bir hata oluştu.');
    } finally {
      setExportLoading(false);
    }
  };

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary }}>{t('no_data_source_selected') || 'Veri kaynağı seçilmedi'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />
      <PosOfflineBanner tenantId={activeTenantId} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('reports')}</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 }}
        onScroll={(e) => useUIStore.getState().reportScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <RecentReportsRow
          runs={recentRuns}
          onOpen={rerunRecent}
          onRemove={run => useReportPrefsStore.getState().removeRecent(activeTenantId, run.id)}
          onClear={() => useReportPrefsStore.getState().clearRecent(activeTenantId)}
        />
        {ALL_REPORTS.map(report => (
          <TouchableOpacity
            key={report.key}
            style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => openReportFilter(report)}
            activeOpacity={0.7}
            testID={`report-${report.key}`}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.reportIcon, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name={report.icon} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{reportTitle(report, t)}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>{reportDesc(report, t)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ReportFilterModal
        visible={showFilterModal}
        report={selectedReport}
        title={title}
        tenantId={activeTenantId}
        filterValues={filterValues}
        onChange={onFilterChange}
        onApplyValues={applyFavoriteValues}
        onClose={() => setShowFilterModal(false)}
        onRun={runReport}
        lookupCache={lookupCache}
        fetchLookupSource={fetchLookupSource}
        alert={filterAlert}
      />

      <ReportResultModal
        visible={showResultModal}
        report={selectedReport}
        title={title}
        filterValues={filterValues}
        runner={runner}
        rows={rows}
        exportLoading={exportLoading}
        pdfProgress={pdfProgress}
        onExportExcel={exportExcel}
        onExportPdf={exportPdf}
        onBackToFilters={backToFilters}
        onClose={closeResult}
        alertProps={resultAlert.alertProps}
      />
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
});
