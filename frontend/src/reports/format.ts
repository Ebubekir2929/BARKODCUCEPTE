/**
 * Rapor hücre biçimlendirme yardımcıları (TR yerel ayarı, ₺).
 */
import { ColDef } from './types';
import { formatDateCell } from './dates';

export const toNum = (v: any): number => parseFloat(String(v ?? '0')) || 0;

export const fmtMoney = (n: number) =>
  `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtNumber = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

export const isTruthyFlag = (v: any) => v === true || v === 1 || v === '1';

/** Kolon tipine göre ham değeri görüntü metnine çevirir. */
export const renderValue = (val: any, col: ColDef): string => {
  if (col.type === 'money') return `₺${parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
  if (col.type === 'number') return parseFloat(val || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 });
  if (col.type === 'bool') return isTruthyFlag(val) ? 'Evet' : 'Hayır';
  // Kolon adı TARIH / ZAMAN / DATE içeriyorsa tarih+saat normalize et (AM/PM yok)
  if (typeof val === 'string' && /TARIH|ZAMAN|DATE|_DT\b/i.test(col.key)) return formatDateCell(val);
  // Genel kolonlarda ISO/US tarih benzeri metinleri otomatik algıla
  if (typeof val === 'string' && /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{2}\.\d{2}\.\d{4})(?:[\sT]\d{1,2}:\d{2})?/.test(val)) {
    return formatDateCell(val);
  }
  return String(val || '-');
};
