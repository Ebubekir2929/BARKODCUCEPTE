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
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [tempStartDate, setTempStartDate] = useState({ day: '', month: '', year: '' });
  const [tempEndDate, setTempEndDate] = useState({ day: '', month: '', year: '' });

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
    setDateRange({ start: new Date(), end: new Date() });
    setTempStartDate({ day: '', month: '', year: '' });
    setTempEndDate({ day: '', month: '', year: '' });
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
  };

  const applyManualStartDate = () => {
    const day = parseInt(tempStartDate.day) || 1;
    const month = parseInt(tempStartDate.month) || 1;
    const year = parseInt(tempStartDate.year) || new Date().getFullYear();
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020) {
      const newDate = new Date(year, month - 1, day);
      setDateRange(prev => ({ ...prev, start: newDate }));
    }
    setShowStartPicker(false);
  };

  const applyManualEndDate = () => {
    const day = parseInt(tempEndDate.day) || 1;
    const month = parseInt(tempEndDate.month) || 1;
    const year = parseInt(tempEndDate.year) || new Date().getFullYear();
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020) {
      const newDate = new Date(year, month - 1, day);
      setDateRange(prev => ({ ...prev, end: newDate }));
    }
    setShowEndPicker(false);
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

          <ScrollView style={styles.content}>
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
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Hızlı Tarih Seçimi</Text>
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

            {/* Manual Date Entry */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Manuel Tarih Girişi</Text>
            
            {/* Start Date */}
            <View style={[styles.dateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.dateCardHeader}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Başlangıç Tarihi</Text>
                <TouchableOpacity
                  style={[styles.editBtn, { backgroundColor: colors.primary + '20' }]}
                  onPress={() => setShowStartPicker(!showStartPicker)}
                >
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.dateValue, { color: colors.text }]}>
                {dateRange.start.toLocaleDateString('tr-TR')}
              </Text>
              {showStartPicker && (
                <View style={styles.dateInputRow}>
                  <TextInput
                    style={[styles.dateInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="GG"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={tempStartDate.day}
                    onChangeText={(t) => setTempStartDate(prev => ({ ...prev, day: t }))}
                  />
                  <Text style={[styles.dateSeparator, { color: colors.textSecondary }]}>/</Text>
                  <TextInput
                    style={[styles.dateInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="AA"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={tempStartDate.month}
                    onChangeText={(t) => setTempStartDate(prev => ({ ...prev, month: t }))}
                  />
                  <Text style={[styles.dateSeparator, { color: colors.textSecondary }]}>/</Text>
                  <TextInput
                    style={[styles.dateInputYear, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="YYYY"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={4}
                    value={tempStartDate.year}
                    onChangeText={(t) => setTempStartDate(prev => ({ ...prev, year: t }))}
                  />
                  <TouchableOpacity
                    style={[styles.applyDateBtn, { backgroundColor: colors.primary }]}
                    onPress={applyManualStartDate}
                  >
                    <Ionicons name="checkmark" size={18} color="#FFF" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* End Date */}
            <View style={[styles.dateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.dateCardHeader}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Bitiş Tarihi</Text>
                <TouchableOpacity
                  style={[styles.editBtn, { backgroundColor: colors.primary + '20' }]}
                  onPress={() => setShowEndPicker(!showEndPicker)}
                >
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.dateValue, { color: colors.text }]}>
                {dateRange.end.toLocaleDateString('tr-TR')}
              </Text>
              {showEndPicker && (
                <View style={styles.dateInputRow}>
                  <TextInput
                    style={[styles.dateInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="GG"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={tempEndDate.day}
                    onChangeText={(t) => setTempEndDate(prev => ({ ...prev, day: t }))}
                  />
                  <Text style={[styles.dateSeparator, { color: colors.textSecondary }]}>/</Text>
                  <TextInput
                    style={[styles.dateInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="AA"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={tempEndDate.month}
                    onChangeText={(t) => setTempEndDate(prev => ({ ...prev, month: t }))}
                  />
                  <Text style={[styles.dateSeparator, { color: colors.textSecondary }]}>/</Text>
                  <TextInput
                    style={[styles.dateInputYear, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="YYYY"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={4}
                    value={tempEndDate.year}
                    onChangeText={(t) => setTempEndDate(prev => ({ ...prev, year: t }))}
                  />
                  <TouchableOpacity
                    style={[styles.applyDateBtn, { backgroundColor: colors.primary }]}
                    onPress={applyManualEndDate}
                  >
                    <Ionicons name="checkmark" size={18} color="#FFF" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.resetButton, { borderColor: colors.border }]}
              onPress={handleReset}
            >
              <Text style={[styles.resetButtonText, { color: colors.text }]}>Sıfırla</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: colors.primary }]}
              onPress={handleApply}
            >
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
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  branchList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
    gap: 8,
  },
  branchItem: {
    paddingHorizontal: 16,
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
    marginBottom: 24,
    gap: 8,
  },
  quickDateItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickDateText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dateCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  dateCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateLabel: {
    fontSize: 13,
  },
  editBtn: {
    padding: 6,
    borderRadius: 8,
  },
  dateValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  dateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 4,
  },
  dateInput: {
    width: 50,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    textAlign: 'center',
  },
  dateInputYear: {
    width: 70,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    textAlign: 'center',
  },
  dateSeparator: {
    fontSize: 18,
    fontWeight: '600',
  },
  applyDateBtn: {
    padding: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    gap: 12,
  },
  resetButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  applyButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
