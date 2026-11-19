// Family Safety schickt die Tageswerte nur als Bild (Balkendiagramm "Computerzeit").
// Dieses Modul liest das Diagramm per Texterkennung (Tesseract.js, läuft im Browser) aus:
// Über jedem Balken steht die Dauer ("5 Std. 30 Min."), darunter der Wochentag ("Do").

import { addDays, parseYmd } from './util.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (globalThis.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Texterkennung konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      return globalThis.Tesseract.createWorker('deu');
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/** Bild vergrößern & in Graustufen wandeln – verbessert die Erkennung kleiner Schrift deutlich */
async function prepare(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = bmp.width < 1200 ? Math.min(3, 1600 / bmp.width) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // Hintergrund-Helligkeit schätzen: dunkle Diagramme invertieren, damit Text dunkel auf hell ist
  let sum = 0;
  for (let i = 0; i < d.length; i += 4 * 97) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  const dark = sum / (d.length / (4 * 97)) < 110;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (dark) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, width: bmp.width, height: bmp.height };
}

/** Liest das Bild in zwei Varianten (aufbereitet + original) – die App wählt die stimmigere */
export async function* ocrImage(blob) {
  const w = await getWorker();
  const { canvas } = await prepare(blob);
  for (const src of [canvas, blob]) {
    const { data } = await w.recognize(src);
    yield { text: data.text, words: (data.words || []).map((x) => ({ text: x.text, bbox: x.bbox })) };
  }
}

const WD = { mo: 0, di: 1, mi: 2, do: 3, fr: 4, sa: 5, so: 6, mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const clean = (t) => t.toLowerCase().replace(/[^a-zäöü0-9]/g, '');
// Häufige OCR-Verwechslungen in Zahlen
const num = (t) => {
  const s = t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[^\d]/g, '');
  return s && s.length <= 3 && /^[\dOoIl|]+[.,:]?$/.test(t) ? +s : null;
};
const isH = (t) => /^(std|h|hr|hrs|stunden?)$/.test(clean(t));
const isM = (t) => /^(min|m|mins|minuten?)$/.test(clean(t));

/**
 * Wörter mit Positionen → Tageswerte.
 * @param words [{text, bbox:{x0,y0,x1,y1}}]
 * @param range {from, to}  Berichtszeitraum, z. B. Do 12.11. – Mi 18.11.
 */
export function parseChartWords(words, range, total = null) {
  // 1) Dauern zusammensetzen: "5" "Std." ["30" "Min."] | "45" "Min." | auch "5Std." in einem Wort
  const toks = [];
  for (const w of words) {
    const m = w.text.match(/^(\d{1,3})(std\.?|h|min\.?)$/i);
    if (m) { toks.push({ text: m[1], bbox: w.bbox }); toks.push({ text: m[2], bbox: w.bbox }); }
    else toks.push(w);
  }
  const durs = [];
  for (let i = 0; i < toks.length; i++) {
    const n = num(toks[i].text);
    if (n == null || !toks[i + 1]) continue;
    const sameLine = (a, b) => Math.abs((a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2) < (a.bbox.y1 - a.bbox.y0) * 0.8;
    let min = null, box = { ...toks[i].bbox }, j = i + 1;
    if (isH(toks[j].text) && sameLine(toks[i], toks[j])) {
      min = n * 60;
      box.x1 = toks[j].bbox.x1;
      const n2 = toks[j + 1] ? num(toks[j + 1].text) : null;
      if (n2 != null && n2 < 60 && toks[j + 2] && isM(toks[j + 2].text) && sameLine(toks[i], toks[j + 2])) {
        min += n2;
        box.x1 = toks[j + 2].bbox.x1;
        j += 2;
      }
    } else if (isM(toks[j].text) && sameLine(toks[i], toks[j])) {
      min = n;
      box.x1 = toks[j].bbox.x1;
    }
    if (min != null && min <= 1440) {
      durs.push({ min, cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 });
      i = j;
    }
  }

  // 2) Wochentags-Spalten
  const dates = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) dates.push(d);
  const dateOfWd = {};
  dates.forEach((d) => (dateOfWd[(parseYmd(d).getDay() + 6) % 7] = d));
  const cols = [];
  for (const w of words) {
    const idx = WD[clean(w.text)];
    if (idx != null && dateOfWd[idx] && !cols.some((c) => c.idx === idx)) cols.push({ idx, cx: (w.bbox.x0 + w.bbox.x1) / 2, cy: (w.bbox.y0 + w.bbox.y1) / 2 });
  }

  const days = {};
  // Die Spalten sind gleichmäßig verteilt: aus den erkannten Wochentagen eine Gerade x = a + b·Position
  // legen, damit auch unleserliche Wochentage ihre Spalte bekommen.
  const pts = cols.map((c) => ({ p: dates.indexOf(dateOfWd[c.idx]), x: c.cx, y: c.cy }));
  let fit = null;
  if (pts.length >= 2) {
    const mp = pts.reduce((a, q) => a + q.p, 0) / pts.length, mx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    let nu = 0, de = 0;
    pts.forEach((q) => { nu += (q.p - mp) * (q.x - mx); de += (q.p - mp) ** 2; });
    const b = de ? nu / de : 0;
    // Plausibel nur bei positivem Abstand und wenn die Punkte gut auf der Geraden liegen
    if (b > 0 && pts.every((q) => Math.abs(mx + b * (q.p - mp) - q.x) < b * 0.3)) fit = { a: mx - b * mp, b, y: Math.max(...pts.map((q) => q.y)) };
  }
  if (fit) {
    const used = new Set();
    dates.forEach((date, p) => {
      const cx = fit.a + fit.b * p;
      let best = null, bd = Infinity;
      durs.forEach((d, k) => {
        if (used.has(k) || d.cy > fit.y) return; // Wert steht über dem Wochentag
        const dist = Math.abs(d.cx - cx);
        if (dist < bd) { bd = dist; best = k; }
      });
      if (best != null && bd < fit.b * 0.45) {
        used.add(best);
        days[date] = durs[best].min;
      }
    });
  } else if (durs.length === dates.length) {
    durs.sort((a, b) => a.cx - b.cx).forEach((d, i) => (days[dates[i]] = d.min));
  }

  // 3) Ein fehlender Tag lässt sich aus der Wochensumme ergänzen
  const missing = dates.filter((d) => days[d] == null);
  const sum = Object.values(days).reduce((a, b) => a + b, 0);
  if (missing.length === 1 && total != null && total - sum >= 0 && total - sum <= 1440) days[missing[0]] = total - sum;
  // Ergeben die gelesenen Tage bereits die Wochensumme, sind alle übrigen Tage 0 ("0 Min." wird gern übersehen)
  else if (missing.length > 1 && total != null && sum === total && dates.length - missing.length >= 1) missing.forEach((d) => (days[d] = 0));

  const n = Object.keys(days).length;
  const sum2 = Object.values(days).reduce((a, b) => a + b, 0);
  const sumOk = total == null || Math.abs(sum2 - total) <= Math.max(10, total * 0.03);
  const ok = n === dates.length ? (total == null || Math.abs(sum2 - total) <= 60) : n >= 5 && sumOk;
  return { ok, days, found: n, sum: sum2, total, durations: durs.length, columns: cols.length };
}
