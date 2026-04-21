import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useLanguageStore } from '../src/store/languageStore';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';

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
  const { isLoading, checkAuth } = useAuthStore();
  const { isReady: langReady, loadLanguage } = useLanguageStore();

  useEffect(() => {
    loadTheme();
    loadLanguage();
    checkAuth();
  }, []);

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
