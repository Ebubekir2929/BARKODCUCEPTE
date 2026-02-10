import React, { useState } from 'react';
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
import { branches } from '../data/mockData';
import DateTimePicker from '@react-native-community/datetimepicker';

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: { branchId: string | null; startDate: Date; endDate: Date }) => void;
  currentFilters: {
    branchId: string | null;
    startDate: Date;
    endDate: Date;
  };
}

export const FilterModal: React.FC<FilterModalProps> = ({
  visible,
  onClose,
  onApply,
  currentFilters,
}) => {
  const { colors } = useThemeStore();
  const [selectedBranch, setSelectedBranch] = useState<string | null>(currentFilters.branchId);
  const [dateRange, setDateRange] = useState({
    start: currentFilters.startDate,
    end: currentFilters.endDate,
  });
  const [startDateInput, setStartDateInput] = useState(formatDateForInput(currentFilters.startDate));
  const [endDateInput, setEndDateInput] = useState(formatDateForInput(currentFilters.endDate));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

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
    { label: 'Bugün', days: 0 },
    { label: 'Dün', days: 1 },
    { label: 'Son 7 Gün', days: 7 },
    { label: 'Son 30 Gün', days: 30 },
    { label: 'Bu Ay', days: -1 },
  ];

  const selectQuickDate = (days: number) => {
    const end = new Date();
    let start = new Date();
    
    if (days === -1) {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (days === 0) {
      start = new Date();
    } else {
      start.setDate(start.getDate() - days);
    }
    
    setDateRange({ start, end });
    setStartDateInput(formatDateForInput(start));
    setEndDateInput(formatDateForInput(end));
  };

  const parseDate = (input: string): Date | null => {
    // Accept formats: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY
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
    if (parsed) {
      setDateRange(prev => ({ ...prev, start: parsed }));
    }
  };

  const handleEndDateChange = (text: string) => {
    setEndDateInput(text);
    const parsed = parseDate(text);
    if (parsed) {
      setDateRange(prev => ({ ...prev, end: parsed }));
    }
  };

  const onStartDatePickerChange = (event: any, selectedDate?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setDateRange(prev => ({ ...prev, start: selectedDate }));
      setStartDateInput(formatDateForInput(selectedDate));
    }
  };

  const onEndDatePickerChange = (event: any, selectedDate?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setDateRange(prev => ({ ...prev, end: selectedDate }));
      setEndDateInput(formatDateForInput(selectedDate));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Filtreler</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {/* Branch Selection */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Şube Seçimi</Text>
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

            {/* Quick Date Selection */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Hızlı Tarih</Text>
            <View style={styles.quickDateList}>
              {quickDateOptions.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.quickDateItem,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => selectQuickDate(option.days)}
                >
                  <Text style={[styles.quickDateText, { color: colors.text }]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Manual Date Entry with Picker */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Tarih Seçimi</Text>
            <View style={styles.dateInputsRow}>
              <View style={styles.dateInputWrapper}>
                <Text style={[styles.dateInputLabel, { color: colors.textSecondary }]}>Başlangıç</Text>
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
                <Text style={[styles.dateInputLabel, { color: colors.textSecondary }]}>Bitiş</Text>
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

            {/* Date Pickers */}
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

            {/* Selected Date Display */}
            <View style={[styles.selectedDateDisplay, { backgroundColor: colors.background }]}>
              <Ionicons name="time-outline" size={18} color={colors.primary} />
              <Text style={[styles.selectedDateText, { color: colors.text }]}>
                {dateRange.start.toLocaleDateString('tr-TR')} - {dateRange.end.toLocaleDateString('tr-TR')}
              </Text>
            </View>

            <Text style={[styles.dateHint, { color: colors.textSecondary }]}>
              Elle yazın veya takvim ikonuna tıklayın
            </Text>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.resetButton, { borderColor: colors.border }]}
              onPress={handleReset}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.text} />
              <Text style={[styles.resetButtonText, { color: colors.text }]}>Sıfırla</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: colors.primary }]}
              onPress={handleApply}
            >
              <Ionicons name="checkmark" size={18} color="#FFF" />
              <Text style={styles.applyButtonText}>Uygula</Text>
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
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
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
    paddingBottom: 40,
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
    marginBottom: 8,
  },
  selectedDateText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dateHint: {
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 10,
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
