import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';

const DEFAULT_SOURCES: { key: DataSource; label: string }[] = [
  { key: 'data1', label: 'Data 1' },
  { key: 'data2', label: 'Data 2' },
  { key: 'data3', label: 'Data 3' },
];

const DATA_SOURCE_KEYS: DataSource[] = ['data1', 'data2', 'data3'];

export const DataSourceSelector: React.FC = () => {
  const { colors } = useThemeStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  // Build data sources from user tenants or fallback to defaults
  const dataSources = React.useMemo(() => {
    if (user?.tenants && user.tenants.length > 0) {
      return user.tenants.slice(0, 10).map((tenant, index) => ({
        key: DATA_SOURCE_KEYS[index] || (`data${index + 1}` as DataSource),
        label: tenant.name || `Data ${index + 1}`,
        tenantId: tenant.tenant_id,
      }));
    }
    return DEFAULT_SOURCES.map(s => ({ ...s, tenantId: '' }));
  }, [user?.tenants]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.inner}>
        <View style={styles.labelRow}>
          <Ionicons name="server-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t('data_source')}:</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {dataSources.map((src) => {
            const isActive = activeSource === src.key;
            return (
              <TouchableOpacity
                key={src.key}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isActive ? colors.primary : colors.background,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setActiveSource(src.key)}
                activeOpacity={0.7}
              >
                {isActive && (
                  <Ionicons name="checkmark-circle" size={14} color="#fff" style={{ marginRight: 4 }} />
                )}
                <Text
                  style={[
                    styles.chipText,
                    { color: isActive ? '#fff' : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {src.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 150,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
