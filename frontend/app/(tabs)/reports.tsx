import React, { useState, useMemo, useCallback, useEffect, useRef, memo, useDeferredValue } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, FlatList, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import DateTimePicker from '@react-native-community/datetimepicker';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// === REPORT DEFINITIONS ===
interface FilterDef {
  name: string; label: string; type: 'multiselect' | 'select_static' | 'date' | 'text';
  source?: string; // rap_filtre_lookup Kaynak
  options?: { value: any; label: string }[];
  required?: boolean; group?: string;
  placeholder?: string;
  numeric?: boolean; // text input that should use numeric keyboard + number conversion
}
interface ColDef { key: string; label: string; type?: 'money' | 'number' | 'bool'; }
interface CardLayout {
  title: string;          // main product/entity name (e.g. 'AD')
  code?: string;          // secondary code (e.g. 'KOD')
  amount?: string;        // right-side big amount (e.g. 'FIYAT')
  amountType?: 'money' | 'number';
  amountCurrency?: string;// key for currency label (e.g. 'DOVIZ_AD')
  amountLabel?: string;   // optional label below amount (e.g. 'Fiyat')
  chips?: { key: string; label?: string; type?: 'bool' | 'text' | 'number' }[]; // quick-info pills
  meta?: { key: string; label?: string; type?: 'text' | 'number' | 'money' }[]; // footer info
}
interface ReportDef {
  key: string; title: string; icon: keyof typeof Ionicons.glyphMap; description: string;
  datasetKey: string; defaultParams: Record<string, any>;
  columns: ColDef[]; filters: FilterDef[];
  requireNarrowing?: boolean;
  requiredFilters?: string[];
  cardLayout?: CardLayout;
  summary?: {
    cols: { key: string; label: string; type?: 'money' | 'number' }[];
    totalsFromRow?: Record<string, string>;
    // Compute a column's total as an expression over other totalsFromRow keys
    // e.g. { BAKIYE: { op: 'sub', a: 'TOPLAM_BORC', b: 'TOPLAM_ALACAK' } }
    totalsComputed?: Record<string, { op: 'sub' | 'add'; a: string; b: string }>;
    showOnlyTotal?: boolean;
  };
  hierarchical?: {
    labelKey: string;   // e.g. 'ACIKLAMA'
    valueKey: string;   // e.g. 'TUTAR'
    levelKey: string;   // e.g. 'SEVIYE'
  };
  disableSort?: boolean; // hide the sort pills bar for chronological reports
}

const FIYAT_LISTELERI: ReportDef = {
  key: 'fiyat_listeleri', title: 'Fiyat Listeleri', icon: 'pricetags-outline',
  description: 'Stok fiyat listeleri ve KDV bilgileri',
  datasetKey: 'rap_fiyat_listeleri_web',
  defaultParams: {
    Aktif: 1, Durum: 0, Resimli: 0, Page: 1, PageSize: 500,
    FiyatAd: '', BirimAd: '', DovizAd: '', Lokasyon: '',
    StokCinsi: '', StokGrup: '', StokMarka: '', StokVergi: '', Stoklar: '',
    StokOzelKod1: '', StokOzelKod2: '', StokOzelKod3: '', StokOzelKod4: '', StokOzelKod5: '',
    StokOzelKod6: '', StokOzelKod7: '', StokOzelKod8: '', StokOzelKod9: '',
  },
  requireNarrowing: true,
  requiredFilters: ['FiyatAd'],
  cardLayout: {
    title: 'AD',
    code: 'KOD',
    amount: 'FIYAT',
    amountType: 'money',
    amountCurrency: 'DOVIZ_AD',
    amountLabel: 'Satış Fiyatı',
    chips: [
      { key: 'STOK_FIYAT_AD' },
      { key: 'KDV_DAHILMI', label: 'KDV Dahil', type: 'bool' },
      { key: 'STOK_BIRIM' },
      { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
    ],
    meta: [
      { key: 'STOK_CINSI' },
      { key: 'STOK_GRUP', label: 'Grup' },
      { key: 'STOK_MARKA', label: 'Marka' },
      { key: 'FIYAT_YEREL', label: 'Yerel', type: 'money' },
    ],
  },
  columns: [
    { key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Ürün Adı' },
    { key: 'STOK_FIYAT_AD', label: 'Fiyat Adı' }, { key: 'DOVIZ_AD', label: 'Döviz' },
    { key: 'STOK_BIRIM', label: 'Birim' }, { key: 'FIYAT', label: 'Fiyat', type: 'money' },
    { key: 'FIYAT_YEREL', label: 'Yerel Fiyat', type: 'money' },
    { key: 'KDV_DAHILMI', label: 'KDV Dahil', type: 'bool' },
    { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
    { key: 'STOK_CINSI', label: 'Cinsi' }, { key: 'STOK_GRUP', label: 'Grup' },
    { key: 'STOK_MARKA', label: 'Marka' },
  ],
  filters: [
    { name: 'FiyatAd', label: 'Fiyat Adı', type: 'multiselect', source: 'STOK_FIYAT_AD', required: true, group: 'Temel' },
    { name: 'DovizAd', label: 'Döviz Adı', type: 'multiselect', source: 'DOVIZ_AD', group: 'Temel' },
    { name: 'Aktif', label: 'Aktif', type: 'select_static', options: [{ value: 1, label: 'Aktif' }, { value: 0, label: 'Pasif' }, { value: '', label: 'Tümü' }], group: 'Temel' },
    { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Temel' },
    { name: 'BirimAd', label: 'Birim', type: 'multiselect', source: 'STOK_BIRIM', group: 'Stok' },
    { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI', group: 'Stok' },
    { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP', group: 'Stok' },
    { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA', group: 'Stok' },
    { name: 'StokVergi', label: 'Stok Vergi', type: 'multiselect', source: 'STOK_VERGI', group: 'Stok' },
  ],
};

// Other reports - simplified
// === SATIS ADET KAR — Tam parametre seti (POS tüm anahtarları ister) ===
const STOK_FILTER_DEFAULTS = {
  Stoklar: '', StokGrup: '', StokCinsi: '', StokMarka: '', StokVergi: '',
  StokOzelKod1: '', StokOzelKod2: '', StokOzelKod3: '', StokOzelKod4: '',
  StokOzelKod5: '', StokOzelKod6: '', StokOzelKod7: '', StokOzelKod8: '', StokOzelKod9: '',
};
const STOK_FILTERS_UI: FilterDef[] = [
  { name: 'Stoklar', label: 'Stok (Ürün)', type: 'multiselect', source: 'STOK', group: 'Filtreler' },
  { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP', group: 'Filtreler' },
  { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI', group: 'Filtreler' },
  { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA', group: 'Filtreler' },
  { name: 'StokVergi', label: 'KDV (Vergi)', type: 'multiselect', source: 'STOK_VERGI', group: 'Filtreler' },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDateTR = (iso: string): string => {
  if (!iso) return '';
  // Strip any time suffix like "2026-04-18 23:59:59" → "2026-04-18"
  const datePart = iso.split(' ')[0].split('T')[0];
  const parts = datePart.split('-');
  if (parts.length !== 3) return datePart;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
};
const firstOfYear = () => {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
};
const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const SATIS_ADET_KAR: ReportDef = {
  key: 'satis_adet_kar',
  title: 'Satış Adet / Kâr',
  icon: 'trending-up-outline',
  description: 'Satış adet, tutar ve kâr analizi',
  datasetKey: 'rap_satis_adet_kar_web',
  defaultParams: {
    BASTARIH: firstOfYear(),
    BITTARIH: today(),
    KdvDahil: 1,
    FisTipi: 0,
    Pc_Ad: '',
    Lokasyon: '',
    MaliyetYoksaSatisGelsin: 0,
    SarfFireGelmesin: 0,
    Page: 1,
    PageSize: 500,
    ...STOK_FILTER_DEFAULTS,
  },
  requireNarrowing: false,
  requiredFilters: ['Lokasyon'],
  summary: {
    cols: [
      { key: 'SATIS_MIKTAR', label: 'Miktar', type: 'number' },
      { key: 'FIYAT', label: 'Satış Fiyat', type: 'money' },
      { key: 'SATIS_TUTARI', label: 'Satış Tutar', type: 'money' },
      { key: 'SON_ALIS_FIYATI', label: 'Alış Fiyat', type: 'money' },
      { key: 'ALIS_TUTARI', label: 'Alış Tutar', type: 'money' },
      { key: 'KAR_TUTAR', label: 'Kâr Tutar', type: 'money' },
      { key: 'ORAN', label: 'Kâr %', type: 'number' },
    ],
    // Use POS-provided totals when available (it already returns TOPLAM_* on every row)
    totalsFromRow: {
      SATIS_MIKTAR: 'TOPLAM_SATIS_MIKTAR',
      SATIS_TUTARI: 'TOPLAM_SATIS_TUTARI',
      ALIS_TUTARI: 'TOPLAM_ALIS_TUTARI',
      KAR_TUTAR: 'TOPLAM_KAR_TUTAR',
      ORAN: 'TOPLAM_ORAN',
    },
  },
  cardLayout: {
    title: 'AD',
    code: 'KOD',
    amount: 'KAR_TUTAR',
    amountType: 'money',
    amountLabel: 'Kâr',
    chips: [
      { key: 'ORAN', label: 'Kâr %', type: 'number' },
      { key: 'SATIS_MIKTAR', label: 'Adet', type: 'number' },
      { key: 'STOK_BIRIM' },
    ],
    meta: [
      { key: 'SATIS_TUTARI', label: 'Satış', type: 'money' },
      { key: 'ALIS_TUTARI', label: 'Alış', type: 'money' },
      { key: 'FIYAT', label: 'Birim Satış', type: 'money' },
      { key: 'SON_ALIS_FIYATI', label: 'Son Alış', type: 'money' },
      { key: 'STOK_GRUP', label: 'Grup' },
      { key: 'STOK_MARKA', label: 'Marka' },
      { key: 'BARKOD', label: 'Barkod' },
    ],
  },
  columns: [
    { key: 'KOD', label: 'Kod' },
    { key: 'AD', label: 'Ürün' },
    { key: 'BARKOD', label: 'Barkod' },
    { key: 'STOK_GRUP', label: 'Grup' },
    { key: 'STOK_MARKA', label: 'Marka' },
    { key: 'STOK_BIRIM', label: 'Birim' },
    { key: 'SON_ALIS_KAYNAK', label: 'Maliyet Kaynak' },
    { key: 'FIYAT', label: 'Satış Fiyatı', type: 'money' },
    { key: 'SON_ALIS_FIYATI', label: 'Son Alış Fiyatı', type: 'money' },
    { key: 'SATIS_MIKTAR', label: 'Satış Adet', type: 'number' },
    { key: 'ALIS_TUTARI', label: 'Alış Tutarı', type: 'money' },
    { key: 'SATIS_TUTARI', label: 'Satış Tutarı', type: 'money' },
    { key: 'KAR_TUTAR', label: 'Kâr Tutarı', type: 'money' },
    { key: 'ORAN', label: 'Kâr Oranı %', type: 'number' },
  ],
  filters: [
    { name: 'BASTARIH', label: 'Başlangıç Tarihi', type: 'date', group: 'Tarih Aralığı' },
    { name: 'BITTARIH', label: 'Bitiş Tarihi', type: 'date', group: 'Tarih Aralığı' },
    { name: 'FisTipi', label: 'Fiş Tipi', type: 'select_static', group: 'Seçenekler',
      options: [
        { value: 0, label: 'Tümü' },
        { value: 1, label: 'Sadece Satış Fişleri' },
        { value: 2, label: 'Sadece İadeler' },
      ] },
    { name: 'KdvDahil', label: 'KDV Dahil Göster', type: 'select_static', group: 'Seçenekler',
      options: [
        { value: 1, label: 'KDV Dahil' },
        { value: 0, label: 'KDV Hariç' },
      ] },
    { name: 'MaliyetYoksaSatisGelsin', label: 'Maliyet Yoksa', type: 'select_static', group: 'Seçenekler',
      options: [
        { value: 1, label: 'Satış fiyatı göster' },
        { value: 0, label: 'Gösterme (sıfır)' },
      ] },
    { name: 'SarfFireGelmesin', label: 'Sarf/Fire', type: 'select_static', group: 'Seçenekler',
      options: [
        { value: 0, label: 'Dahil' },
        { value: 1, label: 'Hariç' },
      ] },
    { name: 'Pc_Ad', label: 'Bilgisayar Adı (Pc_Ad)', type: 'text', group: 'Filtreler', placeholder: 'Örn: KASA1' },
    { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtreler', required: true },
    ...STOK_FILTERS_UI,
    { name: 'StokOzelKod1', label: 'Özel Kod 1', type: 'multiselect', source: 'STOK_OZEL_KOD_1', group: 'Özel Kodlar' },
    { name: 'StokOzelKod2', label: 'Özel Kod 2', type: 'multiselect', source: 'STOK_OZEL_KOD_2', group: 'Özel Kodlar' },
    { name: 'StokOzelKod3', label: 'Özel Kod 3', type: 'multiselect', source: 'STOK_OZEL_KOD_3', group: 'Özel Kodlar' },
    { name: 'StokOzelKod4', label: 'Özel Kod 4', type: 'multiselect', source: 'STOK_OZEL_KOD_4', group: 'Özel Kodlar' },
    { name: 'StokOzelKod5', label: 'Özel Kod 5', type: 'multiselect', source: 'STOK_OZEL_KOD_5', group: 'Özel Kodlar' },
    { name: 'StokOzelKod6', label: 'Özel Kod 6', type: 'multiselect', source: 'STOK_OZEL_KOD_6', group: 'Özel Kodlar' },
    { name: 'StokOzelKod7', label: 'Özel Kod 7', type: 'multiselect', source: 'STOK_OZEL_KOD_7', group: 'Özel Kodlar' },
    { name: 'StokOzelKod8', label: 'Özel Kod 8', type: 'multiselect', source: 'STOK_OZEL_KOD_8', group: 'Özel Kodlar' },
    { name: 'StokOzelKod9', label: 'Özel Kod 9', type: 'multiselect', source: 'STOK_OZEL_KOD_9', group: 'Özel Kodlar' },
  ],
};

const OTHER_REPORTS: ReportDef[] = [
  SATIS_ADET_KAR,
  // === STOK ENVANTER — Envanter Raporu ===
  {
    key: 'stok_envanter',
    title: 'Stok Envanter',
    icon: 'cube-outline',
    description: 'Anlık stok miktar, maliyet ve değer raporu',
    datasetKey: 'rap_stok_envanter_web',
    defaultParams: {
      SONTARIH: today(),
      Lokasyon: '', Durum: 0, FiyatId: 0, Aktif: '',
      Tedarikci: '', KdvDahil: 1, LokasyonDagilim: 0,
      Page: 1, PageSize: 500,
      ...STOK_FILTER_DEFAULTS,
    },
    requireNarrowing: false,
    requiredFilters: ['Lokasyon'],
    summary: {
      cols: [
        { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
        { key: 'FIFO___TUTAR', label: 'FIFO Tutar', type: 'money' },
        { key: 'AGIRLIKLI_ORTALAMA___TUTAR', label: 'Ağ. Ort. Tutar', type: 'money' },
        { key: 'SON_ALIS_TUTAR', label: 'Toplam Alış', type: 'money' },
        { key: 'SATIS_TUTARI___YEREL', label: 'Toplam Satış', type: 'money' },
      ],
      // No POS-provided totals for this dataset — compute from rows
    },
    cardLayout: {
      title: 'AD',
      code: 'KOD',
      amount: 'SATIS_TUTARI___YEREL',
      amountType: 'money',
      amountLabel: 'Satış Değeri',
      chips: [
        { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
        { key: 'STOK_BIRIM' },
        { key: 'LOKASYON' },
      ],
      meta: [
        { key: 'SATIS_FIYATI', label: 'Satış Fiyatı', type: 'money' },
        { key: 'SON_ALIS_FIYATI', label: 'Son Alış Fiyatı', type: 'money' },
        { key: 'SON_ALIS_TUTAR', label: 'Son Alış Tutar', type: 'money' },
        { key: 'FIFO___FIYAT', label: 'FIFO Fiyat', type: 'money' },
        { key: 'FIFO___TUTAR', label: 'FIFO Tutar', type: 'money' },
        { key: 'AGIRLIKLI_ORTALAMA___FIYAT', label: 'Ağ. Ort. Fiyat', type: 'money' },
        { key: 'AGIRLIKLI_ORTALAMA___TUTAR', label: 'Ağ. Ort. Tutar', type: 'money' },
      ],
    },
    columns: [
      { key: 'KOD', label: 'Kod' },
      { key: 'AD', label: 'Ürün' },
      { key: 'LOKASYON', label: 'Lokasyon' },
      { key: 'MEVCUT', label: 'Mevcut', type: 'number' },
      { key: 'STOK_BIRIM', label: 'Birim' },
      { key: 'FIFO___FIYAT', label: 'FIFO Fiyat', type: 'money' },
      { key: 'FIFO___TUTAR', label: 'FIFO Tutar', type: 'money' },
      { key: 'AGIRLIKLI_ORTALAMA___FIYAT', label: 'Ağ.Ort. Fiyat', type: 'money' },
      { key: 'AGIRLIKLI_ORTALAMA___TUTAR', label: 'Ağ.Ort. Tutar', type: 'money' },
      { key: 'SON_ALIS_FIYATI', label: 'Son Alış Fiyatı', type: 'money' },
      { key: 'SON_ALIS_TUTAR', label: 'Son Alış Tutar', type: 'money' },
      { key: 'SATIS_FIYATI', label: 'Satış Fiyatı', type: 'money' },
      { key: 'SATIS_TUTARI___YEREL', label: 'Satış Tutarı', type: 'money' },
    ],
    filters: [
      { name: 'SONTARIH', label: 'Son Tarih', type: 'date', group: 'Tarih' },
      { name: 'Aktif', label: 'Aktif Durumu', type: 'select_static', group: 'Seçenekler',
        options: [
          { value: '', label: 'Tümü' },
          { value: 1, label: 'Sadece Aktif' },
          { value: 0, label: 'Sadece Pasif' },
        ] },
      { name: 'Durum', label: 'Stok Durumu', type: 'select_static', group: 'Seçenekler',
        options: [
          { value: 0, label: 'Tümü' },
          { value: 1, label: 'Stokta Olanlar (>0)' },
          { value: 2, label: 'Tükenmişler (=0)' },
          { value: 3, label: 'Eksi Stoklar (<0)' },
        ] },
      { name: 'KdvDahil', label: 'KDV Dahil Göster', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'KDV Dahil' }, { value: 0, label: 'KDV Hariç' }] },
      { name: 'LokasyonDagilim', label: 'Lokasyon Dağılımı', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 0, label: 'Toplu (Tüm Lokasyonlar)' }, { value: 1, label: 'Lokasyon Bazında' }] },
      { name: 'FiyatId', label: 'Fiyat Adı', type: 'multiselect', source: 'STOK_FIYAT_AD', group: 'Filtreler' },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtreler', required: true },
      { name: 'Tedarikci', label: 'Tedarikçi', type: 'multiselect', source: 'TEDARIKCI', group: 'Filtreler' },
      { name: 'Stoklar', label: 'Stok (Ürün)', type: 'multiselect', source: 'STOK', group: 'Filtreler' },
      { name: 'StokGrup', label: 'Stok Grup', type: 'multiselect', source: 'STOK_GRUP', group: 'Filtreler' },
      { name: 'StokCinsi', label: 'Stok Cinsi', type: 'multiselect', source: 'STOK_CINSI', group: 'Filtreler' },
      { name: 'StokMarka', label: 'Stok Marka', type: 'multiselect', source: 'STOK_MARKA', group: 'Filtreler' },
      { name: 'StokVergi', label: 'KDV (Vergi)', type: 'multiselect', source: 'STOK_VERGI', group: 'Filtreler' },
      { name: 'StokOzelKod1', label: 'Özel Kod 1', type: 'multiselect', source: 'STOK_OZEL_KOD_1', group: 'Özel Kodlar' },
      { name: 'StokOzelKod2', label: 'Özel Kod 2', type: 'multiselect', source: 'STOK_OZEL_KOD_2', group: 'Özel Kodlar' },
      { name: 'StokOzelKod3', label: 'Özel Kod 3', type: 'multiselect', source: 'STOK_OZEL_KOD_3', group: 'Özel Kodlar' },
      { name: 'StokOzelKod4', label: 'Özel Kod 4', type: 'multiselect', source: 'STOK_OZEL_KOD_4', group: 'Özel Kodlar' },
      { name: 'StokOzelKod5', label: 'Özel Kod 5', type: 'multiselect', source: 'STOK_OZEL_KOD_5', group: 'Özel Kodlar' },
      { name: 'StokOzelKod6', label: 'Özel Kod 6', type: 'multiselect', source: 'STOK_OZEL_KOD_6', group: 'Özel Kodlar' },
      { name: 'StokOzelKod7', label: 'Özel Kod 7', type: 'multiselect', source: 'STOK_OZEL_KOD_7', group: 'Özel Kodlar' },
      { name: 'StokOzelKod8', label: 'Özel Kod 8', type: 'multiselect', source: 'STOK_OZEL_KOD_8', group: 'Özel Kodlar' },
      { name: 'StokOzelKod9', label: 'Özel Kod 9', type: 'multiselect', source: 'STOK_OZEL_KOD_9', group: 'Özel Kodlar' },
    ],
  },
  {
    key: 'gelir_tablosu',
    title: 'Gelir Tablosu',
    icon: 'stats-chart-outline',
    description: 'Hiyerarşik gelir / gider / kâr zararı raporu',
    datasetKey: 'rap_lm_gelir_tablosu',
    defaultParams: {
      BASTARIH: firstOfMonth(),
      BITTARIH: today(),
      KdvDahil: 0,
      Lokasyon: '',
      SatisGrupGoster: 1,
      IadeGrupGoster: 1,
      MaliyetGrupGoster: 1,
    },
    requireNarrowing: false,
    requiredFilters: ['Lokasyon'],
    hierarchical: { labelKey: 'ACIKLAMA', valueKey: 'TUTAR', levelKey: 'SEVIYE' },
    columns: [
      { key: 'ACIKLAMA', label: 'Açıklama' },
      { key: 'TUTAR', label: 'Tutar', type: 'money' },
    ],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç Tarihi', type: 'date', group: 'Tarih Aralığı' },
      { name: 'BITTARIH', label: 'Bitiş Tarihi', type: 'date', group: 'Tarih Aralığı' },
      { name: 'KdvDahil', label: 'KDV', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'KDV Dahil' }, { value: 0, label: 'KDV Hariç' }] },
      { name: 'SatisGrupGoster', label: 'Satış Grupla', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'Gruplı Göster' }, { value: 0, label: 'Detaylı' }] },
      { name: 'IadeGrupGoster', label: 'İade Grupla', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'Gruplı Göster' }, { value: 0, label: 'Detaylı' }] },
      { name: 'MaliyetGrupGoster', label: 'Maliyet Grupla', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'Gruplı Göster' }, { value: 0, label: 'Detaylı' }] },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre', required: true },
    ],
  },
  // === PERSONEL SATIŞ ÖZET ===
  {
    key: 'personel_satis', title: 'Personel Satış Özet', icon: 'people-outline',
    description: 'Personel bazlı satış, fiş, kişi analizi',
    datasetKey: 'rap_personel_satis_ozet_web',
    defaultParams: {
      BASTARIH: firstOfMonth(), BITTARIH: today(),
      Personel: '', BelgePersoneli: 1, Lokasyon: '', Proje: '', Dovizler: '',
      KdvDahil: 1, FisTuru: '',
      Cariler: '', CariTur: '', CariGrup: '',
      CariOzelKod1: '', CariOzelKod2: '', CariOzelKod3: '', CariOzelKod4: '', CariOzelKod5: '',
      Page: 1, PageSize: 500,
      ...STOK_FILTER_DEFAULTS,
    },
    requireNarrowing: false, requiredFilters: [],
    summary: {
      cols: [
        { key: 'MIKTAR_NET', label: 'Miktar Net', type: 'number' },
        { key: 'TUTAR_NET', label: 'Tutar Net', type: 'money' },
        { key: 'ISKONTO_TUTAR', label: 'İskonto', type: 'money' },
        { key: 'FIS_ADET', label: 'Fiş', type: 'number' },
        { key: 'KISI', label: 'Kişi', type: 'number' },
        { key: 'NOKTA', label: 'Nokta', type: 'number' },
      ],
      totalsFromRow: {
        MIKTAR_NET: 'TOPLAM_MIKTAR_NET', TUTAR_NET: 'TOPLAM_TUTAR_NET',
        ISKONTO_TUTAR: 'TOPLAM_ISKONTO_TUTAR', FIS_ADET: 'TOPLAM_FIS_ADET',
        KISI: 'TOPLAM_KISI', NOKTA: 'TOPLAM_NOKTA',
      },
      showOnlyTotal: true,
    },
    cardLayout: {
      title: 'AD', code: 'KOD',
      amount: 'TUTAR_NET', amountType: 'money', amountLabel: 'Net Satış',
      chips: [
        { key: 'FIS_ADET', label: 'Fiş', type: 'number' },
        { key: 'KISI', label: 'Kişi', type: 'number' },
        { key: 'ORAN', label: '%', type: 'number' },
      ],
      meta: [
        { key: 'MIKTAR_NET', label: 'Miktar', type: 'number' },
        { key: 'TUTAR_GIRIS', label: 'Giriş', type: 'money' },
        { key: 'TUTAR_CIKIS', label: 'Çıkış', type: 'money' },
        { key: 'ISKONTO_TUTAR', label: 'İskonto', type: 'money' },
        { key: 'NOKTA', label: 'Nokta', type: 'number' },
      ],
    },
    columns: [
      { key: 'KOD', label: 'Kod' }, { key: 'AD', label: 'Personel' },
      { key: 'MIKTAR_CIKIS', label: 'Miktar Çıkış', type: 'number' },
      { key: 'MIKTAR_GIRIS', label: 'Miktar Giriş', type: 'number' },
      { key: 'MIKTAR_BEDELSIZ', label: 'Bedelsiz', type: 'number' },
      { key: 'MIKTAR_NET', label: 'Miktar Net', type: 'number' },
      { key: 'TUTAR_CIKIS', label: 'Tutar Çıkış', type: 'money' },
      { key: 'TUTAR_GIRIS', label: 'Tutar Giriş', type: 'money' },
      { key: 'ISKONTO_TUTAR', label: 'İskonto', type: 'money' },
      { key: 'TUTAR_NET', label: 'Tutar Net', type: 'money' },
      { key: 'NOKTA', label: 'Nokta', type: 'number' },
      { key: 'FIS_ADET', label: 'Fiş Adet', type: 'number' },
      { key: 'KISI', label: 'Kişi', type: 'number' },
      { key: 'ORAN', label: 'Oran %', type: 'number' },
    ],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç Tarihi', type: 'date', group: 'Tarih' },
      { name: 'BITTARIH', label: 'Bitiş Tarihi', type: 'date', group: 'Tarih' },
      { name: 'KdvDahil', label: 'KDV', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'KDV Dahil' }, { value: 0, label: 'KDV Hariç' }] },
      { name: 'BelgePersoneli', label: 'Belge Personeli', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 1, label: 'Evet' }, { value: 0, label: 'Hayır' }] },
      { name: 'Personel', label: 'Personel', type: 'multiselect', source: 'PERSONEL', group: 'Filtre' },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' },
      { name: 'Proje', label: 'Proje', type: 'multiselect', source: 'PROJE', group: 'Filtre' },
      { name: 'FisTuru', label: 'Fiş Türü', type: 'multiselect', source: 'FIS_TURU', group: 'Filtre' },
      { name: 'Dovizler', label: 'Döviz', type: 'multiselect', source: 'DOVIZ_AD', group: 'Filtre' },
      { name: 'Cariler', label: 'Cari', type: 'multiselect', source: 'CARI', group: 'Cari' },
      { name: 'CariTur', label: 'Cari Tür', type: 'multiselect', source: 'CARI_TUR', group: 'Cari' },
      { name: 'CariGrup', label: 'Cari Grup', type: 'multiselect', source: 'CARI_GRUP', group: 'Cari' },
      ...STOK_FILTERS_UI,
    ],
  },
  // === FIŞ KALEM LISTESI ===
  {
    key: 'fis_kalem', title: 'Fiş Kalem Listesi', icon: 'receipt-outline',
    description: 'Detaylı fiş satır bazlı kalem listesi',
    datasetKey: 'rap_fis_kalem_listesi_web',
    defaultParams: {
      BASTARIH: firstOfMonth(), BITTARIH: today(),
      FisTuru: '', FisAltTuru: '', Lokasyon: '', Proje: '', BelgeNo: '',
      Personel: '', Cariler: '', CariTur: '', CariGrup: '', Adresler: '', Temsilci: '',
      CariOzelKod1: '', CariOzelKod2: '', CariOzelKod3: '', CariOzelKod4: '', CariOzelKod5: '',
      FisOzelKod1: '', FisOzelKod2: '', FisOzelKod3: '', FisOzelKod4: '', FisOzelKod5: '',
      Detayli: 0, Page: 1, PageSize: 500,
      ...STOK_FILTER_DEFAULTS,
    },
    requireNarrowing: false, requiredFilters: [],
    summary: {
      cols: [
        { key: 'MIKTAR_FIS', label: 'Miktar', type: 'number' },
        { key: 'NET_TUTAR', label: 'Net Tutar', type: 'money' },
        { key: 'KDV_TUTAR', label: 'KDV', type: 'money' },
        { key: 'DAHIL_NET_TUTAR', label: 'Dahil Net', type: 'money' },
        { key: 'SATIR_GENEL_TOPLAM', label: 'Genel Toplam', type: 'money' },
      ],
      totalsFromRow: {
        MIKTAR_FIS: 'TOPLAM_MIKTAR', NET_TUTAR: 'TOPLAM_NET_TUTAR',
        KDV_TUTAR: 'TOPLAM_KDV', DAHIL_NET_TUTAR: 'TOPLAM_DAHIL_NET_TUTAR',
      },
      showOnlyTotal: true,
    },
    cardLayout: {
      title: 'STOK_AD', code: 'BELGENO',
      amount: 'SATIR_GENEL_TOPLAM', amountType: 'money', amountLabel: 'Satır Toplam',
      chips: [
        { key: 'MIKTAR_FIS', label: 'Miktar', type: 'number' },
        { key: 'STOK_BIRIM' },
        { key: 'FIS_TURU' },
      ],
      meta: [
        { key: 'FIS_TARIHI', label: 'Tarih' },
        { key: 'LOKASYON', label: 'Lokasyon' },
        { key: 'CARI_AD', label: 'Cari' },
        { key: 'NET_FIYAT', label: 'Birim Fiyat', type: 'money' },
        { key: 'NET_TUTAR', label: 'Net Tutar', type: 'money' },
        { key: 'KDV_TUTAR', label: 'KDV', type: 'money' },
        { key: 'STOK_KOD', label: 'Stok Kodu' },
      ],
    },
    columns: [
      { key: 'FIS_TARIHI', label: 'Tarih' }, { key: 'BELGENO', label: 'Belge No' },
      { key: 'FIS_TURU', label: 'Fiş Türü' }, { key: 'FIS_ALT_TIPI', label: 'Alt Tür' },
      { key: 'LOKASYON', label: 'Lokasyon' }, { key: 'CARI_KOD', label: 'Cari Kod' },
      { key: 'CARI_AD', label: 'Cari' }, { key: 'STOK_KOD', label: 'Stok Kod' },
      { key: 'STOK_AD', label: 'Stok' }, { key: 'STOK_BIRIM', label: 'Birim' },
      { key: 'MIKTAR_FIS', label: 'Miktar', type: 'number' },
      { key: 'NET_FIYAT', label: 'Net Fiyat', type: 'money' },
      { key: 'NET_TUTAR', label: 'Net Tutar', type: 'money' },
      { key: 'KDV_TUTAR', label: 'KDV', type: 'money' },
      { key: 'DAHIL_NET_TUTAR', label: 'Dahil Net', type: 'money' },
      { key: 'SATIR_GENEL_TOPLAM', label: 'Satır Toplam', type: 'money' },
    ],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç Tarihi', type: 'date', group: 'Tarih' },
      { name: 'BITTARIH', label: 'Bitiş Tarihi', type: 'date', group: 'Tarih' },
      { name: 'BelgeNo', label: 'Belge No', type: 'text', group: 'Seçenekler', placeholder: 'Belge no...' },
      { name: 'Detayli', label: 'Detaylı', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 0, label: 'Özet' }, { value: 1, label: 'Detaylı' }] },
      { name: 'FisTuru', label: 'Fiş Türü', type: 'multiselect', source: 'FIS_TURU', group: 'Filtre' },
      { name: 'FisAltTuru', label: 'Fiş Alt Tür', type: 'multiselect', source: 'FIS_ALT_TIPI', group: 'Filtre' },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' },
      { name: 'Proje', label: 'Proje', type: 'multiselect', source: 'PROJE', group: 'Filtre' },
      { name: 'Personel', label: 'Personel', type: 'multiselect', source: 'PERSONEL', group: 'Filtre' },
      { name: 'Cariler', label: 'Cari', type: 'multiselect', source: 'CARI', group: 'Cari' },
      { name: 'CariTur', label: 'Cari Tür', type: 'multiselect', source: 'CARI_TUR', group: 'Cari' },
      { name: 'CariGrup', label: 'Cari Grup', type: 'multiselect', source: 'CARI_GRUP', group: 'Cari' },
      ...STOK_FILTERS_UI,
    ],
  },
  // === CARI HESAP EKSTRESI ===
  {
    key: 'cari_ekstre', title: 'Cari Hesap Ekstresi', icon: 'wallet-outline',
    description: 'Cari bazlı borç / alacak / bakiye hareketleri',
    datasetKey: 'rap_cari_hesap_ekstresi_web',
    defaultParams: {
      BASTARIH: firstOfYear(), BITTARIH: `${today()} 23:59:59`,
      BakiyeTip: 0, Proje: '', Lokasyon: '', AktifDurum: '',
      Cariler: '', CariKodu: '', CariAdi: '',
      CariTur: '', CariGrup: '', Temsilci: '', Sehir: '', CariRut: '',
      CariOzelKod1: '', CariOzelKod2: '', CariOzelKod3: '', CariOzelKod4: '', CariOzelKod5: '',
      Detayli: 0, BakiyeVermeyenHareketsizDevirlerGelmesin: 0,
      MinBakiye: -99999999, MaxBakiye: 99999999,
      Page: 1, PageSize: 500,
    },
    requireNarrowing: false, requiredFilters: [],
    summary: {
      cols: [
        { key: 'BORC', label: 'Borç', type: 'money' },
        { key: 'ALACAK', label: 'Alacak', type: 'money' },
        { key: 'BAKIYE', label: 'Bakiye', type: 'money' },
      ],
      totalsFromRow: {
        BORC: 'TOPLAM_BORC', ALACAK: 'TOPLAM_ALACAK',
      },
      totalsComputed: {
        BAKIYE: { op: 'sub', a: 'TOPLAM_BORC', b: 'TOPLAM_ALACAK' },
      },
      showOnlyTotal: true,
    },
    cardLayout: {
      title: 'FINANS_ISLEM_TURU', code: 'BELGENO',
      amount: 'RP_BAKIYE', amountType: 'money', amountLabel: 'Bakiye',
      amountCurrency: 'DOVIZ_AD',
      chips: [
        { key: 'TARIH', label: 'Tarih' },
        { key: 'BA', label: 'B/A' },
        { key: 'CARI_TUR' },
      ],
      meta: [
        { key: 'AD', label: 'Cari' },
        { key: 'KOD', label: 'Cari Kod' },
        { key: 'BORC', label: 'Borç', type: 'money' },
        { key: 'ALACAK', label: 'Alacak', type: 'money' },
        { key: 'VADE_TARIHI', label: 'Vade Tarihi' },
        { key: 'LOKASYON', label: 'Lokasyon' },
        { key: 'ACIK_FATURA', label: 'Açık Fat.', type: 'money' },
      ],
    },
    columns: [
      { key: 'KOD', label: 'Cari Kod' }, { key: 'AD', label: 'Cari Adı' },
      { key: 'CARI_TUR', label: 'Cari Tür' }, { key: 'CARI_GRUP', label: 'Cari Grup' },
      { key: 'DOVIZ_AD', label: 'Döviz' }, { key: 'TARIH', label: 'Tarih' },
      { key: 'FINANS_ISLEM_TURU', label: 'İşlem' }, { key: 'BELGENO', label: 'Belge No' },
      { key: 'BORC', label: 'Borç', type: 'money' },
      { key: 'ALACAK', label: 'Alacak', type: 'money' },
      { key: 'RP_BAKIYE', label: 'Bakiye', type: 'money' },
      { key: 'RP_YEREL_BAKIYE', label: 'Yerel Bakiye', type: 'money' },
      { key: 'ACIK_FATURA', label: 'Açık Fatura', type: 'money' },
      { key: 'ACIK_FIS', label: 'Açık Fiş', type: 'money' },
      { key: 'ACIK_DIGER', label: 'Açık Diğer', type: 'money' },
      { key: 'LOKASYON', label: 'Lokasyon' },
      { key: 'BA', label: 'B/A' },
    ],
    filters: [
      { name: 'BASTARIH', label: 'Başlangıç Tarihi', type: 'date', group: 'Tarih' },
      { name: 'BITTARIH', label: 'Bitiş Tarihi', type: 'date', group: 'Tarih' },
      { name: 'BakiyeTip', label: 'Bakiye Tipi', type: 'select_static', group: 'Seçenekler',
        options: [
          { value: 0, label: 'Tümü' },
          { value: 1, label: 'Borçlu' },
          { value: 2, label: 'Alacaklı' },
          { value: 3, label: 'Sıfır Bakiyeliler' },
        ] },
      { name: 'AktifDurum', label: 'Aktif Durum', type: 'select_static', group: 'Seçenekler',
        options: [{ value: '', label: 'Tümü' }, { value: 1, label: 'Aktif' }, { value: 0, label: 'Pasif' }] },
      { name: 'Detayli', label: 'Detaylı', type: 'select_static', group: 'Seçenekler',
        options: [{ value: 0, label: 'Özet (Bakiye)' }, { value: 1, label: 'Detaylı (Hareketler)' }] },
      { name: 'CariKodu', label: 'Cari Kodu', type: 'text', group: 'Cari', placeholder: 'Cari kodu...' },
      { name: 'CariAdi', label: 'Cari Adı', type: 'text', group: 'Cari', placeholder: 'Cari adı...' },
      { name: 'MinBakiye', label: 'Min Bakiye', type: 'text', group: 'Bakiye', placeholder: '-99999999', numeric: true },
      { name: 'MaxBakiye', label: 'Max Bakiye', type: 'text', group: 'Bakiye', placeholder: '99999999', numeric: true },
      { name: 'Cariler', label: 'Cari', type: 'multiselect', source: 'CARI', group: 'Cari' },
      { name: 'CariTur', label: 'Cari Tür', type: 'multiselect', source: 'CARI_TUR', group: 'Cari' },
      { name: 'CariGrup', label: 'Cari Grup', type: 'multiselect', source: 'CARI_GRUP', group: 'Cari' },
      { name: 'Lokasyon', label: 'Lokasyon', type: 'multiselect', source: 'LOKASYON', group: 'Filtre' },
      { name: 'Proje', label: 'Proje', type: 'multiselect', source: 'PROJE', group: 'Filtre' },
      { name: 'Temsilci', label: 'Temsilci', type: 'multiselect', source: 'TEMSILCI', group: 'Filtre' },
      { name: 'Sehir', label: 'Şehir', type: 'multiselect', source: 'SEHIR', group: 'Filtre' },
    ],
  },
];

const ALL_REPORTS = [FIYAT_LISTELERI, ...OTHER_REPORTS];

// === COMPONENT ===
export default function ReportsScreen() {
  const { colors } = useThemeStore();
  const { t, language } = useLanguageStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  // i18n helpers for report titles / descriptions / filter groups
  const getReportTitle = (report: any) => {
    const key = `report_${report.key}` as any;
    const tr = t(key);
    return tr !== key ? tr : report.title;
  };
  const getReportDesc = (report: any) => {
    const key = `report_${report.key}_desc` as any;
    const tr = t(key);
    return tr !== key ? tr : report.description;
  };
  // Large dictionary for translating filter/column labels stored as TR strings
  // in report definitions. Applied only when language is EN.
  const LABEL_MAP: Record<string, string> = {
      'Cari': 'Customer',
      'Cari Adı': 'Customer Name',
      'Cari Kodu': 'Customer Code',
      'Cari Grubu': 'Customer Group',
      'Cari Grup': 'Customer Group',
      'Cari Tür': 'Customer Type',
      'Cari Türü': 'Customer Type',
      'Cari (Ad veya Kod)': 'Customer (Name or Code)',
      'Cariler': 'Customers',
      'Temsilci': 'Representative',
      'Sehir': 'City',
      'Şehir': 'City',
      'Cari Rut': 'Customer Route',
      'CariRut': 'Customer Route',
      'Aktif': 'Active',
      'Pasif': 'Passive',
      'Aktif Durum': 'Active Status',
      'Aktif Durumu': 'Active Status',
      'Tümü': 'All',
      'Stok': 'Stock',
      'Stok Kodu': 'Stock Code',
      'Stok Adı': 'Stock Name',
      'Stok (Ürün)': 'Stock (Product)',
      'Stok Grup': 'Stock Group',
      'Stok Grubu': 'Stock Group',
      'Stok Cinsi': 'Stock Type',
      'Stok Marka': 'Stock Brand',
      'Stok Vergi': 'Stock Tax',
      'Stok Durumu': 'Stock Status',
      'Stoklar': 'Stocks',
      'Birim': 'Unit',
      'Marka': 'Brand',
      'Grup': 'Group',
      'Cinsi': 'Type',
      'Fiyat': 'Price',
      'Fiyat Adı': 'Price Name',
      'Yerel Fiyat': 'Local Price',
      'Döviz': 'Currency',
      'Döviz Adı': 'Currency Name',
      'DovizAd': 'Currency Name',
      'KDV': 'VAT',
      'KDV Dahil': 'VAT Included',
      'KDV Dahil Göster': 'Show VAT Included',
      'KDV (Vergi)': 'VAT (Tax)',
      'KDV Oranı': 'VAT Rate',
      'Tarih': 'Date',
      'Tarih Aralığı': 'Date Range',
      'Başlangıç': 'Start',
      'Bitiş': 'End',
      'Başlangıç Tarihi': 'Start Date',
      'Bitiş Tarihi': 'End Date',
      'Son Tarih': 'End Date',
      'Bugün': 'Today',
      'Dün': 'Yesterday',
      'Lokasyon': 'Location',
      'Lokasyon Dağılımı': 'Location Distribution',
      'Proje': 'Project',
      'Fiş': 'Receipt',
      'Fiş Tipi': 'Receipt Type',
      'Fiş Türü': 'Receipt Type',
      'Fiş Alt Türü': 'Receipt Sub-type',
      'Fiş No': 'Receipt No',
      'Belge No': 'Document No',
      'Personel': 'Staff',
      'Bilgisayar Adı (Pc_Ad)': 'Computer Name (Pc_Ad)',
      'Bilgisayar': 'Computer',
      'Özel Kod 1': 'Special Code 1',
      'Özel Kod 2': 'Special Code 2',
      'Özel Kod 3': 'Special Code 3',
      'Özel Kod 4': 'Special Code 4',
      'Özel Kod 5': 'Special Code 5',
      'Özel Kod 6': 'Special Code 6',
      'Özel Kod 7': 'Special Code 7',
      'Özel Kod 8': 'Special Code 8',
      'Özel Kod 9': 'Special Code 9',
      'Adres': 'Address',
      'Adresler': 'Addresses',
      'Bakiye': 'Balance',
      'Bakiye Tip': 'Balance Type',
      'Borç': 'Debt',
      'Alacak': 'Credit',
      'Borçlu': 'Debtor',
      'Alacaklı': 'Creditor',
      'Min Bakiye': 'Min Balance',
      'Max Bakiye': 'Max Balance',
      'Miktar': 'Quantity',
      'Adet': 'Qty',
      'Tutar': 'Amount',
      'Toplam': 'Total',
      'Ad': 'Name',
      'Kod': 'Code',
      'Satış': 'Sales',
      'Satış Fişleri': 'Sales Receipts',
      'Sadece Satış Fişleri': 'Sales Receipts Only',
      'Sadece İadeler': 'Returns Only',
      'İade': 'Return',
      'İadeler': 'Returns',
      'Hepsi': 'All',
      'Detaylı': 'Detailed',
      'Özet': 'Summary',
      'Son Alış': 'Last Purchase',
      'Son Alış Fiyatı': 'Last Purchase Price',
      'Birim Satış': 'Unit Sale',
      'Maliyet': 'Cost',
      'Maliyet Kaynak': 'Cost Source',
      'Maliyet Yoksa': 'If No Cost',
      'Kâr': 'Profit',
      'Kar': 'Profit',
      'Kar/Zarar': 'Profit/Loss',
      'Karlı': 'Profitable',
      'Zararlı': 'Unprofitable',
      'Finans': 'Finance',
      'Ürün Adı': 'Product Name',
      'Ürün': 'Product',
      'Açıklama': 'Description',
      'Durum': 'Status',
      'Sarf/Fire': 'Consumption/Waste',
      'Sarf Fire': 'Consumption/Waste',
      'Toplu (Tüm Lokasyonlar)': 'Combined (All Locations)',
      'Lokasyon Bazında': 'Per Location',
      'Adet Çıkış': 'Qty Out',
      'Miktar Çıkış': 'Qty Out',
      'Tutar Çıkış': 'Amount Out',
      'Adet Giriş': 'Qty In',
      'Miktar Giriş': 'Qty In',
      'Tutar Giriş': 'Amount In',
      'Net Adet': 'Net Qty',
      'Net Tutar': 'Net Amount',
      'Rut': 'Route',
      'Çıkış': 'Out',
      'Giriş': 'In',
      'Satış Adet': 'Sales Qty',
      'Satış Tutar': 'Sales Amount',
      'İskonto': 'Discount',
      'İskonto Oranı': 'Discount Rate',
      'Vergi': 'Tax',
      'Net': 'Net',
      'Brüt': 'Gross',
      'Fiş Kalem Detaylı': 'Detailed Receipt Items',
      'Detaylı Göster': 'Show Detailed',
      'Bakiye Vermeyen Hareketsiz Devirler Gelmesin': 'Exclude Zero-Balance Inactive Transfers',
    };
  const translateLabel = (label: string | undefined | null): string => {
    if (!label) return label || '';
    if (language !== 'en') return label;
    return LABEL_MAP[label] || label;
  };

    const getGroupLabel = (group: string) => {
    const map: Record<string, any> = {
      'Temel': 'filter_group_temel',
      'Stok': 'filter_group_stok',
      'Filtreler': 'filter_group_filtreler',
      'Seçenekler': 'filter_group_secenekler',
      'Tarih': 'filter_group_tarih',
      'Tarih Aralığı': 'filter_group_tarih_araligi',
      'Özel Kodlar': 'filter_group_ozel_kodlar',
      'Cari': 'filter_group_cari',
      'Finans': 'filter_group_finans',
      'Bakiye': 'filter_group_bakiye',
    };
    const key = map[group];
    return key ? t(key) : group;
  };


  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const idx = match ? parseInt(match[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  // State
  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<FilterDef | null>(null);
  const [pickerOptions, setPickerOptions] = useState<{ value: string; label: string }[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const [filterValues, setFilterValues] = useState<Record<string, any>>({});
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [loadedPages, setLoadedPages] = useState(0);
  const [sortKey, setSortKey] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [datePickerFor, setDatePickerFor] = useState<string | null>(null); // filter name currently using picker
  const runTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Result cache: key = `${reportKey}|${JSON.stringify(filterValues)}` -> { data, loadedPages }
  const resultCacheRef = useRef<Map<string, { data: any[]; pages: number }>>(new Map());

  // Cancel in-flight requests when component unmounts or tab changes
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch(_) {}
      }
      runTokenRef.current++; // invalidate any pending runs
    };
  }, []);

  // Debounce search input (300ms) so we don't filter on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchFilter.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [searchFilter]);

  // Lookup cache
  const [lookupCache, setLookupCache] = useState<Record<string, { value: string; label: string }[]>>({});

  const getDefDates = () => {
    const now = new Date();
    const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0'); const d = String(now.getDate()).padStart(2, '0');
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${d}` };
  };

  // Open filter modal for a report
  const openReportFilter = (report: ReportDef) => {
    const dd = getDefDates();
    const vals: Record<string, any> = {};
    report.filters.forEach(f => {
      if (f.type === 'date') {
        vals[f.name] = report.defaultParams[f.name] || (f.name.includes('BAS') ? dd.start : dd.end);
      } else if (f.type === 'select_static') {
        vals[f.name] = report.defaultParams[f.name] ?? '';
      } else if (f.type === 'text') {
        vals[f.name] = report.defaultParams[f.name] ?? '';
      } else {
        vals[f.name] = ''; // multiselect empty
      }
    });
    setFilterValues(vals);
    setSelectedReport(report);
    setShowFilterModal(true);
    setReportData([]); setSortKey(''); setSearchFilter('');
  };

  // Open picker for multiselect filter (on-demand load)
  const openPicker = useCallback(async (filter: FilterDef) => {
    setPickerFilter(filter);
    setPickerSearch('');
    setShowPickerModal(true);

    if (filter.source && lookupCache[filter.source]) {
      setPickerOptions(lookupCache[filter.source]);
      return;
    }
    if (!filter.source || !activeTenantId) return;

    setPickerLoading(true);
    setPickerOptions([]);
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/report-filter-options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, source: filter.source }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        const opts = data.data.map((r: any) => ({
          value: String(r.ID ?? r.AD ?? r.KOD ?? ''),
          label: String(r.AD || r.KOD || r.ID || ''),
        }));
        setPickerOptions(opts);
        setLookupCache(prev => ({ ...prev, [filter.source!]: opts }));
      }
    } catch (err) { console.error('Lookup error:', err); }
    finally { setPickerLoading(false); }
  }, [activeTenantId, lookupCache]);

  // Toggle selection in multiselect
  const togglePickerValue = (val: string) => {
    if (!pickerFilter) return;
    const current = filterValues[pickerFilter.name] || '';
    const arr = current ? current.split(',') : [];
    const idx = arr.indexOf(val);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(val);
    setFilterValues(prev => ({ ...prev, [pickerFilter.name]: arr.join(',') }));
  };

  const isPickerSelected = (val: string) => {
    if (!pickerFilter) return false;
    const current = filterValues[pickerFilter.name] || '';
    return current.split(',').includes(val);
  };

  // Run report
  const runReport = useCallback(async () => {
    if (!activeTenantId || !selectedReport) return;

    // Check required filters (explicit required filter list takes priority)
    if (selectedReport.requiredFilters && selectedReport.requiredFilters.length > 0) {
      for (const reqName of selectedReport.requiredFilters) {
        const val = filterValues[reqName];
        if (val === undefined || val === null || val === '') {
          const filt = selectedReport.filters.find(f => f.name === reqName);
          Alert.alert('Zorunlu Filtre', `"${filt?.label || reqName}" seçimi zorunludur.`);
          return;
        }
      }
    } else if (selectedReport.requireNarrowing) {
      const hasNarrow = selectedReport.filters.some(f =>
        f.type === 'multiselect' && filterValues[f.name] && filterValues[f.name].length > 0
      );
      if (!hasNarrow) {
        Alert.alert('Filtre Gerekli', 'En az bir daraltıcı filtre seçin');
        return;
      }
    }

    setShowFilterModal(false); setShowResultModal(true);

    // Build cache key from report key + filter values
    const baseParams: Record<string, any> = { ...selectedReport.defaultParams };
    Object.entries(filterValues).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        // Convert numeric filters (MinBakiye, MaxBakiye, etc.) to number
        const filterDef = selectedReport.filters.find(f => f.name === k);
        if (filterDef?.numeric && typeof v === 'string') {
          const n = parseFloat(v);
          if (!Number.isNaN(n)) baseParams[k] = n;
          // If NaN, skip — keep the default (don't pass invalid number as string)
        } else {
          baseParams[k] = v;
        }
      }
    });
    const pageSize = Number(baseParams.PageSize || 500);
    const cacheKey = `${selectedReport.key}|${JSON.stringify(filterValues)}`;

    // Cancel any previous in-flight request + invalidate its run token
    if (abortRef.current) { try { abortRef.current.abort(); } catch(_){} }
    const controller = new AbortController();
    abortRef.current = controller;
    const token_id = ++runTokenRef.current;

    // Check cache — if same filters used before, restore instantly
    const cached = resultCacheRef.current.get(cacheKey);
    if (cached && cached.data.length > 0) {
      setReportData(cached.data);
      setLoadedPages(cached.pages);
      setReportLoading(false);
      setMoreLoading(false);
      return;
    }

    setReportLoading(true); setReportData([]); setLoadedPages(0); setMoreLoading(false);

    // Precompute searchable text on each row ONCE so filter is O(1) per row later
    const indexRow = (row: any) => {
      const parts: string[] = [];
      for (const k in row) {
        const v = row[k];
        if (v !== null && v !== undefined && typeof v !== 'object') parts.push(String(v));
      }
      row.__search = parts.join(' ').toLowerCase();
      return row;
    };

    try {
      const { token } = useAuthStore.getState();
      // Fetch page 1 first (fast response to user)
      const firstResp = await fetch(`${API_URL}/api/data/report-run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, dataset_key: selectedReport.datasetKey, params: { ...baseParams, Page: 1, PageSize: pageSize }, fetch_all: false }),
        signal: controller.signal,
      });
      const first = await firstResp.json();
      if (runTokenRef.current !== token_id || controller.signal.aborted) return; // aborted
      if (!first.ok) { Alert.alert('Hata', first.detail || 'Rapor çalıştırılamadı'); setReportLoading(false); return; }
      const firstRows = (first.data || []).map(indexRow);
      setReportData(firstRows);
      setLoadedPages(1);
      setReportLoading(false);

      // Drill-down / grouping helper — runs after both single-page AND multi-page fetches
      const postProcess = async (collectedRows: any[]): Promise<any[]> => {
        // Cari Ekstre Detayli=1: inject fis_kalem stock items as child rows
        if (
          selectedReport.key === 'cari_ekstre' &&
          (baseParams.Detayli === 1 || baseParams.Detayli === '1')
        ) {
          try {
            const fisParams = {
              BASTARIH: baseParams.BASTARIH || firstOfYear(),
              BITTARIH: String(baseParams.BITTARIH || today()).split(' ')[0],
              FisTuru: '', FisAltTuru: '', Lokasyon: baseParams.Lokasyon || '', Proje: baseParams.Proje || '', BelgeNo: '',
              Personel: '', Cariler: baseParams.Cariler || '', CariTur: baseParams.CariTur || '', CariGrup: baseParams.CariGrup || '',
              Adresler: '', Temsilci: '',
              CariOzelKod1: '', CariOzelKod2: '', CariOzelKod3: '', CariOzelKod4: '', CariOzelKod5: '',
              FisOzelKod1: '', FisOzelKod2: '', FisOzelKod3: '', FisOzelKod4: '', FisOzelKod5: '',
              Detayli: 1, Page: 1, PageSize: 500,
              ...STOK_FILTER_DEFAULTS,
            };
            const fisResp = await fetch(`${API_URL}/api/data/report-run`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ tenant_id: activeTenantId, dataset_key: 'rap_fis_kalem_listesi_web', params: fisParams, fetch_all: true }),
              signal: controller.signal,
            });
            const fis = await fisResp.json();
            if (runTokenRef.current !== token_id || controller.signal.aborted) return collectedRows;
            const fisRows: any[] = Array.isArray(fis?.data) ? fis.data : [];
            if (fisRows.length > 0) {
              const byBelge: Record<string, any[]> = {};
              for (const fr of fisRows) {
                const bn = String(fr.BELGENO || '').trim();
                if (!bn) continue;
                (byBelge[bn] = byBelge[bn] || []).push(fr);
              }
              const expanded: any[] = [];
              for (const row of collectedRows) {
                expanded.push(row);
                const bn = String(row.BELGENO || '').trim();
                if (bn && byBelge[bn]) {
                  for (const child of byBelge[bn]) {
                    expanded.push(indexRow({ ...child, __isDetail: true, __parentBelgeNo: bn }));
                  }
                }
              }
              if (expanded.length !== collectedRows.length) {
                return expanded;
              }
            }
          } catch (drillErr) {
            console.warn('Cari Ekstre drill-down failed:', drillErr);
          }
        }

        // Fiş Kalem Listesi: group line items by BELGENO → fiş header card
        // Detayli=0 → only headers; Detayli=1 → headers + line items
        if (selectedReport.key === 'fis_kalem') {
          const wantDetails = baseParams.Detayli === 1 || baseParams.Detayli === '1';
          const groups = new Map<string, { header: any; items: any[] }>();
          for (const row of collectedRows) {
            const bn = String(row.BELGENO || '').trim();
            if (!bn) continue;
            if (!groups.has(bn)) {
              groups.set(bn, {
                header: {
                  BELGENO: bn,
                  FIS_TARIHI: row.FIS_TARIHI,
                  FIS_TURU: row.FIS_TURU,
                  FIS_ALT_TIPI: row.FIS_ALT_TIPI,
                  LOKASYON: row.LOKASYON,
                  CARI_KOD: row.CARI_KOD,
                  CARI_AD: row.CARI_AD,
                  PROJE: row.PROJE,
                  NET_TUTAR: 0,
                  KDV_TUTAR: 0,
                  DAHIL_NET_TUTAR: 0,
                  SATIR_GENEL_TOPLAM: 0,
                  MIKTAR_FIS: 0,
                  KALEM_SAYISI: 0,
                  __isFisHeader: true,
                },
                items: [],
              });
            }
            const g = groups.get(bn)!;
            g.items.push(row);
            g.header.NET_TUTAR += parseFloat(String(row.NET_TUTAR || '0')) || 0;
            g.header.KDV_TUTAR += parseFloat(String(row.KDV_TUTAR || '0')) || 0;
            g.header.DAHIL_NET_TUTAR += parseFloat(String(row.DAHIL_NET_TUTAR || '0')) || 0;
            g.header.SATIR_GENEL_TOPLAM += parseFloat(String(row.SATIR_GENEL_TOPLAM || '0')) || 0;
            g.header.MIKTAR_FIS += parseFloat(String(row.MIKTAR_FIS || '0')) || 0;
            g.header.KALEM_SAYISI = g.items.length;
          }
          if (groups.size > 0) {
            const result: any[] = [];
            for (const [, g] of groups) {
              result.push(indexRow(g.header));
              if (wantDetails) {
                for (const item of g.items) {
                  result.push(indexRow({ ...item, __isDetail: true, __parentBelgeNo: g.header.BELGENO }));
                }
              }
            }
            return result;
          }
        }

        return collectedRows;
      };

      if (firstRows.length < pageSize) {
        const finalRows = await postProcess(firstRows);
        if (runTokenRef.current === token_id && !controller.signal.aborted) {
          setReportData(finalRows);
          resultCacheRef.current.set(cacheKey, { data: finalRows, pages: 1 });
        }
        return;
      }

      // Background: fetch remaining pages IN PARALLEL batches, append as each batch completes
      setMoreLoading(true);
      let page = 2;
      let collected = firstRows;
      const maxPages = 50;
      const batchSize = 4;
      let done = false;
      while (!done && page <= maxPages) {
        if (runTokenRef.current !== token_id || controller.signal.aborted) return;
        const pageNums = Array.from({ length: batchSize }, (_, i) => page + i).filter(p => p <= maxPages);
        const results = await Promise.all(pageNums.map(p =>
          fetch(`${API_URL}/api/data/report-run`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ tenant_id: activeTenantId, dataset_key: selectedReport.datasetKey, params: { ...baseParams, Page: p, PageSize: pageSize }, fetch_all: false }),
            signal: controller.signal,
          }).then(r => r.json()).catch(() => ({ ok: false, data: [] }))
        ));
        if (runTokenRef.current !== token_id || controller.signal.aborted) return;
        const batchRows: any[] = [];
        for (const r of results) {
          const rows = (r && r.ok && Array.isArray(r.data)) ? r.data.map(indexRow) : [];
          if (rows.length === 0) { done = true; break; }
          batchRows.push(...rows);
          if (rows.length < pageSize) { done = true; break; }
        }
        if (batchRows.length > 0) {
          collected = collected.concat(batchRows);
          setReportData(collected);
          setLoadedPages(page + pageNums.length - 1);
        }
        page += batchSize;
      }
      // Save to cache on successful complete
      if (runTokenRef.current === token_id && !controller.signal.aborted) {
        const finalRows = await postProcess(collected);
        if (finalRows !== collected) {
          setReportData(finalRows);
        }
        resultCacheRef.current.set(cacheKey, { data: finalRows, pages: page - 1 });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Silent abort
      } else {
        console.error(err);
        if (runTokenRef.current === token_id) Alert.alert('Hata', 'Bağlantı hatası');
      }
    } finally {
      if (runTokenRef.current === token_id) { setReportLoading(false); setMoreLoading(false); }
    }
  }, [activeTenantId, selectedReport, filterValues]);

  // Sort & search — deferred for smooth UI (heavy work happens in background)
  const deferredSearch = useDeferredValue(debouncedSearch);
  const deferredSortKey = useDeferredValue(sortKey);
  const deferredSortAsc = useDeferredValue(sortAsc);
  const isProcessing =
    (debouncedSearch !== deferredSearch) ||
    (sortKey !== deferredSortKey) ||
    (sortAsc !== deferredSortAsc) ||
    (searchFilter.trim().toLowerCase() !== debouncedSearch);

  const processedData = useMemo(() => {
    let d = reportData;
    if (deferredSearch) {
      d = d.filter((row: any) => (row.__search || '').includes(deferredSearch));
    }
    if (deferredSortKey) {
      // Preserve parent → child grouping when __isDetail rows exist.
      // Split into parent rows + their detail children, sort parents, then rebuild.
      const hasDetails = d.some((r: any) => r.__isDetail);
      if (hasDetails) {
        const groups: { parent: any; children: any[] }[] = [];
        let current: { parent: any; children: any[] } | null = null;
        for (const row of d) {
          if (row.__isDetail) {
            if (current) current.children.push(row);
          } else {
            current = { parent: row, children: [] };
            groups.push(current);
          }
        }
        groups.sort((ga, gb) => {
          const va = ga.parent[deferredSortKey]; const vb = gb.parent[deferredSortKey];
          const na = parseFloat(va); const nb = parseFloat(vb);
          if (!isNaN(na) && !isNaN(nb)) return deferredSortAsc ? na - nb : nb - na;
          return deferredSortAsc ? String(va || '').localeCompare(String(vb || ''), 'tr') : String(vb || '').localeCompare(String(va || ''), 'tr');
        });
        d = groups.flatMap(g => [g.parent, ...g.children]);
      } else {
        d = [...d].sort((a: any, b: any) => {
          const va = a[deferredSortKey]; const vb = b[deferredSortKey];
          const na = parseFloat(va); const nb = parseFloat(vb);
          if (!isNaN(na) && !isNaN(nb)) return deferredSortAsc ? na - nb : nb - na;
          return deferredSortAsc ? String(va || '').localeCompare(String(vb || ''), 'tr') : String(vb || '').localeCompare(String(va || ''), 'tr');
        });
      }
    }
    return d;
  }, [reportData, deferredSearch, deferredSortKey, deferredSortAsc]);

  const toggleSort = (key: string) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); } };

  const renderValue = (val: any, col: ColDef) => {
    if (col.type === 'money') return `₺${parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
    if (col.type === 'number') return parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    if (col.type === 'bool') return val === true || val === 1 || val === '1' ? 'Evet' : 'Hayır';
    return String(val || '-');
  };

  // PDF Export
  const exportPdf = async () => {
    if (!selectedReport || processedData.length === 0) return;
    setExportLoading(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const cols = selectedReport.columns;
    const fmtMoney = (n: number) => `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Top banner (Personel Satış / Fiş Kalem split / Cari Ekstre hint)
    const buildTopBannerHtml = (): string => {
      if (selectedReport.key === 'personel_satis') {
        const firstRow = processedData[0] || {};
        let toplam = parseFloat(String(firstRow.TOPLAM_TUTAR_NET ?? '0'));
        if (!(toplam > 0)) toplam = processedData.reduce((acc: number, r: any) => acc + (parseFloat(String(r.TUTAR_NET || '0')) || 0), 0);
        const fisAdet = parseFloat(String(firstRow.TOPLAM_FIS_ADET ?? processedData.reduce((a: number, r: any) => a + (parseFloat(String(r.FIS_ADET || 0)) || 0), 0)));
        return `<div style="padding:14px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px;margin-bottom:12px;display:flex;align-items:center;gap:12px"><div style="font-size:11px;font-weight:800;color:#16a34a;letter-spacing:0.5px">TOPLAM SATIŞ</div><div style="font-size:22px;font-weight:800">${fmtMoney(toplam)}</div><div style="font-size:11px;color:#666;margin-left:auto">${fisAdet.toLocaleString('tr-TR')} fiş · ${processedData.length} personel</div></div>`;
      }
      if (selectedReport.key === 'fis_kalem') {
        let satis = 0, alis = 0, satisAd = 0, alisAd = 0;
        for (const row of processedData as any[]) {
          if (row.__isDetail) continue;
          const tut = parseFloat(String(row.SATIR_GENEL_TOPLAM || row.DAHIL_NET_TUTAR || '0')) || 0;
          const ft = String(row.FIS_TURU || '').toLowerCase();
          if (ft.includes('alış') || ft.includes('alis')) { alis += tut; alisAd += 1; }
          else { satis += tut; satisAd += 1; }
        }
        return `<div style="display:flex;gap:10px;margin-bottom:12px"><div style="flex:1;padding:12px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px"><div style="font-size:10px;font-weight:800;color:#16a34a">SATIŞ TOPLAMI</div><div style="font-size:18px;font-weight:800">${fmtMoney(satis)}</div><div style="font-size:10px;color:#666">${satisAd} fiş/fatura</div></div><div style="flex:1;padding:12px;background:#fef2f2;border:2px solid #dc2626;border-radius:10px"><div style="font-size:10px;font-weight:800;color:#dc2626">ALIŞ TOPLAMI</div><div style="font-size:18px;font-weight:800">${fmtMoney(alis)}</div><div style="font-size:10px;color:#666">${alisAd} fiş/fatura</div></div></div>`;
      }
      if (selectedReport.key === 'cari_ekstre') {
        const det = filterValues?.Detayli;
        if (det === 1 || det === '1') {
          const detailCount = processedData.filter((r: any) => r.__isDetail).length;
          return `<div style="padding:10px;background:#eff6ff;border:1px solid #2563eb;border-radius:8px;margin-bottom:12px;color:#1e40af;font-size:12px">💡 Her fiş / faturanın altında <b>stok kalemleri</b> gösterilmektedir (${detailCount} stok kalemi)</div>`;
        }
      }
      return '';
    };

    // Build summary HTML (TOPLAM/MIN/MAX) if configured
    const buildSummaryHtml = (): string => {
      const s = selectedReport.summary;
      if (!s) return '';
      const firstRow = processedData[0] || {};
      const rows: Record<string, { total: number; min: number; max: number }> = {};
      for (const c of s.cols) {
        const vals = processedData.map((r: any) => parseFloat(String(r[c.key] ?? '0'))).filter(n => !isNaN(n));
        const totalKey = s.totalsFromRow?.[c.key];
        const computed = s.totalsComputed?.[c.key];
        let total: number;
        if (computed) {
          const a = parseFloat(String(firstRow[computed.a] ?? '0')) || 0;
          const b = parseFloat(String(firstRow[computed.b] ?? '0')) || 0;
          total = computed.op === 'sub' ? a - b : a + b;
        } else if (totalKey != null) {
          total = parseFloat(String(firstRow[totalKey] ?? '0')) || vals.reduce((a, b) => a + b, 0);
        } else {
          total = vals.reduce((a, b) => a + b, 0);
        }
        rows[c.key] = { total, min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0 };
      }
      const fmtS = (v: number, t?: string) => t === 'money' ? `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
      const cell = (v: number, t?: string) => `<td style="text-align:right;padding:6px;border:1px solid #e5e7eb">${fmtS(v, t)}</td>`;
      const bodyRows = s.showOnlyTotal
        ? `<tr style="background:#eff6ff"><td style="padding:6px;border:1px solid #e5e7eb;font-weight:700;color:#1d4ed8">TOPLAM</td>${s.cols.map(c => cell(rows[c.key].total, c.type)).join('')}</tr>`
        : `<tr style="background:#eff6ff"><td style="padding:6px;border:1px solid #e5e7eb;font-weight:700;color:#1d4ed8">TOPLAM</td>${s.cols.map(c => cell(rows[c.key].total, c.type)).join('')}</tr>
        <tr style="background:#fef2f2"><td style="padding:6px;border:1px solid #e5e7eb;font-weight:700;color:#b91c1c">EN DÜŞÜK</td>${s.cols.map(c => cell(rows[c.key].min, c.type)).join('')}</tr>
        <tr style="background:#f0fdf4"><td style="padding:6px;border:1px solid #e5e7eb;font-weight:700;color:#047857">EN YÜKSEK</td>${s.cols.map(c => cell(rows[c.key].max, c.type)).join('')}</tr>`;
      return `<h3 style="margin:14px 0 6px">Rapor Özeti</h3><table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:10px"><thead><tr><th style="padding:6px;background:#f3f4f6;border:1px solid #e5e7eb"></th>${s.cols.map(c => `<th style="padding:6px;background:#f3f4f6;border:1px solid #e5e7eb;text-align:right">${c.label}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    };

    // Row renderer that highlights fiş headers and indents detail rows
    const renderRow = (r: any) => {
      if (r.__isFisHeader) {
        return `<tr style="background:#dbeafe"><td colspan="${cols.length}" style="padding:8px;border:1px solid #2563eb;font-weight:700;color:#1e40af">📄 ${r.BELGENO || ''} · ${r.FIS_TURU || ''}${r.CARI_AD ? ' · ' + r.CARI_AD : ''}${r.FIS_TARIHI ? ' · ' + String(r.FIS_TARIHI).split(' ')[0] : ''} &nbsp;&nbsp;→&nbsp;&nbsp; <b>${fmtMoney(parseFloat(String(r.SATIR_GENEL_TOPLAM || '0')) || 0)}</b> (${r.KALEM_SAYISI || 0} kalem)</td></tr>`;
      }
      if (r.__isDetail) {
        return `<tr style="background:#f9fafb"><td colspan="${cols.length}" style="padding:6px 8px 6px 24px;border:1px solid #e5e7eb;font-size:10px">&nbsp;&nbsp;➡ <b>${r.STOK_KOD || ''}</b> ${r.STOK_AD || ''} — Miktar: ${parseFloat(String(r.MIKTAR_FIS || 0)).toLocaleString('tr-TR')} ${r.STOK_BIRIM || ''} · Fiyat: ${fmtMoney(parseFloat(String(r.NET_FIYAT || 0)) || 0)} · KDV: ${fmtMoney(parseFloat(String(r.KDV_TUTAR || 0)) || 0)} · <b>${fmtMoney(parseFloat(String(r.SATIR_GENEL_TOPLAM || 0)) || 0)}</b></td></tr>`;
      }
      return `<tr>${cols.map(c => `<td>${renderValue(r[c.key], c)}</td>`).join('')}</tr>`;
    };
    const topBannerHtml = buildTopBannerHtml();
    const summaryHtml = buildSummaryHtml();
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:16px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:5px;text-align:left;font-size:10px}th{background:#f5f5f5;font-weight:bold}h2{font-size:16px;margin:0 0 8px}h3{font-size:13px}</style></head><body><h2>${selectedReport.title}</h2><p style="color:#666">${processedData.length} kayıt · ${new Date().toLocaleDateString('tr-TR')}</p>${topBannerHtml}${summaryHtml}<table><thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${processedData.map(renderRow).join('')}</tbody></table></body></html>`;
    try {
      if (Platform.OS === 'web') {
        // Web: open in new window and trigger print dialog
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
          // small delay so styles render, then print
          setTimeout(() => { try { w.focus(); w.print(); } catch(_){} }, 500);
        } else {
          Alert.alert('Popup engellendi', 'Tarayıcı yeni sekme açmaya izin vermedi. Popup izni verin.');
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: selectedReport.title });
        } else {
          Alert.alert('PDF hazır', `Dosya: ${uri}`);
        }
      }
    } catch (err) {
      console.error('PDF export error:', err);
      Alert.alert('Hata', 'PDF oluşturulurken bir hata oluştu.');
    } finally {
      setExportLoading(false);
    }
  };

  // Excel Export
  const exportExcel = async () => {
    if (!selectedReport || processedData.length === 0) return;
    setExportLoading(true);
    // Defer heavy work so overlay paints first
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const cols = selectedReport.columns;
      const isFisKalem = selectedReport.key === 'fis_kalem';
      const hasHeaders = (processedData as any[]).some(r => r.__isFisHeader);
      const hasDetails = (processedData as any[]).some(r => r.__isDetail);

      // Build rows (human-readable values)
      // Special path: Fiş Kalem with grouped structure → use custom column set with a "Tür" column
      const rows: any[] = [];
      if (isFisKalem && hasHeaders) {
        // Custom wide-format rows: one column-set for fiş headers, another for stok kalemleri
        for (const r of processedData as any[]) {
          const o: Record<string, any> = {};
          if (r.__isFisHeader) {
            o['Tür'] = 'FİŞ';
            o['Tarih'] = String(r.FIS_TARIHI || '').split(' ')[0];
            o['Belge No'] = r.BELGENO || '';
            o['Fiş Türü'] = r.FIS_TURU || '';
            o['Alt Tür'] = r.FIS_ALT_TIPI || '';
            o['Lokasyon'] = r.LOKASYON || '';
            o['Cari Kod'] = r.CARI_KOD || '';
            o['Cari'] = r.CARI_AD || '';
            o['Stok Kod'] = '';
            o['Stok'] = '';
            o['Birim'] = '';
            o['Miktar'] = parseFloat(String(r.MIKTAR_FIS || 0)) || 0;
            o['Net Fiyat'] = '';
            o['Net Tutar'] = parseFloat(String(r.NET_TUTAR || 0)) || 0;
            o['KDV'] = parseFloat(String(r.KDV_TUTAR || 0)) || 0;
            o['Dahil Net'] = parseFloat(String(r.DAHIL_NET_TUTAR || 0)) || 0;
            o['Satır Toplam'] = parseFloat(String(r.SATIR_GENEL_TOPLAM || 0)) || 0;
            o['Kalem Sayısı'] = r.KALEM_SAYISI || 0;
          } else if (r.__isDetail) {
            o['Tür'] = '  Kalem';
            o['Tarih'] = '';
            o['Belge No'] = r.BELGENO || '';
            o['Fiş Türü'] = '';
            o['Alt Tür'] = '';
            o['Lokasyon'] = '';
            o['Cari Kod'] = '';
            o['Cari'] = '';
            o['Stok Kod'] = r.STOK_KOD || '';
            o['Stok'] = r.STOK_AD || '';
            o['Birim'] = r.STOK_BIRIM || '';
            o['Miktar'] = parseFloat(String(r.MIKTAR_FIS || 0)) || 0;
            o['Net Fiyat'] = parseFloat(String(r.NET_FIYAT || 0)) || 0;
            o['Net Tutar'] = parseFloat(String(r.NET_TUTAR || 0)) || 0;
            o['KDV'] = parseFloat(String(r.KDV_TUTAR || 0)) || 0;
            o['Dahil Net'] = parseFloat(String(r.DAHIL_NET_TUTAR || 0)) || 0;
            o['Satır Toplam'] = parseFloat(String(r.SATIR_GENEL_TOPLAM || 0)) || 0;
            o['Kalem Sayısı'] = '';
          }
          rows.push(o);
        }
      } else {
        for (const r of processedData as any[]) {
          const o: Record<string, any> = {};
          cols.forEach(c => {
            let v = r[c.key];
            if (c.type === 'money' || c.type === 'number') {
              const n = parseFloat(String(v ?? '0'));
              v = isNaN(n) ? 0 : n;
            } else if (c.type === 'bool') {
              v = (v === true || v === 1 || v === '1') ? 'Evet' : 'Hayır';
            } else if (v === null || v === undefined) {
              v = '';
            } else {
              v = String(v);
            }
            o[c.label] = v;
          });
          rows.push(o);
        }
      }

      const fisKalemHeaders = ['Tür','Tarih','Belge No','Fiş Türü','Alt Tür','Lokasyon','Cari Kod','Cari','Stok Kod','Stok','Birim','Miktar','Net Fiyat','Net Tutar','KDV','Dahil Net','Satır Toplam','Kalem Sayısı'];
      const header = (isFisKalem && hasHeaders) ? fisKalemHeaders : cols.map(c => c.label);
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      // Auto-size columns
      const colWidths = header.map(h => {
        const maxLen = Math.max(h.length, ...rows.map((r: any) => String(r[h] ?? '').length));
        return { wch: Math.min(40, Math.max(8, maxLen + 2)) };
      });
      (ws as any)['!cols'] = colWidths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (selectedReport.title || 'Rapor').substring(0, 31));
      void hasDetails; // marker used for future expansion

      // Summary sheet (TOPLAM/MIN/MAX)
      if (selectedReport.summary) {
        const s = selectedReport.summary;
        const firstRow = processedData[0] || {};
        const computeVals = (key: string) => {
          const vals = processedData.map((r: any) => parseFloat(String(r[key] ?? '0'))).filter(n => !isNaN(n));
          const totalKey = s.totalsFromRow?.[key];
          const computed = s.totalsComputed?.[key];
          let total: number;
          if (computed) {
            const a = parseFloat(String(firstRow[computed.a] ?? '0')) || 0;
            const b = parseFloat(String(firstRow[computed.b] ?? '0')) || 0;
            total = computed.op === 'sub' ? a - b : a + b;
          } else if (totalKey != null) {
            total = parseFloat(String(firstRow[totalKey] ?? '0')) || vals.reduce((a, b) => a + b, 0);
          } else {
            total = vals.reduce((a, b) => a + b, 0);
          }
          return {
            total,
            min: vals.length ? Math.min(...vals) : 0,
            max: vals.length ? Math.max(...vals) : 0,
          };
        };
        const stats = s.cols.map(c => ({ col: c, v: computeVals(c.key) }));
        const summaryRows: any[] = s.showOnlyTotal
          ? [{ '': 'TOPLAM', ...Object.fromEntries(stats.map(x => [x.col.label, x.v.total])) }]
          : [
              { '': 'TOPLAM', ...Object.fromEntries(stats.map(x => [x.col.label, x.v.total])) },
              { '': 'EN DÜŞÜK', ...Object.fromEntries(stats.map(x => [x.col.label, x.v.min])) },
              { '': 'EN YÜKSEK', ...Object.fromEntries(stats.map(x => [x.col.label, x.v.max])) },
            ];
        // Add TOP BANNER rows for Personel Satış and Fiş Kalem
        if (selectedReport.key === 'personel_satis') {
          let toplam = parseFloat(String(firstRow.TOPLAM_TUTAR_NET ?? '0'));
          if (!(toplam > 0)) toplam = processedData.reduce((a: number, r: any) => a + (parseFloat(String(r.TUTAR_NET || 0)) || 0), 0);
          summaryRows.unshift({ '': 'TOPLAM SATIŞ', [s.cols[0]?.label || '']: toplam } as any);
        } else if (selectedReport.key === 'fis_kalem') {
          let satis = 0, alis = 0;
          for (const row of processedData as any[]) {
            if (row.__isDetail) continue;
            const tut = parseFloat(String(row.SATIR_GENEL_TOPLAM || row.DAHIL_NET_TUTAR || '0')) || 0;
            const ft = String(row.FIS_TURU || '').toLowerCase();
            if (ft.includes('alış') || ft.includes('alis')) alis += tut;
            else satis += tut;
          }
          summaryRows.unshift({ '': 'SATIŞ TOPLAMI', [s.cols[0]?.label || '']: satis } as any);
          summaryRows.unshift({ '': 'ALIŞ TOPLAMI', [s.cols[0]?.label || '']: alis } as any);
        }
        const wsS = XLSX.utils.json_to_sheet(summaryRows, { header: ['', ...s.cols.map(c => c.label)] });
        (wsS as any)['!cols'] = [{ wch: 18 }, ...s.cols.map(() => ({ wch: 16 }))];
        XLSX.utils.book_append_sheet(wb, wsS, 'Özet');
      }

      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const fileName = `${selectedReport.key}_${ts}.xlsx`;

      if (Platform.OS === 'web') {
        // On web: download via Blob
        const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      } else {
        const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        const uri = FileSystem.cacheDirectory + fileName;
        await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          UTI: 'com.microsoft.excel.xlsx',
          dialogTitle: selectedReport.title,
        });
      }
    } catch (err) {
      console.error('Excel export error:', err);
      Alert.alert('Hata', 'Excel oluşturulurken bir hata oluştu.');
    } finally {
      setExportLoading(false);
    }
  };

  // Get selected labels for a filter
  const getSelectedLabels = (filterName: string, source?: string) => {
    const val = filterValues[filterName] || '';
    if (!val) return '';
    const opts = source ? (lookupCache[source] || []) : [];
    const ids = val.split(',');
    if (opts.length > 0) {
      return ids.map((id: string) => opts.find(o => o.value === id)?.label || id).join(', ');
    }
    return val;
  };

  const filteredPickerOpts = useMemo(() => {
    if (!pickerSearch) return pickerOptions;
    const q = pickerSearch.toLowerCase();
    return pickerOptions.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [pickerOptions, pickerSearch]);

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}><Ionicons name="document-text-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>{t('no_data_source_selected') || 'Veri kaynağı seçilmedi'}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('reports')}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 }}>
        {ALL_REPORTS.map(report => (
          <TouchableOpacity key={report.key} style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => openReportFilter(report)} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.reportIcon, { backgroundColor: colors.primary + '15' }]}><Ionicons name={report.icon} size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={[{ fontSize: 15, fontWeight: '700', color: colors.text }]}>{getReportTitle(report)}</Text><Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{getReportDesc(report)}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* FILTER MODAL */}
      <Modal visible={showFilterModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[{ fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 }]}>{selectedReport ? getReportTitle(selectedReport) : ''} - {t('filters_suffix')}</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 10, paddingBottom: 30 }}>
              {(() => {
                // Dedupe filters by name — prevents React duplicate-key warnings when reports
                // accidentally list the same filter twice (e.g. explicit + spread).
                const seen = new Set<string>();
                const unique = (selectedReport?.filters || []).filter(f => {
                  if (seen.has(f.name)) return false;
                  seen.add(f.name);
                  return true;
                });
                return unique.map(filter => (
                <View key={filter.name}>
                  <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 }]}>
                    {translateLabel(filter.label)} {filter.required && <Text style={{ color: colors.error }}>*</Text>}
                  </Text>
                  {filter.type === 'date' ? (
                    <TouchableOpacity
                      style={[styles.filterInput, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                      onPress={() => setDatePickerFor(filter.name)}
                    >
                      <Text style={[{ fontSize: 13, color: filterValues[filter.name] ? colors.text : colors.textSecondary }]}>
                        {filterValues[filter.name] ? formatDateTR(filterValues[filter.name]) : t('select_date')}
                      </Text>
                      <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  ) : filter.type === 'select_static' ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {filter.options?.map(opt => (
                        <TouchableOpacity key={String(opt.value)} style={[styles.chip, filterValues[filter.name] === opt.value && { backgroundColor: colors.primary, borderColor: colors.primary }, { borderColor: colors.border }]}
                          onPress={() => setFilterValues(prev => ({ ...prev, [filter.name]: opt.value }))}>
                          <Text style={[{ fontSize: 12, color: filterValues[filter.name] === opt.value ? '#fff' : colors.text }]}>{translateLabel(opt.label)}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : filter.type === 'multiselect' ? (
                    <TouchableOpacity
                      style={[styles.filterInput, { backgroundColor: colors.card, borderColor: filterValues[filter.name] ? colors.primary : colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                      onPress={() => openPicker(filter)}
                    >
                      <Text style={[{ fontSize: 13, color: filterValues[filter.name] ? colors.text : colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                        {filterValues[filter.name] ? getSelectedLabels(filter.name, filter.source) : t('select_placeholder')}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ) : filter.type === 'text' ? (
                    <TextInput
                      style={[styles.filterInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                      value={filterValues[filter.name] || ''}
                      onChangeText={v => setFilterValues(prev => ({ ...prev, [filter.name]: v }))}
                      placeholder={filter.placeholder || t('enter_text')} placeholderTextColor={colors.textSecondary}
                      autoCapitalize="none"
                      keyboardType={filter.numeric ? 'numbers-and-punctuation' : 'default'}
                    />
                  ) : null}
                </View>
              ));
              })()}
              <TouchableOpacity style={[{ backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }]} onPress={runReport}>
                <Text style={[{ color: '#fff', fontWeight: '700', fontSize: 15 }]}>{t('run_report')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* DATE PICKER MODAL */}
      {datePickerFor && (Platform.OS === 'web' ? (
        <Modal visible animationType="fade" transparent statusBarTranslucent>
          <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
            <View style={{ backgroundColor: colors.card, padding: 20, borderRadius: 16, width: '90%', maxWidth: 320, gap: 16 }}>
              <Text style={[{ fontSize: 15, fontWeight: '700', color: colors.text }]}>Tarih Seçin</Text>
              <TextInput
                style={[styles.filterInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text, fontSize: 16, letterSpacing: 1 }]}
                value={filterValues[datePickerFor] || today()}
                onChangeText={(v) => setFilterValues(prev => ({ ...prev, [datePickerFor]: v }))}
                placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
                  onPress={() => setDatePickerFor(null)}
                ><Text style={[{ color: colors.text, fontWeight: '600' }]}>{t('cancel')}</Text></TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' }}
                  onPress={() => setDatePickerFor(null)}
                ><Text style={[{ color: '#fff', fontWeight: '700' }]}>{t('ok')}</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : (
        <DateTimePicker
          value={filterValues[datePickerFor] ? new Date(filterValues[datePickerFor]) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            if (Platform.OS === 'android') setDatePickerFor(null);
            if (event.type === 'set' && selectedDate) {
              const iso = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
              setFilterValues(prev => ({ ...prev, [datePickerFor]: iso }));
            }
          }}
        />
      ))}

      <Modal visible={showPickerModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 }]}>{pickerFilter?.label}</Text>
              <TouchableOpacity onPress={() => setShowPickerModal(false)}><Ionicons name="checkmark" size={24} color={colors.primary} /></TouchableOpacity>
            </View>
            {pickerOptions.length > 5 && !pickerLoading && (
              <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons name="search" size={16} color={colors.textSecondary} />
                  <TextInput style={[{ flex: 1, fontSize: 13, color: colors.text, paddingVertical: 0 }]} placeholder="Ara..." placeholderTextColor={colors.textSecondary} value={pickerSearch} onChangeText={setPickerSearch} />
                  {pickerSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setPickerSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
            {pickerLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>Seçenekler yükleniyor...</Text></View>
            ) : (
              <FlatList
                data={filteredPickerOpts}
                keyExtractor={(item, idx) => String(idx)}
                contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20, paddingTop: pickerOptions.length > 5 ? 0 : 8 }}
                renderItem={({ item }) => {
                  const sel = isPickerSelected(item.value);
                  return (
                    <TouchableOpacity style={[styles.pickerItem, { backgroundColor: sel ? colors.primary + '15' : colors.card, borderColor: sel ? colors.primary : colors.border }]} onPress={() => togglePickerValue(item.value)}>
                      <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={20} color={sel ? colors.primary : colors.textSecondary} />
                      <Text style={[{ fontSize: 14, color: sel ? colors.primary : colors.text, fontWeight: sel ? '600' : '400', flex: 1 }]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={<View style={{ alignItems: 'center', paddingVertical: 20 }}><Text style={[{ color: colors.textSecondary }]}>Seçenek bulunamadı</Text></View>}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* RESULT MODAL */}
      <Modal visible={showResultModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 }]}>{selectedReport ? getReportTitle(selectedReport) : ''}</Text>
              <TouchableOpacity style={{ marginRight: 8 }} onPress={() => {
                // Abort any in-flight page fetches when user returns to filter
                if (abortRef.current) { try { abortRef.current.abort(); } catch(_){} }
                runTokenRef.current++;
                setMoreLoading(false); setReportLoading(false);
                setShowResultModal(false); setShowFilterModal(true);
              }}><Ionicons name="options-outline" size={22} color={colors.primary} /></TouchableOpacity>
              <TouchableOpacity onPress={() => {
                // Abort and clean up on close
                if (abortRef.current) { try { abortRef.current.abort(); } catch(_){} }
                runTokenRef.current++;
                setMoreLoading(false); setReportLoading(false);
                setShowResultModal(false); setSelectedReport(null); setReportData([]);
              }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            {/* Toolbar */}
            <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
              <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
                <Ionicons name="search" size={14} color={colors.textSecondary} />
                <TextInput
                  style={[{ flex: 1, fontSize: 12, color: colors.text, paddingVertical: 0 }]}
                  placeholder="Ara..."
                  placeholderTextColor={colors.textSecondary}
                  value={searchFilter}
                  onChangeText={setSearchFilter}
                  returnKeyType="search"
                />
                {isProcessing && searchFilter.length > 0 ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : searchFilter.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => { setSearchFilter(''); setDebouncedSearch(''); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.success + '18' }]} onPress={exportExcel} disabled={exportLoading}>
                {exportLoading ? <ActivityIndicator size="small" color={colors.success} /> : <Ionicons name="grid-outline" size={14} color={colors.success} />}
                <Text style={[{ fontSize: 10, color: colors.success, fontWeight: '700' }]}>Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.error + '15' }]} onPress={exportPdf} disabled={exportLoading}>
                {exportLoading ? <ActivityIndicator size="small" color={colors.error} /> : <Ionicons name="document-text-outline" size={14} color={colors.error} />}
                <Text style={[{ fontSize: 10, color: colors.error, fontWeight: '700' }]}>PDF</Text>
              </TouchableOpacity>
            </View>
            {/* Sort headers - compact pill style */}
            {selectedReport && !reportLoading && processedData.length > 0 && !selectedReport.disableSort && (() => {
              const sortOpts = (selectedReport.cardLayout
                ? [
                    selectedReport.cardLayout.title ? { key: selectedReport.cardLayout.title, label: selectedReport.columns.find(c => c.key === selectedReport.cardLayout!.title)?.label || 'Ad' } : null,
                    selectedReport.cardLayout.amount ? { key: selectedReport.cardLayout.amount, label: selectedReport.cardLayout.amountLabel || 'Fiyat' } : null,
                    ...(selectedReport.cardLayout.chips || []).map(c => ({ key: c.key, label: c.label || selectedReport.columns.find(col => col.key === c.key)?.label || c.key })),
                  ].filter(Boolean) as { key: string; label: string }[]
                : selectedReport.columns
              );
              return (
                <View style={[styles.sortBar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={styles.sortIconBox}>
                    <Ionicons name="swap-vertical" size={13} color={colors.textSecondary} />
                    <Text style={[{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }]}>Sırala</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2, alignItems: 'center' }}>
                    {sortOpts.map(col => {
                      const active = sortKey === col.key;
                      return (
                        <TouchableOpacity
                          key={col.key}
                          style={[
                            styles.sortPill,
                            {
                              backgroundColor: active ? colors.primary : colors.card,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => toggleSort(col.key)}
                          activeOpacity={0.7}
                        >
                          <Text style={[{ fontSize: 11, fontWeight: '700', color: active ? '#fff' : colors.text }]} numberOfLines={1}>{translateLabel(col.label)}</Text>
                          {active && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={11} color="#fff" />}
                        </TouchableOpacity>
                      );
                    })}
                    {sortKey !== '' && (
                      <TouchableOpacity onPress={() => { setSortKey(''); setSortAsc(true); }} style={[styles.sortPill, { backgroundColor: 'transparent', borderColor: colors.border }]}>
                        <Ionicons name="close" size={11} color={colors.textSecondary} />
                        <Text style={[{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }]}>{t('clear')}</Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                </View>
              );
            })()}
            <View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{reportLoading ? 'Çalıştırılıyor...' : `${processedData.length} kayıt${debouncedSearch && processedData.length !== reportData.length ? ` · toplam ${reportData.length}` : ''}`}</Text>
              {isProcessing && !reportLoading && reportData.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[{ fontSize: 10, color: colors.primary, fontWeight: '600' }]}>{sortKey !== deferredSortKey || sortAsc !== deferredSortAsc ? 'Sıralanıyor...' : 'İşleniyor...'}</Text>
                </View>
              )}
              {moreLoading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.primary + '18' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[{ fontSize: 10, color: colors.primary, fontWeight: '700' }]}>Daha fazla yükleniyor (sayfa {loadedPages + 1})...</Text>
                </View>
              )}
            </View>
            {reportLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary }]}>POS'tan veri alınıyor...</Text></View>
            ) : processedData.length > 0 ? (
              <FlatList
                data={processedData}
                keyExtractor={(_, idx) => String(idx)}
                contentContainerStyle={{ padding: 12, paddingBottom: 30, gap: 8 }}
                initialNumToRender={15}
                maxToRenderPerBatch={12}
                windowSize={7}
                removeClippedSubviews={Platform.OS !== 'web'}
                updateCellsBatchingPeriod={50}
                ListHeaderComponent={(() => {
                  if (!selectedReport) return null;
                  return (
                    <>
                      <TopBanner report={selectedReport} data={reportData} baseParams={selectedReport.defaultParams} filterValues={filterValues} colors={colors} />
                      {selectedReport.summary && <ReportSummaryPanel data={reportData} config={selectedReport.summary} colors={colors} />}
                    </>
                  );
                })()}
                renderItem={({ item }) => (
                  selectedReport?.hierarchical
                    ? <HierarchicalRow item={item} report={selectedReport} colors={colors} />
                    : <ReportCard item={item} report={selectedReport} colors={colors} renderValue={renderValue} />
                )}
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><Ionicons name="document-text-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>Sonuç bulunamadı</Text></View>
            )}
            {/* Export overlay INSIDE result modal so it floats above the modal */}
            {exportLoading && (
              <View style={styles.exportOverlay}>
                <View style={[styles.exportBox, { backgroundColor: colors.card }]}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12 }]}>Dosya hazırlanıyor...</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  reportCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  reportIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, flex: 1, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  filterInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 6 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 6, borderBottomWidth: 1 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  sortHeader: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 4 },
  sortBar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1 },
  sortIconBox: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingRight: 6, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#ccc', marginRight: 4 },
  sortPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  resultRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resultCell: { minWidth: '40%', flex: 1 },
  exportOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 9998 },
  exportBox: { borderRadius: 16, padding: 30, alignItems: 'center', minWidth: 200 },
});

const cardStyles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  code: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  amount: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  amountCurrency: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  chipText: { fontSize: 11, fontWeight: '600' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  metaItem: { minWidth: 70 },
  metaLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  metaValue: { fontSize: 12, fontWeight: '600' },
});


// Memoized report card — re-renders only when item/report/colors change
interface ReportCardProps {
  item: any;
  report: ReportDef | null;
  colors: any;
  renderValue: (val: any, col: ColDef) => string;
}
const ReportCardComp: React.FC<ReportCardProps> = ({ item, report, colors, renderValue }) => {
  // Special render: Fiş Kalem header row — highlighted card showing fiş summary
  if (item.__isFisHeader) {
    const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fisTuru = String(item.FIS_TURU || '-');
    const belge = String(item.BELGENO || '');
    const tarih = String(item.FIS_TARIHI || '').split(' ')[0];
    const cariAd = String(item.CARI_AD || '');
    const kalem = item.KALEM_SAYISI || 0;
    const miktar = parseFloat(String(item.MIKTAR_FIS || '0'));
    const toplam = parseFloat(String(item.SATIR_GENEL_TOPLAM || '0'));
    return (
      <View style={[cardStyles.card, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '40', borderWidth: 1.5 }]}>
        <View style={cardStyles.cardTop}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[cardStyles.code, { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>{belge}</Text>
            <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>{fisTuru}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[cardStyles.amount, { color: colors.primary }]} numberOfLines={1}>₺{fmt(toplam)}</Text>
            <Text style={[cardStyles.amountCurrency, { color: colors.textSecondary }]}>Fiş Toplamı</Text>
          </View>
        </View>
        <View style={cardStyles.chipsRow}>
          {tarih && <View style={[cardStyles.chip, { backgroundColor: colors.primary + '15' }]}><Text style={[cardStyles.chipText, { color: colors.primary }]}>{tarih}</Text></View>}
          <View style={[cardStyles.chip, { backgroundColor: colors.success + '18' }]}><Text style={[cardStyles.chipText, { color: colors.success }]}>{kalem} kalem</Text></View>
          <View style={[cardStyles.chip, { backgroundColor: colors.primary + '12' }]}><Text style={[cardStyles.chipText, { color: colors.primary }]}>Toplam Miktar: {miktar.toLocaleString('tr-TR')}</Text></View>
          {cariAd && <View style={[cardStyles.chip, { backgroundColor: colors.textSecondary + '18' }]}><Text style={[cardStyles.chipText, { color: colors.text }]} numberOfLines={1}>{cariAd}</Text></View>}
        </View>
      </View>
    );
  }

  // Special render: drill-down detail row (stok kalem)
  if (item.__isDetail) {
    const stokKod = String(item.STOK_KOD || '');
    const stokAd = String(item.STOK_AD || '-');
    const miktar = parseFloat(String(item.MIKTAR_FIS || '0'));
    const birim = String(item.STOK_BIRIM || '');
    const fiyat = parseFloat(String(item.NET_FIYAT || '0'));
    const kdv = parseFloat(String(item.KDV_TUTAR || '0'));
    const netKdvDahil = parseFloat(String(item.SATIR_GENEL_TOPLAM || item.DAHIL_NET_TUTAR || '0'));
    const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (
      <View style={[{ marginLeft: 16, marginTop: -8, marginBottom: 8, padding: 10, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: colors.primary + '80', backgroundColor: colors.card + 'C0', borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Ionicons name="arrow-forward-outline" size={12} color={colors.primary} />
          <Text style={[{ fontSize: 11, color: colors.textSecondary, marginLeft: 4 }]}>{stokKod}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.primary }]}>₺{fmt(netKdvDahil)}</Text>
        </View>
        <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 }]} numberOfLines={2}>{stokAd}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Miktar: <Text style={{ color: colors.text, fontWeight: '600' }}>{miktar.toLocaleString('tr-TR')} {birim}</Text></Text>
          <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Fiyat: <Text style={{ color: colors.text, fontWeight: '600' }}>₺{fmt(fiyat)}</Text></Text>
          {kdv > 0 && <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>KDV: <Text style={{ color: colors.text, fontWeight: '600' }}>₺{fmt(kdv)}</Text></Text>}
        </View>
      </View>
    );
  }

  const cl = report?.cardLayout;
  if (cl) {
    const titleVal = String(item[cl.title] ?? '-');
    const codeVal = cl.code ? String(item[cl.code] ?? '') : '';
    const amountRaw = cl.amount ? item[cl.amount] : null;
    const amountCurrency = cl.amountCurrency ? String(item[cl.amountCurrency] ?? '') : '';
    const amountText = cl.amount
      ? (cl.amountType === 'money'
          ? `₺${parseFloat(amountRaw || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : parseFloat(amountRaw || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 }))
      : '';
    return (
      <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={cardStyles.cardTop}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            {codeVal !== '' && (<Text style={[cardStyles.code, { color: colors.textSecondary }]} numberOfLines={1}>{codeVal}</Text>)}
            <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>{titleVal}</Text>
          </View>
          {cl.amount && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[cardStyles.amount, { color: colors.primary }]} numberOfLines={1}>{amountText}</Text>
              {amountCurrency !== '' && (<Text style={[cardStyles.amountCurrency, { color: colors.textSecondary }]}>{amountCurrency}</Text>)}
            </View>
          )}
        </View>
        {cl.chips && cl.chips.length > 0 && (
          <View style={cardStyles.chipsRow}>
            {cl.chips.map(c => {
              const v = item[c.key];
              if (v === undefined || v === null || v === '') return null;
              const col = report?.columns.find(x => x.key === c.key);
              let txt = ''; let bg = colors.primary + '12'; let fg = colors.primary;
              if (c.type === 'bool' || col?.type === 'bool') {
                const isTrue = v === true || v === 1 || v === '1';
                txt = `${c.label || col?.label || c.key}: ${isTrue ? 'Evet' : 'Hayır'}`;
                bg = isTrue ? (colors.success + '20') : (colors.error + '18');
                fg = isTrue ? colors.success : colors.error;
              } else if (c.type === 'number' || col?.type === 'number') {
                txt = `${c.label || col?.label || c.key}: ${parseFloat(String(v || '0')).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
              } else {
                txt = c.label ? `${c.label}: ${v}` : String(v);
              }
              return (<View key={c.key} style={[cardStyles.chip, { backgroundColor: bg }]}><Text style={[cardStyles.chipText, { color: fg }]} numberOfLines={1}>{txt}</Text></View>);
            })}
          </View>
        )}
        {cl.meta && cl.meta.length > 0 && (
          <View style={[cardStyles.metaRow, { borderTopColor: colors.border }]}>
            {cl.meta.map(m => {
              const v = item[m.key];
              if (v === undefined || v === null || v === '' || v === '-') return null;
              const col = report?.columns.find(x => x.key === m.key);
              let val = String(v);
              if (m.type === 'money' || col?.type === 'money') {
                val = `₺${parseFloat(String(v || '0')).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
              } else if (m.type === 'number' || col?.type === 'number') {
                val = parseFloat(String(v || '0')).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
              }
              return (<View key={m.key} style={cardStyles.metaItem}><Text style={[cardStyles.metaLabel, { color: colors.textSecondary }]}>{m.label || col?.label || m.key}</Text><Text style={[cardStyles.metaValue, { color: colors.text }]} numberOfLines={1}>{val}</Text></View>);
            })}
          </View>
        )}
      </View>
    );
  }
  // Fallback: 2-col grid
  return (
    <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(report?.columns || []).map(col => (
          <View key={col.key} style={styles.resultCell}>
            <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{translateLabel(col.label)}</Text>
            <Text style={[{ fontSize: 12, fontWeight: '600', color: col.type === 'money' ? colors.primary : colors.text }]} numberOfLines={1}>{renderValue(item[col.key], col)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};
const ReportCard = memo(ReportCardComp, (prev, next) => prev.item === next.item && prev.report === next.report && prev.colors === next.colors);

// Summary panel (TOPLAM / MIN / MAX) shown at top of result list
interface ReportSummaryPanelProps {
  data: any[];
  config: { cols: { key: string; label: string; type?: 'money' | 'number' }[]; totalsFromRow?: Record<string, string> };
  colors: any;
}
const ReportSummaryPanelComp: React.FC<ReportSummaryPanelProps> = ({ data, config, colors }) => {
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const out: Record<string, { total: number; min: number; max: number }> = {};
    // Use POS-provided totals on first row when available, else sum across rows
    const firstRow = data[0] || {};
    for (const col of config.cols) {
      const totalKey = config.totalsFromRow?.[col.key];
      const computed = config.totalsComputed?.[col.key];
      const vals = data.map(r => parseFloat(String(r[col.key] ?? '0'))).filter(n => !isNaN(n));
      let total: number;
      if (computed) {
        const a = parseFloat(String(firstRow[computed.a] ?? '0')) || 0;
        const b = parseFloat(String(firstRow[computed.b] ?? '0')) || 0;
        total = computed.op === 'sub' ? a - b : a + b;
      } else if (totalKey != null) {
        total = parseFloat(String(firstRow[totalKey] ?? '0')) || vals.reduce((a, b) => a + b, 0);
      } else {
        total = vals.reduce((a, b) => a + b, 0);
      }
      const min = vals.length ? Math.min(...vals) : 0;
      const max = vals.length ? Math.max(...vals) : 0;
      out[col.key] = { total, min, max };
    }
    return out;
  }, [data, config]);

  if (!stats) return null;

  const fmt = (v: number, type?: 'money' | 'number') => {
    if (type === 'money') return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return v.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  };

  const statRows = config.showOnlyTotal
    ? [{ key: 'total' as const, label: 'TOPLAM', icon: 'stats-chart' as const, color: colors.primary, bg: colors.primary + '10' }]
    : [
        { key: 'total' as const, label: 'TOPLAM', icon: 'stats-chart' as const, color: colors.primary, bg: colors.primary + '10' },
        { key: 'min' as const, label: 'EN DÜŞÜK', icon: 'trending-down' as const, color: colors.error, bg: colors.error + '0D' },
        { key: 'max' as const, label: 'EN YÜKSEK', icon: 'trending-up' as const, color: colors.success, bg: colors.success + '0D' },
      ];

  return (
    <View style={[summaryStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[summaryStyles.hintRow, { borderBottomColor: colors.border }]}>
        <Ionicons name="stats-chart-outline" size={13} color={colors.primary} />
        <Text style={[summaryStyles.hintText, { color: colors.text }]}>Rapor Özeti</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="swap-horizontal" size={12} color={colors.textSecondary} />
        <Text style={[summaryStyles.hintMuted, { color: colors.textSecondary }]}>Kaydırın</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Column header row */}
          <View style={[summaryStyles.headerRow, { borderBottomColor: colors.border }]}>
            <View style={summaryStyles.labelCol} />
            {config.cols.map(c => (
              <View key={c.key} style={summaryStyles.cell}>
                <Text style={[summaryStyles.colLabel, { color: colors.textSecondary }]} numberOfLines={1}>{c.label}</Text>
              </View>
            ))}
          </View>
          {/* Data rows */}
          {statRows.map((stat, idx) => (
            <View key={stat.key} style={[summaryStyles.row, { backgroundColor: stat.bg, borderTopColor: colors.border, borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth }]}>
              <View style={summaryStyles.labelCol}>
                <View style={[summaryStyles.pill, { backgroundColor: stat.color }]}>
                  <Ionicons name={stat.icon} size={11} color="#fff" />
                  <Text style={summaryStyles.pillText} numberOfLines={1}>{stat.label}</Text>
                </View>
              </View>
              {config.cols.map(c => (
                <View key={c.key} style={summaryStyles.cell}>
                  <Text style={[summaryStyles.cellVal, { color: colors.text }]} numberOfLines={1}>
                    {fmt(stats[c.key][stat.key] || 0, c.type)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};
const ReportSummaryPanel = memo(ReportSummaryPanelComp, (prev, next) => prev.data === next.data && prev.config === next.config && prev.colors === next.colors);

// === TOP BANNER — prominent total / split / hint shown above the summary panel ===
interface TopBannerProps { report: ReportDef; data: any[]; baseParams: any; filterValues: any; colors: any; }
const TopBannerComp: React.FC<TopBannerProps> = ({ report, data, filterValues, colors }) => {
  if (!data || data.length === 0) return null;
  const fmt = (n: number) => `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // PERSONEL SATIŞ: prominent "Toplam Satış" banner
  if (report.key === 'personel_satis') {
    const firstRow = data[0] || {};
    let toplam = parseFloat(String(firstRow.TOPLAM_TUTAR_NET ?? '0'));
    if (!(toplam > 0)) {
      toplam = data.reduce((acc, r) => acc + (parseFloat(String(r.TUTAR_NET || '0')) || 0), 0);
    }
    const fisAdet = parseFloat(String(firstRow.TOPLAM_FIS_ADET ?? data.reduce((a, r) => a + (parseFloat(String(r.FIS_ADET || 0)) || 0), 0)));
    return (
      <View style={[topBannerStyles.banner, { backgroundColor: colors.success + '15', borderColor: colors.success + '50' }]}>
        <View style={topBannerStyles.iconWrap}>
          <View style={[topBannerStyles.iconBg, { backgroundColor: colors.success }]}>
            <Ionicons name="cash-outline" size={22} color="#fff" />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[topBannerStyles.label, { color: colors.success }]}>TOPLAM SATIŞ</Text>
          <Text style={[topBannerStyles.big, { color: colors.text }]} numberOfLines={1}>{fmt(toplam)}</Text>
          <Text style={[topBannerStyles.sub, { color: colors.textSecondary }]}>{fisAdet.toLocaleString('tr-TR')} fiş • {data.length} personel</Text>
        </View>
      </View>
    );
  }

  // FİŞ KALEM LİSTESİ: split sales vs purchases
  if (report.key === 'fis_kalem') {
    let satisTutar = 0, alisTutar = 0, satisAdet = 0, alisAdet = 0;
    for (const row of data) {
      if (!row.__isFisHeader && !row.__isDetail) {
        // Flat row (no grouping applied) — treat normally
        const tut = parseFloat(String(row.SATIR_GENEL_TOPLAM || row.DAHIL_NET_TUTAR || '0')) || 0;
        const ft = String(row.FIS_TURU || '').toLowerCase();
        if (ft.includes('alış') || ft.includes('alis')) { alisTutar += tut; alisAdet += 1; }
        else { satisTutar += tut; satisAdet += 1; }
      } else if (row.__isFisHeader) {
        const tut = parseFloat(String(row.SATIR_GENEL_TOPLAM || row.DAHIL_NET_TUTAR || '0')) || 0;
        const ft = String(row.FIS_TURU || '').toLowerCase();
        if (ft.includes('alış') || ft.includes('alis')) { alisTutar += tut; alisAdet += 1; }
        else { satisTutar += tut; satisAdet += 1; }
      }
    }
    return (
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View style={[topBannerStyles.halfBanner, { backgroundColor: colors.success + '15', borderColor: colors.success + '50' }]}>
          <Ionicons name="arrow-up-circle" size={20} color={colors.success} />
          <Text style={[topBannerStyles.halfLabel, { color: colors.success }]}>SATIŞ TOPLAMI</Text>
          <Text style={[topBannerStyles.halfBig, { color: colors.text }]} numberOfLines={1}>{fmt(satisTutar)}</Text>
          <Text style={[topBannerStyles.halfSub, { color: colors.textSecondary }]}>{satisAdet} fiş/fatura</Text>
        </View>
        <View style={[topBannerStyles.halfBanner, { backgroundColor: colors.error + '10', borderColor: colors.error + '50' }]}>
          <Ionicons name="arrow-down-circle" size={20} color={colors.error} />
          <Text style={[topBannerStyles.halfLabel, { color: colors.error }]}>ALIŞ TOPLAMI</Text>
          <Text style={[topBannerStyles.halfBig, { color: colors.text }]} numberOfLines={1}>{fmt(alisTutar)}</Text>
          <Text style={[topBannerStyles.halfSub, { color: colors.textSecondary }]}>{alisAdet} fiş/fatura</Text>
        </View>
      </View>
    );
  }

  // CARI EKSTRE: hint when Detayli=1 (stock items appear under transactions)
  if (report.key === 'cari_ekstre') {
    const det = filterValues?.Detayli;
    const isDetail = det === 1 || det === '1';
    if (isDetail) {
      const detailCount = data.filter((r: any) => r.__isDetail).length;
      return (
        <View style={[topBannerStyles.hint, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '40' }]}>
          <Ionicons name="information-circle" size={18} color={colors.primary} />
          <Text style={[topBannerStyles.hintText, { color: colors.text }]} numberOfLines={2}>
            💡 Her fiş / faturanın altında <Text style={{ fontWeight: '700', color: colors.primary }}>stok kalemleri</Text> gösterilmektedir ({detailCount} stok kalemi bulundu)
          </Text>
        </View>
      );
    }
  }

  return null;
};
const TopBanner = memo(TopBannerComp, (p, n) => p.report === n.report && p.data === n.data && p.filterValues === n.filterValues && p.colors === n.colors);

const topBannerStyles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 10 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  iconBg: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 2 },
  big: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] as any, letterSpacing: -0.5 },
  sub: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  halfBanner: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, gap: 2 },
  halfLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 4 },
  halfBig: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] as any },
  halfSub: { fontSize: 10, fontWeight: '500' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  hintText: { flex: 1, fontSize: 12, fontWeight: '500', lineHeight: 17 },
});

const summaryStyles = StyleSheet.create({
  wrap: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  headerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', borderBottomWidth: 1 },
  row: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center' },
  labelCol: { width: 106, paddingLeft: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, alignSelf: 'flex-start' },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  cell: { minWidth: 96, paddingHorizontal: 6, alignItems: 'flex-end' },
  colLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textAlign: 'right' },
  cellVal: { fontSize: 12, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  hintText: { fontSize: 12, fontWeight: '700' },
  hintMuted: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
});


// === HIERARCHICAL ROW — for Gelir Tablosu-style reports with SEVIYE levels ===
interface HierarchicalRowProps { item: any; report: ReportDef; colors: any; }
const HierarchicalRowComp: React.FC<HierarchicalRowProps> = ({ item, report, colors }) => {
  const cfg = report.hierarchical!;
  const level = Number(item[cfg.levelKey] ?? 0);
  const label = String(item[cfg.labelKey] ?? '');
  const valRaw = parseFloat(String(item[cfg.valueKey] ?? '0')) || 0;
  const valText = `₺${valRaw.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isNegative = valRaw < 0;

  // Style by level
  let bg = colors.card;
  let labelColor = colors.text;
  let valueColor = isNegative ? colors.error : colors.text;
  let fontWeight: '400' | '600' | '700' | '800' = '400';
  let fontSize = 13;
  if (level === 0) { bg = colors.primary + '18'; labelColor = colors.primary; fontWeight = '800'; fontSize = 14; }
  else if (level === 1) { bg = colors.card; fontWeight = '600'; }
  else if (level === 2) { bg = colors.background; fontWeight = '500'; }
  else if (level >= 3) { bg = colors.background; fontSize = 12; }
  if (isNegative && level === 0) { bg = colors.error + '15'; labelColor = colors.error; valueColor = colors.error; }

  return (
    <View style={[hierStyles.row, { backgroundColor: bg, borderBottomColor: colors.border, paddingLeft: 14 + level * 18 }]}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {level > 0 && <Ionicons name="return-down-forward" size={12} color={colors.textSecondary} />}
        <Text style={[{ fontSize, color: labelColor, fontWeight, flex: 1 }]} numberOfLines={2}>{label}</Text>
      </View>
      <Text style={[{ fontSize, fontWeight: level === 0 ? '800' : '700', color: valueColor, textAlign: 'right', fontVariant: ['tabular-nums'] as any }]} numberOfLines={1}>{valText}</Text>
    </View>
  );
};
const HierarchicalRow = memo(HierarchicalRowComp, (prev, next) => prev.item === next.item && prev.report === next.report && prev.colors === next.colors);

const hierStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
});

