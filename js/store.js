// Lokale Datenhaltung inkl. Duplikat-Schutz.
//
// Duplikate werden auf drei Ebenen verhindert:
//  1. Jede E-Mail (internetMessageId) wird nur einmal verarbeitet.
//  2. Inhaltlich identische Berichte (z. B. weitergeleitete Kopien) werden über einen Hash erkannt.
//  3. Jeder Tag existiert genau einmal. Ein vorhandener Wert wird nur durch eine "bessere"
//     Quelle ersetzt: manuell > Tageswert aus Mail > geschätzt (Durchschnitt).

import { hash } from './util.js';

const KEY = 'bz.data.v1';
const PRIO = { estimate: 1, mail: 2, manual: 3 };
// Bei Verbesserungen der Erkennung erhöhen: Nicht (vollständig) erkannte Mails werden dann automatisch neu gelesen
export const PARSER_VERSION = 2;
const RETRY = ['nicht erkannt', 'nur Summe', 'anderes Familienmitglied'];

/** Mail wurde mit älterer Erkennung nicht vollständig gelesen → vergessen, damit sie neu verarbeitet wird */
export function retryIfOutdated(key) {
  const p = db.processed[key];
  if (!p || (p.pv || 1) >= PARSER_VERSION || !RETRY.includes(p.status)) return false;
  if (p.h && db.hashes[p.h] === key) delete db.hashes[p.h];
  delete db.processed[key];
  delete db.rawSamples[key];
  return true;
}

const empty = () => ({
  settings: { clientId: '', tenant: 'consumers', folderId: '', folderName: '', childName: '', customFree: [] },
  processed: {},   // msgKey -> { subject, received, status, weekStart, weekEnd, kind }
  hashes: {},      // inhaltsHash -> msgKey
  days: {},        // 'YYYY-MM-DD' -> { min, src, msg }
  lastSync: null,
  lastReceived: null,
  rawSamples: {},  // msgKey -> Text (nur für nicht erkannte Mails, zur Fehlersuche)
});

export let db = load();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return { ...empty(), ...d, settings: { ...empty().settings, ...d.settings } };
  } catch {}
  return empty();
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function msgKey(m) {
  return (m.internetMessageId || m.id || '').trim();
}

/**
 * Einen geparsten Bericht übernehmen.
 * @returns {'neu'|'duplikat'|'kopie'|'leer'} sowie Anzahl geänderter Tage
 */
export function ingest(key, meta, report, rawText) {
  if (db.processed[key]) return { status: 'duplikat', changed: 0 };

  const base = { subject: meta.subject, received: meta.received, weekStart: report.weekStart, weekEnd: report.weekEnd, kind: report.kind, pv: PARSER_VERSION };

  if (report.kind === 'none') {
    db.processed[key] = { ...base, status: 'nicht erkannt' };
    db.rawSamples[key] = rawText.slice(0, 6000);
    return { status: 'leer', changed: 0 };
  }

  const h = hash(JSON.stringify([report.weekStart, report.weekEnd, report.kind, report.days]));
  if (db.hashes[h]) {
    db.processed[key] = { ...base, status: 'Kopie', duplicateOf: db.hashes[h] };
    return { status: 'kopie', changed: 0 };
  }
  db.hashes[h] = key;

  if (report.kind !== 'daily') db.rawSamples[key] = rawText.slice(0, 8000); // zur Fehlersuche aufheben
  const src = report.kind === 'daily' ? 'mail' : 'estimate';
  let changed = 0;
  for (const [day, min] of Object.entries(report.days)) {
    const cur = db.days[day];
    if (!cur || PRIO[src] > PRIO[cur.src]) {
      db.days[day] = { min, src, msg: key };
      changed++;
    }
  }
  db.processed[key] = { ...base, status: report.kind === 'daily' ? 'übernommen' : 'nur Summe', changed, ocr: !!report.ocr, h };
  return { status: 'neu', changed };
}

export function setManual(day, min) {
  if (min == null) {
    delete db.days[day];
  } else {
    db.days[day] = { min, src: 'manual', msg: null };
  }
  save();
}

/** Alle Mail-Daten verwerfen (manuelle Einträge bleiben) – für kompletten Neuimport */
export function resetMailData() {
  for (const [d, v] of Object.entries(db.days)) if (v.src !== 'manual') delete db.days[d];
  db.processed = {};
  db.hashes = {};
  db.rawSamples = {};
  db.lastReceived = null;
  save();
}

export function exportJson() {
  return JSON.stringify({ ...db, exportedAt: new Date().toISOString() }, null, 1);
}

/** Import einer Sicherung – zusammenführen, nicht überschreiben */
export function importJson(str) {
  const d = JSON.parse(str);
  if (!d.days) throw new Error('Keine gültige Sicherung');
  for (const [day, v] of Object.entries(d.days)) {
    const cur = db.days[day];
    if (!cur || PRIO[v.src] > PRIO[cur.src]) db.days[day] = v;
  }
  Object.assign(db.processed, d.processed || {});
  Object.assign(db.hashes, d.hashes || {});
  if (!db.settings.clientId && d.settings) db.settings = { ...db.settings, ...d.settings };
  save();
}
