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
import { useLanguageStore } from '../../src/store/languageStore';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const { colors, isDark, toggleTheme } = useThemeStore();
  const { language, setLanguage, t, loadLanguage } = useLanguageStore();
  const { showError, showSuccess, showWarning, alertProps } = useAlert();
  const [isOnline, setIsOnline] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  useEffect(() => {
    loadRememberedEmail();
    loadLanguage();
    // Internet connectivity check
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? true);
    });
    return () => unsubscribe();
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
      showError(t('error'), t('fill_all_fields'));
      return;
    }

    // Internet check
    if (!isOnline) {
      showError(t('network_error'), t('offline_banner'));
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

      const result = await login(email, password);
      if (result.success) {
        // Helper to navigate to correct destination
        const navigateNext = () => {
          // If password must be changed (e.g. after forgot-password reset), force change screen
          const mustChange = useAuthStore.getState().user?.must_change_password;
          if (mustChange) {
            router.replace('/change-password?force=1');
          } else {
            router.replace('/(tabs)/dashboard');
          }
        };
        if (result.licenseWarning && result.daysRemaining !== undefined) {
          showWarning(
            'Lisans Uyarısı',
            `Lisans sürenizin dolmasına ${result.daysRemaining} gün kaldı. Lütfen lisansınızı yenileyiniz.`,
            [{ text: 'Tamam', onPress: navigateNext }]
          );
        } else {
          navigateNext();
        }
      } else {
        showError('Giriş Başarısız', result.error || 'Kullanıcı adı/e-posta veya şifre hatalı');
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
          {/* Top toolbar: Language + Theme */}
          <View style={styles.topToolbar}>
            <TouchableOpacity
              style={[styles.langButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setLanguage(language === 'tr' ? 'en' : 'tr')}
            >
              <Ionicons name="language-outline" size={18} color={colors.text} />
              <Text style={[styles.langText, { color: colors.text }]}>
                {language === 'tr' ? 'TR' : 'EN'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.themeToggle} onPress={toggleTheme}>
              <Ionicons
                name={isDark ? 'sunny' : 'moon'}
                size={24}
                color={colors.text}
              />
            </TouchableOpacity>
          </View>

          {/* Logo/Title */}
          {!isOnline && (
            <View style={[styles.offlineBanner, { backgroundColor: '#EF4444' }]}>
              <Ionicons name="cloud-offline-outline" size={18} color="#fff" />
              <Text style={styles.offlineBannerText}>{t('offline_banner') || 'İnternet bağlantısı yok'}</Text>
            </View>
          )}
          <View style={styles.header}>
            <View style={[styles.logoContainer, { backgroundColor: colors.primary }]}>
              <Ionicons name="barcode-outline" size={48} color="#FFFFFF" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{t('app_name')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('app_subtitle')}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder={t('email_or_username') || 'E-posta veya Kullanıcı Adı'}
                placeholderTextColor={colors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder={t('password')}
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
                  {t('caps_lock_warning')}
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
                  {t('remember_me')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/(auth)/forgot-password')}
              >
                <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>
                  {t('forgot_password')}
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
                <Text style={styles.loginButtonText}>{t('login')}</Text>
              )}
            </TouchableOpacity>

            <View style={styles.registerContainer}>
              <Text style={[styles.registerText, { color: colors.textSecondary }]}>
                {t('no_account')}{' '}
              </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text style={[styles.registerLink, { color: colors.primary }]}>
                  {t('register')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Info */}
          <View style={[styles.demoInfo, { backgroundColor: colors.info + '20', borderColor: colors.info }]}>
            <Ionicons name="information-circle" size={20} color={colors.info} />
            <Text style={[styles.demoText, { color: colors.info }]}>
              {t('login_info') || 'E-posta veya kullanıcı adı ile giriş yapabilirsiniz'}
            </Text>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              {t('developed_by')}
            </Text>
            <Text style={[styles.versionText, { color: colors.textSecondary }]}>
              {t('version')}
            </Text>
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
    justifyContent: 'center',
  },
  themeToggle: {
    padding: 8,
  },
  topToolbar: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  langButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  langText: {
    fontSize: 13,
    fontWeight: '700',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
