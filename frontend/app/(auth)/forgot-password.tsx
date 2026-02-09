import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { useThemeStore } from '../../src/store/themeStore';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { forgotPassword } = useAuthStore();
  const { colors } = useThemeStore();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async () => {
    if (!email) {
      Alert.alert('Hata', 'Lütfen e-posta adresinizi girin');
      return;
    }

    setIsLoading(true);
    try {
      const success = await forgotPassword(email);
      if (success) {
        setEmailSent(true);
      } else {
        Alert.alert('Hata', 'Bir hata oluştu');
      }
    } catch (error) {
      Alert.alert('Hata', 'Bir hata oluştu');
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: colors.success + '20' }]}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          </View>
          <Text style={[styles.successTitle, { color: colors.text }]}>
            E-posta Gönderildi!
          </Text>
          <Text style={[styles.successText, { color: colors.textSecondary }]}>
            Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.
            Lütfen gelen kutunuzu kontrol edin.
          </Text>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Giriş Sayfasına Dön</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <TouchableOpacity
            style={styles.navBackButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: colors.warning + '20' }]}>
              <Ionicons name="key" size={48} color={colors.warning} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Şifremi Unuttum</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              E-posta adresinizi girin, size şifre sıfırlama bağlantısı gönderelim.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="E-posta"
                placeholderTextColor={colors.textSecondary}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.primary }]}
              onPress={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitButtonText}>Sıfırlama Bağlantısı Gönder</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
  },
  navBackButton: {
    padding: 8,
    marginLeft: -8,
    marginBottom: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {},
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  submitButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  successText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  backButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
