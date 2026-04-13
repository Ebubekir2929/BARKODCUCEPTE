import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import { useAuthStore } from '../store/authStore';
import { getDataBySource } from '../data/mockData';

const DATA_SOURCE_KEYS: DataSource[] = ['data1', 'data2', 'data3'];

const formatCurrency = (amount: number) => {
  return '₺' + amount.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

// === DASHBOARD: Full interactive selector with cards ===
export const DataSourceSelector: React.FC = () => {
  const { colors } = useThemeStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { user } = useAuthStore();

  const dataSources = React.useMemo(() => {
    if (user?.tenants && user.tenants.length > 0) {
      return user.tenants.slice(0, 10).map((tenant, index) => {
        const key = DATA_SOURCE_KEYS[index] || (`data${index + 1}` as DataSource);
        const sourceData = getDataBySource(key);
        const total = sourceData?.weeklyComparison?.thisWeek?.total || 0;
        const lastWeekTotal = sourceData?.weeklyComparison?.lastWeek?.total || 0;
        const changePercent = lastWeekTotal > 0 ? ((total - lastWeekTotal) / lastWeekTotal) * 100 : 0;
        const branchCount = sourceData?.branchSales?.length || 0;
        return {
          key,
          label: tenant.name || `Data ${index + 1}`,
          tenantId: tenant.tenant_id,
          total,
          changePercent,
          branchCount,
          isUp: changePercent >= 0,
        };
      });
    }
    return DATA_SOURCE_KEYS.map((key, index) => {
      const sourceData = getDataBySource(key);
      const total = sourceData?.weeklyComparison?.thisWeek?.total || 0;
      const lastWeekTotal = sourceData?.weeklyComparison?.lastWeek?.total || 0;
      const changePercent = lastWeekTotal > 0 ? ((total - lastWeekTotal) / lastWeekTotal) * 100 : 0;
      const branchCount = sourceData?.branchSales?.length || 0;
      return {
        key,
        label: `Data ${index + 1}`,
        tenantId: '',
        total,
        changePercent,
        branchCount,
        isUp: changePercent >= 0,
      };
    });
  }, [user?.tenants]);

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
                styles.card,
                {
                  backgroundColor: isActive ? colors.primary : colors.card,
                  borderColor: isActive ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setActiveSource(src.key)}
              activeOpacity={0.7}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardLabelRow}>
                  {isActive && (
                    <View style={[styles.activeDot, { backgroundColor: '#fff' }]} />
                  )}
                  <Text
                    style={[
                      styles.cardLabel,
                      { color: isActive ? '#fff' : colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {src.label}
                  </Text>
                </View>
                <View style={styles.cardBranchRow}>
                  <Ionicons
                    name="business-outline"
                    size={11}
                    color={isActive ? 'rgba(255,255,255,0.7)' : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.cardBranch,
                      { color: isActive ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                    ]}
                  >
                    {src.branchCount} Şube
                  </Text>
                </View>
              </View>
              <Text
                style={[
                  styles.cardTotal,
                  { color: isActive ? '#fff' : colors.text },
                ]}
                numberOfLines={1}
              >
                {formatCurrency(src.total)}
              </Text>
              <View style={styles.cardChangeRow}>
                <Ionicons
                  name={src.isUp ? 'trending-up' : 'trending-down'}
                  size={13}
                  color={isActive
                    ? (src.isUp ? 'rgba(255,255,255,0.85)' : 'rgba(255,180,180,0.9)')
                    : (src.isUp ? '#10B981' : '#EF4444')
                  }
                />
                <Text
                  style={[
                    styles.cardChange,
                    {
                      color: isActive
                        ? (src.isUp ? 'rgba(255,255,255,0.85)' : 'rgba(255,180,180,0.9)')
                        : (src.isUp ? '#10B981' : '#EF4444'),
                    },
                  ]}
                >
                  {src.isUp ? '+' : ''}{src.changePercent.toFixed(1)}%
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// === OTHER PAGES: Small indicator showing active source ===
export const ActiveSourceIndicator: React.FC = () => {
  const { colors } = useThemeStore();
  const { activeSource } = useDataSourceStore();
  const { user } = useAuthStore();

  const activeLabel = React.useMemo(() => {
    if (user?.tenants && user.tenants.length > 0) {
      const index = DATA_SOURCE_KEYS.indexOf(activeSource);
      if (index >= 0 && index < user.tenants.length) {
        return user.tenants[index].name;
      }
    }
    const idx = DATA_SOURCE_KEYS.indexOf(activeSource);
    return `Data ${idx + 1}`;
  }, [user?.tenants, activeSource]);

  return (
    <View style={[styles.indicatorContainer, { borderBottomColor: colors.border }]}>
      <View style={[styles.indicatorChip, { backgroundColor: colors.primary + '15' }]}>
        <View style={[styles.indicatorDot, { backgroundColor: colors.primary }]} />
        <Text style={[styles.indicatorText, { color: colors.primary }]} numberOfLines={1}>
          {activeLabel}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Dashboard Selector Styles
  container: {
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  card: {
    width: 140,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  cardTop: {
    marginBottom: 8,
  },
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  cardBranchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  cardBranch: {
    fontSize: 11,
  },
  cardTotal: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  cardChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  cardChange: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Active Source Indicator Styles
  indicatorContainer: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  indicatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  indicatorText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
