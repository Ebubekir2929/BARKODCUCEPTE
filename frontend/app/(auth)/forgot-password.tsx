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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { useThemeStore } from '../../src/store/themeStore';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';

// Simple math CAPTCHA generator
const generateCaptcha = () => {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const operators = ['+', '-', 'x'];
  const operator = operators[Math.floor(Math.random() * 3)];
  
  let answer: number;
  switch (operator) {
    case '+':
      answer = num1 + num2;
      break;
    case '-':
      answer = Math.max(num1, num2) - Math.min(num1, num2);
      return { question: `${Math.max(num1, num2)} - ${Math.min(num1, num2)} = ?`, answer };
    case 'x':
      answer = num1 * num2;
      break;
    default:
      answer = num1 + num2;
  }
  
  return { question: `${num1} ${operator} ${num2} = ?`, answer };
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { forgotPassword } = useAuthStore();
  const { colors } = useThemeStore();
  const { showError, showSuccess, showWarning, alertProps } = useAlert();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  
  // CAPTCHA state
  const [captcha, setCaptcha] = useState(generateCaptcha());
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(false);

  const refreshCaptcha = () => {
    setCaptcha(generateCaptcha());
    setCaptchaInput('');
    setCaptchaVerified(false);
  };

  const verifyCaptcha = () => {
    const userAnswer = parseInt(captchaInput);
    if (userAnswer === captcha.answer) {
      setCaptchaVerified(true);
      showSuccess('Doğrulandı', 'Robot doğrulaması başarılı!');
    } else {
      showError('Hatalı', 'Yanlış cevap. Lütfen tekrar deneyin.');
      refreshCaptcha();
    }
  };

  const handleSubmit = async () => {
    if (!email) {
      showWarning('Uyarı', 'Lütfen e-posta adresinizi girin');
      return;
    }

    if (!captchaVerified) {
      showWarning('Uyarı', 'Lütfen önce robot doğrulamasını tamamlayın');
      return;
    }

    // Email validation (allow username too - just require non-empty)
    const trimmed = email.trim();
    if (trimmed.length < 3) {
      showError('Hata', 'Geçerli bir e-posta veya kullanıcı adı girin');
      return;
    }

    setIsLoading(true);
    try {
      const result = await forgotPassword(trimmed);
      if (result.success) {
        setEmailSent(true);
      } else {
        showError('Hata', result.error || 'Bir hata oluştu. Lütfen tekrar deneyin.');
      }
    } catch (error) {
      showError('Hata', 'Bir hata oluştu. Lütfen tekrar deneyin.');
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
        <CustomAlert {...alertProps} />
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

            {/* Robot Verification CAPTCHA */}
            <View style={[styles.captchaContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.captchaHeader}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
                <Text style={[styles.captchaTitle, { color: colors.text }]}>Robot Doğrulama</Text>
              </View>
              
              <View style={styles.captchaContent}>
                <View style={[styles.captchaQuestion, { backgroundColor: colors.background }]}>
                  <Text style={[styles.captchaQuestionText, { color: colors.text }]}>
                    {captcha.question}
                  </Text>
                  <TouchableOpacity onPress={refreshCaptcha} style={styles.refreshBtn}>
                    <Ionicons name="refresh" size={20} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.captchaInputRow}>
                  <TextInput
                    style={[
                      styles.captchaInput, 
                      { 
                        backgroundColor: colors.background, 
                        color: colors.text,
                        borderColor: captchaVerified ? colors.success : colors.border,
                      }
                    ]}
                    placeholder="Cevap"
                    placeholderTextColor={colors.textSecondary}
                    value={captchaInput}
                    onChangeText={setCaptchaInput}
                    keyboardType="number-pad"
                    maxLength={4}
                    editable={!captchaVerified}
                  />
                  
                  {captchaVerified ? (
                    <View style={[styles.verifiedBadge, { backgroundColor: colors.success }]}>
                      <Ionicons name="checkmark" size={20} color="#FFF" />
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.verifyBtn, { backgroundColor: colors.primary }]}
                      onPress={verifyCaptcha}
                      disabled={!captchaInput}
                    >
                      <Text style={styles.verifyBtnText}>Doğrula</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {captchaVerified && (
                  <View style={[styles.verifiedMessage, { backgroundColor: colors.success + '15' }]}>
                    <Ionicons name="shield-checkmark" size={16} color={colors.success} />
                    <Text style={[styles.verifiedText, { color: colors.success }]}>
                      Robot değilsiniz doğrulandı
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.submitButton, 
                { backgroundColor: captchaVerified ? colors.primary : colors.textSecondary }
              ]}
              onPress={handleSubmit}
              disabled={isLoading || !captchaVerified}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#FFF" />
                  <Text style={styles.submitButtonText}>Sıfırlama Bağlantısı Gönder</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Custom Alert */}
      <CustomAlert {...alertProps} />
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
    marginBottom: 20,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  captchaContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  captchaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  captchaTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  captchaContent: {},
  captchaQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  captchaQuestionText: {
    fontSize: 24,
    fontWeight: '700',
  },
  refreshBtn: {
    padding: 8,
  },
  captchaInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  captchaInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  verifyBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  verifyBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  verifiedBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  verifiedText: {
    fontSize: 13,
    fontWeight: '600',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
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
