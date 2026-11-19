// Family Safety baut das Diagramm-Bild aus einer URL, in der die Tageswerte bereits stehen:
//   https://account.microsoft.com/family/chart/screentime.png?data=CONSI-PC:Windows PC:…
// Statt das Bild zu laden (wird von Microsoft für fremde Apps blockiert) lesen wir die Zahlen direkt
// aus der URL. Das genaue Format ist nicht dokumentiert, daher robust: Wir suchen 7 aufeinander
// folgende Zahlen, deren Summe exakt zur Wochensumme aus dem Mailtext passt.

import { addDays } from './util.js';

/** Alle Zahlenfolgen (pro Gerät/Abschnitt) aus dem data-Parameter */
function numberGroups(url) {
  let data;
  try {
    const u = new URL(url);
    data = u.searchParams.get('data') || decodeURIComponent(u.search);
  } catch {
    data = decodeURIComponent(url);
  }
  // Abschnitte pro Gerät sind durch | oder ; getrennt (falls mehrere Geräte)
  return data.split(/[|;]/).map((seg) => (seg.match(/\d+(?:\.\d+)?/g) || []).map(Number));
}

/** Passt eine Folge (in Sekunden oder Minuten) auf die Wochensumme? Liefert Minuten pro Tag */
function fit(vals, totalMin) {
  for (const unit of [60, 1, 1 / 60]) { // Sekunden, Minuten, Stunden
    const exactSum = vals.reduce((a, b) => a + b, 0) / unit;
    if (Math.abs(exactSum - totalMin) > 7) continue;
    // Rundung so wählen, dass die Tage genau die Wochensumme ergeben
    for (const round of [Math.floor, Math.round, Math.ceil]) {
      const mins = vals.map((v) => round(v / unit));
      if (mins.reduce((a, b) => a + b, 0) === totalMin) return mins;
    }
    if (Math.abs(exactSum - totalMin) <= 1) return vals.map((v) => Math.round(v / unit));
  }
  return null;
}

/**
 * @param urls  Bild-URLs der Mail
 * @param range {from, to} Berichtszeitraum (7 Tage)
 * @param totalMin Wochensumme laut Mailtext (Minuten)
 * @returns {days, info} oder {days: null, info}
 */
export function daysFromChartUrls(urls, range, totalMin) {
  const info = [];
  const chartUrls = urls.filter((u) => /\/family\/chart\/screentime/i.test(u));
  if (!chartUrls.length) return { days: null, info: ['Keine screentime-Diagramm-URL gefunden.'] };
  if (totalMin == null) return { days: null, info: ['Wochensumme fehlt – Tageswerte nicht prüfbar.'] };

  const dates = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) dates.push(d);
  const n = dates.length;
  const toDays = (mins) => Object.fromEntries(dates.map((d, i) => [d, mins[i]]));

  for (const url of chartUrls) {
    info.push(`Diagramm-URL: ${url}`);
    const groups = numberGroups(url);
    const all = groups.flat();

    // 1) Eine Folge von 7 Zahlen ergibt die Wochensumme (ein Gerät)
    // auch jede zweite Zahl prüfen, falls Werte paarweise (Tag:Wert) abgelegt sind
    const strided = (s, o) => s.filter((_, k) => k % 2 === o);
    for (const seq of [...groups, all, strided(all, 0), strided(all, 1)]) {
      for (let i = 0; i + n <= seq.length; i++) {
        const mins = fit(seq.slice(i, i + n), totalMin);
        if (mins) return { days: toDays(mins), info };
      }
    }
    // 2) Mehrere Geräte: je Abschnitt die letzten 7 Zahlen, tageweise addiert
    const per = groups.filter((g) => g.length >= n).map((g) => g.slice(-n));
    if (per.length > 1) {
      const summed = dates.map((_, i) => per.reduce((a, g) => a + g[i], 0));
      const mins = fit(summed, totalMin);
      if (mins) return { days: toDays(mins), info };
    }
    info.push(`Zahlen in der URL: ${all.join(', ')} – keine 7 Werte mit Summe ${totalMin} Min. gefunden.`);
  }
  return { days: null, info };
}
