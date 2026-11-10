/**
 * Favori filtre kaydetme kutusu — Filtre Modal'ının İÇİNDE inline overlay (isim girişi).
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useLanguageStore } from '../../store/languageStore';
import { reportModalStyles as ms } from './reportStyles';

interface Props {
  summary: string;            // kaydedilecek filtrelerin özeti
  onSave: (name: string) => void;
  onClose: () => void;
}

export const FavoriteSaveOverlay: React.FC<Props> = ({ summary, onSave, onClose }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const [name, setName] = useState('');
  const valid = name.trim().length > 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[ms.innerOverlay, { padding: 16 }]}>
      <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFillObject} onPress={onClose} />
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Ionicons name="star" size={18} color={colors.warning} />
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>Favori Olarak Kaydet</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }} numberOfLines={2}>{summary}</Text>
        <TextInput
          style={[ms.filterInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, fontSize: 15 }]}
          placeholder="Favori adı (örn. Merkez – Garsonlar)"
          placeholderTextColor={colors.textSecondary}
          value={name}
          onChangeText={setName}
          autoFocus
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={() => valid && onSave(name)}
          testID="favorite-name-input"
        />
        <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 8 }}>Tarihler kaydedilmez; favori uygulanınca seçili tarihler korunur.</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <TouchableOpacity style={[ms.dialogBtn, { borderWidth: 1, borderColor: colors.border }]} onPress={onClose}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{t('cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[ms.dialogBtn, { backgroundColor: valid ? colors.primary : colors.border }]}
            onPress={() => valid && onSave(name)}
            disabled={!valid}
            testID="favorite-save-confirm"
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Kaydet</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  box: { width: '92%', maxWidth: 400, borderRadius: 16, borderWidth: 1, padding: 16 },
});

export default FavoriteSaveOverlay;
