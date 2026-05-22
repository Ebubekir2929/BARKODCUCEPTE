import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, ColorSchemeName } from 'react-native';

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  card: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  cash: string;
  openAccount: string;
  total: string;
}

const DEFAULT_ACCENT = '#2563EB';

const lightTheme: ThemeColors = {
  primary: DEFAULT_ACCENT,
  secondary: '#7C3AED',
  background: '#F3F4F6',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  cash: '#10B981',
  openAccount: '#F59E0B',
  total: '#8B5CF6',
};

const darkTheme: ThemeColors = {
  primary: '#3B82F6',
  secondary: '#8B5CF6',
  background: '#0F172A',
  surface: '#1E293B',
  card: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  border: '#334155',
  success: '#22C55E',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#60A5FA',
  cash: '#22C55E',
  openAccount: '#FBBF24',
  total: '#A78BFA',
};

export type ThemeMode = 'system' | 'light' | 'dark';

// Hex -> RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return {
    r: parseInt(full.substring(0, 2), 16),
    g: parseInt(full.substring(2, 4), 16),
    b: parseInt(full.substring(4, 6), 16),
  };
};

// Hex'ten daha açık ton (dark mode için)
const lightenHex = (hex: string, amount = 0.15): string => {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`.toUpperCase();
};

// Verilen accent rengini light/dark temasına uygula
const applyAccent = (base: ThemeColors, accent: string, isDark: boolean): ThemeColors => ({
  ...base,
  primary: isDark ? lightenHex(accent, 0.15) : accent,
});

interface ThemeStore {
  mode: ThemeMode;
  isDark: boolean;
  accent: string;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => Promise<void>;
  setAccent: (hex: string) => Promise<void>;
  toggleTheme: () => Promise<void>;
  loadTheme: () => Promise<void>;
  _applySystemChange: (scheme: ColorSchemeName) => void;
}

const resolveIsDark = (mode: ThemeMode): boolean => {
  if (mode === 'system') {
    const scheme = Appearance.getColorScheme();
    return scheme === 'dark';
  }
  return mode === 'dark';
};

const buildColors = (isDark: boolean, accent: string): ThemeColors => {
  const base = isDark ? darkTheme : lightTheme;
  return applyAccent(base, accent, isDark);
};

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: 'system',
  isDark: Appearance.getColorScheme() === 'dark',
  accent: DEFAULT_ACCENT,
  colors: buildColors(Appearance.getColorScheme() === 'dark', DEFAULT_ACCENT),

  setMode: async (mode: ThemeMode) => {
    await AsyncStorage.setItem('themeMode', mode);
    const isDark = resolveIsDark(mode);
    const { accent } = get();
    set({ mode, isDark, colors: buildColors(isDark, accent) });
  },

  setAccent: async (hex: string) => {
    const normalized = hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
    await AsyncStorage.setItem('themeAccent', normalized);
    const { isDark } = get();
    set({ accent: normalized, colors: buildColors(isDark, normalized) });
  },

  toggleTheme: async () => {
    const currentIsDark = get().isDark;
    const newMode: ThemeMode = currentIsDark ? 'light' : 'dark';
    await AsyncStorage.setItem('themeMode', newMode);
    const { accent } = get();
    set({
      mode: newMode,
      isDark: !currentIsDark,
      colors: buildColors(!currentIsDark, accent),
    });
  },

  loadTheme: async () => {
    try {
      const legacy = await AsyncStorage.getItem('theme');
      const storedMode = (await AsyncStorage.getItem('themeMode')) as ThemeMode | null;
      const storedAccent = await AsyncStorage.getItem('themeAccent');

      let mode: ThemeMode = 'system';
      if (storedMode === 'system' || storedMode === 'light' || storedMode === 'dark') {
        mode = storedMode;
      } else if (legacy === 'dark' || legacy === 'light') {
        mode = legacy;
        await AsyncStorage.setItem('themeMode', mode);
      }

      const accent = (storedAccent && /^#[0-9A-Fa-f]{6}$/.test(storedAccent)) ? storedAccent.toUpperCase() : DEFAULT_ACCENT;
      const isDark = resolveIsDark(mode);
      set({ mode, isDark, accent, colors: buildColors(isDark, accent) });

      Appearance.addChangeListener(({ colorScheme }) => {
        get()._applySystemChange(colorScheme);
      });
    } catch (error) {
      console.log('Error loading theme:', error);
    }
  },

  _applySystemChange: (scheme: ColorSchemeName) => {
    const { mode, accent } = get();
    if (mode !== 'system') return;
    const isDark = scheme === 'dark';
    set({ isDark, colors: buildColors(isDark, accent) });
  },
}));
