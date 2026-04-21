import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useLanguageStore } from '../store/languageStore';

interface SummaryCardProps {
  title: string;
  amount: number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress?: () => void;
  subtitle?: string;
  lastWeekAmount?: number;
  changePercent?: number;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  amount,
  icon,
  color,
  onPress,
  subtitle,
  lastWeekAmount,
  changePercent,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const isPositive = changePercent !== undefined && changePercent >= 0;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon} size={22} color={color} />
        </View>
        {changePercent !== undefined && (
          <View style={[styles.changeBadge, { backgroundColor: isPositive ? colors.success + '15' : colors.error + '15' }]}>
            <Ionicons 
              name={isPositive ? 'trending-up' : 'trending-down'} 
              size={12} 
              color={isPositive ? colors.success : colors.error} 
            />
            <Text style={[styles.changeText, { color: isPositive ? colors.success : colors.error }]}>
              %{Math.abs(changePercent).toFixed(1)}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.title, { color: colors.textSecondary }]}>{title}</Text>
      <Text style={[styles.amount, { color: colors.text }]}>
        ₺{amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
      </Text>
      {lastWeekAmount !== undefined && (
        <View style={styles.lastWeekRow}>
          <Text style={[styles.lastWeekLabel, { color: colors.textSecondary }]}>Geçen hafta: </Text>
          <Text style={[styles.lastWeekValue, { color: colors.textSecondary }]}>
            ₺{lastWeekAmount.toLocaleString('tr-TR')}
          </Text>
        </View>
      )}
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    marginHorizontal: 4,
    borderWidth: 1,
    minWidth: 150,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 2,
  },
  changeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  title: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 3,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
  },
  lastWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  lastWeekLabel: {
    fontSize: 10,
  },
  lastWeekValue: {
    fontSize: 10,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 10,
    marginTop: 4,
  },
});
