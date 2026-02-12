import React, { useCallback } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { Platform } from 'react-native';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TabIcon = ({ name, color, size }: { name: IconName; color: string; size: number }) => (
  <Ionicons name={name} size={size} color={color} />
);

export default function TabLayout() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();

  const renderDashboardIcon = useCallback(
    ({ color, size }: { color: string; size: number }) => (
      <TabIcon name="grid" color={color} size={size} />
    ),
    []
  );

  const renderStockIcon = useCallback(
    ({ color, size }: { color: string; size: number }) => (
      <TabIcon name="cube" color={color} size={size} />
    ),
    []
  );

  const renderCustomersIcon = useCallback(
    ({ color, size }: { color: string; size: number }) => (
      <TabIcon name="people" color={color} size={size} />
    ),
    []
  );

  const renderReportsIcon = useCallback(
    ({ color, size }: { color: string; size: number }) => (
      <TabIcon name="document-text" color={color} size={size} />
    ),
    []
  );

  const renderSettingsIcon = useCallback(
    ({ color, size }: { color: string; size: number }) => (
      <TabIcon name="settings" color={color} size={size} />
    ),
    []
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: Platform.OS === 'ios' ? 88 : 65,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('dashboard'),
          tabBarIcon: renderDashboardIcon,
        }}
      />
      <Tabs.Screen
        name="stock"
        options={{
          title: t('stock'),
          tabBarIcon: renderStockIcon,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: t('customers'),
          tabBarIcon: renderCustomersIcon,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('reports'),
          tabBarIcon: renderReportsIcon,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings'),
          tabBarIcon: renderSettingsIcon,
        }}
      />
    </Tabs>
  );
}
