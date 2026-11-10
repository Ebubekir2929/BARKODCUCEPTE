/**
 * Rapor sonuç satırlarının son işlemesi:
 *  - arama indeksi (__search)
 *  - Cari Ekstre Detaylı=1 → her fiş/faturanın altına stok kalemleri (fis_kalem çekilir)
 *  - Fiş Kalem Listesi → BELGENO bazında fiş başlığı kartları (+ isteğe bağlı kalemler)
 */
import { fetchReportWithPending } from '../utils/reportFetch';
import { STOK_FILTER_DEFAULTS } from './definitions';
import { firstOfYear, today } from './dates';
import { ReportDef } from './types';
import { toNum } from './format';

/** Aranabilir metni satıra bir kez yazar; sonraki filtreleme O(1)/satır olur. */
export const indexRow = (row: any) => {
  const parts: string[] = [];
  for (const k in row) {
    const v = row[k];
    if (v !== null && v !== undefined && typeof v !== 'object') parts.push(String(v));
  }
  row.__search = parts.join(' ').toLowerCase();
  return row;
};

const wantsDetail = (params: Record<string, any>) => params.Detayli === 1 || params.Detayli === '1';

function cariEkstreFisParams(baseParams: Record<string, any>) {
  return {
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
}

/** Cari ekstre satırlarının altına BELGENO eşleşen fiş kalemlerini ekler. */
export function expandCariEkstre(rows: any[], fisRows: any[]): any[] {
  if (fisRows.length === 0) return rows;
  const byBelge: Record<string, any[]> = {};
  for (const fr of fisRows) {
    const bn = String(fr.BELGENO || '').trim();
    if (!bn) continue;
    (byBelge[bn] = byBelge[bn] || []).push(fr);
  }
  const expanded: any[] = [];
  for (const row of rows) {
    expanded.push(row);
    const bn = String(row.BELGENO || '').trim();
    if (bn && byBelge[bn]) {
      for (const child of byBelge[bn]) expanded.push(indexRow({ ...child, __isDetail: true, __parentBelgeNo: bn }));
    }
  }
  return expanded.length !== rows.length ? expanded : rows;
}

/** Fiş kalemlerini BELGENO'ya göre gruplar; başlık kartı + (Detaylı=1 ise) kalemler. */
export function groupFisKalem(rows: any[], wantDetails: boolean): any[] {
  const groups = new Map<string, { header: any; items: any[] }>();
  for (const row of rows) {
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
          NET_TUTAR: 0, KDV_TUTAR: 0, DAHIL_NET_TUTAR: 0, SATIR_GENEL_TOPLAM: 0, MIKTAR_FIS: 0,
          KALEM_SAYISI: 0,
          __isFisHeader: true,
        },
        items: [],
      });
    }
    const g = groups.get(bn)!;
    g.items.push(row);
    g.header.NET_TUTAR += toNum(row.NET_TUTAR);
    g.header.KDV_TUTAR += toNum(row.KDV_TUTAR);
    g.header.DAHIL_NET_TUTAR += toNum(row.DAHIL_NET_TUTAR);
    g.header.SATIR_GENEL_TOPLAM += toNum(row.SATIR_GENEL_TOPLAM);
    g.header.MIKTAR_FIS += toNum(row.MIKTAR_FIS);
    g.header.KALEM_SAYISI = g.items.length;
  }
  if (groups.size === 0) return rows;
  const result: any[] = [];
  for (const [, g] of groups) {
    result.push(indexRow(g.header));
    if (wantDetails) {
      for (const item of g.items) result.push(indexRow({ ...item, __isDetail: true, __parentBelgeNo: g.header.BELGENO }));
    }
  }
  return result;
}

export interface PostProcessCtx { tenantId: string; token: string | null | undefined; signal: AbortSignal }

/** Rapora özel son işleme; değişiklik yoksa aynı diziyi döndürür. */
export async function postProcessRows(
  report: ReportDef, baseParams: Record<string, any>, rows: any[], ctx: PostProcessCtx,
): Promise<any[]> {
  if (report.key === 'cari_ekstre' && wantsDetail(baseParams)) {
    try {
      const fis = await fetchReportWithPending(
        { tenant_id: ctx.tenantId, dataset_key: 'rap_fis_kalem_listesi_web', params: cariEkstreFisParams(baseParams), fetch_all: true },
        ctx.token,
        { signal: ctx.signal },
      );
      if (ctx.signal.aborted) return rows;
      return expandCariEkstre(rows, Array.isArray(fis?.data) ? fis.data : []);
    } catch (err) {
      console.warn('Cari Ekstre drill-down failed:', err);
      return rows;
    }
  }
  if (report.key === 'fis_kalem') return groupFisKalem(rows, wantsDetail(baseParams));
  return rows;
}
