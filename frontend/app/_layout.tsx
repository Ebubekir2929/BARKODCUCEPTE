import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useLanguageStore } from '../src/store/languageStore';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notificationService from '../src/services/notificationService';

function AppShell() {
  const { colors } = useThemeStore();
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

  useEffect(() => {
    loadTheme();
    loadLanguage();
    checkAuth();
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
    if (Platform.OS === 'web') return;
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
