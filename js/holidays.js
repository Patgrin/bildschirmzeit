// Schulferien & schulfreie Tage in Oberösterreich (nach Schulzeitgesetz berechnet).
// Regeln:
//  - Schulbeginn OÖ: zweiter Montag im September
//  - Sommerferien: 9 Wochen + Sonntag vor Schulbeginn (Samstag … Sonntag)
//  - Herbstferien: 27.–31. Oktober, mit Nationalfeiertag (26.10.) und Allerheiligen/Allerseelen (1./2.11.)
//  - Weihnachtsferien: 24.12. – 6.1.
//  - Semesterferien OÖ: Montag der dritten Februarwoche bis Sonntag
//  - Osterferien: Samstag vor Palmsonntag bis Ostermontag
//  - Pfingstferien: Samstag vor Pfingsten bis Pfingstmontag
//  - Einzelne Tage: 8.12., 1.5., 4.5. (Hl. Florian, Landespatron OÖ), Christi Himmelfahrt, Fronleichnam
// Schulautonome Tage sind je Schule verschieden → in den Einstellungen selbst ergänzen.

import { ymd, addDays } from './util.js';

function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(new Date(y, month - 1, day, 12));
}

function nthWeekday(y, month, weekday, n) {
  // weekday: 0=So … 1=Mo
  const d = new Date(y, month - 1, 1, 12);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (n - 1));
  return ymd(d);
}

const s = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Liefert alle Ferien/freien Tage für die Kalenderjahre fromYear..toYear */
export function holidaysOO(fromYear = 2025, toYear = 2028) {
  const out = [];
  for (let y = fromYear - 1; y <= toYear; y++) {
    const schoolStart = nthWeekday(y, 9, 1, 2);
    out.push({ from: addDays(schoolStart, -65), to: addDays(schoolStart, -1), name: 'Sommerferien' });
    out.push({ from: s(y, 10, 26), to: s(y, 11, 2), name: 'Herbstferien' });
    out.push({ from: s(y, 12, 8), to: s(y, 12, 8), name: 'Mariä Empfängnis' });
    out.push({ from: s(y, 12, 24), to: s(y + 1, 1, 6), name: 'Weihnachtsferien' });

    const semStart = nthWeekday(y, 2, 1, 3);
    out.push({ from: semStart, to: addDays(semStart, 6), name: 'Semesterferien' });

    const easter = easterSunday(y);
    out.push({ from: addDays(easter, -8), to: addDays(easter, 1), name: 'Osterferien' });
    out.push({ from: s(y, 5, 1), to: s(y, 5, 1), name: 'Staatsfeiertag' });
    out.push({ from: s(y, 5, 4), to: s(y, 5, 4), name: 'Hl. Florian' });
    out.push({ from: addDays(easter, 39), to: addDays(easter, 39), name: 'Christi Himmelfahrt' });
    out.push({ from: addDays(easter, 48), to: addDays(easter, 50), name: 'Pfingstferien' });
    out.push({ from: addDays(easter, 60), to: addDays(easter, 60), name: 'Fronleichnam' });
  }
  return out;
}

let cache = null;
let cacheKey = '';

/** Ferienname für einen Tag oder null. custom: [{from,to,name}] (schulautonome Tage) */
export function holidayFor(day, custom = []) {
  const key = JSON.stringify(custom);
  if (!cache || key !== cacheKey) {
    cache = [...holidaysOO(), ...custom.map((c) => ({ ...c, name: c.name || 'Schulfrei' }))];
    cacheKey = key;
  }
  // Längere Ferien vor Einzeltagen bevorzugen
  let hit = null;
  for (const h of cache) {
    if (day >= h.from && day <= h.to) {
      if (!hit || h.name.endsWith('ferien')) hit = h;
    }
  }
  return hit ? hit.name : null;
}
