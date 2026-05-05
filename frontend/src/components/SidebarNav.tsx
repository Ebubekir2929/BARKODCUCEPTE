/**
 * SidebarNav — desktop/tablet web sidebar to replace expo-router's bottom tabs.
 *
 * Rendered by `(tabs)/_layout.tsx` only when `Platform.OS === 'web'` and the
 * window is ≥ 768px wide. On mobile (and narrow web windows) the default
 * bottom tab bar is used instead.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useLanguageStore } from '../store/languageStore';
import { useAuthStore } from '../store/authStore';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const NAV_ICONS: Record<string, IconName> = {
  dashboard: 'grid',
  stock: 'cube',
  customers: 'people',
  reports: 'document-text',
  settings: 'settings',
};

interface Props extends BottomTabBarProps {
  width: number;
}

export const SidebarNav: React.FC<Props> = ({ state, navigation, width }) => {
  const { colors, theme } = useThemeStore();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const collapsed = width < 1024;

  return (
    <View style={[
      styles.container,
      {
        backgroundColor: colors.surface,
        borderRightColor: colors.border,
        width: collapsed ? 76 : 240,
      },
    ]}>
      {/* Logo / Brand */}
      <View style={[styles.brand, { borderBottomColor: colors.border }]}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Ionicons name="bar-chart" size={20} color="#fff" />
        </View>
        {!collapsed && (
          <View style={{ flex: 1 }}>
            <Text style={[styles.brandTitle, { color: colors.text }]} numberOfLines={1}>Barkodcu Cepte</Text>
            <Text style={[styles.brandSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>POS Yönetim</Text>
          </View>
        )}
      </View>

      {/* Nav items */}
      <View style={{ flex: 1, paddingTop: 12 }}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const icon = NAV_ICONS[route.name] || 'ellipse';
          const label = (() => {
            switch (route.name) {
              case 'dashboard': return t('dashboard');
              case 'stock': return t('stock');
              case 'customers': return t('customers');
              case 'reports': return t('reports');
              case 'settings': return t('settings');
              default: return route.name;
            }
          })();
          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              style={[
                styles.navItem,
                collapsed && styles.navItemCollapsed,
                focused && {
                  backgroundColor: colors.primary + '18',
                  borderLeftColor: colors.primary,
                },
              ]}
              activeOpacity={0.75}
            >
              <Ionicons
                name={focused ? icon : (`${icon}-outline` as IconName)}
                size={22}
                color={focused ? colors.primary : colors.textSecondary}
              />
              {!collapsed && (
                <Text
                  style={[
                    styles.navLabel,
                    { color: focused ? colors.primary : colors.text, fontWeight: focused ? '700' : '500' },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              )}
              {focused && collapsed && (
                <View style={[styles.dotIndicator, { backgroundColor: colors.primary }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* User profile chip at bottom */}
      <View style={[styles.profile, { borderTopColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.primary + '25' }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {(user?.email || 'U')[0]?.toUpperCase()}
          </Text>
        </View>
        {!collapsed && (
          <View style={{ flex: 1, paddingHorizontal: 8 }}>
            <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
              {user?.full_name || user?.email || 'Kullanıcı'}
            </Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]} numberOfLines={1}>
              {theme === 'dark' ? '🌙 Koyu' : '☀️ Açık'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: '100%',
    borderRightWidth: 1,
    paddingVertical: 0,
    flexDirection: 'column',
    ...Platform.select({
      web: {
        position: 'sticky' as any,
        top: 0,
      } as any,
    }),
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: { fontSize: 14, fontWeight: '800' },
  brandSubtitle: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  navItemCollapsed: {
    paddingHorizontal: 0,
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  navLabel: {
    fontSize: 14,
    flex: 1,
  },
  dotIndicator: {
    position: 'absolute',
    right: 8,
    top: '50%',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800' },
  userName: { fontSize: 13, fontWeight: '700' },
  userEmail: { fontSize: 11, fontWeight: '500', marginTop: 1 },
});

export default SidebarNav;
