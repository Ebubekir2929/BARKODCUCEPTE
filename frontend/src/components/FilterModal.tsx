import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
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
      // This month
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (days === 0) {
      start = new Date();
    } else {
      start.setDate(start.getDate() - days);
    }
    
    setDateRange({ start, end });
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

            {/* Date Display */}
            <View style={[styles.dateDisplay, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.dateItem}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Başlangıç</Text>
                <Text style={[styles.dateValue, { color: colors.text }]}>
                  {dateRange.start.toLocaleDateString('tr-TR')}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color={colors.textSecondary} />
              <View style={styles.dateItem}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Bitiş</Text>
                <Text style={[styles.dateValue, { color: colors.text }]}>
                  {dateRange.end.toLocaleDateString('tr-TR')}
                </Text>
              </View>
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
    maxHeight: '80%',
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
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateItem: {
    alignItems: 'center',
  },
  dateLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 16,
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
