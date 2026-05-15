/**
 * notificationTapHandler — SADE versiyon (2026-05-06 sıfırdan yazıldı)
 *
 * Akış:
 *  1) Bildirim gelir.
 *  2) Kullanıcı banner'a tıklar.
 *  3) Expo Notifications "responseListener" tetiklenir.
 *  4) Payload'u (iptal_id / fis_id / tenant / type) AsyncStorage'a yazarız.
 *  5) Dashboard mount olduğunda / focus aldığında AsyncStorage'ı okur, modal açar
 *     ve pending tap'ı siler.
 *
 * Hiçbir Zustand store kullanmıyoruz — sadece AsyncStorage. Bu şekilde:
 *  - Cold start ✅ (app açılırken store hidrate olmadan da AsyncStorage hazır)
 *  - Background tap ✅ (focus effect AsyncStorage'ı yeniden okur)
 *  - Foreground tap ✅ (aynı yol)
 *  - Crash riski yok (state güncellemesi yok, sadece disk I/O)
 */
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

const STORAGE_KEY = '@notification_pending_tap_v2';
/** Event fired immediately after a tap is persisted. Dashboard/Stock subscribe
 *  to it so they can process the tap even while already focused (foreground
 *  scenario — useFocusEffect would not re-fire in that case). */
export const NOTIFICATION_TAP_EVENT = 'notification_tap_received_v2';

export interface PendingTap {
  type?: string;       // 'iptal' | 'high_sale' | ...
  iptal_id?: string;
  fis_id?: string;
  belgeno?: string;
  amount?: string;
  tenant?: string;
  receivedAt?: number;
}

let _attached = false;
let _subscriptions: Array<{ remove?: () => void }> = [];

/**
 * Bildirim tap'ını AsyncStorage'a yazar. Aynı tap iki kere işlenmesin diye
 * receivedAt timestamp'i ile beraber saklanır.
 *
 * 2026-05-15 — Export edildi ki RootLayout'taki NotificationResponseBridge
 * (useLastNotificationResponse hook) doğrudan çağırabilsin.
 */
export async function writePendingTap(payload: any) {
  try {
    // 2026-05-15 — iOS APNs payloads sometimes deliver the full userInfo
    // (including the `aps` key). Strip it so we only persist our custom data.
    let p: any = payload;
    if (p && typeof p === 'object' && p.aps && typeof p.aps === 'object') {
      const { aps, ...rest } = p;
      p = rest;
    }
    if (!p || typeof p !== 'object') {
      console.log('[NotifTap] empty payload, skip');
      return;
    }
    const tap: PendingTap = {
      type: String(p.type || '').toLowerCase(),
      iptal_id: p.iptal_id != null ? String(p.iptal_id) : undefined,
      fis_id: p.fis_id != null ? String(p.fis_id) : undefined,
      belgeno: p.belgeno != null ? String(p.belgeno) : undefined,
      amount: p.amount != null ? String(p.amount) : undefined,
      tenant: p.tenant != null ? String(p.tenant) : undefined,
      receivedAt: Date.now(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tap));
    console.log('[NotifTap] ✅ wrote pending:', tap, 'rawPayload=', JSON.stringify(payload));
    // Emit in-app event so screens already focused can immediately react
    // (foreground tap scenario — useFocusEffect wouldn't fire again).
    try { DeviceEventEmitter.emit(NOTIFICATION_TAP_EVENT, tap); } catch {}
  } catch (e) {
    console.log('[NotifTap] write failed:', e);
  }
}

/**
 * Dashboard'dan çağrılır. Pending tap varsa döner, yoksa null.
 * Çağrandan SONRA `clearPendingTap()` çağrılarak silinmeli.
 */
export async function readPendingTap(): Promise<PendingTap | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const tap = JSON.parse(raw) as PendingTap;
    return tap;
  } catch (e) {
    console.log('[NotifTap] read failed:', e);
    return null;
  }
}

export async function clearPendingTap(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/**
 * Uygulamanın en başında (RootLayout) bir kez çağrılır. İdempotent.
 * Dinleyicileri kurar:
 *  - addNotificationResponseReceivedListener: warm tap (foreground/background)
 *  - getLastNotificationResponseAsync:        cold start tap
 */
export function attachNotificationTapHandler(): void {
  if (_attached) return;
  _attached = true;

  // 1) Cold start: app henüz mount olmadan tıklanmış olabilir
  Notifications.getLastNotificationResponseAsync()
    .then((resp) => {
      if (resp) {
        const data = resp.notification?.request?.content?.data;
        if (data) {
          writePendingTap(data);
        }
      }
    })
    .catch(() => {});

  // 2) Warm tap: app çalışırken (foreground/background) kullanıcı banner'a tıklarsa
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    try {
      const data = resp?.notification?.request?.content?.data;
      if (data) writePendingTap(data);
    } catch (e) {
      console.log('[NotifTap] response handler failed:', e);
    }
  });
  _subscriptions.push(sub);
}

export function detachNotificationTapHandler(): void {
  _subscriptions.forEach((s) => { try { s.remove?.(); } catch {} });
  _subscriptions = [];
  _attached = false;
}

// Geriye dönük uyumluluk: eski kod `checkPendingFromStorage` çağırıyor olabilir.
export async function checkPendingFromStorage(): Promise<void> {
  // No-op — yeni akışta dashboard zaten readPendingTap ile okur.
}
