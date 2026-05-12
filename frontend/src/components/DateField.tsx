import React, { useState, useCallback } from 'react';
import { Platform, TouchableOpacity, View, Text, TextInput, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

/**
 * DateField — Cross-platform date picker that renders:
 *  - iOS: inline `spinner` picker inside a small modal sheet with Confirm/Cancel.
 *  - Android: native system date picker dialog (opens when tapped).
 *  - Web: HTML5 `<input type="date">` styled as a TextInput.
 *
 * Props:
 *   value: string  — ISO date "YYYY-MM-DD"
 *   onChange: (next: string) => void
 *   label?: string
 *   minDate?: string  — optional ISO
 *   maxDate?: string  — optional ISO
 *   colors: any — theme colors (text, textSecondary, card, border, primary, surface)
 *
 * Behavior: Provides a TouchableOpacity (or native input on Web) showing the
 *   current value formatted as DD.MM.YYYY for TR locale, and triggers
 *   onChange with ISO YYYY-MM-DD when the user picks a date.
 */
export interface DateFieldProps {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  minDate?: string;
  maxDate?: string;
  colors: {
    text: string;
    textSecondary: string;
    card: string;
    border: string;
    primary: string;
    surface: string;
    background?: string;
  };
}

function parseIso(value: string): Date {
  if (!value) return new Date();
  // Accept "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatTr(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y}`;
}

export const DateField: React.FC<DateFieldProps> = ({ value, onChange, label, minDate, maxDate, colors }) => {
  const [show, setShow] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() => parseIso(value));

  const min = minDate ? parseIso(minDate) : undefined;
  const max = maxDate ? parseIso(maxDate) : undefined;

  const open = useCallback(() => {
    setTempDate(parseIso(value));
    setShow(true);
  }, [value]);

  const handleAndroidChange = useCallback((event: any, selected?: Date) => {
    // Android: dialog is system-modal; "set" or "dismissed" arrives in event.type
    setShow(false);
    if (event?.type === 'set' && selected) {
      onChange(toIso(selected));
    }
  }, [onChange]);

  // ---- Web: native HTML date input via TextInput web fallback ----
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1 }}>
        {label ? (
          <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        ) : null}
        <TextInput
          // @ts-ignore — web-only attribute
          type="date"
          value={value}
          onChangeText={(t) => onChange(t)}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          placeholderTextColor={colors.textSecondary}
          min={minDate}
          max={maxDate}
        />
      </View>
    );
  }

  // ---- iOS: inline spinner inside a small bottom-sheet modal ----
  if (Platform.OS === 'ios') {
    return (
      <View style={{ flex: 1 }}>
        {label ? (
          <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        ) : null}
        <TouchableOpacity
          onPress={open}
          style={[styles.fieldBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.fieldVal, { color: colors.text }]}>{formatTr(value) || '—'}</Text>
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
        </TouchableOpacity>

        <Modal visible={show} transparent animationType="fade" onRequestClose={() => setShow(false)}>
          <View style={styles.overlay}>
            <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{label || 'Tarih Seç'}</Text>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                locale="tr-TR"
                minimumDate={min}
                maximumDate={max}
                onChange={(_, sel) => sel && setTempDate(sel)}
                themeVariant="light"
                style={{ width: '100%' }}
              />
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => setShow(false)}
                  style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.actionTxt, { color: colors.text }]}>İptal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { onChange(toIso(tempDate)); setShow(false); }}
                  style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                >
                  <Text style={[styles.actionTxt, { color: '#fff' }]}>Tamam</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ---- Android: native dialog (auto-closes) ----
  return (
    <View style={{ flex: 1 }}>
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      ) : null}
      <TouchableOpacity
        onPress={open}
        style={[styles.fieldBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
      >
        <Text style={[styles.fieldVal, { color: colors.text }]}>{formatTr(value) || '—'}</Text>
        <Ionicons name="calendar-outline" size={16} color={colors.primary} />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          minimumDate={min}
          maximumDate={max}
          onChange={handleAndroidChange}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 10, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  fieldBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
    minHeight: 40,
  },
  fieldVal: { fontSize: 14, fontWeight: '700' },
  input: {
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
    fontSize: 14, fontWeight: '600',
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 14, padding: 14, borderWidth: 1 },
  sheetTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1 },
  actionTxt: { fontSize: 14, fontWeight: '700' },
});

export default DateField;
