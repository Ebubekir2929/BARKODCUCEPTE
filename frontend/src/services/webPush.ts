/**
 * 2026-02 — FCM Web Push entegrasyonu (sadece web).
 *
 * Bu modül Platform.OS === 'web' iken devreye girer ve:
 *   • Firebase Web SDK'yı initialize eder
 *   • Browser'dan Notification permission ister
 *   • FCM token'ı alır ve backend'e platform="web" ile kaydeder
 *   • Foreground (sayfa açıkken) gelen mesajları Notification API ile gösterir
 *
 * Service worker (background bildirimler) /firebase-messaging-sw.js dosyasında.
 * Bu dosya Expo build'inde public/firebase-messaging-sw.js olarak yer alır;
 * `npx expo export -p web` sonrası dist/ köküne kopyalanır.
 */

import { Platform } from 'react-native';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDt--i6zMdjz0iWfH61JOakL9vP5doIUWU',
  authDomain: 'barkodcu-cepte.firebaseapp.com',
  projectId: 'barkodcu-cepte',
  storageBucket: 'barkodcu-cepte.firebasestorage.app',
  messagingSenderId: '593493499759',
  appId: '1:593493499759:web:9892618eb1814499b4129a',
};

// Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
const VAPID_KEY =
  'BBQHbZuHYwqbeKF4Ae7pcNeOWjbgGApeVa7O1kzriqtTTcsstysDDcrmUjgjsQwc4PBppASZfEcBjncFsKV0sLQ';

/**
 * Web push'u tüm gerekli adımlarla başlatır:
 *   1) Service worker'ı kaydet
 *   2) Notification permission iste
 *   3) FCM token al
 *   4) Backend'e POST /api/notifications/register-token (platform='web')
 *   5) Foreground onMessage handler kur
 *
 * @param backendUrl Tam backend URL (örn. https://api.example.com)
 * @param authToken JWT bearer token
 * @returns FCM web token | null (kullanıcı izin vermezse veya tarayıcı desteklemezse)
 */
export async function initWebPush(
  backendUrl: string,
  authToken: string,
): Promise<string | null> {
  if (Platform.OS !== 'web') return null;

  // Browser API kontrolü
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    console.warn('[WebPush] Tarayıcı Notification veya Service Worker desteklemiyor');
    return null;
  }

  try {
    // 1) Service worker'ı kaydet
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    console.log('[WebPush] Service worker kaydedildi:', swReg.scope);

    // 2) Permission iste (eğer zaten verilmediyse)
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      console.warn('[WebPush] Kullanıcı bildirim iznini reddetti:', permission);
      return null;
    }

    // 3) Firebase init + token al
    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken, onMessage, isSupported } = await import('firebase/messaging');

    const supported = await isSupported();
    if (!supported) {
      console.warn('[WebPush] FCM bu tarayıcıda desteklenmiyor');
      return null;
    }

    const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) {
      console.warn('[WebPush] FCM token alınamadı (kullanıcı izin verdi ama token null)');
      return null;
    }
    console.log('[WebPush] FCM token alındı:', token.slice(0, 30) + '...');

    // 4) Backend'e kaydet
    try {
      const url = `${backendUrl.replace(/\/$/, '')}/api/notifications/register-token`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          token,
          platform: 'web',
          device_id: navigator.userAgent.slice(0, 100),
        }),
      });
      if (!resp.ok) {
        console.error('[WebPush] Backend register-token başarısız:', resp.status, await resp.text());
      } else {
        console.log('[WebPush] Token backend\'e kaydedildi ✅');
      }
    } catch (err) {
      console.error('[WebPush] Backend register hatası:', err);
    }

    // 5) Foreground mesaj handler — sayfa açıkken mesaj gelirse Notification göster
    onMessage(messaging, (payload) => {
      console.log('[WebPush] Foreground mesaj alındı:', payload);
      const title = payload.notification?.title || 'Barkodcu Cepte';
      const body = payload.notification?.body || '';
      const data = payload.data || {};

      try {
        const n = new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: (data.event_key as string) || 'default',
          data,
        });
        n.onclick = () => {
          window.focus();
          // Deep link: tıklandığında ilgili ekranı aç
          if (data.type === 'high_sale' || data.type === 'iptal') {
            window.location.hash = '#dashboard';
          } else if (data.type === 'low_stock') {
            window.location.hash = '#stock';
          }
          n.close();
        };
      } catch (e) {
        console.warn('[WebPush] Foreground notification gösterilemedi:', e);
      }
    });

    return token;
  } catch (err) {
    console.error('[WebPush] init başarısız:', err);
    return null;
  }
}

/**
 * Token yenileme — kullanıcı oturumu açıkken çağrılır.
 * Browser yenileme / token rotation durumlarında yeni token'ı backend'e gönderir.
 */
export async function refreshWebPushToken(backendUrl: string, authToken: string): Promise<void> {
  await initWebPush(backendUrl, authToken);
}
