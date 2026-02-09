import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';
import { useThemeStore } from '../src/store/themeStore';

export default function Index() {
  const router = useRouter();
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { colors, loadTheme } = useThemeStore();

  useEffect(() => {
    const init = async () => {
      await loadTheme();
      await checkAuth();
    };
    init();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/(tabs)/dashboard');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [isLoading, isAuthenticated]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
