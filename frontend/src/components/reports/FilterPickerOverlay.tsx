/**
 * Çoklu seçim listesi — Filtre Modal'ının İÇİNDE alt sayfa overlay'i olarak çizilir
 * (native alt-modal yok → iOS donması yaşanmaz). Arama kutusu 5+ seçenekte görünür.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, FlatList, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { FilterDef, LookupOption } from '../../reports/types';
import { reportModalStyles as ms } from './reportStyles';

interface Props {
  filter: FilterDef;
  options: LookupOption[];
  loading: boolean;
  /** Virgülle ayrılmış seçili değerler */
  selected: string;
  onToggle: (value: string) => void;
  onClose: () => void;
}

export const FilterPickerOverlay: React.FC<Props> = ({ filter, options, loading, selected, onToggle, onClose }) => {
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const altBosluk = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);
  const [search, setSearch] = useState('');

  const selectedSet = useMemo(() => new Set(selected ? selected.split(',') : []), [selected]);
  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, search]);
  const showSearch = options.length > 5 && !loading;

  return (
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', zIndex: 100 }]}>
      <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFillObject} onPress={onClose} />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }}>
        <View style={[ms.header, { borderBottomColor: colors.border }]}>
          <Text style={[ms.headerTitle, { color: colors.text }]}>{filter.label}</Text>
          <TouchableOpacity onPress={onClose} testID="picker-done"><Ionicons name="checkmark" size={24} color={colors.primary} /></TouchableOpacity>
        </View>
        {showSearch && (
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <View style={[ms.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput style={{ flex: 1, fontSize: 13, color: colors.text, paddingVertical: 0 }} placeholder="Ara..." placeholderTextColor={colors.textSecondary} value={search} onChangeText={setSearch} />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Seçenekler yükleniyor...</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(_, idx) => String(idx)}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 + altBosluk, paddingTop: showSearch ? 0 : 8 }}
            renderItem={({ item, index }) => {
              const sel = selectedSet.has(item.value);
              return (
                <TouchableOpacity style={[ms.pickerItem, { backgroundColor: sel ? colors.primary + '15' : colors.card, borderColor: sel ? colors.primary : colors.border }]} onPress={() => onToggle(item.value)} testID={`picker-item-${index}`}>
                  <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={20} color={sel ? colors.primary : colors.textSecondary} />
                  <Text style={{ fontSize: 14, color: sel ? colors.primary : colors.text, fontWeight: sel ? '600' : '400', flex: 1 }}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 20, paddingHorizontal: 16 }}>
                <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
                  {search ? 'Seçenek bulunamadı' : "Liste POS'tan henüz alınamadı. Birkaç saniye sonra filtreyi kapatıp tekrar açın."}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </View>
  );
};

export default FilterPickerOverlay;
