import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';
import { CancelledReceipt } from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Conditionally import expo-notifications only on native
let Notifications: any = null;
let Device: any = null;

if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
    Device = require('expo-device');
    
    // Configure notification behavior
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (error) {
    console.log('expo-notifications not available');
  }
}

export interface NotificationData {
  type: 'receipt_cancelled' | 'low_stock' | 'new_order' | 'payment_received' | 'general';
  title: string;
  body: string;
  data?: any;
}

class NotificationService {
  private expoPushToken: string | null = null;

  async registerForPushNotifications(): Promise<string | null> {
    if (Platform.OS === 'web' || !Notifications || !Device) {
      console.log('Push notifications not supported on this platform');
      return null;
    }

    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Push notification permission not granted');
        return null;
      }

      // Get projectId from Expo Constants (set via EAS or app.json extra.eas.projectId)
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      let tokenData: any = null;
      try {
        tokenData = projectId
          ? await Notifications.getExpoPushTokenAsync({ projectId })
          : await Notifications.getExpoPushTokenAsync();
      } catch (tokenErr: any) {
        // Re-throw with a clear message so the Settings screen can show the real reason
        const msg = tokenErr?.message || String(tokenErr);
        throw new Error(
          `Expo getExpoPushTokenAsync() hatası:\n${msg}\n\n` +
          `projectId=${projectId || '(boş)'}\n\n` +
          `Bu hata genellikle Firebase/FCM kurulumunun eksik olmasından kaynaklanır.`,
        );
      }

      this.expoPushToken = tokenData?.data || null;
      console.log('Push token:', this.expoPushToken);

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Varsayılan',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#2563EB',
        });

        await Notifications.setNotificationChannelAsync('cancellations', {
          name: 'Fiş İptalleri',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 500, 250, 500],
          lightColor: '#EF4444',
          sound: 'default',
        });
      }

      // Send token to backend so it can push notifications via Expo Push API
      if (this.expoPushToken) {
        // Robust register: retry up to 3 times with backoff (covers transient
        // network/auth issues right after login — fixes "no_active_tokens" bug)
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await this.saveTokenToBackend(this.expoPushToken);
            break;
          } catch (e) {
            console.warn(`Token register attempt ${attempt}/3 failed:`, e);
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
          }
        }
      }

      return this.expoPushToken;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
    }
  }

  async saveTokenToBackend(token: string): Promise<boolean> {
    const { token: authToken } = useAuthStore.getState();
    if (!authToken) {
      throw new Error('Oturum yok — önce giriş yapın.');
    }
    const resp = await fetch(`${API_URL}/api/notifications/register-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        device_id: (Device?.osInternalBuildId || Device?.deviceName || 'unknown').toString().slice(0, 100),
      }),
    });
    const data = await resp.json().catch(() => ({} as any));
    console.log('Backend token-register response:', resp.status, data);
    if (!resp.ok || !data?.ok) {
      throw new Error(
        `Backend token kaydı başarısız (HTTP ${resp.status}): ${data?.detail || JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return true;
  }

  async unregisterFromBackend(): Promise<boolean> {
    try {
      const { token: authToken } = useAuthStore.getState();
      if (!authToken) return false;
      const resp = await fetch(`${API_URL}/api/notifications/unregister-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ token: this.expoPushToken || '' }),
      });
      return resp.ok;
    } catch (error) {
      console.error('unregisterFromBackend error:', error);
      return false;
    }
  }

  async sendTestPushNotification(title = 'Barkodcu Cepte', body = 'Test bildirimi'): Promise<boolean> {
    try {
      const { token: authToken } = useAuthStore.getState();
      if (!authToken) return false;
      const resp = await fetch(`${API_URL}/api/notifications/send-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ title, body }),
      });
      const data = await resp.json();
      console.log('send-test response:', data);
      return resp.ok && !!data?.ok;
    } catch (error) {
      console.error('sendTestPushNotification error:', error);
      return false;
    }
  }

  async sendLocalNotification(notification: NotificationData): Promise<void> {
    if (Platform.OS === 'web' || !Notifications) {
      console.log('Local notification (web):', notification.title, notification.body);
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notification.title,
          body: notification.body,
          data: { ...notification.data, type: notification.type },
          sound: true,
        },
        trigger: null,
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  }

  async sendReceiptCancelledNotification(receipt: CancelledReceipt, branchName: string): Promise<void> {
    const notification: NotificationData = {
      type: 'receipt_cancelled',
      title: '🚫 Fiş İptali',
      body: `${branchName}: ${receipt.receiptNo} numaralı fiş iptal edildi. Tutar: ₺${receipt.amount.toFixed(2)}`,
      data: {
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        amount: receipt.amount,
        branchName,
        reason: receipt.reason,
      },
    };

    await this.sendLocalNotification(notification);
  }

  async sendLowStockNotification(productName: string, quantity: number, branchName: string): Promise<void> {
    const notification: NotificationData = {
      type: 'low_stock',
      title: '⚠️ Düşük Stok Uyarısı',
      body: `${branchName}: ${productName} stoğu kritik seviyede (${quantity} adet)`,
      data: { productName, quantity, branchName },
    };

    await this.sendLocalNotification(notification);
  }

  async sendGeneralNotification(title: string, body: string, data?: any): Promise<void> {
    const notification: NotificationData = {
      type: 'general',
      title,
      body,
      data,
    };

    await this.sendLocalNotification(notification);
  }

  getExpoPushToken(): string | null {
    return this.expoPushToken;
  }
}

export const notificationService = new NotificationService();
export default notificationService;
