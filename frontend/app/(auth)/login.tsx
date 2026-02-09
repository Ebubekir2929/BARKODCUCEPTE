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

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const { colors, isDark, toggleTheme } = useThemeStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Hata', 'Lütfen tüm alanları doldurun');
      return;
    }

    setIsLoading(true);
    try {
      const success = await login(email, password);
      if (success) {
        router.replace('/(tabs)/dashboard');
      } else {
        Alert.alert('Hata', 'Giriş başarısız');
      }
    } catch (error) {
      Alert.alert('Hata', 'Bir hata oluştu');
    } finally {
      setIsLoading(false);
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
              <Ionicons name="bar-chart" size={48} color="#FFFFFF" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>BizStats</Text>
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
                onChangeText={setPassword}
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

            <TouchableOpacity
              style={styles.forgotPassword}
              onPress={() => router.push('/(auth)/forgot-password')}
            >
              <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>
                Şifremi Unuttum
              </Text>
            </TouchableOpacity>

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
    fontSize: 32,
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
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
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
  },
  demoText: {
    flex: 1,
    fontSize: 13,
  },
});
