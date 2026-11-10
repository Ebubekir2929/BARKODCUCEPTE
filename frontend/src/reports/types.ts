/**
 * Rapor ekranı tip tanımları.
 * 2026-11 refactor: app/(tabs)/reports.tsx'ten çıkarıldı.
 */
import { Ionicons } from '@expo/vector-icons';

export interface FilterDef {
  name: string; label: string; type: 'multiselect' | 'select_static' | 'date' | 'text';
  source?: string; // rap_filtre_lookup Kaynak
  options?: { value: any; label: string }[];
  required?: boolean; group?: string;
  placeholder?: string;
  numeric?: boolean; // text input that should use numeric keyboard + number conversion
}

export interface ColDef { key: string; label: string; type?: 'money' | 'number' | 'bool'; }

export interface CardLayout {
  title: string;          // main product/entity name (e.g. 'AD')
  code?: string;          // secondary code (e.g. 'KOD')
  amount?: string;        // right-side big amount (e.g. 'FIYAT')
  amountType?: 'money' | 'number';
  amountCurrency?: string;// key for currency label (e.g. 'DOVIZ_AD')
  amountLabel?: string;   // optional label below amount (e.g. 'Fiyat')
  chips?: { key: string; label?: string; type?: 'bool' | 'text' | 'number' }[]; // quick-info pills
  meta?: { key: string; label?: string; type?: 'text' | 'number' | 'money' }[]; // footer info
}

export interface SummaryConfig {
  cols: { key: string; label: string; type?: 'money' | 'number' }[];
  totalsFromRow?: Record<string, string>;
  // Compute a column's total as an expression over other totalsFromRow keys
  // e.g. { BAKIYE: { op: 'sub', a: 'TOPLAM_BORC', b: 'TOPLAM_ALACAK' } }
  totalsComputed?: Record<string, { op: 'sub' | 'add'; a: string; b: string }>;
  showOnlyTotal?: boolean;
}

export interface ReportDef {
  key: string; title: string; icon: keyof typeof Ionicons.glyphMap; description: string;
  datasetKey: string; defaultParams: Record<string, any>;
  columns: ColDef[]; filters: FilterDef[];
  requireNarrowing?: boolean;
  requiredFilters?: string[];
  cardLayout?: CardLayout;
  summary?: SummaryConfig;
  hierarchical?: {
    labelKey: string;   // e.g. 'ACIKLAMA'
    valueKey: string;   // e.g. 'TUTAR'
    levelKey: string;   // e.g. 'SEVIYE'
  };
  disableSort?: boolean; // hide the sort pills bar for chronological reports
}

export interface LookupOption { value: string; label: string }

export type FilterValues = Record<string, any>;
