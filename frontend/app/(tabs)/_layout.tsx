import React, { useCallback, useEffect } from 'react';
import { Tabs, Slot, useSegments, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { Platform, useWindowDimensions, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
// 2026-05-06 — flushPendingNotificationRoute kaldırıldı. Yeni mimari:
// notificationTapHandler AsyncStorage'a yazar, dashboard.tsx useFocusEffect
// içinde readPendingTap çağırarak okur. Burada hiçbir şey yapmaya gerek yok.

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TabIcon = ({ name, color, size }: { name: IconName; color: string; size: number }) => (
  <Ionicons name={name} size={size} color={color} />
);

// 5 main routes for both bottom-tab (mobile) and sidebar (desktop web)
const ROUTES: { key: string; icon: IconName; labelKey: string }[] = [
  { key: 'dashboard', icon: 'grid', labelKey: 'dashboard' },
  { key: 'stock', icon: 'cube', labelKey: 'stock' },
  { key: 'customers', icon: 'people', labelKey: 'customers' },
  { key: 'reports', icon: 'document-text', labelKey: 'reports' },
  { key: 'settings', icon: 'settings', labelKey: 'settings' },
];

export default function TabLayout() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // NOTE (Rules of Hooks): ALL hooks must be called before any conditional
  // `return`. We previously defined the `useCallback` tab-icon renderers AFTER
  // the early `return <SidebarLayout/>`, which meant that when the viewport
  // crossed the 768 px breakpoint React saw the hook count change and threw
  // "Rendered more hooks than during the previous render". Keep them here.
  const renderDashboardIcon = useCallback(({ color, size }: any) => <TabIcon name="grid" color={color} size={size} />, []);
  const renderStockIcon = useCallback(({ color, size }: any) => <TabIcon name="cube" color={color} size={size} />, []);
  const renderCustomersIcon = useCallback(({ color, size }: any) => <TabIcon name="people" color={color} size={size} />, []);
  const renderReportsIcon = useCallback(({ color, size }: any) => <TabIcon name="document-text" color={color} size={size} />, []);
  const renderSettingsIcon = useCallback(({ color, size }: any) => <TabIcon name="settings" color={color} size={size} />, []);

  // 2026-05-06 — Eski `flushPendingNotificationRoute` çağrısı kaldırıldı.
  // Yeni mimari: dashboard.tsx useFocusEffect içinde AsyncStorage'dan
  // pending tap'i okur. Burada hiçbir şey yapmaya gerek yok.

  // 2026-05-05 — On the web (≥ 768px) render a left sidebar instead of the
  // default bottom tab bar so the app feels like a desktop SaaS dashboard.
  // 2026-05-06 — Mobil-only proje. Web sidebar nav devre dışı.
  const useSidebar = false;

  // ─── Desktop / Tablet web sidebar layout ──────────────────────────────
  // We use <Slot/> here because expo-router's Tabs always pins its tabBar to
  // the bottom of the screen, which can't be reused for a left sidebar.
  if (useSidebar) {
    return <SidebarLayout colors={colors} t={t} width={width} />;
  }

  // ─── Mobile / narrow web — keep the original bottom-tab UX ────────────

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: (Platform.OS === 'ios' ? 65 : 60) + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(12, insets.bottom + 4),
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: t('dashboard'), tabBarIcon: renderDashboardIcon }} />
      <Tabs.Screen name="stock" options={{ title: t('stock'), tabBarIcon: renderStockIcon }} />
      <Tabs.Screen name="customers" options={{ title: t('customers'), tabBarIcon: renderCustomersIcon }} />
      <Tabs.Screen name="reports" options={{ title: t('reports'), tabBarIcon: renderReportsIcon }} />
      <Tabs.Screen name="settings" options={{ title: t('settings'), tabBarIcon: renderSettingsIcon }} />
    </Tabs>
  );
}

// ============================================================================
// Sidebar layout for web ≥ 768px — renders <Slot/> for the active child route
// ============================================================================
const SidebarLayout: React.FC<{ colors: any; t: (k: string) => string; width: number }> = ({ colors, t, width }) => {
  const segments = useSegments();
  const { user, theme } = useAuthStore.getState() as any;
  // segments looks like ["(tabs)", "dashboard"] — pick the active route name
  const activeRoute = segments[segments.length - 1] || 'dashboard';
  const collapsed = width < 1024;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      {/* SIDEBAR */}
      <View style={[
        sidebarStyles.container,
        { backgroundColor: colors.surface, borderRightColor: colors.border, width: collapsed ? 76 : 240 },
      ]}>
        {/* Brand */}
        <View style={[sidebarStyles.brand, { borderBottomColor: colors.border }]}>
          <View style={[sidebarStyles.logo, { backgroundColor: colors.primary }]}>
            <Ionicons name="bar-chart" size={20} color="#fff" />
          </View>
          {!collapsed && (
            <View style={{ flex: 1 }}>
              <Text style={[sidebarStyles.brandTitle, { color: colors.text }]} numberOfLines={1}>Barkodcu Cepte</Text>
              <Text style={[sidebarStyles.brandSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>POS Yönetim</Text>
            </View>
          )}
        </View>

        {/* Nav items */}
        <View style={{ flex: 1, paddingTop: 12 }}>
          {ROUTES.map((r) => {
            const focused = activeRoute === r.key;
            const label = t(r.labelKey);
            return (
              <TouchableOpacity
                key={r.key}
                onPress={() => router.replace(`/(tabs)/${r.key}` as any)}
                style={[
                  sidebarStyles.navItem,
                  collapsed && sidebarStyles.navItemCollapsed,
                  focused && {
                    backgroundColor: colors.primary + '18',
                    borderLeftColor: colors.primary,
                  },
                ]}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={focused ? r.icon : (`${r.icon}-outline` as IconName)}
                  size={22}
                  color={focused ? colors.primary : colors.textSecondary}
                />
                {!collapsed && (
                  <Text
                    style={[
                      sidebarStyles.navLabel,
                      { color: focused ? colors.primary : colors.text, fontWeight: focused ? '700' : '500' },
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Profile */}
        <View style={[sidebarStyles.profile, { borderTopColor: colors.border }]}>
          <View style={[sidebarStyles.avatar, { backgroundColor: colors.primary + '25' }]}>
            <Text style={[sidebarStyles.avatarText, { color: colors.primary }]}>
              {(user?.email || user?.full_name || 'U')[0]?.toUpperCase()}
            </Text>
          </View>
          {!collapsed && (
            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              <Text style={[sidebarStyles.userName, { color: colors.text }]} numberOfLines={1}>
                {user?.full_name || user?.email || 'Kullanıcı'}
              </Text>
              <Text style={[sidebarStyles.userEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                {theme === 'dark' ? '🌙 Koyu' : '☀️ Açık'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* CONTENT — current route renders here via <Slot/> */}
      <View style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        <Slot />
      </View>
    </View>
  );
};

const sidebarStyles = StyleSheet.create({
  container: {
    height: '100%',
    borderRightWidth: 1,
    flexDirection: 'column',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
  },
  logo: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brandTitle: { fontSize: 14, fontWeight: '800' },
  brandSubtitle: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    marginHorizontal: 8, marginVertical: 2,
    borderRadius: 10, borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  navItemCollapsed: { paddingHorizontal: 0, justifyContent: 'center', marginHorizontal: 6 },
  navLabel: { fontSize: 14, flex: 1 },
  profile: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14, borderTopWidth: 1,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  userName: { fontSize: 13, fontWeight: '700' },
  userEmail: { fontSize: 11, fontWeight: '500', marginTop: 1 },
});
