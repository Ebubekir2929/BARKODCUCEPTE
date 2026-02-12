import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notificationService from '../../src/services/notificationService';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, toggleTheme } = useThemeStore();
  const { user, logout } = useAuthStore();
  const { language, setLanguage, t, loadLanguage } = useLanguageStore();
  const { showSuccess, showError, showInfo, showWarning, alertProps } = useAlert();
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [lowStockAlert, setLowStockAlert] = useState(true);
  const [salesAlert, setSalesAlert] = useState(true);
  const [cancellationAlert, setCancellationAlert] = useState(true);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  useEffect(() => {
    loadNotificationSettings();
    loadLanguage();
  }, []);

  const loadNotificationSettings = async () => {
    try {
      const notifs = await AsyncStorage.getItem('notificationsEnabled');
      const lowStock = await AsyncStorage.getItem('lowStockAlert');
      const sales = await AsyncStorage.getItem('salesAlert');
      const cancellation = await AsyncStorage.getItem('cancellationAlert');
      if (notifs !== null) setNotificationsEnabled(notifs === 'true');
      if (lowStock !== null) setLowStockAlert(lowStock === 'true');
      if (sales !== null) setSalesAlert(sales === 'true');
      if (cancellation !== null) setCancellationAlert(cancellation === 'true');
    } catch (error) {
      console.log('Error loading notification settings:', error);
    }
  };

  const toggleNotifications = async () => {
    const newValue = !notificationsEnabled;
    
    if (newValue && Platform.OS !== 'web') {
      try {
        const token = await notificationService.registerForPushNotifications();
        if (!token) {
          console.log('Push token not available, but local notifications will work');
        }
      } catch (error) {
        console.log('Push notification registration error:', error);
      }
    }
    
    setNotificationsEnabled(newValue);
    await AsyncStorage.setItem('notificationsEnabled', newValue.toString());
    
    if (newValue) {
      if (Platform.OS === 'web') {
        showSuccess('Bildirimler Aktif', 'Web platformunda bildirimler uygulama içi gösterilecektir.');
      } else {
        showSuccess('Bildirimler Aktif', 'Artık stok, satış ve fiş iptali uyarıları alacaksınız.');
      }
    }
  };

  const toggleLowStockAlert = async (value: boolean) => {
    setLowStockAlert(value);
    await AsyncStorage.setItem('lowStockAlert', value.toString());
  };

  const toggleSalesAlert = async (value: boolean) => {
    setSalesAlert(value);
    await AsyncStorage.setItem('salesAlert', value.toString());
  };

  const toggleCancellationAlert = async (value: boolean) => {
    setCancellationAlert(value);
    await AsyncStorage.setItem('cancellationAlert', value.toString());
  };

  const testCancellationNotification = async () => {
    if (Platform.OS === 'web') {
      showInfo('Demo Bildirim', '🚫 Fiş İptali: Merkez Şube - FIS-001 numaralı fiş iptal edildi. Tutar: ₺245.50');
    } else {
      await notificationService.sendReceiptCancelledNotification(
        {
          id: 'test-1',
          receiptNo: 'FIS-TEST-001',
          date: new Date().toISOString(),
          amount: 245.50,
          reason: 'Test bildirimi',
          items: [],
        },
        'Merkez Şube'
      );
      showSuccess('Gönderildi', 'Test bildirimi gönderildi. Bildirim çubuğunuzu kontrol edin.');
    }
  };

  const handleLogout = () => {
    showWarning('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Çıkış Yap',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleClearCache = () => {
    showWarning('Önbelleği Temizle', 'Tüm önbellekteki veriler silinecek. Devam etmek istiyor musunuz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Temizle',
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem('cached_products');
            await AsyncStorage.removeItem('cached_customers');
            showSuccess('Başarılı', 'Önbellek temizlendi');
          } catch (error) {
            showError('Hata', 'Önbellek temizlenirken bir hata oluştu');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings')}</Text>
      </View>

      <ScrollView style={styles.scrollView}>
        <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.userAvatar, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.userAvatarText, { color: colors.primary }]}>
              {user?.name?.charAt(0) || 'U'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{user?.name || 'Kullanıcı'}</Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
              {user?.email || 'email@example.com'}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: colors.success + '20' }]}>
              <Text style={[styles.roleText, { color: colors.success }]}>
                {user?.role === 'admin' ? t('admin') : t('user')}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('appearance')}</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="moon-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('dark_theme')}</Text>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFF"
              />
            </View>
            
            {/* Language Selection */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowLanguageModal(true)}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="language-outline" size={22} color={colors.primary} />
                <View>
                  <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('language')}</Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                    {language === 'tr' ? '🇹🇷 Türkçe' : '🇬🇧 English'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('notifications')}</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="notifications-outline" size={22} color={colors.primary} />
                <View>
                  <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('push_notifications')}</Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                    {notificationsEnabled ? t('active') : t('inactive')}
                  </Text>
                </View>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
                trackColor={{ false: colors.border, true: colors.success }}
                thumbColor="#FFF"
              />
            </View>
            
            {notificationsEnabled && (
              <>
                <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="cube-outline" size={22} color={colors.warning} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('low_stock_alert')}</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>{t('low_stock_desc')}</Text>
                    </View>
                  </View>
                  <Switch
                    value={lowStockAlert}
                    onValueChange={toggleLowStockAlert}
                    trackColor={{ false: colors.border, true: colors.warning }}
                    thumbColor="#FFF"
                  />
                </View>
                
                <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="cash-outline" size={22} color={colors.success} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('sales_alerts')}</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>{t('sales_alerts_desc')}</Text>
                    </View>
                  </View>
                  <Switch
                    value={salesAlert}
                    onValueChange={toggleSalesAlert}
                    trackColor={{ false: colors.border, true: colors.success }}
                    thumbColor="#FFF"
                  />
                </View>

                <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="close-circle-outline" size={22} color={colors.error} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('cancellation_alert')}</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>{t('cancellation_alert_desc')}</Text>
                    </View>
                  </View>
                  <Switch
                    value={cancellationAlert}
                    onValueChange={toggleCancellationAlert}
                    trackColor={{ false: colors.border, true: colors.error }}
                    thumbColor="#FFF"
                  />
                </View>

                <TouchableOpacity style={styles.menuItem} onPress={testCancellationNotification}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="paper-plane-outline" size={22} color={colors.info} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('test_notification')}</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>{t('test_notification_desc')}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('data_management')}</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}
              onPress={handleClearCache}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="trash-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('clear_cache')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => showInfo(t('info'), t('demo_mode'))}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="sync-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('sync_data')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('application')}</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}
              onPress={() => showInfo(t('app_name'), `${t('version')}\n\n${t('app_subtitle')}\n\nBerk Yazılım © 2025`)}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('about')}</Text>
              </View>
              <Text style={[styles.versionText, { color: colors.textSecondary }]}>{t('version')}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => showInfo(t('help'), 'destek@barkodcucepte.com')}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="help-circle-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('help')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: colors.error + '15', borderColor: colors.error }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>{t('logout')}</Text>
        </TouchableOpacity>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Language Selection Modal */}
      <Modal visible={showLanguageModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('select_language')}</Text>
              <TouchableOpacity onPress={() => setShowLanguageModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <TouchableOpacity
                style={[
                  styles.languageOption,
                  { backgroundColor: colors.card, borderColor: language === 'tr' ? colors.primary : colors.border }
                ]}
                onPress={() => {
                  setLanguage('tr');
                  setShowLanguageModal(false);
                }}
              >
                <Text style={styles.languageFlag}>🇹🇷</Text>
                <View style={styles.languageInfo}>
                  <Text style={[styles.languageName, { color: colors.text }]}>Türkçe</Text>
                  <Text style={[styles.languageNative, { color: colors.textSecondary }]}>Turkish</Text>
                </View>
                {language === 'tr' && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.languageOption,
                  { backgroundColor: colors.card, borderColor: language === 'en' ? colors.primary : colors.border }
                ]}
                onPress={() => {
                  setLanguage('en');
                  setShowLanguageModal(false);
                }}
              >
                <Text style={styles.languageFlag}>🇬🇧</Text>
                <View style={styles.languageInfo}>
                  <Text style={[styles.languageName, { color: colors.text }]}>English</Text>
                  <Text style={[styles.languageNative, { color: colors.textSecondary }]}>İngilizce</Text>
                </View>
                {language === 'en' && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CustomAlert {...alertProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  userAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  userAvatarText: {
    fontSize: 26,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    marginBottom: 8,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  sectionContent: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  menuItemLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  menuItemSub: {
    fontSize: 12,
    marginTop: 2,
  },
  versionText: {
    fontSize: 14,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    padding: 20,
    paddingBottom: 40,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    marginBottom: 12,
  },
  languageFlag: {
    fontSize: 32,
    marginRight: 16,
  },
  languageInfo: {
    flex: 1,
  },
  languageName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 2,
  },
  languageNative: {
    fontSize: 13,
  },
});
