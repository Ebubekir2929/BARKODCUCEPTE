import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useLanguageStore } from '../store/languageStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import { useAuthStore } from '../store/authStore';

// Build dynamic keys based on count: data1, data2, ..., dataN
const keyFor = (index: number): DataSource => `data${index + 1}`;

const formatCurrency = (amount: number) => {
  return '₺' + amount.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

interface DataSourceSelectorProps {
  totals?: Record<string, number>; // key → total amount from live data
}

// === DASHBOARD: Compact interactive selector ===
export const DataSourceSelector: React.FC<DataSourceSelectorProps> = ({ totals }) => {
  const { colors } = useThemeStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { user } = useAuthStore();

  const dataSources = React.useMemo(() => {
    if (user?.tenants && user.tenants.length > 0) {
      // Unlimited tenants — every tenant gets its own data source key
      return user.tenants.map((tenant, index) => {
        const key = keyFor(index);
        const total = totals?.[key] ?? 0;
        return { key, label: tenant.name || `Data ${index + 1}`, total };
      });
    }
    return [];
  }, [user?.tenants, totals]);

  if (dataSources.length === 0) return null;

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
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
              <Ionicons
                name={isActive ? 'radio-button-on' : 'radio-button-off'}
                size={16}
                color={isActive ? '#fff' : colors.textSecondary}
              />
              <View style={styles.chipTexts}>
                <Text
                  style={[styles.chipLabel, { color: isActive ? '#fff' : colors.text }]}
                  numberOfLines={1}
                >
                  {src.label}
                </Text>
                {src.total > 0 && (
                  <Text
                    style={[styles.chipTotal, { color: isActive ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {formatCurrency(src.total)}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// === OTHER PAGES: Elegant active source display ===
export const ActiveSourceIndicator: React.FC = () => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { activeSource } = useDataSourceStore();
  const { user } = useAuthStore();

  const activeLabel = React.useMemo(() => {
    if (user?.tenants && user.tenants.length > 0) {
      // Extract numeric index from 'dataN' key
      const match = /^data(\d+)$/.exec(activeSource || '');
      const index = match ? parseInt(match[1], 10) - 1 : -1;
      if (index >= 0 && index < user.tenants.length) {
        return user.tenants[index].name;
      }
    }
    return null;
  }, [user?.tenants, activeSource]);

  if (!activeLabel) return null;

  return (
    <View style={[styles.indicatorBar, { borderBottomColor: colors.border }]}>
      <Ionicons name="server-outline" size={14} color={colors.primary} />
      <Text style={[styles.indicatorLabel, { color: colors.textSecondary }]}>{t('data_source')}:</Text>
      <Text style={[styles.indicatorName, { color: colors.primary }]} numberOfLines={1}>{activeLabel}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  chipTexts: {},
  chipLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  chipTotal: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  indicatorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 6,
  },
  indicatorLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  indicatorName: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
});
