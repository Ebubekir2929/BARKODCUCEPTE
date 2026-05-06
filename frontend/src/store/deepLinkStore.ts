/**
 * 2026-05-06 — Pending deep-link store.
 *
 * Notification tap handler dispatches the tapped notification's payload here.
 * Dashboard / Stock screens subscribe and process when ready.
 *
 * Why a store?
 *   • Android `router.push` does NOT update useLocalSearchParams when the
 *     target route is already the active screen → modal never opens.
 *   • Module-level refs in screens block repeat taps of the same notification.
 *   • A reactive store removes both problems: every push (even duplicate) is
 *     a new object reference, screens process it once and call `clear()`.
 */
import { create } from 'zustand';

export type DeepLinkPayload = {
  type: 'high_sale' | 'iptal' | 'iptal_satir' | 'low_stock_summary' | 'eksi_stok' | 'low_stock' | string;
  // common
  tenant?: string;
  // iptal
  iptal_id?: string;
  // high_sale
  belgeno?: string;
  fis_id?: string;
  amount?: string;
  // generic — anything else the backend included
  [key: string]: any;
} | null;

interface DeepLinkState {
  pending: DeepLinkPayload;
  // Each push generates a new id so screens that already processed payload N
  // know to re-run when payload N+1 arrives even if its content is identical.
  seq: number;
  push: (data: DeepLinkPayload) => void;
  clear: () => void;
}

export const useDeepLinkStore = create<DeepLinkState>((set, get) => ({
  pending: null,
  seq: 0,
  push: (data) => {
    if (!data) return;
    set({ pending: data, seq: get().seq + 1 });
  },
  clear: () => set({ pending: null }),
}));
