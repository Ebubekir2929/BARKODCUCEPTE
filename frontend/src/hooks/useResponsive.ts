// 2026-05-06 — Mobil-only proje. Web desteği bu projeden kaldırıldı.
// Bu hook artık her zaman "phone" döner. `isDesktop`, `isTablet`, `isWideWeb`,
// `isWeb`, `isXLarge` daima false. Bu sayede kod tabanındaki tüm
// `Platform.OS === 'web' && isDesktop && ...` branch'ları dead-code olur ve
// mobil uygulamaya zarar vermez. Yeni özellik eklerken bu kalıbı KULLANMAYIN.
import { useWindowDimensions } from 'react-native';

export type DeviceClass = 'phone' | 'tablet' | 'desktop' | 'xlarge';

export interface ResponsiveInfo {
  width: number;
  height: number;
  device: DeviceClass;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isXLarge: boolean;
  isWideWeb: boolean;
  isWeb: boolean;
}

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    device: 'phone',
    isPhone: true,
    isTablet: false,
    isDesktop: false,
    isXLarge: false,
    isWideWeb: false,
    isWeb: false,
  };
}

export function pickResponsive<T>(_d: DeviceClass, vals: { phone: T; tablet?: T; desktop?: T }): T {
  return vals.phone;
}
