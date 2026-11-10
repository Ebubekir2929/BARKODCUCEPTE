/**
 * Rapor özet istatistikleri (TOPLAM / EN DÜŞÜK / EN YÜKSEK) ve rapora özel üst
 * banner toplamları. Ekran, PDF ve Excel aynı hesabı buradan kullanır.
 */
import { SummaryConfig } from './types';
import { toNum } from './format';

export interface SummaryStat { total: number; min: number; max: number }

export function computeSummaryStats(rows: any[], config: SummaryConfig): Record<string, SummaryStat> | null {
  if (!rows || rows.length === 0) return null;
  // POS satırların her birinde TOPLAM_* döndürür; varsa ilk satırdan oku, yoksa topla.
  const firstRow = rows[0] || {};
  const out: Record<string, SummaryStat> = {};
  for (const col of config.cols) {
    let sum = 0, min = Infinity, max = -Infinity, count = 0;
    for (const r of rows) {
      const n = parseFloat(String(r[col.key] ?? '0'));
      if (isNaN(n)) continue;
      sum += n; count++;
      if (n < min) min = n;
      if (n > max) max = n;
    }
    const totalKey = config.totalsFromRow?.[col.key];
    const computed = config.totalsComputed?.[col.key];
    let total: number;
    if (computed) {
      const a = toNum(firstRow[computed.a]);
      const b = toNum(firstRow[computed.b]);
      total = computed.op === 'sub' ? a - b : a + b;
    } else if (totalKey != null) {
      total = toNum(firstRow[totalKey]) || sum;
    } else {
      total = sum;
    }
    out[col.key] = { total, min: count ? min : 0, max: count ? max : 0 };
  }
  return out;
}

/** Personel Satış Özet: toplam net satış + fiş adedi (POS toplamı varsa onu kullan). */
export function personelToplamSatis(rows: any[]): { toplam: number; fisAdet: number } {
  const firstRow = rows[0] || {};
  let toplam = parseFloat(String(firstRow.TOPLAM_TUTAR_NET ?? '0'));
  if (!(toplam > 0)) toplam = rows.reduce((acc: number, r: any) => acc + toNum(r.TUTAR_NET), 0);
  const fisAdet = parseFloat(String(
    firstRow.TOPLAM_FIS_ADET ?? rows.reduce((a: number, r: any) => a + toNum(r.FIS_ADET), 0),
  ));
  return { toplam, fisAdet };
}

/** Fiş Kalem Listesi: satış / alış toplamları (detay satırları hariç). */
export function fisKalemSatisAlis(rows: any[]): { satis: number; alis: number; satisAdet: number; alisAdet: number } {
  let satis = 0, alis = 0, satisAdet = 0, alisAdet = 0;
  for (const row of rows) {
    if (row.__isDetail) continue;
    const tut = toNum(row.SATIR_GENEL_TOPLAM || row.DAHIL_NET_TUTAR);
    const ft = String(row.FIS_TURU || '').toLowerCase();
    if (ft.includes('alış') || ft.includes('alis')) { alis += tut; alisAdet += 1; }
    else { satis += tut; satisAdet += 1; }
  }
  return { satis, alis, satisAdet, alisAdet };
}

export const isDetayli = (filterValues: Record<string, any> | undefined) => {
  const det = filterValues?.Detayli;
  return det === 1 || det === '1';
};
