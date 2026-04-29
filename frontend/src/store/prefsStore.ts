import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// User-controlled UI preferences (currently: dashboard auto-refresh cadence).
// Persisted in AsyncStorage so the choice survives app restarts.

export type RefreshInterval = 0 | 15 | 30 | 60 | 300; // seconds; 0 = manual only

interface PrefsState {
  refreshInterval: RefreshInterval;
  hydrated: boolean;
  setRefreshInterval: (v: RefreshInterval) => void;
  hydrate: () => Promise<void>;
}

const KEY = '@prefs:refreshInterval';

export const usePrefsStore = create<PrefsState>((set) => ({
  refreshInterval: 60, // default: 1 minute
  hydrated: false,
  setRefreshInterval: (v) => {
    set({ refreshInterval: v });
    AsyncStorage.setItem(KEY, String(v)).catch(() => {});
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && [0, 15, 30, 60, 300].includes(n)) {
          set({ refreshInterval: n as RefreshInterval });
        }
      }
    } catch {
      // ignore
    } finally {
      set({ hydrated: true });
    }
  },
}));
