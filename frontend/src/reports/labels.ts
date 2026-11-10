/**
 * Rapor etiket çevirileri. Rapor tanımlarındaki filtre/kolon etiketleri TR saklanır;
 * dil EN ise bu sözlükten çevrilir.
 */
import { FilterValues, ReportDef } from './types';
import { formatDateTR } from './dates';

type Translate = (key: any) => string;

export const reportTitle = (report: ReportDef, t: Translate) => {
  const key = `report_${report.key}`;
  const tr = t(key);
  return tr !== key ? tr : report.title;
};

export const reportDesc = (report: ReportDef, t: Translate) => {
  const key = `report_${report.key}_desc`;
  const tr = t(key);
  return tr !== key ? tr : report.description;
};

export const translateLabel = (label: string | undefined | null, language: string): string => {
  if (!label) return label || '';
  if (language !== 'en') return label;
  return LABEL_MAP[label] || label;
};

/**
 * Filtre değerlerinin tek satırlık özeti (Son Raporlar kartı / favori ipucu):
 * "10.11.2026 · Personel: 2 · KDV Hariç". Varsayılanıyla aynı sabit seçenekler gizlenir.
 */
export function summarizeFilters(report: ReportDef, values: FilterValues): string {
  const parts: string[] = [];
  const bas = values.BASTARIH ? formatDateTR(String(values.BASTARIH)) : '';
  const bit = values.BITTARIH ? formatDateTR(String(values.BITTARIH)) : '';
  if (bas || bit) parts.push(bas && bit && bas !== bit ? `${bas} – ${bit}` : bas || bit);
  const seen = new Set<string>();
  for (const f of report.filters) {
    if (f.type === 'date' || seen.has(f.name)) continue;
    seen.add(f.name);
    const v = values[f.name];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'multiselect') {
      parts.push(`${f.label}: ${String(v).split(',').filter(Boolean).length}`);
    } else if (f.type === 'select_static') {
      if (String(v) === String(report.defaultParams[f.name] ?? '')) continue;
      const opt = f.options?.find(o => String(o.value) === String(v));
      parts.push(opt ? opt.label : `${f.label}: ${v}`);
    } else {
      parts.push(`${f.label}: ${v}`);
    }
  }
  return parts.join(' · ') || 'Filtre yok';
}

/** Favoriye kaydedilecek değerler: tarih dışı, boş olmayan ve (sabit seçeneklerde) varsayılandan farklı filtreler. */
export function pickFavoriteValues(report: ReportDef, values: FilterValues): FilterValues {
  const out: FilterValues = {};
  for (const f of report.filters) {
    if (f.type === 'date') continue;
    const v = values[f.name];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'select_static' && String(v) === String(report.defaultParams[f.name] ?? '')) continue;
    out[f.name] = v;
  }
  return out;
}

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
