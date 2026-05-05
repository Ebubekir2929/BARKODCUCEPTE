import { useWindowDimensions, Platform } from 'react-native';

/**
 * Responsive layout hook — derives device class from window width so screens
 * can render mobile-first by default but switch to a richer desktop layout on
 * the web/tablet.
 *
 * Breakpoints follow common SaaS dashboards:
 *   • phone   < 768px   (bugünkü mobil görünüm)
 *   • tablet  768–1023  (2 kolonlu kartlar)
 *   • desktop ≥ 1024    (sidebar + multi-column + tablo)
 *
 * On native (iOS/Android) it always returns "phone" — we don't change the
 * mobile UX even on a 12" iPad in landscape since the bottom-tab nav is more
 * thumb-friendly there. Web is the only platform where desktop layout kicks in.
 */
export type DeviceClass = 'phone' | 'tablet' | 'desktop' | 'xlarge';

export interface ResponsiveInfo {
  width: number;
  height: number;
  device: DeviceClass;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Web ≥ 1280px — used for "ultra-wide" grid layouts (KPIs in 1 row). */
  isXLarge: boolean;
  /** True for web tablet+desktop — useful for switching to side nav. */
  isWideWeb: boolean;
  /** Web only flag (Platform.OS === 'web'). */
  isWeb: boolean;
}

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';

  let device: DeviceClass = 'phone';
  if (isWeb) {
    if (width >= 1280) device = 'xlarge';
    else if (width >= 1024) device = 'desktop';
    else if (width >= 768) device = 'tablet';
    else device = 'phone';
  }

  return {
    width,
    height,
    device,
    isPhone: device === 'phone',
    isTablet: device === 'tablet',
    isDesktop: device === 'desktop' || device === 'xlarge',
    isXLarge: device === 'xlarge',
    isWideWeb: isWeb && device !== 'phone',
    isWeb,
  };
}

/** Pick a value based on the current device class. Falls back through phone. */
export function pickResponsive<T>(d: DeviceClass, vals: { phone: T; tablet?: T; desktop?: T }): T {
  if (d === 'desktop') return (vals.desktop ?? vals.tablet ?? vals.phone) as T;
  if (d === 'tablet') return (vals.tablet ?? vals.phone) as T;
  return vals.phone;
}
