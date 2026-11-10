/**
 * Rapor PDF dışa aktarımı. Büyük veri setlerinde HTML gövdesi 250'lik parçalarla
 * ve `setTimeout(0)` nefesleriyle üretilir (Android expo-print bellek çökmesi önlemi);
 * ilerleme `onProgress` ile bildirilir.
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { FilterValues, ReportDef } from './types';
import { fmtMoney, renderValue, toNum } from './format';
import { computeSummaryStats, fisKalemSatisAlis, isDetayli, personelToplamSatis } from './summary';

const PDF_CHUNK_SIZE = 250;

export type PdfExportResult = 'shared' | 'popup_blocked' | { savedUri: string };

const td = 'padding:6px;border:1px solid #e5e7eb';

function buildTopBannerHtml(report: ReportDef, rows: any[], filterValues: FilterValues): string {
  if (report.key === 'personel_satis') {
    const { toplam, fisAdet } = personelToplamSatis(rows);
    return `<div style="padding:14px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px;margin-bottom:12px;display:flex;align-items:center;gap:12px"><div style="font-size:11px;font-weight:800;color:#16a34a;letter-spacing:0.5px">TOPLAM SATIŞ</div><div style="font-size:22px;font-weight:800">${fmtMoney(toplam)}</div><div style="font-size:11px;color:#666;margin-left:auto">${fisAdet.toLocaleString('tr-TR')} fiş · ${rows.length} personel</div></div>`;
  }
  if (report.key === 'fis_kalem') {
    const { satis, alis, satisAdet, alisAdet } = fisKalemSatisAlis(rows);
    return `<div style="display:flex;gap:10px;margin-bottom:12px"><div style="flex:1;padding:12px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px"><div style="font-size:10px;font-weight:800;color:#16a34a">SATIŞ TOPLAMI</div><div style="font-size:18px;font-weight:800">${fmtMoney(satis)}</div><div style="font-size:10px;color:#666">${satisAdet} fiş/fatura</div></div><div style="flex:1;padding:12px;background:#fef2f2;border:2px solid #dc2626;border-radius:10px"><div style="font-size:10px;font-weight:800;color:#dc2626">ALIŞ TOPLAMI</div><div style="font-size:18px;font-weight:800">${fmtMoney(alis)}</div><div style="font-size:10px;color:#666">${alisAdet} fiş/fatura</div></div></div>`;
  }
  if (report.key === 'cari_ekstre' && isDetayli(filterValues)) {
    const detailCount = rows.filter((r: any) => r.__isDetail).length;
    return `<div style="padding:10px;background:#eff6ff;border:1px solid #2563eb;border-radius:8px;margin-bottom:12px;color:#1e40af;font-size:12px">💡 Her fiş / faturanın altında <b>stok kalemleri</b> gösterilmektedir (${detailCount} stok kalemi)</div>`;
  }
  return '';
}

function buildSummaryHtml(report: ReportDef, rows: any[]): string {
  const s = report.summary;
  if (!s) return '';
  const stats = computeSummaryStats(rows, s);
  if (!stats) return '';
  const fmtS = (v: number, t?: string) => t === 'money' ? fmtMoney(v) : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  const cell = (v: number, t?: string) => `<td style="text-align:right;${td}">${fmtS(v, t)}</td>`;
  const line = (bg: string, color: string, label: string, pick: (k: string) => number) =>
    `<tr style="background:${bg}"><td style="${td};font-weight:700;color:${color}">${label}</td>${s.cols.map(c => cell(pick(c.key), c.type)).join('')}</tr>`;
  const bodyRows = line('#eff6ff', '#1d4ed8', 'TOPLAM', k => stats[k].total)
    + (s.showOnlyTotal ? '' : line('#fef2f2', '#b91c1c', 'EN DÜŞÜK', k => stats[k].min) + line('#f0fdf4', '#047857', 'EN YÜKSEK', k => stats[k].max));
  return `<h3 style="margin:14px 0 6px">Rapor Özeti</h3><table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:10px"><thead><tr><th style="padding:6px;background:#f3f4f6;border:1px solid #e5e7eb"></th>${s.cols.map(c => `<th style="padding:6px;background:#f3f4f6;border:1px solid #e5e7eb;text-align:right">${c.label}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function renderRowHtml(report: ReportDef, r: any): string {
  const cols = report.columns;
  if (r.__isFisHeader) {
    return `<tr style="background:#dbeafe"><td colspan="${cols.length}" style="padding:8px;border:1px solid #2563eb;font-weight:700;color:#1e40af">📄 ${r.BELGENO || ''} · ${r.FIS_TURU || ''}${r.CARI_AD ? ' · ' + r.CARI_AD : ''}${r.FIS_TARIHI ? ' · ' + String(r.FIS_TARIHI).split(' ')[0] : ''} &nbsp;&nbsp;→&nbsp;&nbsp; <b>${fmtMoney(toNum(r.SATIR_GENEL_TOPLAM))}</b> (${r.KALEM_SAYISI || 0} kalem)</td></tr>`;
  }
  if (r.__isDetail) {
    return `<tr style="background:#f9fafb"><td colspan="${cols.length}" style="padding:6px 8px 6px 24px;border:1px solid #e5e7eb;font-size:10px">&nbsp;&nbsp;➡ <b>${r.STOK_KOD || ''}</b> ${r.STOK_AD || ''} — Miktar: ${toNum(r.MIKTAR_FIS).toLocaleString('tr-TR')} ${r.STOK_BIRIM || ''} · Fiyat: ${fmtMoney(toNum(r.NET_FIYAT))} · KDV: ${fmtMoney(toNum(r.KDV_TUTAR))} · <b>${fmtMoney(toNum(r.SATIR_GENEL_TOPLAM))}</b></td></tr>`;
  }
  return `<tr>${cols.map(c => `<td>${renderValue(r[c.key], c)}</td>`).join('')}</tr>`;
}

export async function exportReportPdf(opts: {
  report: ReportDef;
  rows: any[];
  filterValues: FilterValues;
  onProgress: (done: number, total: number) => void;
}): Promise<PdfExportResult> {
  const { report, rows, filterValues, onProgress } = opts;
  onProgress(0, rows.length);
  await new Promise(resolve => setTimeout(resolve, 0)); // overlay önce çizilsin

  const bodyChunks: string[] = [];
  for (let i = 0; i < rows.length; i += PDF_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + PDF_CHUNK_SIZE);
    bodyChunks.push(chunk.map(r => renderRowHtml(report, r)).join(''));
    onProgress(Math.min(i + PDF_CHUNK_SIZE, rows.length), rows.length);
    if (i + PDF_CHUNK_SIZE < rows.length) await new Promise(res => setTimeout(res, 0));
  }

  const cols = report.columns;
  const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:16px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:5px;text-align:left;font-size:10px}th{background:#f5f5f5;font-weight:bold}h2{font-size:16px;margin:0 0 8px}h3{font-size:13px}</style></head><body><h2>${report.title}</h2><p style="color:#666">${rows.length.toLocaleString('tr-TR')} kayıt · ${new Date().toLocaleDateString('tr-TR')}</p>${buildTopBannerHtml(report, rows, filterValues)}${buildSummaryHtml(report, rows)}<table><thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${bodyChunks.join('')}</tbody></table></body></html>`;

  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (!w) return 'popup_blocked';
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* yazdırma iptal */ } }, 500);
    return 'shared';
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: report.title });
    return 'shared';
  }
  return { savedUri: uri };
}
