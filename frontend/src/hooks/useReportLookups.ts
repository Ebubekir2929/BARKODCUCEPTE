/**
 * Rapor filtre seçenekleri (rap_filtre_lookup) önbelleği.
 * - Aynı kaynak için uçuştaki isteği tekilleştirir.
 * - Seçili rapor değişince tüm kaynakları paralel ön yükler (dropdown anında açılır).
 * - Boş listeyi önbelleğe ALMAZ: backend blobu olmayan tenant için POS'a tek seferlik
 *   istek atar; sonraki açılışta tekrar sorulur.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { LookupOption, ReportDef } from '../reports/types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export function useReportLookups(activeTenantId: string, report: ReportDef | null) {
  const [lookupCache, setLookupCache] = useState<Record<string, LookupOption[]>>({});
  const inflightRef = useRef<Map<string, Promise<LookupOption[] | null>>>(new Map());

  // Veri kaynağı (tenant) değişince eski tenant'ın listeleri geçersiz
  useEffect(() => {
    setLookupCache({});
    inflightRef.current.clear();
  }, [activeTenantId]);

  const fetchLookupSource = useCallback(async (source: string): Promise<LookupOption[] | null> => {
    if (lookupCache[source]) return lookupCache[source];
    const existing = inflightRef.current.get(source);
    if (existing) return existing;
    const { token } = useAuthStore.getState();
    if (!token || !activeTenantId) return null;

    const promise = (async () => {
      try {
        const resp = await fetch(`${API_URL}/api/data/report-filter-options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId, source }),
        });
        if (!resp.ok) return null;
        const j = await resp.json();
        if (!j?.ok || !Array.isArray(j?.data)) return null;
        const opts: LookupOption[] = j.data.map((r: any) => ({
          value: String(r.ID ?? r.AD ?? r.KOD ?? ''),
          label: String(r.AD || r.KOD || r.ID || ''),
        }));
        if (opts.length) setLookupCache(prev => ({ ...prev, [source]: opts }));
        return opts;
      } catch {
        return null;
      } finally {
        inflightRef.current.delete(source);
      }
    })();
    inflightRef.current.set(source, promise);
    return promise;
  }, [lookupCache, activeTenantId]);

  useEffect(() => {
    if (!report || !activeTenantId) return;
    report.filters
      .filter(f => f.source && !lookupCache[f.source])
      .forEach(f => { fetchLookupSource(f.source as string); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.key, activeTenantId, fetchLookupSource]);

  return { lookupCache, fetchLookupSource };
}
