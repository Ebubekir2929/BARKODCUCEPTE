/**
 * 2026-06-01 — Twitter-style animated bottom tab bar.
 * Sayfa aşağı kaydırıldığında gizlenir, yukarı kaydırıldığında görünür.
 * `uiStore.tabBarHidden` state'ini dinler.
 */
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';

export const AnimatedTabBar: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStore();
  const tabBarHidden = useUIStore((s) => s.tabBarHidden);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  const totalHeight = (Platform.OS === 'ios' ? 65 : 60) + insets.bottom;

  useEffect(() => {
    translateY.value = withTiming(tabBarHidden ? totalHeight : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(tabBarHidden ? 0 : 1, { duration: 180 });
  }, [tabBarHidden, totalHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents={tabBarHidden ? 'none' : 'auto'}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: totalHeight,
          paddingBottom: Math.max(12, insets.bottom + 4),
        },
        animatedStyle,
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label =
          options.tabBarLabel !== undefined
            ? (typeof options.tabBarLabel === 'string' ? options.tabBarLabel : route.name)
            : options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name as any);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        const tabBarIcon = options.tabBarIcon;

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.tab}
            activeOpacity={0.7}
          >
            {tabBarIcon ? tabBarIcon({
              focused: isFocused,
              color: isFocused ? colors.primary : colors.textSecondary,
              size: 24,
            }) : <Ionicons name="ellipse" size={24} color={isFocused ? colors.primary : colors.textSecondary} />}
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  color: isFocused ? colors.primary : colors.textSecondary,
                  fontSize: Platform.OS === 'ios' ? 9 : 11,
                  marginTop: Platform.OS === 'ios' ? -2 : 2,
                },
              ]}
            >
              {String(label)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '600',
  },
});

export default AnimatedTabBar;
