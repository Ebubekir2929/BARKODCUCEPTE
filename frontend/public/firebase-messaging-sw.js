/* eslint-disable no-undef */
/**
 * 2026-02 — FCM Web Push Service Worker
 * Sayfa kapalıyken / arka planda gelen bildirimleri yakalar.
 *
 * Bu dosya `public/firebase-messaging-sw.js` altında bulunur ve Expo build
 * sırasında dist/firebase-messaging-sw.js olarak köke kopyalanır.
 * Service worker'ın YALNIZCA root scope'tan (/) servis edilmesi gerekiyor —
 * /static/... gibi alt yollardan yüklenirse FCM çalışmaz.
 */

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDt--i6zMdjz0iWfH61JOakL9vP5doIUWU',
  authDomain: 'barkodcu-cepte.firebaseapp.com',
  projectId: 'barkodcu-cepte',
  storageBucket: 'barkodcu-cepte.firebasestorage.app',
  messagingSenderId: '593493499759',
  appId: '1:593493499759:web:9892618eb1814499b4129a',
});

const messaging = firebase.messaging();

// Background message handler — sayfa kapalı / sekme arka planda iken çalışır
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw] Background mesaj alındı:', payload);
  const title = payload.notification?.title || 'Barkodcu Cepte';
  const body = payload.notification?.body || '';
  const data = payload.data || {};

  self.registration.showNotification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.event_key || 'default',
    data,
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Aç' },
      { action: 'close', title: 'Kapat' },
    ],
  });
});

// Notification tıklama → uygun ekranı aç (deep link with modal params)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  const data = event.notification.data || {};
  // 2026-02 — Build query params so app opens the right modal:
  //   high_sale push  → /?openHighSale=<belgeno>&openHighSaleFisId=<fisId>&openHighSaleAmount=<amount>&openHighSaleTenant=<tenant>
  //   iptal push      → /?openIptal=<id>&openIptalTenant=<tenant>
  const params = new URLSearchParams();
  let path = '/';
  if (data.type === 'high_sale') {
    if (data.belgeno) params.set('openHighSale', data.belgeno);
    if (data.fis_id) params.set('openHighSaleFisId', data.fis_id);
    if (data.belgeno) params.set('openHighSaleBelgeno', data.belgeno);
    if (data.amount) params.set('openHighSaleAmount', data.amount);
    if (data.tenant_id) params.set('openHighSaleTenant', data.tenant_id);
  } else if (data.type === 'iptal' || data.type === 'cancellation') {
    if (data.iptal_id) params.set('openIptal', data.iptal_id);
    if (data.tenant_id) params.set('openIptalTenant', data.tenant_id);
  } else if (data.type === 'low_stock') {
    path = '/stock';
  }
  const qs = params.toString();
  const target = path + (qs ? '?' + qs : '');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Eğer pencere zaten açıksa ona focus ver + navigate et
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', data, target });
          if ('navigate' in client) {
            client.navigate(target).catch(() => {});
          }
          return client.focus();
        }
      }
      // Yoksa yeni pencere aç
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    }),
  );
});
