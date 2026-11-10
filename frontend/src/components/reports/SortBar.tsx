/**
 * Sonuç listesi sıralama çubuğu (kompakt pill'ler). cardLayout varsa başlık / tutar /
 * çip alanları, yoksa tüm kolonlar sıralanabilir.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useLanguageStore } from '../../store/languageStore';
import { ReportDef } from '../../reports/types';
import { translateLabel } from '../../reports/labels';

interface Props {
  report: ReportDef;
  sortKey: string;
  sortAsc: boolean;
  onToggle: (key: string) => void;
  onClear: () => void;
}

const sortOptions = (report: ReportDef): { key: string; label: string }[] => {
  const cl = report.cardLayout;
  if (!cl) return report.columns;
  const colLabel = (key: string) => report.columns.find(c => c.key === key)?.label;
  return [
    cl.title ? { key: cl.title, label: colLabel(cl.title) || 'Ad' } : null,
    cl.amount ? { key: cl.amount, label: cl.amountLabel || 'Fiyat' } : null,
    ...(cl.chips || []).map(c => ({ key: c.key, label: c.label || colLabel(c.key) || c.key })),
  ].filter(Boolean) as { key: string; label: string }[];
};

export const SortBar: React.FC<Props> = ({ report, sortKey, sortAsc, onToggle, onClear }) => {
  const { colors } = useThemeStore();
  const { t, language } = useLanguageStore();
  return (
    <View style={[styles.bar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.iconBox}>
        <Ionicons name="swap-vertical" size={13} color={colors.textSecondary} />
        <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>Sırala</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, alignItems: 'center' }}>
        {sortOptions(report).map(col => {
          const active = sortKey === col.key;
          return (
            <TouchableOpacity
              key={col.key}
              style={[styles.pill, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
              onPress={() => onToggle(col.key)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: active ? '#fff' : colors.text }} numberOfLines={1}>{translateLabel(col.label, language)}</Text>
              {active && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={11} color="#fff" />}
            </TouchableOpacity>
          );
        })}
        {sortKey !== '' && (
          <TouchableOpacity onPress={onClear} style={[styles.pill, { backgroundColor: 'transparent', borderColor: colors.border }]}>
            <Ionicons name="close" size={11} color={colors.textSecondary} />
            <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>{t('clear')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1 },
  iconBox: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingRight: 6, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#ccc', marginRight: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});

export default SortBar;
