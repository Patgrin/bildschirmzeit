// Datums-Hilfsfunktionen. Alle Tage werden als 'YYYY-MM-DD' (lokale Zeit) geführt.

export const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // 12 Uhr: robust gegen Sommerzeit-Sprünge
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

/** Montag der Woche (ISO) */
export function mondayOf(s) {
  const d = parseYmd(s);
  const wd = (d.getDay() + 6) % 7; // Mo=0 … So=6
  d.setDate(d.getDate() - wd);
  return ymd(d);
}

export function weekdayIndex(s) {
  return (parseYmd(s).getDay() + 6) % 7;
}

// Family-Safety-Berichte laufen immer von Donnerstag bis Mittwoch → danach werden Wochen gebildet
export const WEEK_START = 3; // Mo=0 … Do=3

/** Donnerstag der Berichtswoche, in die der Tag fällt */
export function weekStartOf(s) {
  return addDays(s, -((weekdayIndex(s) - WEEK_START + 7) % 7));
}

/** "Do 12. Nov. – Mi 18. Nov. 2026" */
export function fmtWeek(start) {
  const end = addDays(start, 6);
  return `${WD_SHORT[weekdayIndex(start)]} ${fmtDate(start)} – ${WD_SHORT[weekdayIndex(end)]} ${fmtDate(end, true)}`;
}

export function isoWeek(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

export const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const MONTHS = ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
export const MONTHS_LONG = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function fmtDate(s, withYear = false) {
  const d = parseYmd(s);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}

/** Minuten → "3 Std. 20 Min." */
export function fmtMin(min) {
  if (min == null || isNaN(min)) return '–';
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}

/** Minuten → "3:20" */
export function fmtHM(min) {
  if (min == null || isNaN(min)) return '–';
  min = Math.round(min);
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

/** Eingabe "3:20", "3,5", "3h 20m", "200" (Minuten) → Minuten */
export function parseUserDuration(str) {
  str = String(str).trim().toLowerCase().replace(',', '.');
  if (!str) return null;
  let m;
  if ((m = str.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = str.match(/^(\d+(?:\.\d+)?)\s*(h|std\.?)?\s*(?:(\d+)\s*(m|min\.?)?)?$/))) {
    if (m[2] || m[3] || m[1].includes('.')) return Math.round(+m[1] * 60 + (+m[3] || 0));
    const n = +m[1];
    return n <= 24 ? n * 60 : n; // "3" = 3 Std., "200" = 200 Min.
  }
  return null;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Einfacher, stabiler String-Hash (für Duplikat-Erkennung) */
export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
