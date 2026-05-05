import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';

/**
 * DataTable — desktop/tablet spreadsheet-style list used on wide screens.
 *
 * Uses FlashList for virtualized rows + a sticky header with sortable columns.
 * Designed to replace card layouts in Stock/Customers on the web dashboard.
 */

export type TableAlign = 'left' | 'right' | 'center';

export interface TableColumn<T> {
  key: string;
  label: string;
  /** Flexible width ratio (used in flex layout). */
  flex?: number;
  /** Fixed minimum width in px (prevents collapse on narrow desktops). */
  minWidth?: number;
  align?: TableAlign;
  numeric?: boolean;
  /** Custom cell renderer. Defaults to String(item[key] ?? ''). */
  render?: (item: T, index: number) => React.ReactNode;
  /** Custom sorter value — defaults to item[key]. */
  sortValue?: (item: T) => number | string;
  /** When false, header click will not sort this column. */
  sortable?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  keyExtractor: (item: T, idx: number) => string;
  onRowPress?: (item: T, idx: number) => void;
  estimatedItemSize?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  ListEmptyComponent?: React.ReactElement | null;
  /** Optional initial sort column key. */
  initialSortKey?: string;
  initialSortDir?: 'asc' | 'desc';
  /** Reduce vertical density (38px row vs 48px). */
  dense?: boolean;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    data, columns, keyExtractor, onRowPress,
    estimatedItemSize = 48, refreshing, onRefresh,
    ListEmptyComponent, initialSortKey, initialSortDir = 'asc', dense = false,
  } = props;
  const { colors } = useThemeStore();

  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find(c => c.key === sortKey);
    if (!col) return data;
    const getter = col.sortValue || ((it: any) => it?.[sortKey]);
    const dir = sortDir === 'asc' ? 1 : -1;
    const arr = [...data];
    arr.sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      // Numeric compare
      const na = parseFloat(va as any);
      const nb = parseFloat(vb as any);
      const bothNum = !isNaN(na) && !isNaN(nb) && (col.numeric || (typeof va === 'number' || typeof vb === 'number'));
      if (bothNum) return (na - nb) * dir;
      const sa = String(va ?? '').toLocaleLowerCase('tr-TR');
      const sb = String(vb ?? '').toLocaleLowerCase('tr-TR');
      return sa.localeCompare(sb, 'tr-TR') * dir;
    });
    return arr;
  }, [data, columns, sortKey, sortDir]);

  const handleHeaderPress = useCallback((col: TableColumn<T>) => {
    if (col.sortable === false) return;
    setSortKey(prev => {
      if (prev === col.key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return col.key;
    });
  }, []);

  const rowHeight = dense ? 38 : 48;

  const renderRow = useCallback(({ item, index }: { item: T; index: number }) => {
    const zebra = index % 2 === 1;
    return (
      <TouchableOpacity
        activeOpacity={onRowPress ? 0.6 : 1}
        onPress={() => onRowPress?.(item, index)}
        style={[
          styles.row,
          {
            height: rowHeight,
            backgroundColor: zebra ? colors.background : colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {columns.map((col) => {
          const content = col.render
            ? col.render(item, index)
            : <Text style={{ fontSize: 12.5, color: colors.text }} numberOfLines={1}>{String((item as any)?.[col.key] ?? '')}</Text>;
          return (
            <View
              key={col.key}
              style={[
                styles.cell,
                {
                  flex: col.flex ?? 1,
                  minWidth: col.minWidth,
                  justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                },
              ]}
            >
              {typeof content === 'string' || typeof content === 'number'
                ? <Text style={{ fontSize: 12.5, color: colors.text }} numberOfLines={1}>{String(content)}</Text>
                : content}
            </View>
          );
        })}
      </TouchableOpacity>
    );
  }, [columns, colors, rowHeight, onRowPress]);

  return (
    <View style={[styles.wrapper, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Sticky Header */}
      <View style={[styles.headerRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {columns.map((col) => {
          const active = sortKey === col.key;
          return (
            <TouchableOpacity
              key={col.key}
              activeOpacity={col.sortable === false ? 1 : 0.6}
              onPress={() => handleHeaderPress(col)}
              style={[
                styles.cell,
                {
                  flex: col.flex ?? 1,
                  minWidth: col.minWidth,
                  justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: active ? colors.primary : colors.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
                numberOfLines={1}
              >
                {col.label}
              </Text>
              {active && (
                <Ionicons
                  name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'}
                  size={12}
                  color={colors.primary}
                  style={{ marginLeft: 4 }}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <FlashList
        data={sortedData}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        estimatedItemSize={rowHeight}
        drawDistance={1200}
        ListEmptyComponent={ListEmptyComponent ?? undefined}
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        ) : undefined}
        showsVerticalScrollIndicator
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
});
