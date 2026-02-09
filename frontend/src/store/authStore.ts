import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  forgotPassword: (email: string) => Promise<boolean>;
}

// Demo user for testing
const DEMO_USER: User = {
  id: '1',
  email: 'demo@sirket.com',
  name: 'Demo Kullanıcı',
  role: 'admin',
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    // Demo login - accept any credentials for demo
    if (email && password) {
      const token = 'demo-jwt-token-' + Date.now();
      await AsyncStorage.setItem('token', token);
      await AsyncStorage.setItem('user', JSON.stringify(DEMO_USER));
      set({ user: DEMO_USER, token, isAuthenticated: true, isLoading: false });
      return true;
    }
    return false;
  },

  register: async (name: string, email: string, password: string) => {
    if (name && email && password) {
      const newUser: User = {
        id: Date.now().toString(),
        email,
        name,
        role: 'user',
      };
      const token = 'demo-jwt-token-' + Date.now();
      await AsyncStorage.setItem('token', token);
      await AsyncStorage.setItem('user', JSON.stringify(newUser));
      set({ user: newUser, token, isAuthenticated: true, isLoading: false });
      return true;
    }
    return false;
  },

  logout: async () => {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
  },

  checkAuth: async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const userStr = await AsyncStorage.getItem('user');
      if (token && userStr) {
        const user = JSON.parse(userStr);
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      set({ isLoading: false });
    }
  },

  forgotPassword: async (email: string) => {
    // Demo - just simulate success
    return !!email;
  },
}));
