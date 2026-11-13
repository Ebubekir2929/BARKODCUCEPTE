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
  // 2026-11 — Gösterge paneli: Açık Hesap kartını göster / Toplam'a dahil et
  showOpenAccount: boolean;
  includeOpenAccountInTotal: boolean;
  setRefreshInterval: (v: RefreshInterval) => void;
  setShowOpenAccount: (v: boolean) => void;
  setIncludeOpenAccountInTotal: (v: boolean) => void;
  hydrate: () => Promise<void>;
}

const KEY = '@prefs:refreshInterval';
const KEY_SHOW_OA = '@prefs:showOpenAccount';
const KEY_INCLUDE_OA = '@prefs:includeOpenAccountInTotal';
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
  showOpenAccount: true,
  includeOpenAccountInTotal: true,
  setRefreshInterval: (v) => {
    const c = clamp(Number(v));
    set({ refreshInterval: c });
    AsyncStorage.setItem(KEY, String(c)).catch(() => {});
  },
  setShowOpenAccount: (v) => {
    set({ showOpenAccount: v });
    AsyncStorage.setItem(KEY_SHOW_OA, v ? '1' : '0').catch(() => {});
  },
  setIncludeOpenAccountInTotal: (v) => {
    set({ includeOpenAccountInTotal: v });
    AsyncStorage.setItem(KEY_INCLUDE_OA, v ? '1' : '0').catch(() => {});
  },
  hydrate: async () => {
    try {
      const [raw, showOa, includeOa] = await Promise.all([
        AsyncStorage.getItem(KEY),
        AsyncStorage.getItem(KEY_SHOW_OA),
        AsyncStorage.getItem(KEY_INCLUDE_OA),
      ]);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= MIN_INTERVAL && n <= MAX_INTERVAL) {
          set({ refreshInterval: n });
        }
      }
      if (showOa !== null) set({ showOpenAccount: showOa === '1' });
      if (includeOa !== null) set({ includeOpenAccountInTotal: includeOa === '1' });
    } catch {
      // ignore
    } finally {
      set({ hydrated: true });
    }
  },
}));
