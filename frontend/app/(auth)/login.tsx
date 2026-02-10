import React, { useState, useEffect } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const { colors, isDark, toggleTheme } = useThemeStore();
  const { showError, showSuccess, alertProps } = useAlert();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  useEffect(() => {
    loadRememberedEmail();
  }, []);

  const loadRememberedEmail = async () => {
    try {
      const savedEmail = await AsyncStorage.getItem('remembered_email');
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch (error) {
      console.log('Error loading remembered email');
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      showError('Hata', 'Lütfen tüm alanları doldurun');
      return;
    }

    setIsLoading(true);
    try {
      // Save or remove email based on remember me
      if (rememberMe) {
        await AsyncStorage.setItem('remembered_email', email);
      } else {
        await AsyncStorage.removeItem('remembered_email');
      }

      const success = await login(email, password);
      if (success) {
        router.replace('/(tabs)/dashboard');
      } else {
        showError('Giriş Başarısız', 'E-posta veya şifre hatalı');
      }
    } catch (error) {
      showError('Hata', 'Bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordKeyPress = (e: any) => {
    // Check for caps lock on web
    if (Platform.OS === 'web' && e.nativeEvent) {
      const isCapsLock = e.nativeEvent.getModifierState && e.nativeEvent.getModifierState('CapsLock');
      setCapsLockOn(isCapsLock);
    }
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    // Simple caps lock detection based on input
    if (text.length > 0) {
      const lastChar = text[text.length - 1];
      const isUpperCase = lastChar === lastChar.toUpperCase() && lastChar !== lastChar.toLowerCase();
      // Only show warning if it looks like caps lock might be on
      if (isUpperCase && text.length > 2) {
        const upperCount = text.split('').filter(c => c === c.toUpperCase() && c !== c.toLowerCase()).length;
        setCapsLockOn(upperCount > text.length * 0.7);
      } else {
        setCapsLockOn(false);
      }
    }
  };

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
          {/* Theme Toggle */}
          <TouchableOpacity style={styles.themeToggle} onPress={toggleTheme}>
            <Ionicons
              name={isDark ? 'sunny' : 'moon'}
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>

          {/* Logo/Title */}
          <View style={styles.header}>
            <View style={[styles.logoContainer, { backgroundColor: colors.primary }]}>
              <Ionicons name="barcode-outline" size={48} color="#FFFFFF" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Barkodcu Cepte</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Satış Yönetim Sistemi
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

            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Şifre"
                placeholderTextColor={colors.textSecondary}
                value={password}
                onChangeText={handlePasswordChange}
                onKeyPress={handlePasswordKeyPress}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {/* Caps Lock Warning */}
            {capsLockOn && (
              <View style={[styles.capsWarning, { backgroundColor: colors.warning + '20' }]}>
                <Ionicons name="warning-outline" size={16} color={colors.warning} />
                <Text style={[styles.capsWarningText, { color: colors.warning }]}>
                  Caps Lock açık olabilir
                </Text>
              </View>
            )}

            {/* Remember Me & Forgot Password Row */}
            <View style={styles.optionsRow}>
              <TouchableOpacity 
                style={styles.rememberMe} 
                onPress={() => setRememberMe(!rememberMe)}
              >
                <View style={[
                  styles.checkbox, 
                  { borderColor: colors.border },
                  rememberMe && { backgroundColor: colors.primary, borderColor: colors.primary }
                ]}>
                  {rememberMe && <Ionicons name="checkmark" size={14} color="#FFF" />}
                </View>
                <Text style={[styles.rememberMeText, { color: colors.textSecondary }]}>
                  Beni Hatırla
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/(auth)/forgot-password')}
              >
                <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>
                  Şifremi Unuttum
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.loginButton, { backgroundColor: colors.primary }]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginButtonText}>Giriş Yap</Text>
              )}
            </TouchableOpacity>

            <View style={styles.registerContainer}>
              <Text style={[styles.registerText, { color: colors.textSecondary }]}>
                Hesabınız yok mu?{' '}
              </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text style={[styles.registerLink, { color: colors.primary }]}>
                  Kayıt Ol
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Demo Info */}
          <View style={[styles.demoInfo, { backgroundColor: colors.info + '20', borderColor: colors.info }]}>
            <Ionicons name="information-circle" size={20} color={colors.info} />
            <Text style={[styles.demoText, { color: colors.info }]}>
              Demo: Herhangi bir e-posta ve şifre ile giriş yapabilirsiniz
            </Text>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Berk Yazılım Tarafından Geliştirilmiştir
            </Text>
            <Text style={[styles.versionText, { color: colors.textSecondary }]}>
              v1.0.0
            </Text>
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
    justifyContent: 'center',
  },
  themeToggle: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
  },
  form: {
    marginBottom: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  capsWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    marginTop: -8,
  },
  capsWarningText: {
    fontSize: 12,
    fontWeight: '500',
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  rememberMe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rememberMeText: {
    fontSize: 14,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: '500',
  },
  loginButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    fontSize: 14,
  },
  registerLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  demoInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginBottom: 24,
  },
  demoText: {
    flex: 1,
    fontSize: 13,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 16,
  },
  footerText: {
    fontSize: 12,
    marginBottom: 4,
  },
  versionText: {
    fontSize: 11,
  },
});
