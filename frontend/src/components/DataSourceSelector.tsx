import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { getDataBySource } from '../data/mockData';

const DEFAULT_SOURCES: { key: DataSource; label: string }[] = [
  { key: 'data1', label: 'Data 1' },
  { key: 'data2', label: 'Data 2' },
  { key: 'data3', label: 'Data 3' },
];

const DATA_SOURCE_KEYS: DataSource[] = ['data1', 'data2', 'data3'];

const formatCurrency = (amount: number) => {
  return '₺' + amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const DataSourceSelector: React.FC = () => {
  const { colors } = useThemeStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  // Build data sources from user tenants or fallback to defaults
  const dataSources = React.useMemo(() => {
    if (user?.tenants && user.tenants.length > 0) {
      return user.tenants.slice(0, 10).map((tenant, index) => {
        const key = DATA_SOURCE_KEYS[index] || (`data${index + 1}` as DataSource);
        const sourceData = getDataBySource(key);
        const total = sourceData?.weeklyComparison?.thisWeek?.total || 0;
        return {
          key,
          label: tenant.name || `Data ${index + 1}`,
          tenantId: tenant.tenant_id,
          total,
        };
      });
    }
    return DEFAULT_SOURCES.map(s => {
      const sourceData = getDataBySource(s.key);
      const total = sourceData?.weeklyComparison?.thisWeek?.total || 0;
      return { ...s, tenantId: '', total };
    });
  }, [user?.tenants]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {dataSources.map((src) => {
          const isActive = activeSource === src.key;
          return (
            <TouchableOpacity
              key={src.key}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? colors.primary : colors.card,
                  borderColor: isActive ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setActiveSource(src.key)}
              activeOpacity={0.7}
            >
              {isActive && (
                <Ionicons name="checkmark-circle" size={14} color="#fff" style={{ marginRight: 4 }} />
              )}
              <View style={styles.chipContent}>
                <Text
                  style={[
                    styles.chipLabel,
                    { color: isActive ? '#fff' : colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {src.label}
                </Text>
                <Text
                  style={[
                    styles.chipTotal,
                    { color: isActive ? 'rgba(255,255,255,0.85)' : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {formatCurrency(src.total)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 100,
  },
  chipContent: {
    flexDirection: 'column',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  chipTotal: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
});
