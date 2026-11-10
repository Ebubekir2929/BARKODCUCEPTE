/**
 * Rapor çalıştırma: önce anlık cache_only yanıt (~200 ms), ardından arkada POS/taze
 * veri; POS "hazırlanıyor" durumunu (pendingInfo) bildirir. Aynı filtrelerle tekrar
 * çalıştırmada sonuç bellekten anında döner.
 */
import { useState, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { fetchReportWithPending, PendingInfo } from '../utils/reportFetch';
import { FilterValues, ReportDef } from '../reports/types';
import { buildReportParams } from '../reports/params';
import { indexRow, postProcessRows } from '../reports/postProcess';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export function useReportRunner(activeTenantId: string, onError: (title: string, message: string) => void) {
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportAgeSec, setReportAgeSec] = useState<number | null>(null); // tazelik rozeti
  const [pendingInfo, setPendingInfo] = useState<PendingInfo | null>(null);
  const runTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // key = `${reportKey}|${JSON.stringify(filterValues)}`
  const resultCacheRef = useRef<Map<string, any[]>>(new Map());

  /** Uçuştaki isteği iptal eder ve bekleyen sonuçları geçersiz kılar. */
  const cancel = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* zaten iptal */ } }
    runTokenRef.current++;
    setReportLoading(false);
    setPendingInfo(null);
  }, []);

  const clear = useCallback(() => setReportData([]), []);

  const run = useCallback(async (report: ReportDef, filterValues: FilterValues) => {
    if (!activeTenantId) return;
    const baseParams = buildReportParams(report, filterValues);
    const pageSize = Number(baseParams.PageSize || 500);
    const cacheKey = `${report.key}|${JSON.stringify(filterValues)}`;

    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* zaten iptal */ } }
    const controller = new AbortController();
    abortRef.current = controller;
    const tokenId = ++runTokenRef.current;
    const isCurrent = () => runTokenRef.current === tokenId && !controller.signal.aborted;

    const cached = resultCacheRef.current.get(cacheKey);
    if (cached && cached.length > 0) {
      setReportData(cached);
      setReportLoading(false);
      return;
    }

    setReportLoading(true); setReportData([]); setReportAgeSec(null);
    try {
      const { token } = useAuthStore.getState();
      const bodyBase = {
        tenant_id: activeTenantId,
        dataset_key: report.datasetKey,
        params: { ...baseParams, Page: 1, PageSize: pageSize },
        fetch_all: true,
      };

      // 1) Anlık cache-only yanıt
      try {
        const cacheResp = await fetch(`${API_URL}/api/data/report-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ ...bodyBase, cache_only: true }),
          signal: controller.signal,
        });
        const cJson = await cacheResp.json().catch(() => ({}));
        if (cJson?.ok && Array.isArray(cJson.data) && cJson.data.length > 0) {
          setReportData(cJson.data.map(indexRow));
          setReportAgeSec(typeof cJson._age === 'number' ? cJson._age : 0);
          setReportLoading(false);
        }
      } catch { /* cache miss OK */ }

      // 2) Tam çekim (POS veya taze backend cache) — POS 25 sn'de bitirmezse pending döner
      const first = await fetchReportWithPending(bodyBase, token, {
        signal: controller.signal,
        onPending: (p) => { if (runTokenRef.current === tokenId) setPendingInfo(p); },
      });
      setPendingInfo(null);
      if (!isCurrent()) return;
      if (!first.ok) { onError('Hata', first.detail || 'Rapor çalıştırılamadı'); setReportLoading(false); return; }
      const firstRows: any[] = (first.data || []).map(indexRow);
      setReportData(firstRows);
      setReportLoading(false);

      const finalRows = await postProcessRows(report, baseParams, firstRows, {
        tenantId: activeTenantId, token, signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (finalRows !== firstRows) setReportData(finalRows);
      resultCacheRef.current.set(cacheKey, finalRows);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error(err);
        if (runTokenRef.current === tokenId) onError('Hata', 'Bağlantı hatası');
      }
    } finally {
      if (runTokenRef.current === tokenId) { setReportLoading(false); setPendingInfo(null); }
    }
  }, [activeTenantId, onError]);

  return { reportData, reportLoading, reportAgeSec, pendingInfo, run, cancel, clear };
}

export type ReportRunner = ReturnType<typeof useReportRunner>;
