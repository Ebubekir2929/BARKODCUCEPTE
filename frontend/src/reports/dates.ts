/**
 * Rapor tarih yardımcıları (ISO "YYYY-MM-DD" tabanlı).
 */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const firstOfYear = () => {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
};

export const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/** "2026-04-18 23:59:59" → "18.04.2026" */
export const formatDateTR = (iso: string): string => {
  if (!iso) return '';
  const datePart = iso.split(' ')[0].split('T')[0];
  const parts = datePart.split('-');
  if (parts.length !== 3) return datePart;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
};

/**
 * POS yalnızca tarih verilen aralıkları reddediyor; tarih filtrelerini tam güne tamamla:
 *   başlangıç → "YYYY-MM-DD 00:00:00", bitiş → "YYYY-MM-DD 23:59:59".
 * Saat zaten varsa dokunma.
 */
export const padDate = (v: any, endOfDay: boolean): string => {
  const s = String(v ?? '').trim();
  if (!s) return s;
  if (/\d{2}:\d{2}/.test(s)) return s;
  const datePart = s.split(' ')[0].split('T')[0];
  return endOfDay ? `${datePart} 23:59:59` : `${datePart} 00:00:00`;
};

/** ISO / "YYYY-MM-DD" → Date (geçersizse bugün). DateTimePicker değeri için. */
export const isoToDate = (v: any): Date => {
  if (!v) return new Date();
  const [yy, mm, dd] = String(v).slice(0, 10).split('-').map(n => parseInt(n, 10));
  if (!yy || !mm || !dd || yy < 1990) return new Date();
  const d = new Date(yy, mm - 1, dd);
  return isNaN(d.getTime()) ? new Date() : d;
};

export const dateToIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const to24h = (h: string | undefined, ampm: string | undefined): number => {
  let hh = h ? parseInt(h, 10) : NaN;
  if (ampm && !Number.isNaN(hh)) {
    const up = ampm.toUpperCase();
    if (up === 'PM' && hh < 12) hh += 12;
    if (up === 'AM' && hh === 12) hh = 0;
  }
  return hh;
};

/**
 * Tarih benzeri hücre değerini AM/PM'siz 24 saatlik Türkçe biçime çevirir: "DD.MM.YYYY HH:MM".
 * Desteklenen girdiler: "2026-05-02 14:09:26", "2026-05-02T14:09:26", "05/02/2026 02:09:26 PM",
 * "02.05.2026 14:09", "2026-05-02".
 */
export const formatDateCell = (raw: string): string => {
  if (!raw) return '';
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\sT](\d{2}):(\d{2})(?::\d{2})?)?/);
  if (iso) {
    const [, y, mo, d, hh, mm] = iso;
    return hh && mm ? `${d}.${mo}.${y} ${hh}:${mm}` : `${d}.${mo}.${y}`;
  }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  if (us) {
    const [, mo, d, y, h, mm, ampm] = us;
    const hh = to24h(h, ampm);
    if (Number.isNaN(hh)) return `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${y}`;
    return `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${y} ${String(hh).padStart(2, '0')}:${mm}`;
  }
  const tr = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  if (tr) {
    const [, d, mo, y, h, mm, ampm] = tr;
    const hh = to24h(h, ampm);
    if (Number.isNaN(hh)) return `${d}.${mo}.${y}`;
    return `${d}.${mo}.${y} ${String(hh).padStart(2, '0')}:${mm}`;
  }
  return s;
};
