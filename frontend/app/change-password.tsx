import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useLanguageStore } from '../src/store/languageStore';
import { useAlert, CustomAlert } from '../src/components/CustomAlert';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { token, refreshUser } = useAuthStore();
  const params = useLocalSearchParams<{ force?: string }>();
  const isForced = params.force === '1';
  const { showError, showSuccess, showWarning, alertProps } = useAlert();

  // Block hardware back when forced
  useEffect(() => {
    if (!isForced) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      showWarning(t('warning_title'), t('set_new_password_first'));
      return true;
    });
    return () => sub.remove();
  }, [isForced]);

  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!oldPass || !newPass || !newPass2) {
      showWarning(t('warning_title'), t('fill_all_fields'));
      return;
    }
    if (newPass !== newPass2) {
      showWarning(t('warning_title'), t('passwords_no_match'));
      return;
    }
    if (newPass.length < 6) {
      showWarning(t('warning_title'), t('password_min_6'));
      return;
    }
    if (oldPass === newPass) {
      showWarning(t('warning_title'), t('password_same_as_old'));
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ old_password: oldPass, new_password: newPass }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showError(t('error_title'), data.detail || t('password_change_failed'));
      } else {
        try { await refreshUser(); } catch(_) {}
        showSuccess(t('success_title'), data.message || t('password_changed_success'), [
          { text: 'Tamam', onPress: () => {
            if (isForced) router.replace('/(tabs)/dashboard');
            else router.back();
          }},
        ]);
      }
    } catch (e) {
      showError(t('error_title'), t('connection_error_short'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {isForced ? (
          <View style={{ width: 24 }} />
        ) : (
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.title, { color: colors.text }]}>{isForced ? t('set_password') : t('change_password')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {isForced && (
            <View style={[styles.warnBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}>
              <Ionicons name="warning" size={18} color={colors.warning} />
              <Text style={[styles.warnText, { color: colors.warning }]}>
                Hesabınıza geçici bir şifre ile giriş yaptınız. Devam etmek için yeni bir şifre belirlemeniz gerekiyor.
              </Text>
            </View>
          )}

          <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="lock-closed" size={36} color={colors.primary} />
          </View>

          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {isForced
              ? 'Lütfen hesabınız için yeni ve güvenli bir şifre belirleyin. Şifreniz en az 6 karakter olmalıdır.'
              : 'Güvenliğiniz için yeni bir şifre belirleyin. Yeni şifreniz en az 6 karakter olmalıdır.'}
          </Text>

          {/* Current password */}
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="key-outline" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Mevcut Şifre"
              placeholderTextColor={colors.textSecondary}
              value={oldPass}
              onChangeText={setOldPass}
              secureTextEntry={!showOld}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowOld(!showOld)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showOld ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* New password */}
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Yeni Şifre (min 6 karakter)"
              placeholderTextColor={colors.textSecondary}
              value={newPass}
              onChangeText={setNewPass}
              secureTextEntry={!showNew}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowNew(!showNew)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Confirm new password */}
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Yeni Şifre (Tekrar)"
              placeholderTextColor={colors.textSecondary}
              value={newPass2}
              onChangeText={setNewPass2}
              secureTextEntry={!showNew}
              autoCapitalize="none"
            />
            {newPass2.length > 0 && (
              <Ionicons
                name={newPass === newPass2 ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={newPass === newPass2 ? colors.success : colors.error}
              />
            )}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: loading ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.submitText}>Şifreyi Değiştir</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '10' }]}>
            <Ionicons name="information-circle" size={16} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.primary }]}>
              Şifrenizi değiştirdikten sonra tekrar giriş yapmanız gerekebilir.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <CustomAlert {...alertProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20, gap: 14 },
  iconBox: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 6 },
  description: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 14, paddingHorizontal: 10 },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, marginTop: 8,
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 10, marginTop: 6,
  },
  infoText: { fontSize: 12, flex: 1, lineHeight: 16 },
  warnBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 4,
  },
  warnText: { fontSize: 13, fontWeight: '600', flex: 1, lineHeight: 18 },
});
