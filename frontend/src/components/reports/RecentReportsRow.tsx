/**
 * "Son Raporlar" — rapor listesinin üstünde yatay kaydırmalı son 5 çalıştırma.
 * Tek dokunuşla aynı filtrelerle yeniden çalışır; uzun basınca tek kayıt silinir.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useLanguageStore } from '../../store/languageStore';
import { RecentRun } from '../../store/reportPrefsStore';
import { ALL_REPORTS } from '../../reports/definitions';
import { reportTitle, summarizeFilters } from '../../reports/labels';
import { fmtAge } from '../FreshnessBadge';

interface Props {
  runs: RecentRun[];
  onOpen: (run: RecentRun) => void;
  onRemove: (run: RecentRun) => void;
  onClear: () => void;
}

export const RecentReportsRow: React.FC<Props> = ({ runs, onOpen, onRemove, onClear }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  if (runs.length === 0) return null;
  const now = Date.now();

  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.headerRow}>
        <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
        <Text style={[styles.headerText, { color: colors.textSecondary }]}>Son Raporlar</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="recent-clear">
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>{t('clear')}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {runs.map((run, index) => {
          const report = ALL_REPORTS.find(r => r.key === run.reportKey);
          if (!report) return null;
          return (
            <TouchableOpacity
              key={run.id}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => onOpen(run)}
              onLongPress={() => onRemove(run)}
              activeOpacity={0.75}
              testID={`recent-${run.reportKey}-${index}`}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.icon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name={report.icon} size={16} color={colors.primary} />
                </View>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{reportTitle(report, t)}</Text>
              </View>
              <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>{summarizeFilters(report, run.filterValues)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto' }}>
                <Ionicons name="play-circle" size={14} color={colors.primary} />
                <Text style={{ fontSize: 10, fontWeight: '600', color: colors.primary }}>Tekrar çalıştır</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 10, color: colors.textSecondary }}>{fmtAge(Math.max(0, (now - run.at) / 1000))}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, paddingHorizontal: 2 },
  headerText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  card: { width: 200, minHeight: 104, borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  icon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: '700', flex: 1 },
  summary: { fontSize: 11, lineHeight: 15 },
});

export default RecentReportsRow;
