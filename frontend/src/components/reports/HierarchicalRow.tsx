/**
 * Hiyerarşik satır — Gelir Tablosu gibi SEVIYE'li raporlar için (girintili, seviyeye göre vurgulu).
 */
import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '../../store/themeStore';
import { ReportDef } from '../../reports/types';
import { fmtMoney, toNum } from '../../reports/format';

interface Props { item: any; report: ReportDef; colors: ThemeColors }

const HierarchicalRowComp: React.FC<Props> = ({ item, report, colors }) => {
  const cfg = report.hierarchical!;
  const level = Number(item[cfg.levelKey] ?? 0);
  const label = String(item[cfg.labelKey] ?? '');
  const valRaw = toNum(item[cfg.valueKey]);
  const isNegative = valRaw < 0;

  let bg = colors.card;
  let labelColor = colors.text;
  let valueColor = isNegative ? colors.error : colors.text;
  let fontWeight: '400' | '500' | '600' | '700' | '800' = '400';
  let fontSize = 13;
  if (level === 0) { bg = colors.primary + '18'; labelColor = colors.primary; fontWeight = '800'; fontSize = 14; }
  else if (level === 1) { fontWeight = '600'; }
  else if (level === 2) { bg = colors.background; fontWeight = '500'; }
  else { bg = colors.background; fontSize = 12; }
  if (isNegative && level === 0) { bg = colors.error + '15'; labelColor = colors.error; valueColor = colors.error; }

  return (
    <View style={[styles.row, { backgroundColor: bg, borderBottomColor: colors.border, paddingLeft: 14 + level * 18 }]}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {level > 0 && <Ionicons name="return-down-forward" size={12} color={colors.textSecondary} />}
        <Text style={{ fontSize, color: labelColor, fontWeight, flex: 1 }} numberOfLines={2}>{label}</Text>
      </View>
      <Text style={{ fontSize, fontWeight: level === 0 ? '800' : '700', color: valueColor, textAlign: 'right', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{fmtMoney(valRaw)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
});

export const HierarchicalRow = memo(HierarchicalRowComp, (p, n) => p.item === n.item && p.report === n.report && p.colors === n.colors);
export default HierarchicalRow;
