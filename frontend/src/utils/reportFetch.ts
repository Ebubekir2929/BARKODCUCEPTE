/**
 * 2026-09 v16 — Rapor çekme yardımcısı ("hazırlanıyor" modeli).
 *
 * Backend `/api/data/report-run` artık POS zaman aşımında HATA vermez;
 * `pending:true` + POS durumu + geçen süre döner ve arka planda beklemeye
 * devam eder. Bu yardımcı, rapor bitene kadar 3 sn arayla aynı isteği
 * yineler ve her turda `onPending` ile durum bildirir. İkinci turlardan
 * itibaren `force_refresh` gönderilmez → POS'a ikinci istek AÇILMAZ.
 */
import Constants from 'expo-constants';

const API_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as any)?.backendUrl ||
  '';

export interface PendingInfo {
  /** POS durumu: queued | running | indiriliyor | baslatiliyor | sayfa N */
  status: string;
  /** Raporun POS'a gönderilmesinden bu yana geçen saniye */
  elapsedSec: number;
}

export const pendingLabel = (p: PendingInfo | null): string => {
  if (!p) return '';
  const s = (p.status || '').toLowerCase();
  let durum = 'POS raporu hazırlıyor';
  if (s === 'queued') durum = 'POS kuyruğunda sırada';
  else if (s === 'running') durum = 'POS\'ta çalışıyor';
  else if (s === 'indiriliyor') durum = 'Sonuç indiriliyor';
  else if (s.startsWith('sayfa')) durum = `Sonraki sayfalar alınıyor (${s})`;
  const dk = Math.floor(p.elapsedSec / 60);
  const sn = p.elapsedSec % 60;
  const sure = dk > 0 ? `${dk} dk ${sn} sn` : `${sn} sn`;
  return `${durum} · ${sure}`;
};

export async function fetchReportWithPending(
  body: Record<string, any>,
  token: string | null | undefined,
  opts: {
    signal?: AbortSignal;
    onPending?: (p: PendingInfo | null) => void;
    /** Toplam bekleme üst sınırı (ms). Varsayılan 10 dk. */
    maxWaitMs?: number;
    /** Yineleme aralığı (ms). Varsayılan 3 sn. */
    intervalMs?: number;
  } = {},
): Promise<any> {
  const { signal, onPending, maxWaitMs = 10 * 60 * 1000, intervalMs = 3000 } = opts;
  const basla = Date.now();
  // İlk tur kullanıcının isteğini aynen taşır; sonraki turlar sadece bekler.
  let gonder: Record<string, any> = { ...body };
  for (;;) {
    const resp = await fetch(`${API_URL}/api/data/report-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(gonder),
      signal,
    });
    const j = await resp.json().catch(() => ({}));
    if (!j?.pending) {
      onPending?.(null);
      return j;
    }
    onPending?.({ status: String(j.status || 'running'), elapsedSec: Number(j.elapsed_sec || 0) });
    if (Date.now() - basla > maxWaitMs) {
      onPending?.(null);
      return { ok: false, detail: 'Rapor POS tarafından 10 dakikada hazırlanamadı. Tarih aralığını daraltıp tekrar deneyin.' };
    }
    // _pending_poll: backend bu yinelemeleri rapor kullanım sayacına eklemez
    gonder = { ...body, force_refresh: false, cache_only: false, _pending_poll: true };
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, intervalMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
}
