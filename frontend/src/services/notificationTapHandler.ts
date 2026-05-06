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
 *
 * 2026-05-06 — `_pendingData` queue protects cold-start taps that fire BEFORE
 *   the auth gate finishes. Once the app finally lands on the (tabs) tree,
 *   the auth layout calls flushPendingNotificationRoute() and the queued tap
 *   is replayed.
 */
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useDeepLinkStore } from '../store/deepLinkStore';

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
let _pendingData: Record<string, any> | null = null;
let _authReady = false;

function _route(data: Record<string, any> | null | undefined, fromQueue = false) {
  if (!data) return;
  // 2026-05-06 — If auth not ready, queue the tap. The (tabs) layout calls
  // flushPendingNotificationRoute() once the user lands on a tabs route.
  if (!_authReady && !fromQueue) {
    _pendingData = data;
    console.log('[notifTap] queued (auth not ready):', data?.type);
    return;
  }
  try {
    const type = String(data.type || data?.notification?.type || '').toLowerCase();
    if (!type) return;
    console.log('[notifTap] dispatching type=', type);

    // Decide which tab to navigate to.
    const isStock = (type === 'low_stock_summary' || type === 'eksi_stok' || type === 'low_stock');
    const targetPath = isStock ? '/(tabs)/stock' : '/(tabs)/dashboard';

    // 2026-05-06 — Navigate first (so the screen mounts), THEN push to store.
    // Android router.push to the SAME screen does NOT update useLocalSearchParams,
    // so screens subscribe to deepLinkStore instead. Store dispatch happens
    // after a short delay to give the screen time to mount its subscription.
    try { router.push(targetPath as any); } catch (e) { console.log('[notifTap] navigate err:', e); }
    setTimeout(() => {
      try {
        useDeepLinkStore.getState().push(data as any);
        console.log('[notifTap] store.push OK type=', type);
      } catch (e) {
        console.log('[notifTap] store.push err:', e);
      }
    }, 200);
  } catch (e) {
    console.log('[notifTap] route error:', e);
  }
}

/** Called from the (tabs) layout once the auth gate has resolved and the
 * router is mounted on a tabs route. Flushes any queued notification tap. */
export function flushPendingNotificationRoute() {
  _authReady = true;
  if (_pendingData) {
    const d = _pendingData;
    _pendingData = null;
    console.log('[notifTap] flushing queued tap:', d?.type);
    // small delay so the navigator finishes mounting the tab tree
    setTimeout(() => _route(d, true), 350);
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
