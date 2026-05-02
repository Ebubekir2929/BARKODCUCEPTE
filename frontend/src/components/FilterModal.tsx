import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useLanguageStore } from '../store/languageStore';
import DateTimePicker from '@react-native-community/datetimepicker';

interface Branch {
  id: string;
  name: string;
}

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: { branchId: string | null; startDate: Date; endDate: Date }) => void;
  currentFilters: {
    branchId: string | null;
    startDate: Date;
    endDate: Date;
  };
  branches?: Branch[];
}

export const FilterModal: React.FC<FilterModalProps> = ({
  visible,
  onClose,
  onApply,
  currentFilters,
  branches = [],
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const [selectedBranch, setSelectedBranch] = useState<string | null>(currentFilters.branchId);
  const [dateRange, setDateRange] = useState({
    start: currentFilters.startDate,
    end: currentFilters.endDate,
  });
  const [startDateInput, setStartDateInput] = useState(formatDateForInput(currentFilters.startDate));
  const [endDateInput, setEndDateInput] = useState(formatDateForInput(currentFilters.endDate));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  // Track which "Hızlı Tarih" chip is active so it can be visually highlighted
  // (blue border + filled background) — cleared the moment the user types or
  // picks a custom date manually.
  const [activeQuickDate, setActiveQuickDate] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelectedBranch(currentFilters.branchId);
      setDateRange({ start: currentFilters.startDate, end: currentFilters.endDate });
      setStartDateInput(formatDateForInput(currentFilters.startDate));
      setEndDateInput(formatDateForInput(currentFilters.endDate));
      setActiveQuickDate(null);
    }
  }, [visible]);

  function formatDateForInput(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  const handleApply = () => {
    onApply({
      branchId: selectedBranch,
      startDate: dateRange.start,
      endDate: dateRange.end,
    });
    onClose();
  };

  const handleReset = () => {
    setSelectedBranch(null);
    const today = new Date();
    setDateRange({ start: today, end: today });
    setStartDateInput(formatDateForInput(today));
    setEndDateInput(formatDateForInput(today));
  };

  const quickDateOptions = [
    { label: t('today_label'), getValue: () => { const d = new Date(); return { start: d, end: d }; } },
    { label: t('yesterday_label'), getValue: () => { const d = new Date(); d.setDate(d.getDate() - 1); return { start: d, end: d }; } },
    { label: t('last_7_days'), getValue: () => { const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 7); return { start, end }; } },
    { label: t('last_30_days'), getValue: () => { const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30); return { start, end }; } },
    { label: t('this_month'), getValue: () => { const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth(), 1); return { start, end }; } },
    { label: t('last_month'), getValue: () => { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - 1, 1); const end = new Date(now.getFullYear(), now.getMonth(), 0); return { start, end }; } },
  ];

  const selectQuickDate = (option: typeof quickDateOptions[0]) => {
    const { start, end } = option.getValue();
    setDateRange({ start, end });
    setStartDateInput(formatDateForInput(start));
    setEndDateInput(formatDateForInput(end));
    setActiveQuickDate(option.label);
  };

  const parseDate = (input: string): Date | null => {
    const cleaned = input.replace(/[.\-]/g, '/');
    const parts = cleaned.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const year = parseInt(parts[2]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
        return new Date(year, month - 1, day);
      }
    }
    return null;
  };

  const handleStartDateChange = (text: string) => {
    setStartDateInput(text);
    const parsed = parseDate(text);
    if (parsed) setDateRange(prev => ({ ...prev, start: parsed }));
    setActiveQuickDate(null);
  };

  const handleEndDateChange = (text: string) => {
    setEndDateInput(text);
    const parsed = parseDate(text);
    if (parsed) setDateRange(prev => ({ ...prev, end: parsed }));
    setActiveQuickDate(null);
  };

  const onStartDatePickerChange = (event: any, selectedDate?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setDateRange(prev => ({ ...prev, start: selectedDate }));
      setStartDateInput(formatDateForInput(selectedDate));
      setActiveQuickDate(null);
    }
  };

  const onEndDatePickerChange = (event: any, selectedDate?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setDateRange(prev => ({ ...prev, end: selectedDate }));
      setEndDateInput(formatDateForInput(selectedDate));
      setActiveQuickDate(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{t('filters')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
            {/* Branch Selection - from live data */}
            {branches.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('branch_select')}</Text>
                <View style={styles.branchList}>
                  <TouchableOpacity
                    style={[
                      styles.branchItem,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      selectedBranch === null && { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
                    ]}
                    onPress={() => setSelectedBranch(null)}
                  >
                    <Text style={[styles.branchText, { color: selectedBranch === null ? colors.primary : colors.text }]}>
                      Tüm Şubeler
                    </Text>
                  </TouchableOpacity>
                  {branches.map((branch) => (
                    <TouchableOpacity
                      key={branch.id}
                      style={[
                        styles.branchItem,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        selectedBranch === branch.id && { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
                      ]}
                      onPress={() => setSelectedBranch(branch.id)}
                    >
                      <Text style={[styles.branchText, { color: selectedBranch === branch.id ? colors.primary : colors.text }]}>
                        {branch.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Quick Date Selection */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('quick_date')}</Text>
            <View style={styles.quickDateList}>
              {quickDateOptions.map((option) => {
                const isActive = activeQuickDate === option.label;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.quickDateItem,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      isActive && { borderColor: colors.primary, backgroundColor: colors.primary + '20', borderWidth: 1.5 },
                    ]}
                    onPress={() => selectQuickDate(option)}
                  >
                    {isActive && (
                      <Ionicons name="checkmark-circle" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                    )}
                    <Text style={[styles.quickDateText, { color: isActive ? colors.primary : colors.text, fontWeight: isActive ? '700' : '500' }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Manual Date Entry */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('date_select')}</Text>
            <View style={styles.dateInputsRow}>
              <View style={styles.dateInputWrapper}>
                <Text style={[styles.dateInputLabel, { color: colors.textSecondary }]}>{t('start_placeholder')}</Text>
                <View style={[styles.dateInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.dateInput, { color: colors.text }]}
                    placeholder="GG/AA/YYYY"
                    placeholderTextColor={colors.textSecondary}
                    value={startDateInput}
                    onChangeText={handleStartDateChange}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                  <TouchableOpacity onPress={() => setShowStartPicker(true)} style={styles.calendarBtn}>
                    <Ionicons name="calendar" size={20} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.dateInputWrapper}>
                <Text style={[styles.dateInputLabel, { color: colors.textSecondary }]}>{t('end_placeholder')}</Text>
                <View style={[styles.dateInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.dateInput, { color: colors.text }]}
                    placeholder="GG/AA/YYYY"
                    placeholderTextColor={colors.textSecondary}
                    value={endDateInput}
                    onChangeText={handleEndDateChange}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                  <TouchableOpacity onPress={() => setShowEndPicker(true)} style={styles.calendarBtn}>
                    <Ionicons name="calendar" size={20} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {showStartPicker && (
              <DateTimePicker
                value={dateRange.start}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onStartDatePickerChange}
                locale="tr-TR"
              />
            )}
            {showEndPicker && (
              <DateTimePicker
                value={dateRange.end}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onEndDatePickerChange}
                locale="tr-TR"
              />
            )}

            <View style={[styles.selectedDateDisplay, { backgroundColor: colors.background }]}>
              <Ionicons name="time-outline" size={18} color={colors.primary} />
              <Text style={[styles.selectedDateText, { color: colors.text }]}>
                {dateRange.start.toLocaleDateString('tr-TR')} - {dateRange.end.toLocaleDateString('tr-TR')}
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.resetButton, { borderColor: colors.border }]}
              onPress={handleReset}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.text} />
              <Text style={[styles.resetButtonText, { color: colors.text }]}>{t('reset')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: colors.primary }]}
              onPress={handleApply}
            >
              <Ionicons name="checkmark" size={18} color="#FFF" />
              <Text style={styles.applyButtonText}>{t('apply')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 20,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  branchList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
    gap: 8,
  },
  branchItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  branchText: {
    fontSize: 14,
    fontWeight: '500',
  },
  quickDateList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
    gap: 8,
  },
  quickDateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickDateText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dateInputsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  dateInputWrapper: {
    flex: 1,
  },
  dateInputLabel: {
    fontSize: 12,
    marginBottom: 6,
    marginLeft: 4,
  },
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  calendarBtn: {
    padding: 8,
  },
  selectedDateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 8,
  },
  selectedDateText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    gap: 12,
  },
  resetButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  resetButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  applyButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
