/**
 * Notification tap handler — cross-platform (iOS + Android), defensive multi-
 * layer pickup so a tapped notification ALWAYS lands on the right modal even
 * if any single delivery channel fails.
 *
 * 2026-05-06 — Full rewrite. Previous architectures only relied on
 * `addNotificationResponseReceivedListener`, which is fragile:
 *   - Listener may attach AFTER cold-start tap is delivered
 *   - Foreground notification with `setNotificationHandler` not configured
 *     in time fires no response on Android
 *   - iOS `getLastNotificationResponseAsync` is reliable but returns only
 *     once and only on cold-start
 *   - Race conditions when app is force-killed during processing
 *
 * NEW MULTI-LAYER PICKUP:
 *   Layer 1 — `setNotificationHandler` configured at MODULE LOAD time so
 *             foreground delivery is immediately operational.
 *   Layer 2 — `addNotificationResponseReceivedListener` for fg/bg taps.
 *   Layer 3 — `getLastNotificationResponseAsync()` for cold-start taps.
 *   Layer 4 — `AsyncStorage` persistence so a tap survives crashes/restarts:
 *             every tap is written to disk, every screen focus re-reads disk,
 *             explicit `clearPending()` after the modal opens.
 *   Layer 5 — Reactive Zustand store with `seq` counter so DUPLICATE taps
 *             of the SAME notification still trigger the consumer effect.
 *
 * Consumers (dashboard.tsx, stock.tsx):
 *   import { useFocusEffect } from 'expo-router';
 *   useFocusEffect(useCallback(() => { checkPendingFromStorage(); }, []));
 *   const deepLink = useDeepLinkStore((s) => s.pending);
 *   const seq      = useDeepLinkStore((s) => s.seq);
 *   useEffect(() => { if (deepLink) {  open modal  ; clearPending(); } }, [deepLink, seq]);
 */

import { Platform } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeepLinkStore } from '../store/deepLinkStore';

const STORAGE_KEY = '@deepLink/pendingTap';

let Notifications: any = null;
if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
  } catch {
    Notifications = null;
  }
}

// Layer 1 — configure foreground display BEFORE any notification can arrive.
// Done at module-load (top of import graph) so iOS/Android foreground state
// shows the banner and fires the tap listener.
if (Notifications?.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,        // iOS 14+ + Android API 34+
      shouldShowList: true,          // Android API 34+
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

let _attached = false;
let _coldStartHandled = false;
let _subscription: any = null;

/** Persist tap data to disk + push to reactive store */
function _dispatch(data: Record<string, any>): void {
  if (!data) return;
  try {
    console.log('[notifTap] dispatch', JSON.stringify(data));
    // Persist BEFORE store push so a crash mid-route still recovers on next launch.
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    // Decide which tab to navigate to so the consumer screen is mounted.
    const type = String(data.type || '').toLowerCase();
    const isStock = (type === 'low_stock_summary' || type === 'eksi_stok' || type === 'low_stock');
    const targetPath = isStock ? '/(tabs)/stock' : '/(tabs)/dashboard';
    try { router.push(targetPath as any); } catch (e) { console.log('[notifTap] navigate err:', e); }
    // Slight delay so the navigator finishes mounting the tab tree, then push to store.
    setTimeout(() => {
      try { useDeepLinkStore.getState().push(data as any); } catch (e) { console.log('[notifTap] store err:', e); }
    }, 250);
  } catch (e) {
    console.log('[notifTap] dispatch err:', e);
  }
}

/** Attach OS-level listeners. Idempotent — safe to call multiple times. */
export function attachNotificationTapHandler(): void {
  if (Platform.OS === 'web' || !Notifications) return;
  if (_attached) return;
  _attached = true;

  // Layer 2 — fg/bg tap listener
  _subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
    const data = response?.notification?.request?.content?.data || {};
    _dispatch(data);
  });

  // Layer 3 — cold-start tap (app launched FROM the notification)
  if (!_coldStartHandled) {
    _coldStartHandled = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response: any) => {
        if (response) {
          const data = response?.notification?.request?.content?.data || {};
          _dispatch(data);
        }
      })
      .catch((e: any) => console.log('[notifTap] cold-start err:', e));
  }
}

/** Detach (e.g. on logout). Optional; module-level state retained. */
export function detachNotificationTapHandler(): void {
  try {
    _subscription?.remove?.();
  } catch {}
  _subscription = null;
  _attached = false;
}

/**
 * Layer 4 — re-read disk-persisted tap on screen focus. Each consumer screen
 * (dashboard.tsx, stock.tsx) calls this from useFocusEffect so a notification
 * delivered while the screen was unmounted (or before it mounted) can still
 * be recovered when the user lands on it.
 */
export async function checkPendingFromStorage(): Promise<void> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) return;
    const data = JSON.parse(json);
    if (data && typeof data === 'object') {
      // Don't dispatch through router again — just re-push to store so the
      // current screen's effect re-runs.
      useDeepLinkStore.getState().push(data as any);
    }
  } catch (e) {
    console.log('[notifTap] checkPending err:', e);
  }
}

/** Clear the persisted tap. Called by the consumer once it has opened the
 *  matching modal. Without this, the tap would re-fire on every screen focus. */
export async function clearPendingTap(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
  try {
    useDeepLinkStore.getState().clear();
  } catch {}
}

/** Legacy compat — older code paths called this expecting a flush. Now a no-op
 *  because storage-based pickup runs on focus. Kept to avoid import errors. */
export function flushPendingNotificationRoute(): void {
  // intentionally empty — kept for backward compatibility
}
