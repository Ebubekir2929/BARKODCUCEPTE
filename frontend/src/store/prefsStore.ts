import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// User-controlled UI preferences (currently: dashboard auto-refresh cadence).
// Persisted in AsyncStorage so the choice survives app restarts.
//
// 2026-05-13 — refreshInterval artık ARALIK içinde herhangi bir sayı olabilir
// (0 = manuel, 5..3600 saniye). Önceden sadece preset değerler kabul ediliyordu
// ve kullanıcı manuel girdiği değer (örn. 45sn) hydrate'te reddedilip varsayılan
// 60'a dönüyordu. Bu bug giderildi: any 0–3600 değeri persist olur.
export type RefreshInterval = number; // seconds; 0 = manual only, 5..3600 valid

interface PrefsState {
  refreshInterval: RefreshInterval;
  hydrated: boolean;
  setRefreshInterval: (v: RefreshInterval) => void;
  hydrate: () => Promise<void>;
}

const KEY = '@prefs:refreshInterval';
const MIN_INTERVAL = 0;     // 0 = manual
const MAX_INTERVAL = 3600;  // 1 hour upper bound

function clamp(n: number): number {
  if (isNaN(n) || n < 0) return 0;
  if (n > MAX_INTERVAL) return MAX_INTERVAL;
  return Math.floor(n);
}

export const usePrefsStore = create<PrefsState>((set) => ({
  refreshInterval: 60, // default: 1 minute
  hydrated: false,
  setRefreshInterval: (v) => {
    const c = clamp(Number(v));
    set({ refreshInterval: c });
    AsyncStorage.setItem(KEY, String(c)).catch(() => {});
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= MIN_INTERVAL && n <= MAX_INTERVAL) {
          set({ refreshInterval: n });
        }
      }
    } catch {
      // ignore
    } finally {
      set({ hydrated: true });
    }
  },
}));
