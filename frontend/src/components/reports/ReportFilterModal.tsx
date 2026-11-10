/**
 * Rapor filtre modalı: tarih / sabit seçenek / çoklu seçim / metin alanları ve
 * "Raporu Çalıştır" düğmesi. Tarih seçici, liste seçici ve uyarı kutusu bu modalın
 * İÇİNDE inline overlay olarak çizilir (iOS modal yığını sorunu).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Platform, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useLanguageStore } from '../../store/languageStore';
import { FavoriteFilter, useReportPrefsStore } from '../../store/reportPrefsStore';
import { CustomAlert, useAlert } from '../CustomAlert';
import { FilterDef, FilterValues, LookupOption, ReportDef } from '../../reports/types';
import { formatDateTR } from '../../reports/dates';
import { pickFavoriteValues, summarizeFilters, translateLabel } from '../../reports/labels';
import { reportModalStyles as ms } from './reportStyles';
import { FilterDateOverlay } from './FilterDateOverlay';
import { FilterPickerOverlay } from './FilterPickerOverlay';
import { FavoriteSaveOverlay } from './FavoriteSaveOverlay';

interface Props {
  visible: boolean;
  report: ReportDef | null;
  title: string;
  tenantId: string;
  filterValues: FilterValues;
  onChange: (name: string, value: any) => void;
  /** Favori uygulandığında tarih dışı filtreleri bu değerlerle değiştirir */
  onApplyValues: (values: FilterValues) => void;
  onClose: () => void;
  onRun: () => void;
  lookupCache: Record<string, LookupOption[]>;
  fetchLookupSource: (source: string) => Promise<LookupOption[] | null>;
  /** Zorunlu filtre / favori uyarıları için inline CustomAlert (useAlert) */
  alert: ReturnType<typeof useAlert>;
}

/** Aynı ada sahip filtreleri tekille (açık + spread tekrarları React key uyarısı veriyordu). */
const uniqueFilters = (filters: FilterDef[]) => {
  const seen = new Set<string>();
  return filters.filter(f => (seen.has(f.name) ? false : (seen.add(f.name), true)));
};

export const ReportFilterModal: React.FC<Props> = ({
  visible, report, title, tenantId, filterValues, onChange, onApplyValues, onClose, onRun, lookupCache, fetchLookupSource, alert,
}) => {
  const { colors } = useThemeStore();
  const { t, language } = useLanguageStore();
  const insets = useSafeAreaInsets();
  const altBosluk = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);

  const [datePickerFor, setDatePickerFor] = useState<string | null>(null);
  const [pickerFilter, setPickerFilter] = useState<FilterDef | null>(null);
  const [pickerOptions, setPickerOptions] = useState<LookupOption[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [showFavoriteSave, setShowFavoriteSave] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const allFavorites = useReportPrefsStore(s => s.favorites[tenantId]);
  const { addFavorite, removeFavorite } = useReportPrefsStore.getState();
  const favorites = useMemo(
    () => (allFavorites || []).filter(f => f.reportKey === report?.key),
    [allFavorites, report?.key],
  );
  const favoriteValues = report ? pickFavoriteValues(report, filterValues) : {};
  const favoriteSummary = report ? summarizeFilters(report, favoriteValues) : '';

  const openFavoriteSave = () => {
    if (!report) return;
    if (Object.keys(favoriteValues).length === 0) {
      alert.showWarning('Filtre Seçilmedi', 'Favori kaydetmek için tarih dışında en az bir filtre seçin.');
      return;
    }
    Keyboard.dismiss();
    setShowFavoriteSave(true);
  };

  const saveFavorite = (name: string) => {
    if (!report) return;
    addFavorite(tenantId, report.key, name, favoriteValues);
    setShowFavoriteSave(false);
    // Yeni chip en üstte; kullanıcı aşağıdaysa görsün
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const confirmRemoveFavorite = (fav: FavoriteFilter) => {
    alert.showWarning('Favoriyi Sil', `"${fav.name}" favorisi silinsin mi?`, [
      { text: t('cancel'), style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeFavorite(tenantId, fav.id) },
    ]);
  };

  const openPicker = useCallback(async (filter: FilterDef) => {
    Keyboard.dismiss();
    setPickerFilter(filter);
    if (filter.source && lookupCache[filter.source]) { setPickerOptions(lookupCache[filter.source]); return; }
    if (!filter.source) return;
    setPickerLoading(true);
    setPickerOptions([]);
    try {
      const opts = await fetchLookupSource(filter.source);
      if (opts) setPickerOptions(opts);
    } catch (err) { console.error('Lookup error:', err); }
    finally { setPickerLoading(false); }
  }, [lookupCache, fetchLookupSource]);

  const togglePickerValue = (val: string) => {
    if (!pickerFilter) return;
    const arr = filterValues[pickerFilter.name] ? String(filterValues[pickerFilter.name]).split(',') : [];
    const idx = arr.indexOf(val);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
    onChange(pickerFilter.name, arr.join(','));
  };

  const selectedLabels = (filter: FilterDef) => {
    const val = filterValues[filter.name] || '';
    if (!val) return '';
    const opts = filter.source ? lookupCache[filter.source] || [] : [];
    if (opts.length === 0) return val;
    return String(val).split(',').map((id: string) => opts.find(o => o.value === id)?.label || id).join(', ');
  };

  const inputBase = { backgroundColor: colors.card, borderColor: colors.border };
  const rowBase = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const };

  const renderField = (filter: FilterDef) => {
    const val = filterValues[filter.name];
    switch (filter.type) {
      case 'date':
        return (
          <TouchableOpacity style={[ms.filterInput, inputBase, rowBase]} onPress={() => setDatePickerFor(filter.name)} testID={`filter-date-${filter.name}`}>
            <Text style={{ fontSize: 13, color: val ? colors.text : colors.textSecondary }}>{val ? formatDateTR(val) : t('select_date')}</Text>
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          </TouchableOpacity>
        );
      case 'select_static':
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {filter.options?.map(opt => {
              const active = val === opt.value;
              return (
                <TouchableOpacity key={String(opt.value)} style={[ms.chip, { borderColor: colors.border, backgroundColor: active ? colors.primary : undefined }]} onPress={() => onChange(filter.name, opt.value)}>
                  <Text style={{ fontSize: 12, color: active ? '#fff' : colors.text }}>{translateLabel(opt.label, language)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        );
      case 'multiselect':
        return (
          <TouchableOpacity style={[ms.filterInput, inputBase, rowBase, { borderColor: val ? colors.primary : colors.border }]} onPress={() => openPicker(filter)} testID={`filter-pick-${filter.name}`}>
            <Text style={{ fontSize: 13, color: val ? colors.text : colors.textSecondary, flex: 1 }} numberOfLines={1}>{val ? selectedLabels(filter) : t('select_placeholder')}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        );
      case 'text':
        return (
          <TextInput
            style={[ms.filterInput, inputBase, { color: colors.text }]}
            value={val || ''}
            onChangeText={v => onChange(filter.name, v)}
            placeholder={filter.placeholder || t('enter_text')} placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType={filter.numeric ? 'numbers-and-punctuation' : 'default'}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle={Platform.OS === 'web' ? 'overFullScreen' : undefined} statusBarTranslucent>
      <View style={ms.overlay}>
        <View style={[ms.content, { backgroundColor: colors.surface, maxHeight: Platform.OS === 'web' ? '92%' : '85%' }]}>
          <View style={[ms.header, { borderBottomColor: colors.border }]}>
            <Text style={[ms.headerTitle, { fontSize: 17, color: colors.text }]}>{title} - {t('filters_suffix')}</Text>
            <TouchableOpacity onPress={openFavoriteSave} style={{ marginRight: 12 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="favorite-save">
              <Ionicons name="star-outline" size={22} color={colors.warning} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} testID="filter-close"><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
          </View>
          <ScrollView ref={scrollRef} style={{ padding: 16 }} contentContainerStyle={{ gap: 10, paddingBottom: 30 + altBosluk }}>
            {favorites.length > 0 && (
              <View style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Ionicons name="star" size={13} color={colors.warning} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.3 }}>FAVORİLER</Text>
                  <Text style={{ fontSize: 10, color: colors.textSecondary }}>· silmek için basılı tut</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {favorites.map(fav => (
                    <TouchableOpacity
                      key={fav.id}
                      style={[ms.chip, { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: colors.warning + '80', backgroundColor: colors.warning + '14' }]}
                      onPress={() => onApplyValues(fav.filterValues)}
                      onLongPress={() => confirmRemoveFavorite(fav)}
                      delayLongPress={400}
                      testID={`favorite-${fav.id}`}
                    >
                      <Ionicons name="star" size={12} color={colors.warning} />
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }} numberOfLines={1}>{fav.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            {uniqueFilters(report?.filters || []).map(filter => (
              <View key={filter.name}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
                  {translateLabel(filter.label, language)} {filter.required && <Text style={{ color: colors.error }}>*</Text>}
                </Text>
                {renderField(filter)}
              </View>
            ))}
            <TouchableOpacity style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }} onPress={onRun} testID="run-report">
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('run_report')}</Text>
            </TouchableOpacity>
          </ScrollView>

          {datePickerFor && (
            <FilterDateOverlay
              value={filterValues[datePickerFor]}
              onChange={iso => onChange(datePickerFor, iso)}
              onClose={() => setDatePickerFor(null)}
            />
          )}
          <CustomAlert {...alert.alertProps} inline />
          {showFavoriteSave && (
            <FavoriteSaveOverlay summary={favoriteSummary} onSave={saveFavorite} onClose={() => setShowFavoriteSave(false)} />
          )}
          {pickerFilter && (
            <FilterPickerOverlay
              filter={pickerFilter}
              options={pickerOptions}
              loading={pickerLoading}
              selected={filterValues[pickerFilter.name] || ''}
              onToggle={togglePickerValue}
              onClose={() => setPickerFilter(null)}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

export default ReportFilterModal;
