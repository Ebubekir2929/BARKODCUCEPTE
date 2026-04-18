import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, TenantSource } from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface LicenseInfo {
  is_valid: boolean;
  days_remaining: number | null;
  expiry_date: string | null;
  warning: boolean;
}

interface RegisterData {
  full_name: string;
  username: string;
  email: string;
  password: string;
  tax_number: string;
  tenant_id: string;
  tenant_name: string;
  business_type: 'normal' | 'restoran';
  terms_accepted: boolean;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  license: LicenseInfo | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; licenseWarning?: boolean; daysRemaining?: number }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  addTenant: (tenant_id: string, name: string) => Promise<{ success: boolean; error?: string }>;
  updateTenantName: (tenant_id: string, name: string) => Promise<{ success: boolean; error?: string }>;
  removeTenant: (tenant_id: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  license: null,

  login: async (email: string, password: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: (email || '').trim(), password }),
      });

      const data = await response.json();

      if (response.status === 403) {
        // License expired
        return { success: false, error: data.detail || 'Lisans süreniz dolmuştur' };
      }

      if (!response.ok) {
        return { success: false, error: data.detail || 'Giriş başarısız' };
      }

      await AsyncStorage.setItem('token', data.access_token);
      await AsyncStorage.setItem('user', JSON.stringify(data.user));
      if (data.license) {
        await AsyncStorage.setItem('license', JSON.stringify(data.license));
      }

      set({
        user: data.user,
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
        license: data.license || null,
      });

      // Check if license warning needed (< 7 days)
      if (data.license?.warning) {
        return { success: true, licenseWarning: true, daysRemaining: data.license.days_remaining };
      }

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Bağlantı hatası. Lütfen internet bağlantınızı kontrol edin.' };
    }
  },

  register: async (registerData: RegisterData) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerData),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.detail || 'Kayıt başarısız' };
      }

      await AsyncStorage.setItem('token', data.access_token);
      await AsyncStorage.setItem('user', JSON.stringify(data.user));

      set({
        user: data.user,
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });

      return { success: true };
    } catch (error) {
      console.error('Register error:', error);
      return { success: false, error: 'Bağlantı hatası. Lütfen tekrar deneyin.' };
    }
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
        // Verify token is still valid
        try {
          const response = await fetch(`${API_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (response.ok) {
            const freshUser = await response.json();
            await AsyncStorage.setItem('user', JSON.stringify(freshUser));
            set({ user: freshUser, token, isAuthenticated: true, isLoading: false });
          } else {
            // Token expired, use cached data as fallback
            set({ user, token, isAuthenticated: true, isLoading: false });
          }
        } catch {
          // Network error, use cached data
          set({ user, token, isAuthenticated: true, isLoading: false });
        }
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      set({ isLoading: false });
    }
  },

  forgotPassword: async (email: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: (email || '').trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.detail || 'Bir hata oluştu' };
      }
      return { success: true, message: data.message || 'E-posta gönderildi' };
    } catch (error) {
      return { success: false, error: 'Bağlantı hatası' };
    }
  },

  addTenant: async (tenant_id: string, name: string) => {
    const { token } = get();
    if (!token) return { success: false, error: 'Oturum açmanız gerekiyor' };

    try {
      const response = await fetch(`${API_URL}/api/auth/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id, name }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.detail || 'Tenant eklenemedi' };
      }

      await AsyncStorage.setItem('user', JSON.stringify(data));
      set({ user: data });
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Bağlantı hatası' };
    }
  },

  updateTenantName: async (tenant_id: string, name: string) => {
    const { token } = get();
    if (!token) return { success: false, error: 'Oturum açmanız gerekiyor' };

    try {
      const response = await fetch(`${API_URL}/api/auth/tenants/${encodeURIComponent(tenant_id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.detail || 'İsim güncellenemedi' };
      }

      await AsyncStorage.setItem('user', JSON.stringify(data));
      set({ user: data });
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Bağlantı hatası' };
    }
  },

  removeTenant: async (tenant_id: string) => {
    const { token } = get();
    if (!token) return { success: false, error: 'Oturum açmanız gerekiyor' };

    try {
      const response = await fetch(`${API_URL}/api/auth/tenants/${encodeURIComponent(tenant_id)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.detail || 'Tenant silinemedi' };
      }

      await AsyncStorage.setItem('user', JSON.stringify(data));
      set({ user: data });
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Bağlantı hatası' };
    }
  },

  refreshUser: async () => {
    const { token } = get();
    if (!token) return;

    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const user = await response.json();
        await AsyncStorage.setItem('user', JSON.stringify(user));
        set({ user });
      }
    } catch (error) {
      console.error('Refresh user error:', error);
    }
  },
}));
