/**
 * Notification tap handler — converts a tapped notification's `data` payload
 * into an in-app deep link.
 *
 * Each push from the backend watcher carries `data.type`:
 *   - "high_sale"           → /(tabs)/dashboard?openHighSale=<belgeno>
 *   - "iptal" | "iptal_satir" → /(tabs)/dashboard?openIptal=<iptal_id>
 *   - "low_stock_summary"   → /(tabs)/stock?onlyNegative=1
 *
 * The route receivers parse the query params and open the matching modal /
 * filter so the user lands on the relevant detail with one tap.
 */
import { Platform } from 'react-native';
import { router } from 'expo-router';

let Notifications: any = null;
if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
  } catch {
    Notifications = null;
  }
}

let _subscription: any = null;
let _coldStartHandled = false;

function _route(data: Record<string, any> | null | undefined) {
  if (!data) return;
  try {
    const type = String(data.type || data?.notification?.type || '').toLowerCase();
    if (!type) return;

    if (type === 'high_sale' || type === 'yuksek_satis') {
      const belgeno = String(data.belgeno || '');
      const fisId = String(data.fis_id || '');
      router.push({
        pathname: '/(tabs)/dashboard',
        params: {
          openHighSale: belgeno || fisId,
          openHighSaleFisId: fisId,           // 2026-05-05 — separate FIS_ID for /fis-detail lookup
          openHighSaleBelgeno: belgeno,       // 2026-05-05 — separate belge no for display
          openHighSaleAmount: String(data.amount || ''),
          openHighSaleTenant: String(data.tenant || ''),
        },
      });
      return;
    }

    if (type === 'iptal' || type === 'iptal_satir' || type === 'cancel' || type === 'cancellation') {
      router.push({
        pathname: '/(tabs)/dashboard',
        params: {
          openIptal: String(data.iptal_id || data.id || ''),
          openIptalTenant: String(data.tenant || ''),
        },
      });
      return;
    }

    if (type === 'low_stock_summary' || type === 'eksi_stok' || type === 'low_stock') {
      router.push({
        pathname: '/(tabs)/stock',
        params: {
          onlyNegative: '1',
          openLowStockSummary: '1',
          tenant: String(data.tenant || ''),
        },
      });
      return;
    }

    // Unknown type — at least bring the user to the dashboard
    router.push('/(tabs)/dashboard');
  } catch (e) {
    console.log('[notifTap] route error:', e);
  }
}

/** Set up the notification-tap listener. Idempotent — safe to call repeatedly. */
export function attachNotificationTapHandler() {
  if (Platform.OS === 'web' || !Notifications) return;

  // Cold-start: app launched by tapping a notification while killed.
  if (!_coldStartHandled) {
    _coldStartHandled = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response: any) => {
        if (!response) return;
        // Slight delay so the navigation tree is mounted before we push.
        setTimeout(() => _route(response?.notification?.request?.content?.data), 600);
      })
      .catch(() => {});
  }

  // Warm: app already running when user taps a notification.
  if (_subscription) return;
  _subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
    _route(response?.notification?.request?.content?.data);
  });
}

export function detachNotificationTapHandler() {
  try {
    _subscription?.remove?.();
  } catch {}
  _subscription = null;
}
