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
  TextInput,
  ActivityIndicator,
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
  const { user, logout, addTenant, updateTenantName, removeTenant } = useAuthStore();
  const { language, setLanguage, t, loadLanguage } = useLanguageStore();
  const { showSuccess, showError, showInfo, showWarning, alertProps } = useAlert();
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [lowStockAlert, setLowStockAlert] = useState(true);
  const [salesAlert, setSalesAlert] = useState(true);
  const [cancellationAlert, setCancellationAlert] = useState(true);
  const [highSalesThreshold, setHighSalesThreshold] = useState('5000');
  const [checkIntervalMinutes, setCheckIntervalMinutes] = useState('15');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  // Tenant Management State
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [tenantModalMode, setTenantModalMode] = useState<'add' | 'edit'>('add');
  const [editingTenantId, setEditingTenantId] = useState('');
  const [tenantIdInput, setTenantIdInput] = useState('');
  const [tenantNameInput, setTenantNameInput] = useState('');
  const [tenantLoading, setTenantLoading] = useState(false);

  useEffect(() => {
    loadNotificationSettings();
    loadLanguage();
  }, []);

  const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

  // Sync current notification prefs with backend
  const syncSettingsToBackend = async (overrides?: Partial<{
    notify_cancellations: boolean; notify_high_sales: boolean; high_sales_threshold: number;
    notify_low_stock: boolean; check_interval_minutes: number;
  }>) => {
    try {
      const { token } = useAuthStore.getState();
      if (!token) return;
      const body = {
        notify_cancellations: cancellationAlert,
        notify_high_sales: salesAlert,
        high_sales_threshold: parseFloat(highSalesThreshold) || 5000,
        notify_low_stock: lowStockAlert,
        check_interval_minutes: Math.max(1, parseInt(checkIntervalMinutes, 10) || 15),
        ...overrides,
      };
      await fetch(`${API_URL}/api/notifications/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.log('Settings sync failed:', e);
    }
  };

  const loadNotificationSettings = async () => {
    try {
      const notifs = await AsyncStorage.getItem('notificationsEnabled');
      if (notifs !== null) setNotificationsEnabled(notifs === 'true');
      // Fetch from backend (source of truth)
      const { token } = useAuthStore.getState();
      if (token) {
        try {
          const resp = await fetch(`${API_URL}/api/notifications/settings`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (resp.ok) {
            const d = await resp.json();
            const s = d?.settings || {};
            setCancellationAlert(!!s.notify_cancellations);
            setSalesAlert(!!s.notify_high_sales);
            setLowStockAlert(!!s.notify_low_stock);
            setHighSalesThreshold(String(s.high_sales_threshold ?? 5000));
            setCheckIntervalMinutes(String(s.check_interval_minutes ?? 15));
            return;
          }
        } catch {}
      }
      // Fallback: local storage
      const lowStock = await AsyncStorage.getItem('lowStockAlert');
      const sales = await AsyncStorage.getItem('salesAlert');
      const cancellation = await AsyncStorage.getItem('cancellationAlert');
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
    } else if (!newValue && Platform.OS !== 'web') {
      // Turning off → unregister on backend so server won't push anymore
      try {
        await notificationService.unregisterFromBackend();
      } catch (error) {
        console.log('Push notification unregister error:', error);
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
    } else if (Platform.OS !== 'web') {
      showInfo('Bildirimler Kapatıldı', 'Artık push bildirimi almayacaksınız.');
    }
  };

  const toggleLowStockAlert = async (value: boolean) => {
    setLowStockAlert(value);
    await AsyncStorage.setItem('lowStockAlert', value.toString());
    await syncSettingsToBackend({ notify_low_stock: value });
  };

  const toggleSalesAlert = async (value: boolean) => {
    setSalesAlert(value);
    await AsyncStorage.setItem('salesAlert', value.toString());
    await syncSettingsToBackend({ notify_high_sales: value });
  };

  const toggleCancellationAlert = async (value: boolean) => {
    setCancellationAlert(value);
    await AsyncStorage.setItem('cancellationAlert', value.toString());
    await syncSettingsToBackend({ notify_cancellations: value });
  };

  const testCancellationNotification = async () => {
    if (Platform.OS === 'web') {
      showInfo('Demo Bildirim', '🚫 Fiş İptali: Merkez Şube - FIS-001 numaralı fiş iptal edildi. Tutar: ₺245.50');
      return;
    }

    // Try backend-powered push first (so it also tests the real Expo → device round-trip)
    try {
      const ok = await notificationService.sendTestPushNotification(
        '🚫 Fiş İptali',
        'Merkez Şube: FIS-TEST-001 numaralı fiş iptal edildi. Tutar: ₺245.50'
      );
      if (ok) {
        showSuccess('Gönderildi', 'Push bildirimi gönderildi. Bildirim çubuğunuzu kontrol edin.');
        return;
      }
    } catch (err) {
      console.log('Backend test notification failed, falling back to local:', err);
    }

    // Fallback: local notification
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

  // === Tenant Management Functions ===
  const openAddTenantModal = () => {
    setTenantModalMode('add');
    setTenantIdInput('');
    setTenantNameInput('');
    setEditingTenantId('');
    setShowTenantModal(true);
  };

  const openEditTenantModal = (tenantId: string, currentName: string) => {
    setTenantModalMode('edit');
    setEditingTenantId(tenantId);
    setTenantIdInput(tenantId);
    setTenantNameInput(currentName);
    setShowTenantModal(true);
  };

  const handleSaveTenant = async () => {
    if (tenantModalMode === 'add') {
      if (!tenantIdInput.trim()) {
        showWarning('Uyarı', 'Tenant ID girin');
        return;
      }
      if (!tenantNameInput.trim()) {
        showWarning('Uyarı', 'Veri kaynağı adı girin');
        return;
      }
      setTenantLoading(true);
      const result = await addTenant(tenantIdInput.trim(), tenantNameInput.trim());
      setTenantLoading(false);
      if (result.success) {
        showSuccess('Başarılı', 'Veri kaynağı eklendi');
        setShowTenantModal(false);
      } else {
        showError('Hata', result.error || 'Eklenemedi');
      }
    } else {
      if (!tenantNameInput.trim()) {
        showWarning('Uyarı', 'Veri kaynağı adı girin');
        return;
      }
      setTenantLoading(true);
      const result = await updateTenantName(editingTenantId, tenantNameInput.trim());
      setTenantLoading(false);
      if (result.success) {
        showSuccess('Başarılı', 'İsim güncellendi');
        setShowTenantModal(false);
      } else {
        showError('Hata', result.error || 'Güncellenemedi');
      }
    }
  };

  const handleDeleteTenant = (tenantId: string, tenantName: string) => {
    if ((user?.tenants?.length || 0) <= 1) {
      showWarning('Uyarı', 'En az 1 veri kaynağı olmalıdır');
      return;
    }
    showWarning('Veri Kaynağı Sil', `"${tenantName}" veri kaynağını silmek istediğinize emin misiniz?`, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          const result = await removeTenant(tenantId);
          if (result.success) {
            showSuccess('Başarılı', 'Veri kaynağı silindi');
          } else {
            showError('Hata', result.error || 'Silinemedi');
          }
        },
      },
    ]);
  };

  // === Render Tenant Management Section ===
  const renderTenantSection = () => {
    const tenants = user?.tenants || [];
    
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>VERİ KAYNAKLARI YÖNETİMİ</Text>
        
        <View style={[styles.tenantInfoBanner, { backgroundColor: colors.info + '15', borderColor: colors.info + '40' }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.info} />
          <Text style={[styles.tenantInfoText, { color: colors.info }]}>
            Her Tenant ID bir veri kaynağını temsil eder. Uygulamadaki filtre butonları burada tanımlanan isimleri gösterir.
          </Text>
        </View>

        {tenants.map((tenant, index) => (
          <View
            key={tenant.tenant_id}
            style={[styles.tenantCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.tenantCardHeader}>
              <View style={[styles.tenantIndex, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.tenantIndexText, { color: colors.primary }]}>{index + 1}</Text>
              </View>
              <View style={styles.tenantCardInfo}>
                <Text style={[styles.tenantName, { color: colors.text }]}>{tenant.name}</Text>
                <View style={styles.tenantIdRow}>
                  <Ionicons name="key-outline" size={12} color={colors.textSecondary} />
                  <Text style={[styles.tenantIdText, { color: colors.textSecondary }]}>{tenant.tenant_id}</Text>
                </View>
              </View>
              <View style={styles.tenantActions}>
                <TouchableOpacity
                  style={[styles.tenantActionBtn, { backgroundColor: colors.primary + '15' }]}
                  onPress={() => openEditTenantModal(tenant.tenant_id, tenant.name)}
                >
                  <Ionicons name="pencil-outline" size={16} color={colors.primary} />
                </TouchableOpacity>
                {tenants.length > 1 && (
                  <TouchableOpacity
                    style={[styles.tenantActionBtn, { backgroundColor: colors.error + '15' }]}
                    onPress={() => handleDeleteTenant(tenant.tenant_id, tenant.name)}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.addTenantBtn, { borderColor: colors.primary }]}
          onPress={openAddTenantModal}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
          <Text style={[styles.addTenantText, { color: colors.primary }]}>Yeni Veri Kaynağı Ekle</Text>
        </TouchableOpacity>
      </View>
    );
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
              {user?.full_name?.charAt(0) || 'U'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{user?.full_name || 'Kullanıcı'}</Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
              {user?.email || 'email@example.com'}
            </Text>
            <View style={styles.userBadges}>
              <View style={[styles.roleBadge, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.roleText, { color: colors.success }]}>
                  {user?.role === 'admin' ? t('admin') : t('user')}
                </Text>
              </View>
              {user?.business_type && (
                <View style={[styles.roleBadge, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons
                    name={user.business_type === 'restoran' ? 'restaurant-outline' : 'storefront-outline'}
                    size={11}
                    color={colors.primary}
                  />
                  <Text style={[styles.roleText, { color: colors.primary, marginLeft: 4 }]}>
                    {user.business_type === 'restoran' ? 'Restoran' : 'Normal'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Veri Kaynakları Yönetimi */}
        {renderTenantSection()}

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

                {salesAlert && (
                  <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 8 }]}>
                    <View style={styles.menuItemLeft}>
                      <Ionicons name="pricetag-outline" size={20} color={colors.success} />
                      <View>
                        <Text style={[styles.menuItemLabel, { color: colors.text, fontSize: 13 }]}>Yüksek Satış Eşiği (₺)</Text>
                        <Text style={[styles.menuItemSub, { color: colors.textSecondary, fontSize: 10 }]}>Bu tutarın üzerindeki Perakende / Satış faturaları için bildirim</Text>
                      </View>
                    </View>
                    <TextInput
                      value={highSalesThreshold}
                      onChangeText={setHighSalesThreshold}
                      onEndEditing={() => syncSettingsToBackend()}
                      keyboardType="numeric"
                      placeholder="5000"
                      placeholderTextColor={colors.textSecondary}
                      style={{
                        minWidth: 90, paddingHorizontal: 10, paddingVertical: 6,
                        borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                        color: colors.text, textAlign: 'right', fontWeight: '700',
                      }}
                    />
                  </View>
                )}

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

                <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 8 }]}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="timer-outline" size={22} color={colors.primary} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text, fontSize: 13 }]}>Kontrol Sıklığı (dk)</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary, fontSize: 10 }]}>Tüm veri kaynakları için bildirim taraması</Text>
                    </View>
                  </View>
                  <TextInput
                    value={checkIntervalMinutes}
                    onChangeText={setCheckIntervalMinutes}
                    onEndEditing={() => syncSettingsToBackend()}
                    keyboardType="numeric"
                    placeholder="15"
                    placeholderTextColor={colors.textSecondary}
                    style={{
                      minWidth: 70, paddingHorizontal: 10, paddingVertical: 6,
                      borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                      color: colors.text, textAlign: 'center', fontWeight: '700',
                    }}
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
              onPress={async () => {
                try {
                  await AsyncStorage.removeItem('cached_products');
                  await AsyncStorage.removeItem('cached_customers');
                  await AsyncStorage.removeItem('cached_dashboard');
                  await AsyncStorage.removeItem('cached_reports');
                  showSuccess('Senkronize Edildi', 'Tüm veriler yenilendi. Sekmeleri açtığınızda canlı POS verilerinden yeniden çekilecek.');
                } catch (e) {
                  showError('Hata', 'Senkronizasyon sırasında bir hata oluştu.');
                }
              }}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="sync-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('sync_data')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Account / Güvenlik */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>HESAP VE GÜVENLİK</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/change-password')}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="key-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>Şifre Değiştir</Text>
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
              onPress={() => showInfo(
                'Destek / Yardım',
                '📞 Telefon:\n  • 0506 711 9129\n\n📧 E-posta:\n  • fatih@berkyazilim.com'
              )}
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

      {/* Tenant Add/Edit Modal */}
      <Modal visible={showTenantModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {tenantModalMode === 'add' ? 'Yeni Veri Kaynağı' : 'Veri Kaynağı Düzenle'}
              </Text>
              <TouchableOpacity onPress={() => setShowTenantModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              {tenantModalMode === 'add' && (
                <>
                  <Text style={[styles.inputLabel, { color: colors.text }]}>Tenant ID</Text>
                  <View style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="key-outline" size={18} color={colors.textSecondary} />
                    <TextInput
                      style={[styles.modalInputField, { color: colors.text }]}
                      placeholder="Windows tarafında oluşturulan ID"
                      placeholderTextColor={colors.textSecondary}
                      value={tenantIdInput}
                      onChangeText={setTenantIdInput}
                      autoCapitalize="none"
                    />
                  </View>
                </>
              )}

              {tenantModalMode === 'edit' && (
                <View style={[styles.editTenantIdDisplay, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons name="key-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.editTenantIdText, { color: colors.textSecondary }]}>
                    {editingTenantId}
                  </Text>
                </View>
              )}

              <Text style={[styles.inputLabel, { color: colors.text }]}>Veri Kaynağı Adı</Text>
              <View style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={[styles.modalInputField, { color: colors.text }]}
                  placeholder="Örn: Merkez Şube, Kadıköy Mağaza"
                  placeholderTextColor={colors.textSecondary}
                  value={tenantNameInput}
                  onChangeText={setTenantNameInput}
                />
              </View>

              <TouchableOpacity
                style={[styles.saveTenantBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveTenant}
                disabled={tenantLoading}
                activeOpacity={0.8}
              >
                {tenantLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name={tenantModalMode === 'add' ? 'add-circle-outline' : 'checkmark-circle-outline'} size={20} color="#FFF" />
                    <Text style={styles.saveTenantBtnText}>
                      {tenantModalMode === 'add' ? 'Ekle' : 'Güncelle'}
                    </Text>
                  </>
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
  userBadges: {
    flexDirection: 'row',
    gap: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
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
  // Tenant Management Styles
  tenantInfoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  tenantInfoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  tenantCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  tenantCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  tenantIndex: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tenantIndexText: {
    fontSize: 16,
    fontWeight: '700',
  },
  tenantCardInfo: {
    flex: 1,
  },
  tenantName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  tenantIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tenantIdText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tenantActions: {
    flexDirection: 'row',
    gap: 8,
  },
  tenantActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addTenantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    gap: 8,
    marginTop: 4,
  },
  addTenantText: {
    fontSize: 15,
    fontWeight: '600',
  },
  // Modal Styles
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
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalInput: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
  },
  modalInputField: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
  },
  editTenantIdDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  editTenantIdText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  saveTenantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  saveTenantBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
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
