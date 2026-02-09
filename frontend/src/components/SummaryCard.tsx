import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';

interface SummaryCardProps {
  title: string;
  amount: number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress?: () => void;
  subtitle?: string;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  amount,
  icon,
  color,
  onPress,
  subtitle,
}) => {
  const { colors } = useThemeStore();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={[styles.title, { color: colors.textSecondary }]}>{title}</Text>
      <Text style={[styles.amount, { color: colors.text }]}>
        ₺{amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
      </Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    marginHorizontal: 4,
    borderWidth: 1,
    minWidth: 150,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  amount: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    marginTop: 4,
  },
});
