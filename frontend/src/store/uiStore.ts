/**
 * 2026-06-01 — UI state store. Twitter-style scroll-to-hide bottom tab bar.
 * Sayfalar `onScroll` ile `setScrollDirection('up'|'down'|'top')` çağırır.
 * AnimatedTabBar bu değişikliği dinler ve translateY animasyonu yapar.
 */
import { create } from 'zustand';

type ScrollDir = 'up' | 'down' | 'top';

interface UIState {
  tabBarHidden: boolean;
  setTabBarHidden: (h: boolean) => void;
  /** Sayfa scroll'unda çağrılır. Yukarı kaydırınca tab bar görünür, aşağı kaydırınca gizlenir. */
  reportScroll: (dy: number) => void;
}

let lastScrollY = 0;
let lastDir: ScrollDir = 'top';
const HIDE_THRESHOLD = 20;

export const useUIStore = create<UIState>((set, get) => ({
  tabBarHidden: false,
  setTabBarHidden: (h) => set({ tabBarHidden: h }),
  reportScroll: (currentY: number) => {
    const dy = currentY - lastScrollY;
    lastScrollY = currentY;
    if (currentY <= 5) {
      // En tepede ise tab bar görünür
      if (get().tabBarHidden) set({ tabBarHidden: false });
      lastDir = 'top';
      return;
    }
    if (dy > HIDE_THRESHOLD && lastDir !== 'down') {
      lastDir = 'down';
      if (!get().tabBarHidden) set({ tabBarHidden: true });
    } else if (dy < -HIDE_THRESHOLD && lastDir !== 'up') {
      lastDir = 'up';
      if (get().tabBarHidden) set({ tabBarHidden: false });
    }
  },
}));
