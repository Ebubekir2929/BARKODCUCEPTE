/**
 * Rapor Excel (.xlsx) dışa aktarımı: veri sayfası + (varsa) Özet sayfası.
 * Fiş Kalem gruplu görünümde fiş başlığı / kalem satırları "Tür" kolonlu geniş formatta yazılır.
 */
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { ReportDef } from './types';
import { isTruthyFlag, toNum } from './format';
import { computeSummaryStats, fisKalemSatisAlis, personelToplamSatis } from './summary';

const FIS_KALEM_HEADERS = ['Tür', 'Tarih', 'Belge No', 'Fiş Türü', 'Alt Tür', 'Lokasyon', 'Cari Kod', 'Cari', 'Stok Kod', 'Stok', 'Birim', 'Miktar', 'Net Fiyat', 'Net Tutar', 'KDV', 'Dahil Net', 'Satır Toplam', 'Kalem Sayısı'];

function fisKalemRow(r: any): Record<string, any> {
  const isHeader = !!r.__isFisHeader;
  return {
    'Tür': isHeader ? 'FİŞ' : '  Kalem',
    'Tarih': isHeader ? String(r.FIS_TARIHI || '').split(' ')[0] : '',
    'Belge No': r.BELGENO || '',
    'Fiş Türü': isHeader ? r.FIS_TURU || '' : '',
    'Alt Tür': isHeader ? r.FIS_ALT_TIPI || '' : '',
    'Lokasyon': isHeader ? r.LOKASYON || '' : '',
    'Cari Kod': isHeader ? r.CARI_KOD || '' : '',
    'Cari': isHeader ? r.CARI_AD || '' : '',
    'Stok Kod': isHeader ? '' : r.STOK_KOD || '',
    'Stok': isHeader ? '' : r.STOK_AD || '',
    'Birim': isHeader ? '' : r.STOK_BIRIM || '',
    'Miktar': toNum(r.MIKTAR_FIS),
    'Net Fiyat': isHeader ? '' : toNum(r.NET_FIYAT),
    'Net Tutar': toNum(r.NET_TUTAR),
    'KDV': toNum(r.KDV_TUTAR),
    'Dahil Net': toNum(r.DAHIL_NET_TUTAR),
    'Satır Toplam': toNum(r.SATIR_GENEL_TOPLAM),
    'Kalem Sayısı': isHeader ? r.KALEM_SAYISI || 0 : '',
  };
}

function plainRow(report: ReportDef, r: any): Record<string, any> {
  const o: Record<string, any> = {};
  report.columns.forEach(c => {
    let v = r[c.key];
    if (c.type === 'money' || c.type === 'number') v = toNum(v);
    else if (c.type === 'bool') v = isTruthyFlag(v) ? 'Evet' : 'Hayır';
    else v = v === null || v === undefined ? '' : String(v);
    o[c.label] = v;
  });
  return o;
}

function buildSummarySheet(report: ReportDef, data: any[]): XLSX.WorkSheet | null {
  const s = report.summary;
  if (!s) return null;
  const stats = computeSummaryStats(data, s);
  if (!stats) return null;
  const pick = (f: (k: string) => number) => Object.fromEntries(s.cols.map(c => [c.label, f(c.key)]));
  const summaryRows: any[] = s.showOnlyTotal
    ? [{ '': 'TOPLAM', ...pick(k => stats[k].total) }]
    : [
        { '': 'TOPLAM', ...pick(k => stats[k].total) },
        { '': 'EN DÜŞÜK', ...pick(k => stats[k].min) },
        { '': 'EN YÜKSEK', ...pick(k => stats[k].max) },
      ];
  const firstCol = s.cols[0]?.label || '';
  if (report.key === 'personel_satis') {
    summaryRows.unshift({ '': 'TOPLAM SATIŞ', [firstCol]: personelToplamSatis(data).toplam });
  } else if (report.key === 'fis_kalem') {
    const { satis, alis } = fisKalemSatisAlis(data);
    summaryRows.unshift({ '': 'SATIŞ TOPLAMI', [firstCol]: satis });
    summaryRows.unshift({ '': 'ALIŞ TOPLAMI', [firstCol]: alis });
  }
  const ws = XLSX.utils.json_to_sheet(summaryRows, { header: ['', ...s.cols.map(c => c.label)] });
  (ws as any)['!cols'] = [{ wch: 18 }, ...s.cols.map(() => ({ wch: 16 }))];
  return ws;
}

export async function exportReportExcel(report: ReportDef, data: any[]): Promise<void> {
  const grouped = report.key === 'fis_kalem' && data.some(r => r.__isFisHeader);
  const rows = grouped ? data.map(fisKalemRow) : data.map(r => plainRow(report, r));
  const header = grouped ? FIS_KALEM_HEADERS : report.columns.map(c => c.label);

  const ws = XLSX.utils.json_to_sheet(rows, { header });
  (ws as any)['!cols'] = header.map(h => {
    let maxLen = h.length;
    for (const r of rows) maxLen = Math.max(maxLen, String(r[h] ?? '').length);
    return { wch: Math.min(40, Math.max(8, maxLen + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (report.title || 'Rapor').substring(0, 31));
  const wsS = buildSummarySheet(report, data);
  if (wsS) XLSX.utils.book_append_sheet(wb, wsS, 'Özet');

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const fileName = `${report.key}_${ts}.xlsx`;
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (Platform.OS === 'web') {
    const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const url = URL.createObjectURL(new Blob([wbout], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    return;
  }
  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const uri = FileSystem.cacheDirectory + fileName;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, { mimeType: mime, UTI: 'com.microsoft.excel.xlsx', dialogTitle: report.title });
}
