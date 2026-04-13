import React, { useState, useCallback } from 'react';
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
import * as Clipboard from 'expo-clipboard';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuthStore();
  const { colors } = useThemeStore();
  const { showError, showWarning, showSuccess, alertProps } = useAlert();

  // Step tracking
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 2;

  // Form fields
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [taxNumber, setTaxNumber] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [businessType, setBusinessType] = useState<'normal' | 'restoran'>('normal');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const getPasswordStrength = useCallback((pwd: string) => {
    if (!pwd) return { level: 0, text: '—', color: colors.textSecondary };
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 1) return { level: 1, text: 'Zayıf', color: '#EF4444' };
    if (score <= 2) return { level: 2, text: 'Orta', color: '#F59E0B' };
    if (score <= 3) return { level: 3, text: 'İyi', color: '#3B82F6' };
    return { level: 4, text: 'Güçlü', color: '#10B981' };
  }, [colors]);

  const passwordStrength = getPasswordStrength(password);

  const copyToClipboard = async (text: string) => {
    if (text) {
      await Clipboard.setStringAsync(text);
      showSuccess('Kopyalandı', 'Panoya kopyalandı');
    }
  };

  const validateStep1 = () => {
    if (!fullName.trim()) {
      showWarning('Uyarı', 'Firma yetkilisi adını girin');
      return false;
    }
    if (!username.trim() || username.length < 3) {
      showWarning('Uyarı', 'Kullanıcı adı en az 3 karakter olmalıdır');
      return false;
    }
    if (!/^[a-zA-Z0-9._]+$/.test(username)) {
      showWarning('Uyarı', 'Kullanıcı adı sadece harf, rakam, nokta ve alt çizgi içerebilir');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showError('Hata', 'Geçerli bir e-posta adresi girin');
      return false;
    }
    if (password.length < 6) {
      showWarning('Uyarı', 'Şifre en az 6 karakter olmalıdır');
      return false;
    }
    return true;
  };

  const handleNextStep = () => {
    if (validateStep1()) {
      setCurrentStep(2);
    }
  };

  const handleRegister = async () => {
    // Validate step 2
    if (!taxNumber || !taxNumber.match(/^\d{10,11}$/)) {
      showWarning('Uyarı', 'Vergi numarası 10 veya 11 haneli olmalıdır');
      return;
    }
    if (!tenantId.trim()) {
      showWarning('Uyarı', 'Tenant ID girin');
      return;
    }
    if (!termsAccepted) {
      showWarning('Uyarı', 'Şartlar ve koşulları kabul etmelisiniz');
      return;
    }

    setIsLoading(true);
    try {
      const result = await register({
        full_name: fullName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        tax_number: taxNumber.trim(),
        tenant_id: tenantId.trim(),
        tenant_name: tenantName.trim() || tenantId.trim(),
        business_type: businessType,
        terms_accepted: termsAccepted,
      });

      if (result.success) {
        router.replace('/(tabs)/dashboard');
      } else {
        showError('Hata', result.error || 'Kayıt başarısız');
      }
    } catch (error) {
      showError('Hata', 'Bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderProgressBar = () => (
    <View style={styles.progressContainer}>
      <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${(currentStep / totalSteps) * 100}%`,
              backgroundColor: currentStep === totalSteps ? '#10B981' : colors.primary,
            },
          ]}
        />
      </View>
    </View>
  );

  const renderInputWithActions = (
    value: string,
    onChangeText: (t: string) => void,
    placeholder: string,
    icon: string,
    options?: {
      keyboardType?: any;
      autoCapitalize?: any;
      maxLength?: number;
      showCopy?: boolean;
      showClear?: boolean;
      secureTextEntry?: boolean;
    }
  ) => (
    <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon as any} size={20} color={colors.textSecondary} />
      <TextInput
        style={[styles.input, { color: colors.text }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={onChangeText}
        keyboardType={options?.keyboardType || 'default'}
        autoCapitalize={options?.autoCapitalize || 'none'}
        maxLength={options?.maxLength}
        secureTextEntry={options?.secureTextEntry}
      />
      {options?.showCopy && value.length > 0 && (
        <TouchableOpacity onPress={() => copyToClipboard(value)} style={styles.actionButton}>
          <Ionicons name="copy-outline" size={18} color={colors.primary} />
        </TouchableOpacity>
      )}
      {options?.showClear && value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} style={styles.actionButton}>
          <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderStep1 = () => (
    <>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Firma Yetkilisi</Text>
      {renderInputWithActions(fullName, setFullName, 'Ad Soyad', 'person-outline', { autoCapitalize: 'words' })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Kullanıcı Adı</Text>
      {renderInputWithActions(username, setUsername, 'kullaniciadi', 'at-outline', { showCopy: true, showClear: true })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>E-Mail</Text>
      {renderInputWithActions(email, setEmail, 'example@user.com', 'mail-outline', { keyboardType: 'email-address', showCopy: true, showClear: true })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Şifre</Text>
      <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="En az 6 karakter"
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

      {/* Password strength */}
      <View style={styles.strengthContainer}>
        <View style={[styles.strengthBarBg, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.strengthBarFill,
              {
                width: `${(passwordStrength.level / 4) * 100}%`,
                backgroundColor: passwordStrength.color,
              },
            ]}
          />
        </View>
        <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
          Şifre gücü: {passwordStrength.text}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
        onPress={handleNextStep}
      >
        <Text style={styles.primaryButtonText}>Devam Et</Text>
        <Ionicons name="arrow-forward" size={20} color="#FFF" />
      </TouchableOpacity>
    </>
  );

  const renderStep2 = () => (
    <>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Vergi Numarası</Text>
      {renderInputWithActions(taxNumber, setTaxNumber, '10 veya 11 haneli', 'document-text-outline', { keyboardType: 'numeric', maxLength: 11 })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Tenant ID</Text>
      {renderInputWithActions(tenantId, setTenantId, 'Client tarafında oluşturulur', 'key-outline', { showCopy: true, showClear: true })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Tenant Adı (İsteğe bağlı)</Text>
      {renderInputWithActions(tenantName, setTenantName, 'Örn: Merkez Şube', 'pricetag-outline', { autoCapitalize: 'words', showClear: true })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>İşletme Tipi</Text>
      <View style={styles.businessTypeContainer}>
        <TouchableOpacity
          style={[
            styles.businessTypeCard,
            { backgroundColor: colors.card, borderColor: businessType === 'normal' ? colors.primary : colors.border },
            businessType === 'normal' && { borderWidth: 2 },
          ]}
          onPress={() => setBusinessType('normal')}
        >
          <View style={[styles.businessTypeIcon, { backgroundColor: businessType === 'normal' ? colors.primary + '20' : colors.border + '40' }]}>
            <Ionicons name="storefront-outline" size={28} color={businessType === 'normal' ? colors.primary : colors.textSecondary} />
          </View>
          <View style={styles.businessTypeInfo}>
            <Text style={[styles.businessTypeName, { color: colors.text }]}>Normal</Text>
            <Text style={[styles.businessTypeDesc, { color: colors.textSecondary }]}>Masa yapısı olmayan işletmeler</Text>
          </View>
          <View style={[styles.radioOuter, { borderColor: businessType === 'normal' ? colors.primary : colors.border }]}>
            {businessType === 'normal' && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.businessTypeCard,
            { backgroundColor: colors.card, borderColor: businessType === 'restoran' ? colors.primary : colors.border },
            businessType === 'restoran' && { borderWidth: 2 },
          ]}
          onPress={() => setBusinessType('restoran')}
        >
          <View style={[styles.businessTypeIcon, { backgroundColor: businessType === 'restoran' ? colors.primary + '20' : colors.border + '40' }]}>
            <Ionicons name="restaurant-outline" size={28} color={businessType === 'restoran' ? colors.primary : colors.textSecondary} />
          </View>
          <View style={styles.businessTypeInfo}>
            <Text style={[styles.businessTypeName, { color: colors.text }]}>Restoran</Text>
            <Text style={[styles.businessTypeDesc, { color: colors.textSecondary }]}>Masalar var, açık masalar kullanılacak</Text>
          </View>
          <View style={[styles.radioOuter, { borderColor: businessType === 'restoran' ? colors.primary : colors.border }]}>
            {businessType === 'restoran' && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
          </View>
        </TouchableOpacity>
      </View>

      {/* Terms & Conditions */}
      <TouchableOpacity
        style={[styles.termsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => setTermsAccepted(!termsAccepted)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.checkbox,
          { borderColor: termsAccepted ? colors.primary : colors.border },
          termsAccepted && { backgroundColor: colors.primary },
        ]}>
          {termsAccepted && <Ionicons name="checkmark" size={14} color="#FFF" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.termsText, { color: colors.textSecondary }]}>
            Şartlar ve koşulları{' '}
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              okudum ve onaylıyorum
            </Text>
            .
          </Text>
        </View>
      </TouchableOpacity>

      {/* Register Button */}
      <TouchableOpacity
        style={[styles.registerButton]}
        onPress={handleRegister}
        disabled={isLoading}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.registerButtonText}>Kaydol</Text>
        )}
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => currentStep > 1 ? setCurrentStep(currentStep - 1) : router.back()}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.stepText, { color: colors.textSecondary }]}>
              {currentStep} / {totalSteps}
            </Text>
          </View>

          {renderProgressBar()}

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Hesap Oluştur</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {currentStep === 1 ? 'Kişisel bilgilerinizi girin' : 'İşletme bilgilerinizi girin'}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {currentStep === 1 ? renderStep1() : renderStep2()}
          </View>

          {/* Login Link */}
          <View style={styles.loginContainer}>
            <Text style={[styles.loginText, { color: colors.textSecondary }]}>
              Zaten hesabınız var mı?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={[styles.loginLink, { color: colors.primary }]}>
                Girişe geri dön
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

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
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
  },
  form: {},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
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
  actionButton: {
    padding: 6,
    marginLeft: 4,
  },
  strengthContainer: {
    marginBottom: 20,
    marginTop: -8,
  },
  strengthBarBg: {
    height: 6,
    borderRadius: 3,
    marginBottom: 6,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  strengthLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  businessTypeContainer: {
    gap: 12,
    marginBottom: 20,
  },
  businessTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  businessTypeIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  businessTypeInfo: {
    flex: 1,
  },
  businessTypeName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  businessTypeDesc: {
    fontSize: 13,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  registerButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: '#0EA5E9',
    // Gradient effect with background
    backgroundImage: 'linear-gradient(135deg, #0EA5E9, #10B981)',
  } as any,
  registerButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  loginText: {
    fontSize: 14,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '600',
  },
});
