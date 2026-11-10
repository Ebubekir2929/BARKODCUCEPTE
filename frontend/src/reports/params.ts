/**
 * Rapor parametre hazırlama: başlangıç filtre değerleri, zorunlu alan kontrolü ve
 * POS'a gidecek parametre setinin oluşturulması.
 */
import { FilterValues, ReportDef } from './types';
import { today, padDate } from './dates';

/** Filtre modalı açılışındaki varsayılan değerler. Tarihler her raporda BUGÜN gelir. */
export function buildInitialFilterValues(report: ReportDef): FilterValues {
  const vals: FilterValues = {};
  report.filters.forEach(f => {
    if (f.type === 'date') vals[f.name] = today();
    else if (f.type === 'select_static' || f.type === 'text') vals[f.name] = report.defaultParams[f.name] ?? '';
    else vals[f.name] = ''; // multiselect empty
  });
  return vals;
}

/** Zorunlu filtre eksikse uyarı metni döner, aksi halde null. */
export function validateFilters(report: ReportDef, filterValues: FilterValues): { title: string; message: string } | null {
  if (report.requiredFilters && report.requiredFilters.length > 0) {
    for (const reqName of report.requiredFilters) {
      const val = filterValues[reqName];
      if (val === undefined || val === null || val === '') {
        const filt = report.filters.find(f => f.name === reqName);
        return {
          title: 'Zorunlu Filtre',
          message: `Bu raporu çalıştırmak için "${filt?.label || reqName}" alanını seçmelisiniz.`,
        };
      }
    }
    return null;
  }
  if (report.requireNarrowing) {
    const hasNarrow = report.filters.some(f =>
      f.type === 'multiselect' && filterValues[f.name] && filterValues[f.name].length > 0,
    );
    if (!hasNarrow) {
      return {
        title: 'Filtre Gerekli',
        message: 'Sonucu daraltmak için en az bir filtre seçmelisiniz (örn. Stok, Cari, Lokasyon).',
      };
    }
  }
  return null;
}

/** defaultParams + kullanıcı filtreleri → POS parametreleri (sayısal dönüşüm + tam gün tarih). */
export function buildReportParams(report: ReportDef, filterValues: FilterValues): Record<string, any> {
  const params: Record<string, any> = { ...report.defaultParams };
  Object.entries(filterValues).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    const def = report.filters.find(f => f.name === k);
    if (def?.numeric && typeof v === 'string') {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) params[k] = n; // geçersiz sayıyı varsayılanda bırak
    } else {
      params[k] = v;
    }
  });
  report.filters.forEach(f => {
    if (f.type !== 'date') return;
    const v = params[f.name];
    if (v === undefined || v === null || v === '') return;
    const isEnd = /^(BIT|BITTARIH|BITIS|END_)/i.test(f.name) || /bit|end/i.test(f.name);
    params[f.name] = padDate(v, isEnd);
  });
  // filters[] içinde olmayan örtük tarih varsayılanlarını da tamamla
  ['BASTARIH', 'SDATE', 'sdate'].forEach(k => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') params[k] = padDate(params[k], false);
  });
  ['BITTARIH', 'EDATE', 'edate'].forEach(k => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') params[k] = padDate(params[k], true);
  });
  return params;
}
