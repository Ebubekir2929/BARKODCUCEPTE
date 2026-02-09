import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  card: string;
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

interface ThemeStore {
  isDark: boolean;
  colors: ThemeColors;
  toggleTheme: () => Promise<void>;
  loadTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  isDark: false,
  colors: lightTheme,

  toggleTheme: async () => {
    const newIsDark = !get().isDark;
    await AsyncStorage.setItem('theme', newIsDark ? 'dark' : 'light');
    set({ isDark: newIsDark, colors: newIsDark ? darkTheme : lightTheme });
  },

  loadTheme: async () => {
    try {
      const theme = await AsyncStorage.getItem('theme');
      const isDark = theme === 'dark';
      set({ isDark, colors: isDark ? darkTheme : lightTheme });
    } catch (error) {
      console.log('Error loading theme:', error);
    }
  },
}));
