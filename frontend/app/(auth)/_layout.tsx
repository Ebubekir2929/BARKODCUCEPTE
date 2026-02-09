import React from 'react';
import { Stack } from 'expo-router';
import { useThemeStore } from '../../src/store/themeStore';

export default function AuthLayout() {
  const { colors } = useThemeStore();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
