// Liest die Bildschirmzeit aus dem Text eines Microsoft-Family-Safety-Wochenberichts.
// Robust gegen deutsche & englische Formulierungen. Ergebnis:
// { weekStart, weekEnd, days: {'YYYY-MM-DD': Minuten}, kind: 'daily'|'average'|'total'|'none', total, avg }

import { ymd, addDays, parseYmd, daysBetween } from './util.js';

const H = '(?:stunden|stunde|std|hours|hour|hrs|hr|h)\\b\\.?';
const M = '(?:minuten|minute|min|minutes|mins|m)\\b\\.?';
// "3 Std. 20 Min." | "3h 20m" | "3 Std." | "45 Min." | "3:20 Std."
const DUR_SRC = `(?:(\\d{1,3}):(\\d{2})\\s*${H}|(\\d{1,3})\\s*${H}\\s*(?:(?:und|and|,)\\s*)?(?:(\\d{1,2})\\s*${M})?|(\\d{1,4})\\s*${M})`;
const DUR = new RegExp(DUR_SRC, 'i');

function durToMin(m) {
  if (m[1] != null) return +m[1] * 60 + +m[2];
  if (m[3] != null) return +m[3] * 60 + (m[4] ? +m[4] : 0);
  if (m[5] != null) return +m[5];
  return null;
}

export function parseDuration(str) {
  const m = str.match(DUR);
  return m ? durToMin(m) : null;
}

const WEEKDAYS = [
  ['montag', 'monday', 'mo', 'mon'],
  ['dienstag', 'tuesday', 'di', 'tue', 'tues'],
  ['mittwoch', 'wednesday', 'mi', 'wed'],
  ['donnerstag', 'thursday', 'do', 'thu', 'thur', 'thurs'],
  ['freitag', 'friday', 'fr', 'fri'],
  ['samstag', 'saturday', 'sa', 'sat'],
  ['sonntag', 'sunday', 'so', 'sun'],
];
const WD_LOOKUP = {};
WEEKDAYS.forEach((names, i) => names.forEach((n) => (WD_LOOKUP[n] = i)));
const WD_RE = new RegExp(`(?<![\\p{L}\\d])(${Object.keys(WD_LOOKUP).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}])\\.?`, 'giu');

const MONTHS = {
  jän: 1, jan: 1, jänner: 1, januar: 1, january: 1,
  feb: 2, februar: 2, february: 2, feber: 2,
  mär: 3, mrz: 3, märz: 3, mar: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12,
};
const MON_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const monthNum = (s) => (/^\d+$/.test(s) ? +s : MONTHS[s.toLowerCase().replace('.', '')]);

/** Wochenzeitraum aus dem Text, sonst aus dem Empfangsdatum ableiten */
export function findWeekRange(text, received) {
  const recv = ymd(received);
  const recvYear = received.getFullYear();
  const fixYear = (y, m) => (y ? +y : m > received.getMonth() + 1 + 1 ? recvYear - 1 : recvYear);

  // Deutsch: "9. Nov. – 15. Nov. 2025", "09.11. - 15.11.2025", "9.–15. November 2025"
  const de = new RegExp(
    `(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.|(${MON_ALT})\\.?)?\\s*(\\d{4})?\\s*(?:-|–|—|bis)\\s*(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.?|(${MON_ALT})\\.?)\\s*(\\d{4})?`,
    'i'
  );
  // Englisch: "November 9 – 15, 2025", "Nov 9 - Nov 15, 2025"
  const en = new RegExp(
    `(${MON_ALT})\\.?\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s*(?:-|–|—|to)\\s*(?:(${MON_ALT})\\.?\\s+)?(\\d{1,2}),?\\s*(\\d{4})?`,
    'i'
  );

  const candidates = [];
  for (const re of [de, en]) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(text))) {
      let d1, m1, y1, d2, m2, y2;
      if (re === de) {
        d1 = +m[1]; d2 = +m[5];
        m2 = monthNum(m[6] || m[7]);
        m1 = m[2] || m[3] ? monthNum(m[2] || m[3]) : m2;
        y2 = m[8]; y1 = m[4] || (m1 > m2 ? null : y2);
      } else {
        m1 = monthNum(m[1]); d1 = +m[2]; y1 = m[3];
        m2 = m[4] ? monthNum(m[4]) : m1; d2 = +m[5]; y2 = m[6] || y1;
        y1 = y1 || (m1 > m2 ? null : y2);
      }
      if (!m1 || !m2 || d1 > 31 || d2 > 31) continue;
      const yy2 = fixYear(y2, m2);
      const yy1 = y1 ? +y1 : m1 > m2 ? yy2 - 1 : yy2;
      const from = ymd(new Date(yy1, m1 - 1, d1, 12));
      const to = ymd(new Date(yy2, m2 - 1, d2, 12));
      const len = daysBetween(from, to);
      if (len >= 5 && len <= 7 && daysBetween(to, recv) >= -1 && daysBetween(to, recv) <= 21) candidates.push({ from, to });
    }
  }
  if (candidates.length) return { ...candidates[0], fromText: true };

  // Fallback: die 7 Tage vor dem Empfangstag
  const to = addDays(recv, -1);
  return { from: addDays(to, -6), to, fromText: false };
}

/** Tageswerte nach Wochentag ("Mo 3 Std. 20 Min.") oder Datum ("10.11. 3 Std.") */
function findDaily(text, range) {
  const dates = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) dates.push(d);
  const byWeekday = {};
  dates.forEach((d) => (byWeekday[(parseYmd(d).getDay() + 6) % 7] = d));

  const result = {};
  WD_RE.lastIndex = 0;
  let m;
  while ((m = WD_RE.exec(text))) {
    const idx = WD_LOOKUP[m[1].toLowerCase()];
    const date = byWeekday[idx];
    if (!date || result[date] != null) continue;
    // Nach dem Wochentag darf optional ein Datum stehen, dann die Dauer
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const t = tail.match(new RegExp(`^[\\s,:|()\\-–]*(?:\\d{1,2}\\.\\s*(?:\\d{1,2}\\.|(?:${MON_ALT})\\.?)?\\s*(?:\\d{4})?)?[\\s,:|()\\-–]*${DUR_SRC}`, 'i'));
    if (t) {
      const sub = t[0].match(new RegExp(`${DUR_SRC}$`, 'i'));
      const min = sub ? durToMin(sub) : null;
      if (min != null && min <= 24 * 60) result[date] = min;
    }
  }
  if (Object.keys(result).length >= 3) return result;

  // Datumsbasiert: "10.11.: 3 Std." oder "Nov 10: 3h"
  const res2 = {};
  for (const d of dates) {
    const dt = parseYmd(d);
    const day = dt.getDate(), mon = dt.getMonth() + 1;
    const re = new RegExp(`(?<!\\d)0?${day}\\.\\s*(?:0?${mon}\\.?)(?:\\s*\\d{4})?[\\s,:|\\-–]*${DUR_SRC}`, 'i');
    const mm = text.match(re);
    if (mm) {
      const sub = mm[0].match(new RegExp(`${DUR_SRC}$`, 'i'));
      if (sub) res2[d] = durToMin(sub);
    }
  }
  return Object.keys(res2).length >= 3 ? res2 : Object.keys(result).length ? result : {};
}

function findLabeled(text, labels) {
  const re = new RegExp(`(?:${labels})[^\\n\\d]{0,40}?${DUR_SRC}`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const sub = m[0].match(new RegExp(`${DUR_SRC}$`, 'i'));
  return sub ? durToMin(sub) : null;
}

export function parseReport(text, received) {
  text = text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  const range = findWeekRange(text, received);
  const days = findDaily(text, range);
  const avg = findLabeled(text, 'durchschnitt|täglich|pro tag|daily average|average|per day|avg');
  const total = findLabeled(text, 'gesamte bildschirmzeit|bildschirmzeit gesamt|insgesamt|gesamt|total screen time|total|bildschirmzeit|screen time');

  const n = Object.keys(days).length;
  if (n >= 3) {
    return { weekStart: range.from, weekEnd: range.to, rangeFromText: range.fromText, days, kind: 'daily', total: total ?? Object.values(days).reduce((a, b) => a + b, 0), avg };
  }
  const len = daysBetween(range.from, range.to) + 1;
  const est = avg ?? (total != null ? total / len : null);
  if (est != null) {
    const d = {};
    for (let x = range.from; x <= range.to; x = addDays(x, 1)) d[x] = Math.round(est);
    return { weekStart: range.from, weekEnd: range.to, rangeFromText: range.fromText, days: d, kind: avg != null ? 'average' : 'total', total: total ?? est * len, avg: est };
  }
  return { weekStart: range.from, weekEnd: range.to, rangeFromText: range.fromText, days: {}, kind: 'none', total: null, avg: null };
}
