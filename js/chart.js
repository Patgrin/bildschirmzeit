// Verlauf: Ø Bildschirmzeit pro Tag (Wochenmittel) über die gesamte Historie.
// Die Zeit über dem November-2025-Niveau ist transparent orange hervorgehoben,
// Ferienzeiten liegen als graue Bänder im Hintergrund.

import { addDays, weekStartOf, fmtWeek, daysBetween, fmtDate, fmtMin, fmtHM, MONTHS, MONTHS_LONG, escapeHtml, weekdayIndex } from './util.js';
import { holidayFor, holidaysOO } from './holidays.js';

export const BASE_FROM = '2025-11-01';
export const BASE_TO = '2025-11-30';

export function weeklySeries(days, customFree, weekTotals = {}) {
  const weeks = new Map();
  for (const [d, v] of Object.entries(days)) {
    const w = weekStartOf(d);
    if (!weeks.has(w)) weeks.set(w, { start: w, sum: 0, n: 0 });
    const o = weeks.get(w);
    o.sum += v.min;
    o.n++;
  }
  // Wochen, von denen nur die echte Wochensumme bekannt ist (Diagramm nicht lesbar)
  for (const [w, t] of Object.entries(weekTotals)) {
    if (!weeks.has(w)) weeks.set(w, { start: w, sum: t.total, n: 7, totalOnly: true });
  }
  const out = [...weeks.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const w of out) {
    w.avg = w.sum / w.n;
    let free = 0, name = null;
    for (let i = 0; i < 7; i++) {
      const day = addDays(w.start, i);
      if (weekdayIndex(day) >= 5) continue; // nur Schultage Mo–Fr zählen
      const h = holidayFor(day, customFree);
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

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function stats(days, customFree, weekTotals = {}) {
  const weeks = weeklySeries(days, customFree, weekTotals);
  const nov = mean(Object.entries(days).filter(([d]) => d >= BASE_FROM && d <= BASE_TO).map(([, v]) => v.min));
  const last = weeks.slice(-4);
  const recent = last.length ? last.reduce((a, w) => a + w.sum, 0) / last.reduce((a, w) => a + w.n, 0) : null;
  const reg = regression(weeks.map((w) => w.avg));

  // Schultage vs. Ferien vs. Wochenende
  const cat = { schule: [], ferien: [], wochenende: [] };
  const months = new Map();
  for (const [d, v] of Object.entries(days)) {
    const hol = holidayFor(d, customFree);
    if (hol) cat.ferien.push(v.min);
    else if (weekdayIndex(d) >= 5) cat.wochenende.push(v.min);
    else cat.schule.push(v.min);

    const k = d.slice(0, 7);
    if (!months.has(k)) months.set(k, { k, all: [], schule: [], ferien: [] });
    const o = months.get(k);
    o.all.push(v.min);
    if (hol) o.ferien.push(v.min);
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

let hideActive = null, outsideBound = false;
const signed = (min) => `${min >= 0 ? '+' : '−'}${fmtHM(Math.abs(min))} h`;

// Zoom-Zustand: sichtbarer Ausschnitt in Tagen ab Beginn der Historie (null = alles)
let view = null;
let ctx = null; // letzte Render-Parameter für Neuzeichnen beim Zoomen
const MIN_SPAN = 21; // nicht enger als 3 Wochen

export function resetZoom() {
  view = null;
  if (ctx) draw();
}

export function renderChart(el, tip, st, customFree = [], onZoomChange = () => {}) {
  ctx = { el, tip, st, customFree, onZoomChange };
  tip.hidden = true;
  if (!st.weeks.length) {
    el.innerHTML = '<p class="muted center">Noch keine Daten.</p>';
    return;
  }
  bindGestures(el);
  draw();
}

function geometry() {
  const { el, st } = ctx;
  const weeks = st.weeks;
  const W = Math.max(300, el.clientWidth), Hh = 250;
  const m = { l: 36, r: 10, t: 14, b: 28 };
  const iw = W - m.l - m.r, ih = Hh - m.t - m.b;
  const t0 = weeks[0].start, t1 = addDays(weeks[weeks.length - 1].start, 7);
  const span = Math.max(7, daysBetween(t0, t1));
  if (view) {
    const w = Math.min(span, Math.max(MIN_SPAN, view.b - view.a));
    const a = Math.max(0, Math.min(view.a, span - w));
    view = { a, b: a + w };
  }
  const a = view ? view.a : 0, b = view ? view.b : span;
  return { W, Hh, m, iw, ih, t0, t1, span, a, b };
}

function draw() {
  const { el, tip, st, customFree, onZoomChange } = ctx;
  const weeks = st.weeks;
  const { W, Hh, m, iw, ih, t0, t1, span, a, b } = geometry();
  const off = (d) => daysBetween(t0, d);
  const xo = (o) => m.l + ((o - a) / (b - a)) * iw; // Tag-Offset → x
  const xd = (d) => xo(off(d));
  const xw = (w) => xo(off(w.start) + 3.5); // Wochenmitte

  // y-Skala passt sich dem sichtbaren Ausschnitt an
  const visible = weeks.filter((w) => off(w.start) + 7 >= a && off(w.start) <= b);
  const maxMin = Math.max(60, st.nov || 0, ...(visible.length ? visible : weeks).map((w) => w.avg));
  const maxH = Math.ceil((maxMin * 1.08) / 60);
  const stepH = maxH > 8 ? 2 : 1;
  const top = Math.ceil(maxH / stepH) * stepH * 60;
  const y = (min) => m.t + ih - (min / top) * ih;
  const zoomed = !!view && b - a < span - 0.5;

  let svg = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Durchschnittliche Bildschirmzeit pro Tag über die gesamte Historie">`;
  svg += `<clipPath id="plot"><rect x="${m.l}" y="0" width="${iw}" height="${Hh}"/></clipPath>`;

  // Ferien als Hintergrundbänder (nur mehrtägige Ferien)
  svg += '<g clip-path="url(#plot)">';
  const bands = [...holidaysOO(+t0.slice(0, 4), +t1.slice(0, 4)), ...customFree].filter((h) => daysBetween(h.from, h.to) >= 2 && h.to >= t0 && h.from <= t1);
  for (const h of bands) {
    const x1 = xd(h.from), x2 = xd(addDays(h.to, 1));
    if (x2 < m.l || x1 > W - m.r) continue;
    svg += `<rect class="band" x="${x1}" y="${m.t}" width="${Math.max(1, x2 - x1)}" height="${ih}"><title>${escapeHtml(h.name)}</title></rect>`;
  }
  svg += '</g>';

  // Raster
  for (let h = 0; h <= top / 60; h += stepH) {
    const yy = y(h * 60);
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="grid"/>`;
    svg += `<text x="${m.l - 6}" y="${yy + 4}" class="axis" text-anchor="end">${h} h</text>`;
  }

  // Zeitachse: weit herausgezoomt Monate, nah herangezoomt Berichtswochen (Do)
  let lastX = -99;
  const tick = (d, label) => {
    const xx = xd(d);
    if (xx < m.l - 1 || xx > W - m.r - 10 || xx - lastX < 40) return;
    svg += `<line x1="${xx}" x2="${xx}" y1="${m.t + ih}" y2="${m.t + ih + 4}" class="tick"/>`;
    svg += `<text x="${xx}" y="${Hh - 8}" class="axis" text-anchor="${xx < m.l + 12 ? 'start' : 'middle'}">${label}</text>`;
    lastX = xx;
  };
  if (b - a <= 90) {
    for (const w of weeks) tick(w.start, `${+w.start.slice(8)}.${+w.start.slice(5, 7)}.`);
  } else {
    for (let d = `${t0.slice(0, 7)}-01`; d <= t1; ) {
      const mo = +d.slice(5, 7);
      if (d >= t0) tick(d, mo === 1 || lastX < 0 ? `${MONTHS[mo - 1]} ${d.slice(2, 4)}` : MONTHS[mo - 1]);
      const [yy, mm] = d.split('-').map(Number);
      d = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
    }
  }

  // Linie + Flächen
  const pts = weeks.map((w) => [xw(w), y(w.avg)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const first = pts[0][0], last = pts[pts.length - 1][0];
  svg += '<g clip-path="url(#plot)">';
  svg += `<path class="area" d="${line} L${last},${y(0)} L${first},${y(0)} Z"/>`;
  if (st.nov != null) {
    const yb = y(st.nov);
    // Mehr-Zeit gegenüber November 2025: Fläche zwischen Linie und Basislinie, nur oberhalb sichtbar
    svg += `<clipPath id="above"><rect x="0" y="0" width="${W}" height="${yb}"/></clipPath>`;
    svg += `<path class="excess" clip-path="url(#above)" d="${line} L${last},${yb} L${first},${yb} Z"/>`;
  }
  svg += `<path class="line" d="${line}"/>`;
  const r = visible.length > 40 ? 2.5 : 3.5;
  pts.forEach((p, i) => (svg += `<circle class="dot${weeks[i].totalOnly ? ' est' : ''}" cx="${p[0]}" cy="${p[1]}" r="${r}"/>`));
  svg += '</g>';
  if (st.nov != null) {
    const yb = y(st.nov);
    svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${yb}" y2="${yb}"/>`;
    svg += `<text class="base-label" text-anchor="end" x="${W - m.r - 4}" y="${Math.min(yb + 15, m.t + ih - 4)}">Ø Nov. 2025: ${fmtHM(st.nov)} h</text>`;
  }
  svg += `<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<circle class="focus" r="5.5" cx="-10" cy="-10"/>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  svg += '</svg>';
  el.innerHTML = svg;
  onZoomChange(zoomed);

  const svgEl = el.querySelector('svg');
  const cross = el.querySelector('.cross'), focus = el.querySelector('.focus');
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); focus.setAttribute('cx', -10); };
  const show = (ev) => {
    if (gesture || ev.isPrimary === false) return;
    const box = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    if (px < m.l - 10 || px > W - m.r + 10) { hide(); return; }
    let i = -1;
    pts.forEach((p, k) => {
      if (p[0] < m.l - 2 || p[0] > W - m.r + 2) return; // nur sichtbare Punkte
      if (i < 0 || Math.abs(p[0] - px) < Math.abs(pts[i][0] - px)) i = k;
    });
    if (i < 0) { hide(); return; }
    const w = weeks[i], [cx, cy] = pts[i];
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', cx); focus.setAttribute('cy', cy);
    const diff = st.nov != null ? w.avg - st.nov : null;
    tip.innerHTML = `<strong>${fmtWeek(w.start)}</strong>
      <div>Ø ${fmtMin(w.avg)} pro Tag</div>
      ${diff != null ? `<div>${signed(diff)} ggü. Nov. 2025 (${diff >= 0 ? '+' : '−'}${Math.abs(Math.round((diff / st.nov) * 100))} %)</div>` : ''}
      <div class="muted">Woche gesamt ${fmtHM(w.sum)} h · ${w.totalOnly ? 'nur Wochensumme laut Bericht' : `${w.n} Tage`}</div>
      ${w.holiday ? `<div class="muted">${escapeHtml(w.holiday)}</div>` : ''}`;
    tip.hidden = false;
    const sx = (cx / W) * box.width, sy = (cy / Hh) * box.height;
    tip.style.left = `${Math.min(Math.max(sx - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth)}px`;
    tip.style.top = `${sy - tip.offsetHeight - 14 < 0 ? sy + 14 : sy - tip.offsetHeight - 14}px`;
  };
  el.onpointermove = show;
  el.onpointerdown = show;
  hideActive = hide;
  if (!outsideBound) {
    // Tippen außerhalb des Diagramms blendet die Details wieder aus
    outsideBound = true;
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#chart')) hideActive?.(); });
  }
  el.onpointerleave = (e) => { if (e.pointerType === 'mouse') hide(); };
}

// ---------- Zoomen & Verschieben ----------
// Zwei Finger: zoomen (um die Fingermitte). Ein Finger seitlich: verschieben, wenn hineingezoomt.
// Mausrad/Trackpad am PC: zoomen. Senkrechtes Wischen scrollt weiterhin die Seite.
let gesture = null;

function bindGestures(el) {
  if (el._zoomBound) return;
  el._zoomBound = true;

  const toPlot = (clientX) => {
    const g = geometry();
    const box = el.querySelector('svg').getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * g.W;
    return { g, frac: Math.min(1, Math.max(0, (x - g.m.l) / g.iw)) };
  };
  const setView = (a, w, span) => {
    w = Math.min(span, Math.max(MIN_SPAN, w));
    a = Math.max(0, Math.min(a, span - w));
    view = w >= span - 0.5 ? null : { a, b: a + w };
    hideActive?.();
    draw();
  };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [p, q] = e.touches;
      const { g, frac } = toPlot((p.clientX + q.clientX) / 2);
      gesture = { type: 'pinch', dist: Math.max(10, Math.abs(p.clientX - q.clientX)), anchor: g.a + frac * (g.b - g.a), w: g.b - g.a };
      hideActive?.();
    } else if (e.touches.length === 1 && view) {
      const t = e.touches[0];
      const g = geometry();
      gesture = { type: 'maybe-pan', x: t.clientX, y: t.clientY, a: g.a, w: g.b - g.a, iw: g.iw, W: g.W, box: el.getBoundingClientRect().width };
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (e.touches.length !== 2) return;
      e.preventDefault(); // Seiten-Zoom verhindern
      const [p, q] = e.touches;
      const dist = Math.max(10, Math.abs(p.clientX - q.clientX));
      const g = geometry();
      const w = Math.min(g.span, Math.max(MIN_SPAN, gesture.w * (gesture.dist / dist)));
      const { frac } = toPlot((p.clientX + q.clientX) / 2);
      setView(gesture.anchor - frac * w, w, g.span);
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - gesture.x, dy = t.clientY - gesture.y;
      if (gesture.type === 'maybe-pan') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { gesture = null; return; } // senkrecht → Seite scrollen
        gesture.type = 'pan';
      }
      e.preventDefault();
      const dxPlot = (dx / gesture.box) * gesture.W;
      setView(gesture.a - (dxPlot / gesture.iw) * gesture.w, gesture.w, geometry().span);
    }
  }, { passive: false });

  const end = (e) => {
    if (e.touches.length === 0) setTimeout(() => (gesture = null), 0);
    else if (gesture?.type === 'pinch' && e.touches.length === 1) gesture = null; // ein Finger angehoben
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  // iOS-eigene Pinch-Geste (Seitenzoom) im Diagramm unterdrücken
  el.addEventListener('gesturestart', (e) => e.preventDefault());
  el.addEventListener('gesturechange', (e) => e.preventDefault());

  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; // nur Trackpad-Pinch bzw. Strg+Mausrad, normales Scrollen bleibt Scrollen
    e.preventDefault();
    const { g, frac } = toPlot(e.clientX);
    const anchor = g.a + frac * (g.b - g.a);
    const w = Math.min(g.span, Math.max(MIN_SPAN, (g.b - g.a) * Math.exp(e.deltaY * 0.002)));
    setView(anchor - frac * w, w, g.span);
  }, { passive: false });
}
