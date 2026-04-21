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

const lightTheme: ThemeColors = {
  primary: '#2563EB',
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

interface ThemeStore {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => Promise<void>;
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

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: 'system',
  isDark: Appearance.getColorScheme() === 'dark',
  colors: Appearance.getColorScheme() === 'dark' ? darkTheme : lightTheme,

  setMode: async (mode: ThemeMode) => {
    await AsyncStorage.setItem('themeMode', mode);
    const isDark = resolveIsDark(mode);
    set({ mode, isDark, colors: isDark ? darkTheme : lightTheme });
  },

  toggleTheme: async () => {
    // When toggling manually, switch to explicit light/dark mode
    const currentIsDark = get().isDark;
    const newMode: ThemeMode = currentIsDark ? 'light' : 'dark';
    await AsyncStorage.setItem('themeMode', newMode);
    set({
      mode: newMode,
      isDark: !currentIsDark,
      colors: !currentIsDark ? darkTheme : lightTheme,
    });
  },

  loadTheme: async () => {
    try {
      // Backward compat: legacy 'theme' key only stored 'dark' | 'light'
      const legacy = await AsyncStorage.getItem('theme');
      const storedMode = (await AsyncStorage.getItem('themeMode')) as ThemeMode | null;

      let mode: ThemeMode = 'system';
      if (storedMode === 'system' || storedMode === 'light' || storedMode === 'dark') {
        mode = storedMode;
      } else if (legacy === 'dark' || legacy === 'light') {
        mode = legacy;
        await AsyncStorage.setItem('themeMode', mode);
      }

      const isDark = resolveIsDark(mode);
      set({ mode, isDark, colors: isDark ? darkTheme : lightTheme });

      // Subscribe to system appearance changes once
      Appearance.addChangeListener(({ colorScheme }) => {
        get()._applySystemChange(colorScheme);
      });
    } catch (error) {
      console.log('Error loading theme:', error);
    }
  },

  _applySystemChange: (scheme: ColorSchemeName) => {
    const { mode } = get();
    if (mode !== 'system') return;
    const isDark = scheme === 'dark';
    set({ isDark, colors: isDark ? darkTheme : lightTheme });
  },
}));
