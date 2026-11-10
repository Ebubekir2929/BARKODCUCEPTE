/**
 * Rapor sonuç modalı: başlık (filtrelere dön / kapat), arama + Excel/PDF araç çubuğu,
 * sıralama çubuğu, kayıt sayısı + tazelik rozeti, sonuç listesi (kart / hiyerarşik),
 * POS "hazırlanıyor" bekleme ekranı ve dışa aktarma overlay'i.
 */
import React from 'react';
import { View, Text, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import FreshnessBadge from '../FreshnessBadge';
import { CustomAlert } from '../CustomAlert';
import { pendingLabel } from '../../utils/reportFetch';
import { FilterValues, ReportDef } from '../../reports/types';
import { ReportRunner } from '../../hooks/useReportRunner';
import { ProcessedRows } from '../../hooks/useProcessedRows';
import { reportModalStyles as ms } from './reportStyles';
import { ReportCard } from './ReportCard';
import { HierarchicalRow } from './HierarchicalRow';
import { ReportSummaryPanel } from './ReportSummaryPanel';
import { TopBanner } from './TopBanner';
import { SortBar } from './SortBar';
import { PdfProgressOverlay, PdfProgress } from './PdfProgressOverlay';

interface Props {
  visible: boolean;
  report: ReportDef | null;
  title: string;
  filterValues: FilterValues;
  runner: ReportRunner;
  rows: ProcessedRows;
  exportLoading: boolean;
  /** PDF üretim ilerlemesi (modal içinde çizilir; kökte kalırsa native Modal'ın arkasında kalır) */
  pdfProgress: PdfProgress | null;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onBackToFilters: () => void;
  onClose: () => void;
  /** Rapor / dışa aktarma hataları için inline CustomAlert (native Modal üstünde görünür) */
  alertProps: React.ComponentProps<typeof CustomAlert>;
}

export const ReportResultModal: React.FC<Props> = ({
  visible, report, title, filterValues, runner, rows, exportLoading, pdfProgress, onExportExcel, onExportPdf, onBackToFilters, onClose, alertProps,
}) => {
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const altBosluk = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);
  const { reportData, reportLoading, reportAgeSec, pendingInfo } = runner;
  const { processedData, isProcessing, isSorting, searchFilter, debouncedSearch } = rows;

  const countText = reportLoading
    ? 'Çalıştırılıyor...'
    : `${processedData.length.toLocaleString('tr-TR')} kayıt${debouncedSearch && processedData.length !== reportData.length ? ` · toplam ${reportData.length.toLocaleString('tr-TR')}` : ''}`;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle={Platform.OS === 'web' ? 'overFullScreen' : undefined} statusBarTranslucent>
      <View style={ms.overlay}>
        <View style={[ms.content, { backgroundColor: colors.surface, maxHeight: Platform.OS === 'web' ? '92%' : '85%', paddingBottom: altBosluk }]}>
          <View style={[ms.header, { borderBottomColor: colors.border }]}>
            <Text style={[ms.headerTitle, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity style={{ marginRight: 8 }} onPress={onBackToFilters} testID="result-back-to-filters">
              <Ionicons name="options-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} testID="result-close"><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
          </View>

          <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
            <View style={[ms.searchInput, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
              <Ionicons name="search" size={14} color={colors.textSecondary} />
              <TextInput
                style={{ flex: 1, fontSize: 12, color: colors.text, paddingVertical: 0 }}
                placeholder="Ara..."
                placeholderTextColor={colors.textSecondary}
                value={searchFilter}
                onChangeText={rows.setSearchFilter}
                returnKeyType="search"
              />
              {isProcessing && searchFilter.length > 0 ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : searchFilter.length > 0 ? (
                <TouchableOpacity onPress={rows.clearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.success + '18' }]} onPress={onExportExcel} disabled={exportLoading} testID="export-excel">
              {exportLoading ? <ActivityIndicator size="small" color={colors.success} /> : <Ionicons name="grid-outline" size={14} color={colors.success} />}
              <Text style={{ fontSize: 10, color: colors.success, fontWeight: '700' }}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.error + '15' }]} onPress={onExportPdf} disabled={exportLoading} testID="export-pdf">
              {exportLoading ? <ActivityIndicator size="small" color={colors.error} /> : <Ionicons name="document-text-outline" size={14} color={colors.error} />}
              <Text style={{ fontSize: 10, color: colors.error, fontWeight: '700' }}>PDF</Text>
            </TouchableOpacity>
          </View>

          {report && !reportLoading && processedData.length > 0 && !report.disableSort && (
            <SortBar report={report} sortKey={rows.sortKey} sortAsc={rows.sortAsc} onToggle={rows.toggleSort} onClear={rows.clearSort} />
          )}

          <View style={styles.countRow}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: reportLoading ? colors.primary : colors.text }}>{countText}</Text>
            {!reportLoading && reportData.length > 0 && <FreshnessBadge ageSec={reportAgeSec} />}
            {isProcessing && !reportLoading && reportData.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ fontSize: 10, color: colors.primary, fontWeight: '600' }}>{isSorting ? 'Sıralanıyor...' : 'İşleniyor...'}</Text>
              </View>
            )}
          </View>

          {reportLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.textSecondary }}>{pendingInfo ? pendingLabel(pendingInfo) : "POS'tan veri alınıyor..."}</Text>
              {pendingInfo && (
                <>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center' }}>
                    Rapor POS bilgisayarında hazırlanıyor; bitince otomatik gelecek. Uzun tarih aralıkları daha uzun sürer.
                  </Text>
                  <TouchableOpacity testID="report-pending-cancel" onPress={runner.cancel} style={[styles.cancelBtn, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.error, fontWeight: '700' }}>Beklemeyi İptal Et</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : processedData.length > 0 && report ? (
            <FlatList
              data={processedData}
              keyExtractor={(_, idx) => String(idx)}
              contentContainerStyle={{ padding: 12, paddingBottom: 30, gap: 8 }}
              initialNumToRender={15}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews={Platform.OS !== 'web'}
              updateCellsBatchingPeriod={50}
              ListHeaderComponent={
                <>
                  <TopBanner report={report} data={reportData} filterValues={filterValues} colors={colors} />
                  {report.summary && <ReportSummaryPanel data={reportData} config={report.summary} colors={colors} />}
                </>
              }
              renderItem={({ item }) => (
                report.hierarchical
                  ? <HierarchicalRow item={item} report={report} colors={colors} />
                  : <ReportCard item={item} report={report} colors={colors} />
              )}
            />
          ) : (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary }}>Sonuç bulunamadı</Text>
            </View>
          )}

          {exportLoading && !pdfProgress && (
            <View style={[ms.innerOverlay, { backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 9998 }]}>
              <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 30, alignItems: 'center', minWidth: 200 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12 }}>Dosya hazırlanıyor...</Text>
              </View>
            </View>
          )}
          <PdfProgressOverlay progress={pdfProgress} />
          <CustomAlert {...alertProps} inline />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 6, borderBottomWidth: 1 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  countRow: { paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  cancelBtn: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, minHeight: 44, justifyContent: 'center' },
});

export default ReportResultModal;
