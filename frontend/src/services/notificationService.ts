import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { CancelledReceipt } from '../types';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationData {
  type: 'receipt_cancelled' | 'low_stock' | 'new_order' | 'payment_received' | 'general';
  title: string;
  body: string;
  data?: any;
}

class NotificationService {
  private expoPushToken: string | null = null;

  // Register for push notifications
  async registerForPushNotifications(): Promise<string | null> {
    if (Platform.OS === 'web') {
      console.log('Push notifications not supported on web');
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
        projectId: 'your-project-id', // Replace with actual project ID
      });
      
      this.expoPushToken = tokenData.data;
      console.log('Push token:', this.expoPushToken);

      // Android specific channel
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

        await Notifications.setNotificationChannelAsync('alerts', {
          name: 'Uyarılar',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#F59E0B',
        });
      }

      return this.expoPushToken;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
    }
  }

  // Send local notification
  async sendLocalNotification(notification: NotificationData): Promise<void> {
    if (Platform.OS === 'web') {
      console.log('Local notification:', notification);
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notification.title,
          body: notification.body,
          data: { ...notification.data, type: notification.type },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: null, // Immediate
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  }

  // Send receipt cancellation notification
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

  // Send low stock notification
  async sendLowStockNotification(productName: string, quantity: number, branchName: string): Promise<void> {
    const notification: NotificationData = {
      type: 'low_stock',
      title: '⚠️ Düşük Stok Uyarısı',
      body: `${branchName}: ${productName} stoğu kritik seviyede (${quantity} adet)`,
      data: {
        productName,
        quantity,
        branchName,
      },
    };

    await this.sendLocalNotification(notification);
  }

  // Send new order notification
  async sendNewOrderNotification(orderId: string, amount: number, customerName: string): Promise<void> {
    const notification: NotificationData = {
      type: 'new_order',
      title: '🛒 Yeni Sipariş',
      body: `${customerName} tarafından ₺${amount.toFixed(2)} tutarında yeni sipariş`,
      data: {
        orderId,
        amount,
        customerName,
      },
    };

    await this.sendLocalNotification(notification);
  }

  // Send payment received notification
  async sendPaymentReceivedNotification(customerName: string, amount: number): Promise<void> {
    const notification: NotificationData = {
      type: 'payment_received',
      title: '💰 Ödeme Alındı',
      body: `${customerName} tarafından ₺${amount.toFixed(2)} ödeme alındı`,
      data: {
        customerName,
        amount,
      },
    };

    await this.sendLocalNotification(notification);
  }

  // Send general notification
  async sendGeneralNotification(title: string, body: string, data?: any): Promise<void> {
    const notification: NotificationData = {
      type: 'general',
      title,
      body,
      data,
    };

    await this.sendLocalNotification(notification);
  }

  // Add notification listener
  addNotificationListener(callback: (notification: Notifications.Notification) => void) {
    return Notifications.addNotificationReceivedListener(callback);
  }

  // Add notification response listener (when user taps notification)
  addNotificationResponseListener(callback: (response: Notifications.NotificationResponse) => void) {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }

  // Get expo push token
  getExpoPushToken(): string | null {
    return this.expoPushToken;
  }

  // Cancel all notifications
  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  // Get badge count
  async getBadgeCount(): Promise<number> {
    return await Notifications.getBadgeCountAsync();
  }

  // Set badge count
  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count);
  }
}

export const notificationService = new NotificationService();
export default notificationService;
