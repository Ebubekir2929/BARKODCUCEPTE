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
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
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
  const { colors, isDark, mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const { user, logout, addTenant, updateTenantName, removeTenant } = useAuthStore();
  const { language, setLanguage, t, loadLanguage } = useLanguageStore();
  const { showSuccess, showError, showInfo, showWarning, alertProps } = useAlert();
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [lowStockAlert, setLowStockAlert] = useState(true);
  const [salesAlert, setSalesAlert] = useState(true);
  const [cancellationAlert, setCancellationAlert] = useState(true);
  const [lineCancellationAlert, setLineCancellationAlert] = useState(true);
  const [highSalesThreshold, setHighSalesThreshold] = useState('5000');
  const [checkIntervalMinutes, setCheckIntervalMinutes] = useState('15');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  // Scan-now (manual trigger) state
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [scanResetDedup, setScanResetDedup] = useState(false);

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
        notify_line_cancellations: lineCancellationAlert,
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
            setLineCancellationAlert(s.notify_line_cancellations !== false);
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
          // Diagnose why there's no token
          const permStatus = await (async () => {
            try {
              const { getPermissionsAsync } = require('expo-notifications');
              const { status } = await getPermissionsAsync();
              return status;
            } catch {
              return 'unknown';
            }
          })();
          const isDev = (require('expo-device') as any)?.isDevice;
          showError(
            'Token Alınamadı',
            `Push token alınamadı.\n\n` +
            `• İzin: ${permStatus}\n` +
            `• Fiziksel cihaz mı: ${isDev}\n\n` +
            (permStatus !== 'granted'
              ? 'Bildirim izinlerini açıp tekrar deneyin: Android Ayarları → Uygulamalar → Barkodcu Cepte → Bildirimler'
              : 'Internet bağlantınızı kontrol edip tekrar deneyin.')
          );
        } else {
          showSuccess(
            '✅ Token Kaydedildi',
            `Push aktif.\n${token.substring(0, 40)}...`,
          );
        }
      } catch (error: any) {
        showError(
          'Kayıt Hatası',
          `Push kaydı başarısız oldu:\n${String(error?.message || error)}`,
        );
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

    if (newValue && Platform.OS === 'web') {
      showInfo(t('notif_active_title'), t('notif_web_msg'));
    } else if (!newValue && Platform.OS !== 'web') {
      showInfo(t('notif_off_title'), t('notif_off_msg'));
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
      showInfo(t('demo_notif_title'), '🚫 Fiş İptali: Merkez Şube - FIS-001 numaralı fiş iptal edildi. Tutar: ₺245.50');
      return;
    }

    // Try backend-powered push first (so it also tests the real Expo → device round-trip)
    try {
      const ok = await notificationService.sendTestPushNotification(
        '🚫 Fiş İptali',
        'Merkez Şube: FIS-TEST-001 numaralı fiş iptal edildi. Tutar: ₺245.50'
      );
      if (ok) {
        showSuccess(t('sent_title'), t('test_notif_push_sent'));
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
    showSuccess(t('sent_title'), t('test_notif_sent'));
  };

  const runScanNow = async (resetDedup: boolean = false) => {
    try {
      setScanLoading(true);
      setScanResetDedup(resetDedup);
      const { token } = useAuthStore.getState();
      if (!token) {
        showError(t('error'), 'Oturum bulunamadı');
        setScanLoading(false);
        return;
      }
      const resp = await fetch(`${API_URL}/api/notifications/scan-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          days_back: 2,
          reset_dedup: resetDedup,
          send_push: true,
          page_size: 500,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showError('Tarama Hatası', data?.detail || `HTTP ${resp.status}`);
        setScanLoading(false);
        return;
      }
      setScanResult(data);
      setScanModalVisible(true);
    } catch (e: any) {
      showError('Tarama Hatası', e?.message || String(e));
    } finally {
      setScanLoading(false);
    }
  };

  const handleLogout = () => {
    showWarning(t('logout_title'), t('logout_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('logout_title'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleClearCache = () => {
    showWarning(t('cache_clear_title'), t('clear_cache_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clear'),
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem('cached_products');
            await AsyncStorage.removeItem('cached_customers');
            showSuccess(t('success_title'), t('cache_cleared'));
          } catch (error) {
            showError(t('error_title'), t('cache_clear_error'));
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
        showWarning(t('warning_title'), t('enter_tenant_id'));
        return;
      }
      if (!tenantNameInput.trim()) {
        showWarning(t('warning_title'), t('enter_tenant_name'));
        return;
      }
      setTenantLoading(true);
      const result = await addTenant(tenantIdInput.trim(), tenantNameInput.trim());
      setTenantLoading(false);
      if (result.success) {
        showSuccess(t('success_title'), t('tenant_added_success'));
        setShowTenantModal(false);
      } else {
        showError(t('error_title'), result.error || t('could_not_add'));
      }
    } else {
      if (!tenantNameInput.trim()) {
        showWarning(t('warning_title'), t('enter_tenant_name'));
        return;
      }
      setTenantLoading(true);
      const result = await updateTenantName(editingTenantId, tenantNameInput.trim());
      setTenantLoading(false);
      if (result.success) {
        showSuccess(t('success_title'), t('name_updated'));
        setShowTenantModal(false);
      } else {
        showError(t('error_title'), result.error || t('update_failed'));
      }
    }
  };

  const handleDeleteTenant = (tenantId: string, tenantName: string) => {
    if ((user?.tenants?.length || 0) <= 1) {
      showWarning(t('warning_title'), t('at_least_one_tenant'));
      return;
    }
    showWarning(t('delete_tenant_title'), `"${tenantName}" ${t('delete_tenant_msg')}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          const result = await removeTenant(tenantId);
          if (result.success) {
            showSuccess(t('success_title'), t('tenant_deleted_success'));
          } else {
            showError(t('error_title'), result.error || t('delete_failed'));
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
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('tenant_section_title')}</Text>
        
        <View style={[styles.tenantInfoBanner, { backgroundColor: colors.info + '15', borderColor: colors.info + '40' }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.info} />
          <Text style={[styles.tenantInfoText, { color: colors.info }]}>
            {t('tenant_info_banner')}
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
          <Text style={[styles.addTenantText, { color: colors.primary }]}>{t('add_new_tenant')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings')}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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
                <Ionicons name="contrast-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('theme_mode') || 'Tema'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', padding: 10, gap: 8 }}>
              {(['system', 'light', 'dark'] as const).map((m) => {
                const active = themeMode === m;
                const label = m === 'system' ? (t('theme_system') || 'Sistem')
                  : m === 'light' ? (t('theme_light') || 'Açık')
                  : (t('theme_dark') || 'Koyu');
                const icon: any = m === 'system' ? 'phone-portrait-outline' : m === 'light' ? 'sunny-outline' : 'moon-outline';
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setThemeMode(m)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      paddingHorizontal: 8,
                      borderRadius: 10,
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Ionicons name={icon} size={16} color={active ? '#FFFFFF' : colors.text} />
                    <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
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
                        <Text style={[styles.menuItemLabel, { color: colors.text, fontSize: 13 }]}>{t('high_sales_threshold')}</Text>
                        <Text style={[styles.menuItemSub, { color: colors.textSecondary, fontSize: 10 }]}>{t('high_sales_threshold_desc')}</Text>
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

                <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="remove-circle-outline" size={22} color={colors.warning || '#F97316'} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('line_cancellation_alert')}</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>{t('line_cancellation_alert_desc')}</Text>
                    </View>
                  </View>
                  <Switch
                    value={lineCancellationAlert}
                    onValueChange={async (v) => {
                      setLineCancellationAlert(v);
                      await AsyncStorage.setItem('lineCancellationAlert', v.toString());
                      await syncSettingsToBackend({ notify_line_cancellations: v });
                    }}
                    trackColor={{ false: colors.border, true: colors.warning || '#F97316' }}
                    thumbColor="#FFF"
                  />
                </View>

                <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 8 }]}>
                  <View style={styles.menuItemLeft}>
                    <Ionicons name="timer-outline" size={22} color={colors.primary} />
                    <View>
                      <Text style={[styles.menuItemLabel, { color: colors.text, fontSize: 13 }]}>{t('check_interval_minutes')}</Text>
                      <Text style={[styles.menuItemSub, { color: colors.textSecondary, fontSize: 10 }]}>{t('check_interval_minutes_desc')}</Text>
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
                  showSuccess(t('sync_success_title'), t('sync_success_msg'));
                } catch (e) {
                  showError(t('error_title'), t('sync_error'));
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
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('account_and_security') || 'HESAP VE GÜVENLİK'}</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/change-password')}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons name="key-outline" size={22} color={colors.primary} />
                <Text style={[styles.menuItemLabel, { color: colors.text }]}>{t('change_password')}</Text>
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
      </ScrollView>
      </KeyboardAvoidingView>

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
      <Modal visible={showTenantModal} animationType="slide" transparent onRequestClose={() => setShowTenantModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={() => setShowTenantModal(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      {tenantModalMode === 'add' ? t('new_tenant') : t('edit_tenant')}
                    </Text>
                    <TouchableOpacity onPress={() => setShowTenantModal(false)}>
                      <Ionicons name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView
                    style={{ maxHeight: '100%' }}
                    contentContainerStyle={styles.modalBody}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
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
                            returnKeyType="next"
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

                    <Text style={[styles.inputLabel, { color: colors.text }]}>{t('tenant_name_field')}</Text>
                    <View style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
                      <TextInput
                        style={[styles.modalInputField, { color: colors.text }]}
                        placeholder="Örn: Merkez Şube, Kadıköy Mağaza"
                        placeholderTextColor={colors.textSecondary}
                        value={tenantNameInput}
                        onChangeText={setTenantNameInput}
                        returnKeyType="done"
                        onSubmitEditing={handleSaveTenant}
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
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Scan Result Modal */}
      <Modal visible={scanModalVisible} animationType="slide" transparent onRequestClose={() => setScanModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>🔍 Tarama Sonucu</Text>
              <TouchableOpacity onPress={() => setScanModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: 16 }}>
              {scanResult && (
                <>
                  {/* Top summary */}
                  <View style={{
                    backgroundColor: colors.background, padding: 12, borderRadius: 10, marginBottom: 12,
                    borderWidth: 1, borderColor: colors.border,
                  }}>
                    <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>
                      Özet
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      • Aktif cihaz: {scanResult.active_tokens ?? 0}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      • Gönderilen bildirim: {scanResult.push_sent_total ?? 0}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      • Dedup sıfırlandı mı: {scanResult.reset_dedup ? 'Evet' : 'Hayır'}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      • Fiş İptali Uyarısı: {scanResult.settings?.notify_cancellations ? 'Açık' : 'Kapalı'}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      • Satır İptali Uyarısı: {scanResult.settings?.notify_line_cancellations ? 'Açık' : 'Kapalı'}
                    </Text>
                  </View>

                  {/* Per-tenant details */}
                  {(scanResult.tenants || []).map((tr: any, idx: number) => (
                    <View key={`${tr.tenant_id}-${idx}`} style={{
                      backgroundColor: colors.background, padding: 12, borderRadius: 10, marginBottom: 12,
                      borderWidth: 1, borderColor: colors.border,
                    }}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15, marginBottom: 4 }}>
                        🏪 {tr.tenant_name}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, marginBottom: 6 }}>
                        {tr.date_range?.from} → {tr.date_range?.to} · {tr.total_rows} satır · {tr.unique_belge_count} fiş
                      </Text>

                      {tr.pos_error && (
                        <View style={{ backgroundColor: '#fee', padding: 8, borderRadius: 6, marginBottom: 6 }}>
                          <Text style={{ color: '#900', fontSize: 12 }}>❌ POS Hata: {tr.pos_error}</Text>
                        </View>
                      )}

                      {tr.total_rows === 0 && !tr.pos_error && (
                        <Text style={{ color: colors.warning, fontSize: 12 }}>
                          ⚠️ Son 2 günde hiç fiş bulunamadı. POS senkronu kontrol edilmeli.
                        </Text>
                      )}

                      {/* Cancelled belges */}
                      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 8, marginBottom: 4 }}>
                        🚫 İptal Fişleri ({tr.cancelled_belges?.length || 0})
                      </Text>
                      {(tr.cancelled_belges || []).length === 0 ? (
                        <Text style={{ color: colors.textSecondary, fontSize: 12, fontStyle: 'italic' }}>
                          Tarihte iptal edilmiş fiş yok.
                        </Text>
                      ) : (
                        (tr.cancelled_belges || []).map((c: any, i: number) => (
                          <View key={i} style={{
                            paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                          }}>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                              {c.belgeno} · {c.fis_turu || 'Fiş'}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                              Durum: {c.fis_durumu || '-'} · IPTAL={String(c.iptal_flag ?? '-')}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                              Tutar: ₺{Number(c.total).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                            </Text>
                            <Text style={{
                              color: c.push_sent ? colors.success : colors.warning,
                              fontSize: 11, fontWeight: '700',
                            }}>
                              {c.push_sent ? '✅ Bildirim gönderildi' : `⚠️ ${c.result}`}
                            </Text>
                          </View>
                        ))
                      )}

                      {/* Line cancellations */}
                      {(tr.line_cancellations || []).length > 0 && (
                        <>
                          <Text style={{ color: colors.text, fontWeight: '700', marginTop: 8, marginBottom: 4 }}>
                            ❌ Satır İptalleri ({tr.line_cancellations.length})
                          </Text>
                          {tr.line_cancellations.slice(0, 10).map((c: any, i: number) => (
                            <View key={i} style={{
                              paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                            }}>
                              <Text style={{ color: colors.text, fontSize: 12 }}>
                                {c.belgeno} · {c.stok_ad} ({c.miktar})
                              </Text>
                              <Text style={{
                                color: c.push_sent ? colors.success : colors.warning,
                                fontSize: 11, fontWeight: '700',
                              }}>
                                {c.push_sent ? '✅ Gönderildi' : `⚠️ ${c.result}`}
                              </Text>
                            </View>
                          ))}
                        </>
                      )}

                      {/* High sales */}
                      {(tr.high_sales || []).length > 0 && (
                        <>
                          <Text style={{ color: colors.text, fontWeight: '700', marginTop: 8, marginBottom: 4 }}>
                            💰 Yüksek Satışlar ({tr.high_sales.length})
                          </Text>
                          {tr.high_sales.slice(0, 10).map((c: any, i: number) => (
                            <Text key={i} style={{ color: colors.textSecondary, fontSize: 12 }}>
                              {c.belgeno}: ₺{Number(c.total).toLocaleString('tr-TR')} — {c.push_sent ? '✅' : `⚠️ ${c.result}`}
                            </Text>
                          ))}
                        </>
                      )}

                      {/* First row sample — helpful if nothing matched */}
                      {tr.total_rows > 0 && (tr.cancelled_belges || []).length === 0 && (
                        <View style={{ marginTop: 10, padding: 8, backgroundColor: colors.surface, borderRadius: 6 }}>
                          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>
                            Örnek satır (ilk fiş):
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                            FIS_TURU: {String(tr.sample_row?.FIS_TURU || '-')}{'\n'}
                            FIS_DURUMU: {String(tr.sample_row?.FIS_DURUMU || '-')}{'\n'}
                            IPTAL: {String(tr.sample_row?.IPTAL ?? '-')}{'\n'}
                            BELGENO: {String(tr.sample_row?.BELGENO || '-')}
                          </Text>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, padding: 12, borderRadius: 10, alignItems: 'center' }}
                onPress={() => setScanModalVisible(false)}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
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
