/**
 * Rapor Özeti paneli (TOPLAM / EN DÜŞÜK / EN YÜKSEK) — sonuç listesinin üstünde.
 */
import React, { memo, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '../../store/themeStore';
import { SummaryConfig } from '../../reports/types';
import { computeSummaryStats } from '../../reports/summary';
import { fmtMoney, fmtNumber } from '../../reports/format';

interface Props { data: any[]; config: SummaryConfig; colors: ThemeColors }

const ReportSummaryPanelComp: React.FC<Props> = ({ data, config, colors }) => {
  const stats = useMemo(() => computeSummaryStats(data, config), [data, config]);
  if (!stats) return null;

  const fmt = (v: number, type?: 'money' | 'number') => (type === 'money' ? fmtMoney(v) : fmtNumber(v));
  const total = { key: 'total' as const, label: 'TOPLAM', icon: 'stats-chart' as const, color: colors.primary, bg: colors.primary + '10' };
  const statRows = config.showOnlyTotal ? [total] : [
    total,
    { key: 'min' as const, label: 'EN DÜŞÜK', icon: 'trending-down' as const, color: colors.error, bg: colors.error + '0D' },
    { key: 'max' as const, label: 'EN YÜKSEK', icon: 'trending-up' as const, color: colors.success, bg: colors.success + '0D' },
  ];

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.hintRow, { borderBottomColor: colors.border }]}>
        <Ionicons name="stats-chart-outline" size={13} color={colors.primary} />
        <Text style={[styles.hintText, { color: colors.text }]}>Rapor Özeti</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="swap-horizontal" size={12} color={colors.textSecondary} />
        <Text style={[styles.hintMuted, { color: colors.textSecondary }]}>Kaydırın</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
            <View style={styles.labelCol} />
            {config.cols.map(c => (
              <View key={c.key} style={styles.cell}>
                <Text style={[styles.colLabel, { color: colors.textSecondary }]} numberOfLines={1}>{c.label}</Text>
              </View>
            ))}
          </View>
          {statRows.map((stat, idx) => (
            <View key={stat.key} style={[styles.row, { backgroundColor: stat.bg, borderTopColor: colors.border, borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth }]}>
              <View style={styles.labelCol}>
                <View style={[styles.pill, { backgroundColor: stat.color }]}>
                  <Ionicons name={stat.icon} size={11} color="#fff" />
                  <Text style={styles.pillText} numberOfLines={1}>{stat.label}</Text>
                </View>
              </View>
              {config.cols.map(c => (
                <View key={c.key} style={styles.cell}>
                  <Text style={[styles.cellVal, { color: colors.text }]} numberOfLines={1}>{fmt(stats[c.key][stat.key] || 0, c.type)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  headerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', borderBottomWidth: 1 },
  row: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center' },
  labelCol: { width: 106, paddingLeft: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, alignSelf: 'flex-start' },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  cell: { minWidth: 96, paddingHorizontal: 6, alignItems: 'flex-end' },
  colLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textAlign: 'right' },
  cellVal: { fontSize: 12, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  hintText: { fontSize: 12, fontWeight: '700' },
  hintMuted: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
});

export const ReportSummaryPanel = memo(ReportSummaryPanelComp, (p, n) => p.data === n.data && p.config === n.config && p.colors === n.colors);
export default ReportSummaryPanel;
