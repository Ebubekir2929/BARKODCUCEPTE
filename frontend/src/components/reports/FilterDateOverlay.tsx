/**
 * Tarih seçici — Filtre Modal'ının İÇİNDE absolute overlay olarak çizilir
 * (iOS'ta ayrı Modal kullanılınca filtre modalının arkasında açılıyordu).
 * Web: <input type="date">; iOS: spinner; Android: sistem diyaloğu.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useThemeStore } from '../../store/themeStore';
import { useLanguageStore } from '../../store/languageStore';
import { dateToIso, isoToDate, today } from '../../reports/dates';
import { reportModalStyles as ms } from './reportStyles';

interface Props {
  value: string;
  onChange: (iso: string) => void;
  onClose: () => void;
}

export const FilterDateOverlay: React.FC<Props> = ({ value, onChange, onClose }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();

  const buttons = (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
      <TouchableOpacity style={[ms.dialogBtn, { borderWidth: 1, borderColor: colors.border }]} onPress={onClose}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('cancel')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[ms.dialogBtn, { backgroundColor: colors.primary }]} onPress={onClose}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{t('ok')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[ms.innerOverlay, { padding: 16 }]}>
      <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFillObject} onPress={onClose} />
      <View style={{ backgroundColor: colors.surface, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, width: '92%', maxWidth: 400 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 8 }}>Tarih Seç</Text>
        {Platform.OS === 'web' ? (
          <>
            {React.createElement('input' as any, {
              type: 'date',
              value: String(value || today()).split(' ')[0].split('T')[0],
              onChange: (e: any) => { const iso = String(e?.target?.value || ''); if (iso) onChange(iso); },
              style: {
                fontSize: 16, padding: 12, borderRadius: 10,
                border: `1px solid ${colors.border}`, background: colors.background,
                color: colors.text, outline: 'none', width: '100%',
                boxSizing: 'border-box', fontFamily: 'inherit',
              },
            })}
            {buttons}
          </>
        ) : (
          <>
            <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
              <DateTimePicker
                value={isoToDate(value)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                locale="tr-TR"
                // @ts-ignore textColor is iOS-only
                textColor={colors.text}
                style={{ width: 320, height: 220 }}
                onChange={(event, selectedDate) => {
                  if (Platform.OS === 'android') onClose();
                  if (event.type === 'set' && selectedDate) onChange(dateToIso(selectedDate));
                }}
              />
            </View>
            {Platform.OS === 'ios' && buttons}
          </>
        )}
      </View>
    </View>
  );
};

export default FilterDateOverlay;
