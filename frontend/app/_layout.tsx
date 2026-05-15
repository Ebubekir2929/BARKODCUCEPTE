import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from '../src/store/themeStore';
import { usePrefsStore } from '../src/store/prefsStore';
import { useAuthStore } from '../src/store/authStore';
import { useLanguageStore } from '../src/store/languageStore';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import notificationService from '../src/services/notificationService';
import { attachNotificationTapHandler } from '../src/services/notificationTapHandler';

// 2026-05-15 — iOS-spesifik notification-response yardımcısı. Expo'nun resmi
// useLastNotificationResponse hook'u cold start race condition'larını çözer.
// Web'de bu hook native bir API çağırıp çöküyor — Platform check ile native'e sınırla.
function NotificationResponseBridge() {
  if (Platform.OS === 'web') return null;
  return <NotificationResponseBridgeNative />;
}

function NotificationResponseBridgeNative() {
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    try {
      const data: any = (lastResponse as any)?.notification?.request?.content?.data;
      const rawUserInfo: any = (lastResponse as any)?.notification?.request?.trigger?.payload
        || (lastResponse as any)?.notification?.request?.content?.userInfo
        || data;
      // Stream the FULL payload into AsyncStorage so the dashboard tap handler
      // sees it regardless of how iOS structured the response.
      const payload = data && Object.keys(data).length > 0 ? data : rawUserInfo;
      if (!payload || typeof payload !== 'object') return;
      // Lazy-import to avoid circular deps
      import('../src/services/notificationTapHandler').then((mod: any) => {
        try {
          (mod as any).writePendingTap?.(payload);
        } catch {}
      });
    } catch {}
  }, [lastResponse]);
  return null;
}

function AppShell() {
  const { colors } = useThemeStore();

  // 2026-05-05 — Web keyboard shortcuts: `/` focuses the nearest search input,
  // `Esc` closes any open native dialog (browser already maps `Esc` to Modal's
  // onRequestClose, but we also blur the focused element so dropdowns close).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: any) => {
      // Slash → focus first visible search input on the page
      if (e.key === '/' && !(['INPUT', 'TEXTAREA'].includes(e.target?.tagName || ''))) {
        try {
          const el: any = (globalThis as any).document.querySelector(
            'input[placeholder*="ara" i], input[placeholder*="search" i], input[type="search"]'
          );
          if (el && typeof el.focus === 'function') {
            e.preventDefault();
            el.focus();
            try { el.select?.(); } catch {}
          }
        } catch {}
      }
      // Esc → blur active element (helps close picker dropdowns)
      if (e.key === 'Escape') {
        try {
          const a: any = (globalThis as any).document?.activeElement;
          if (a && typeof a.blur === 'function') a.blur();
        } catch {}
      }
    };
    try {
      (globalThis as any).window?.addEventListener?.('keydown', handler);
      return () => (globalThis as any).window?.removeEventListener?.('keydown', handler);
    } catch { return undefined; }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const { colors, isDark, loadTheme } = useThemeStore();
  const { isLoading, checkAuth, isAuthenticated, token } = useAuthStore();
  const { isReady: langReady, loadLanguage } = useLanguageStore();
  const hydratePrefs = usePrefsStore((s) => s.hydrate);

  useEffect(() => {
    loadTheme();
    loadLanguage();
    checkAuth();
    hydratePrefs();
    // Notification tap → deep link (cold-start + warm)
    attachNotificationTapHandler();
  }, []);

  // Auto-register push token every time the user becomes authenticated so the
  // backend watcher always has a live active token (the token can otherwise be
  // marked inactive after a previous logout).
  //
  // We intentionally ignore the local "notificationsEnabled" preference here so
  // that reinstalled APKs / fresh logins always yield a real backend token.
  // The user can still mute notifications from the Settings screen (that only
  // controls the local UI behaviour now; the backend watcher is always ready).
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    // 2026-05-06 — Web push (FCM Web SDK) bu projeden kaldırıldı. Sadece native
    // (iOS / Android) push notification kayıt akışı çalışır.
    (async () => {
      try {
        const result = await notificationService.registerForPushNotifications();
        if (result) {
          await AsyncStorage.setItem('notificationsEnabled', 'true');
          console.log('[layout] push token registered:', result.substring(0, 40));
        } else {
          console.log('[layout] push token was null (no permission or emulator?)');
        }
      } catch (e) {
        console.log('[layout] auto-register push token failed:', e);
      }
    })();
  }, [isAuthenticated, token]);

  // Apply Android navigation bar color whenever theme flips (system or manual)
  useEffect(() => {
    if (Platform.OS === 'android') {
      const bg = isDark ? '#000000' : '#FFFFFF';
      const btn = isDark ? 'light' : 'dark';
      NavigationBar.setBackgroundColorAsync(bg).catch(() => {});
      NavigationBar.setButtonStyleAsync(btn as any).catch(() => {});
    }
  }, [isDark]);

  if (isLoading || !langReady) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        style={isDark ? 'light' : 'dark'}
        backgroundColor={isDark ? '#000000' : '#FFFFFF'}
        translucent={false}
      />
      {/* 2026-05-15 — iOS APNs notification response için yedek köprü */}
      <NotificationResponseBridge />
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
