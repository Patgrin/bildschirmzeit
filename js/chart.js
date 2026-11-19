// Wochen-Diagramm: Ø Bildschirmzeit pro Tag je Woche seit November 2025, mit Trendlinie.

import { addDays, mondayOf, fmtDate, fmtMin, fmtHM, isoWeek, MONTHS, MONTHS_LONG, escapeHtml, weekdayIndex } from './util.js';
import { holidayFor } from './holidays.js';

export const CHART_START = '2025-11-01';

export function weeklySeries(days, customFree) {
  const weeks = new Map();
  for (const [d, v] of Object.entries(days)) {
    if (d < CHART_START) continue;
    const w = mondayOf(d);
    if (!weeks.has(w)) weeks.set(w, { start: w, sum: 0, n: 0, estimated: false });
    const o = weeks.get(w);
    o.sum += v.min;
    o.n++;
    if (v.src === 'estimate') o.estimated = true;
  }
  const out = [...weeks.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const w of out) {
    w.avg = w.sum / w.n;
    let free = 0, name = null;
    for (let i = 0; i < 5; i++) {
      const h = holidayFor(addDays(w.start, i), customFree);
      if (h) { free++; name = name || h; }
    }
    w.holiday = free >= 3 ? name : null;
  }
  return out;
}

function regression(ys) {
  const n = ys.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  const slope = num / den;
  return { slope, at: (x) => my + slope * (x - mx) };
}

export function stats(days, customFree) {
  const weeks = weeklySeries(days, customFree);
  const novDays = Object.entries(days).filter(([d]) => d >= '2025-11-01' && d <= '2025-11-30').map(([, v]) => v.min);
  const nov = novDays.length ? novDays.reduce((a, b) => a + b, 0) / novDays.length : null;
  const last = weeks.slice(-4);
  const recent = last.length ? last.reduce((a, w) => a + w.sum, 0) / last.reduce((a, w) => a + w.n, 0) : null;
  const reg = regression(weeks.map((w) => w.avg));

  // Schultage vs. Ferien vs. Wochenende
  const cat = { schule: [], ferien: [], wochenende: [] };
  for (const [d, v] of Object.entries(days)) {
    if (d < CHART_START) continue;
    if (holidayFor(d, customFree)) cat.ferien.push(v.min);
    else if (weekdayIndex(d) >= 5) cat.wochenende.push(v.min);
    else cat.schule.push(v.min);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // Monate
  const months = new Map();
  for (const [d, v] of Object.entries(days)) {
    if (d < CHART_START) continue;
    const k = d.slice(0, 7);
    if (!months.has(k)) months.set(k, { k, all: [], schule: [], ferien: [] });
    const o = months.get(k);
    o.all.push(v.min);
    if (holidayFor(d, customFree)) o.ferien.push(v.min);
    else if (weekdayIndex(d) < 5) o.schule.push(v.min);
  }
  const monthRows = [...months.values()].sort((a, b) => (a.k < b.k ? -1 : 1)).map((o) => ({
    label: `${MONTHS_LONG[+o.k.slice(5) - 1]} ${o.k.slice(0, 4)}`,
    avg: mean(o.all), schule: mean(o.schule), ferien: mean(o.ferien), n: o.all.length,
  }));

  return {
    weeks, nov, recent,
    change: nov && recent ? (recent - nov) / nov : null,
    slopePerWeek: reg ? reg.slope : null,
    schule: mean(cat.schule), ferien: mean(cat.ferien), wochenende: mean(cat.wochenende),
    monthRows,
  };
}

export function renderChart(el, tip, st) {
  const weeks = st.weeks;
  if (!weeks.length) {
    el.innerHTML = '<p class="muted center">Noch keine Daten ab November 2025.</p>';
    return;
  }
  const W = Math.max(300, el.clientWidth), Hh = 230;
  const m = { l: 36, r: 8, t: 12, b: 26 };
  const iw = W - m.l - m.r, ih = Hh - m.t - m.b;
  const maxMin = Math.max(60, ...weeks.map((w) => w.avg));
  const maxH = Math.ceil(maxMin / 60);
  const stepH = maxH > 8 ? 2 : 1;
  const top = Math.ceil(maxH / stepH) * stepH * 60;
  const y = (min) => m.t + ih - (min / top) * ih;
  const step = iw / weeks.length;
  const bw = Math.max(3, Math.min(28, step - 2));
  const x = (i) => m.l + i * step + (step - bw) / 2;

  let svg = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Durchschnittliche Bildschirmzeit pro Tag je Woche seit November 2025">`;
  // Gitter + Achse
  for (let h = 0; h <= top / 60; h += stepH) {
    const yy = y(h * 60);
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="grid"/>`;
    svg += `<text x="${m.l - 6}" y="${yy + 4}" class="axis" text-anchor="end">${h} h</text>`;
  }
  // Monatsbeschriftung
  let lastMonth = -1, lastX = -99;
  weeks.forEach((w, i) => {
    const th = addDays(w.start, 3); // Donnerstag bestimmt den Monat der Woche
    const mth = +th.slice(5, 7);
    if (mth !== lastMonth) {
      lastMonth = mth;
      if (x(i) - lastX < 34) return; // Beschriftungen nicht überlappen lassen
      lastX = x(i);
      svg += `<text x="${x(i)}" y="${Hh - 8}" class="axis">${MONTHS[mth - 1]}</text>`;
    }
  });
  // Balken (oben gerundet)
  weeks.forEach((w, i) => {
    const x0 = x(i), y0 = y(w.avg), yb = y(0), r = Math.min(4, bw / 2, yb - y0);
    const cls = w.holiday ? 'bar holiday' : 'bar';
    svg += `<path class="${cls}${w.estimated ? ' est' : ''}" d="M${x0},${yb} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${yb} Z"/>`;
  });
  // Trendlinie
  const reg = regression(weeks.map((w) => w.avg));
  if (reg && weeks.length >= 3) {
    const cx = (i) => m.l + i * step + step / 2;
    svg += `<line class="trend" x1="${cx(0)}" y1="${y(Math.max(0, reg.at(0)))}" x2="${cx(weeks.length - 1)}" y2="${y(Math.max(0, reg.at(weeks.length - 1)))}"/>`;
  }
  // Treffer-Flächen für Tooltip
  weeks.forEach((w, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${m.l + i * step}" y="${m.t}" width="${step}" height="${ih}"/>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;

  const show = (ev) => {
    const t = ev.target.closest('.hit');
    el.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
    if (!t) { tip.hidden = true; return; }
    const i = +t.dataset.i, w = weeks[i];
    el.querySelectorAll('.bar')[i].classList.add('active');
    tip.innerHTML = `<strong>KW ${isoWeek(w.start)} · ${fmtDate(w.start)} – ${fmtDate(addDays(w.start, 6), true)}</strong>
      <div>Ø ${fmtMin(w.avg)} pro Tag</div>
      <div class="muted">Summe ${fmtHM(w.sum)} h · ${w.n} Tage${w.estimated ? ' · geschätzt' : ''}</div>
      ${w.holiday ? `<div class="muted">${escapeHtml(w.holiday)}</div>` : ''}`;
    tip.hidden = false;
    const box = el.getBoundingClientRect();
    const bx = (m.l + i * step + step / 2) / W * box.width;
    tip.style.left = `${Math.min(Math.max(bx - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth)}px`;
    tip.style.top = `${Math.max(0, y(w.avg) / Hh * box.height - tip.offsetHeight - 10)}px`;
  };
  el.onpointermove = show;
  el.onpointerdown = show;
  el.onpointerleave = (e) => { if (e.pointerType === 'mouse') { tip.hidden = true; el.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active')); } };
}
