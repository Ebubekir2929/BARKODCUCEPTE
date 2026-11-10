/**
 * Rapor tercihleri: Son Raporlar (son 5 çalıştırma, filtreleriyle) ve Favori Filtreler
 * (isimli filtre kombinasyonları). Veri kaynağına (tenant) göre ayrı tutulur çünkü
 * filtre ID'leri (personel, lokasyon…) tenant'a özgüdür. AsyncStorage'da kalıcıdır.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FilterValues } from '../reports/types';

export interface RecentRun { id: string; reportKey: string; filterValues: FilterValues; at: number }
export interface FavoriteFilter { id: string; reportKey: string; name: string; filterValues: FilterValues; at: number }

interface ReportPrefsState {
  hydrated: boolean;
  recent: Record<string, RecentRun[]>;          // tenantId → en yeni önce, en fazla 5
  favorites: Record<string, FavoriteFilter[]>;  // tenantId → kayıt sırasına göre
  hydrate: () => Promise<void>;
  addRecent: (tenantId: string, reportKey: string, filterValues: FilterValues) => void;
  removeRecent: (tenantId: string, id: string) => void;
  clearRecent: (tenantId: string) => void;
  addFavorite: (tenantId: string, reportKey: string, name: string, filterValues: FilterValues) => void;
  removeFavorite: (tenantId: string, id: string) => void;
}

const KEY = '@reportPrefs:v1';
export const MAX_RECENT = 5;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const sameValues = (a: FilterValues, b: FilterValues) => JSON.stringify(a) === JSON.stringify(b);

const persist = (s: Pick<ReportPrefsState, 'recent' | 'favorites'>) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ recent: s.recent, favorites: s.favorites })).catch(() => {});

export const useReportPrefsStore = create<ReportPrefsState>((set, get) => ({
  hydrated: false,
  recent: {},
  favorites: {},

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          recent: parsed?.recent && typeof parsed.recent === 'object' ? parsed.recent : {},
          favorites: parsed?.favorites && typeof parsed.favorites === 'object' ? parsed.favorites : {},
        });
      }
    } catch {
      // bozuk kayıt → boş başla
    } finally {
      set({ hydrated: true });
    }
  },

  addRecent: (tenantId, reportKey, filterValues) => {
    const list = (get().recent[tenantId] || []).filter(
      r => !(r.reportKey === reportKey && sameValues(r.filterValues, filterValues)),
    );
    list.unshift({ id: newId(), reportKey, filterValues, at: Date.now() });
    const recent = { ...get().recent, [tenantId]: list.slice(0, MAX_RECENT) };
    set({ recent });
    persist({ recent, favorites: get().favorites });
  },

  removeRecent: (tenantId, id) => {
    const recent = { ...get().recent, [tenantId]: (get().recent[tenantId] || []).filter(r => r.id !== id) };
    set({ recent });
    persist({ recent, favorites: get().favorites });
  },

  clearRecent: (tenantId) => {
    const recent = { ...get().recent, [tenantId]: [] };
    set({ recent });
    persist({ recent, favorites: get().favorites });
  },

  addFavorite: (tenantId, reportKey, name, filterValues) => {
    const list = [...(get().favorites[tenantId] || []), { id: newId(), reportKey, name: name.trim(), filterValues, at: Date.now() }];
    const favorites = { ...get().favorites, [tenantId]: list };
    set({ favorites });
    persist({ recent: get().recent, favorites });
  },

  removeFavorite: (tenantId, id) => {
    const favorites = { ...get().favorites, [tenantId]: (get().favorites[tenantId] || []).filter(f => f.id !== id) };
    set({ favorites });
    persist({ recent: get().recent, favorites });
  },
}));
