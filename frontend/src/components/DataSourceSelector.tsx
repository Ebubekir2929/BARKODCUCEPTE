import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useDataSourceStore, DataSource } from '../store/dataSourceStore';
import { useLanguageStore } from '../store/languageStore';

const DATA_SOURCES: { key: DataSource; label: string }[] = [
  { key: 'data1', label: 'Data 1' },
  { key: 'data2', label: 'Data 2' },
  { key: 'data3', label: 'Data 3' },
];

export const DataSourceSelector: React.FC = () => {
  const { colors } = useThemeStore();
  const { activeSource, setActiveSource } = useDataSourceStore();
  const { t } = useLanguageStore();

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.inner}>
        <View style={styles.labelRow}>
          <Ionicons name="server-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t('data_source')}:</Text>
        </View>
        <View style={styles.chipsRow}>
          {DATA_SOURCES.map((src) => {
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
                >
                  {src.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
