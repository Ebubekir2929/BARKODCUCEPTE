import { Platform } from 'react-native';
import { CancelledReceipt } from '../types';

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

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: 'your-project-id',
      });
      
      this.expoPushToken = tokenData.data;
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

      return this.expoPushToken;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
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
