/**
 * Rapor sonuç satırlarında arama + sıralama. Ağır iş `useDeferredValue` ile arka
 * planda yapılır; `isProcessing` sırasında UI'da küçük bir spinner gösterilir.
 */
import { useState, useEffect, useMemo, useDeferredValue, useCallback } from 'react';
import { FilterValues, ReportDef } from '../reports/types';

const compareRows = (a: any, b: any, key: string, asc: boolean) => {
  const va = a[key]; const vb = b[key];
  const na = parseFloat(va); const nb = parseFloat(vb);
  if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
  return asc
    ? String(va || '').localeCompare(String(vb || ''), 'tr')
    : String(vb || '').localeCompare(String(va || ''), 'tr');
};

/** Üst satır → alt (__isDetail) satır gruplamasını koruyarak sıralar. */
function sortRows(rows: any[], key: string, asc: boolean): any[] {
  if (!rows.some((r: any) => r.__isDetail)) return [...rows].sort((a, b) => compareRows(a, b, key, asc));
  const groups: { parent: any; children: any[] }[] = [];
  let current: { parent: any; children: any[] } | null = null;
  for (const row of rows) {
    if (row.__isDetail) { if (current) current.children.push(row); }
    else { current = { parent: row, children: [] }; groups.push(current); }
  }
  groups.sort((ga, gb) => compareRows(ga.parent, gb.parent, key, asc));
  return groups.flatMap(g => [g.parent, ...g.children]);
}

export function useProcessedRows(reportData: any[], report: ReportDef | null, filterValues: FilterValues) {
  const [sortKey, setSortKey] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // 300 ms debounce — her tuş vuruşunda filtreleme yapma
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchFilter.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchFilter]);

  const deferredSearch = useDeferredValue(debouncedSearch);
  const deferredSortKey = useDeferredValue(sortKey);
  const deferredSortAsc = useDeferredValue(sortAsc);
  const isSorting = sortKey !== deferredSortKey || sortAsc !== deferredSortAsc;
  const isProcessing =
    debouncedSearch !== deferredSearch || isSorting || searchFilter.trim().toLowerCase() !== debouncedSearch;

  const minTutar = filterValues?.MinTutar;
  const maxTutar = filterValues?.MaxTutar;
  const processedData = useMemo(() => {
    let d = reportData;
    if (deferredSearch) d = d.filter((row: any) => (row.__search || '').includes(deferredSearch));
    // Tutar filtresi (fis_kalem için istemci tarafı ek emniyet; POS Min/MaxTutar'ı desteklemeyebilir)
    if (report?.datasetKey === 'rap_fis_kalem_listesi_web') {
      const minT = parseFloat(String(minTutar ?? ''));
      const maxT = parseFloat(String(maxTutar ?? ''));
      const hasMin = !isNaN(minT) && minT > -99999999;
      const hasMax = !isNaN(maxT) && maxT < 99999999;
      if (hasMin || hasMax) {
        d = d.filter((row: any) => {
          if (row.__isDetail || row.__isHeader) return true;
          const tut = parseFloat(String(row.SATIR_GENEL_TOPLAM ?? row.DAHIL_NET_TUTAR ?? row.NET_TUTAR ?? '0')) || 0;
          if (hasMin && tut < minT) return false;
          if (hasMax && tut > maxT) return false;
          return true;
        });
      }
    }
    if (deferredSortKey) d = sortRows(d, deferredSortKey, deferredSortAsc);
    return d;
  }, [reportData, deferredSearch, deferredSortKey, deferredSortAsc, report?.datasetKey, minTutar, maxTutar]);

  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }, [sortKey]);
  const clearSort = useCallback(() => { setSortKey(''); setSortAsc(true); }, []);
  const clearSearch = useCallback(() => { setSearchFilter(''); setDebouncedSearch(''); }, []);
  const reset = useCallback(() => { setSortKey(''); setSearchFilter(''); }, []);

  return {
    processedData, isProcessing, isSorting,
    searchFilter, setSearchFilter, clearSearch, debouncedSearch,
    sortKey, sortAsc, toggleSort, clearSort, reset,
  };
}

export type ProcessedRows = ReturnType<typeof useProcessedRows>;
