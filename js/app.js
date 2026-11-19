import { db, save, ingest, msgKey, retryIfOutdated, PARSER_VERSION, setManual, resetMailData, exportJson, importJson } from './store.js';
import * as auth from './auth.js';
import * as graph from './graph.js';
import { parseReport } from './parser.js';
import { ocrImage, parseChartWords } from './chartocr.js';
import { daysFromChartUrls } from './chartdata.js';
import { holidayFor } from './holidays.js';
import { stats, renderChart } from './chart.js';
import { ymd, addDays, weekStartOf, fmtWeek, fmtDate, fmtMin, fmtHM, WD_SHORT, escapeHtml, parseUserDuration, weekdayIndex } from './util.js';

export const APP_VERSION = '1.7.0';
const FIRST_SYNC_FROM = null; // null = alle Mails im Ordner, egal wie alt
const AUTO_SYNC_MIN = 20; // Minuten zwischen automatischen Abgleichen

const $ = (s) => document.querySelector(s);
const cfg = () => db.settings;

// ---------- Hinweise ----------
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'toast'), 4000);
}

function setStatus(html) {
  $('#status').innerHTML = html;
}

// ---------- Abgleich mit Outlook ----------
let syncing = false;

async function sync({ silent = false } = {}) {
  if (syncing) return;
  if (!cfg().clientId) { if (!silent) showTab('settings'); return; }
  const token = await auth.getToken(cfg());
  if (!token) {
    if (auth.autoRelogin(cfg())) { setStatus('Anmeldung wird erneuert …'); return; }
    setStatus(`<button class="link" id="relogin">Bei Microsoft anmelden</button>, damit neue Berichte automatisch eingetragen werden.`);
    $('#relogin').onclick = () => auth.login(cfg());
    return;
  }
  if (!cfg().folderId) {
    setStatus('Bitte in den Einstellungen den Outlook-Ordner auswählen.');
    if (!silent) showTab('settings');
    return;
  }
  syncing = true;
  document.body.classList.add('syncing');
  setStatus('Prüfe Outlook auf neue Berichte …');
  try {
    // Überlappend ab 14 Tage vor der letzten Mail abfragen – Duplikate werden ohnehin erkannt
    // Geänderte Auswertung → alle aus Mails stammenden Werte verwerfen und komplett neu berechnen (manuelle bleiben)
    if (db.parserVersion !== PARSER_VERSION) resetMailData();
    const since = db.lastReceived && db.parserVersion === PARSER_VERSION ? new Date(new Date(db.lastReceived).getTime() - 14 * 86400000).toISOString() : FIRST_SYNC_FROM;
    const msgs = await graph.listMessages(token, cfg().folderId, since);
    let neu = 0, dup = 0, unk = 0, other = 0, retried = 0;
    const child = (cfg().childName || '').trim().toLowerCase();
    for (const m of msgs) {
      const key = msgKey(m);
      if (!key) continue;
      if (retryIfOutdated(key)) retried++;
      if (db.processed[key]) { dup++; continue; }
      const text = m.body?.contentType === 'html' ? graph.htmlToText(m.body.content) : m.body?.content || '';
      const full = `${m.subject}\n${text}`;
      if (child && !full.toLowerCase().includes(child)) {
        db.processed[key] = { subject: m.subject, received: m.receivedDateTime, status: 'anderes Familienmitglied', pv: PARSER_VERSION };
        other++;
        continue;
      }
      const rep = parseReport(full, new Date(m.receivedDateTime));
      let diag = '';
      if (rep.kind !== 'daily' && m.body?.contentType === 'html') {
        // Tageswerte stehen nur im Diagramm-Bild → per Texterkennung auslesen
        setStatus(`Lese Diagramm: ${escapeHtml(m.subject || '')} …`);
        diag = await readChart(token, m, rep);
      }
      const r = ingest(key, { subject: m.subject, received: m.receivedDateTime }, rep, `${full}\n\n--- Diagnose ---\n${diag}`);
      if (r.status === 'neu') neu++;
      else if (r.status === 'leer') unk++;
      else dup++;
      if (!db.lastReceived || m.receivedDateTime > db.lastReceived) db.lastReceived = m.receivedDateTime;
    }
    db.lastSync = new Date().toISOString();
    db.appVersion = APP_VERSION;
    db.parserVersion = PARSER_VERSION;
    db.lastResult = { at: db.lastSync, found: msgs.length, neu, dup, unk, other };
    save();
    render();
    const parts = [`${neu} neue Berichte`];
    if (dup) parts.push(`${dup} bereits bekannt/doppelt`);
    if (unk) parts.push(`${unk} nicht erkannt`);
    if (other) parts.push(`${other} andere Person`);
    if (!silent || neu) toast(parts.join(' · '), neu ? 'ok' : '');
  } catch (e) {
    console.error(e);
    if (e.code === 401) auth.logout();
    toast(e.message, 'err');
  } finally {
    syncing = false;
    document.body.classList.remove('syncing');
    renderStatus();
  }
}

/** Versucht die Tageswerte aus dem Diagramm-Bild zu lesen; ergänzt rep bei Erfolg. Liefert Diagnosetext. */
async function readChart(token, m, rep) {
  const log = [];
  // 1) Tageswerte direkt aus der Diagramm-URL lesen (zuverlässig, ohne Bild zu laden)
  try {
    const r = daysFromChartUrls(graph.imageUrls(m.body?.content), { from: rep.weekStart, to: rep.weekEnd }, rep.total);
    log.push(...r.info);
    if (r.days) {
      rep.days = r.days;
      rep.kind = 'daily';
      log.push('Tageswerte aus Diagramm-URL übernommen.');
      return log.join('\n');
    }
  } catch (e) {
    log.push(`URL-Auswertung: ${e.message}`);
  }
  // 2) Fallback: Bild laden und per Texterkennung lesen
  try {
    const { list, info } = await graph.chartImageCandidates(token, m);
    log.push(...info);
    if (!list.length) log.push('Kein passendes Diagramm-Bild gefunden.');
    for (const c of list.slice(0, 4)) {
      try {
        const blob = await c.load();
        let best = null;
        for await (const ocr of ocrImage(blob)) {
          const res = parseChartWords(ocr.words, { from: rep.weekStart, to: rep.weekEnd }, rep.total);
          log.push(`Texterkennung ${c.label}: ${res.found} Tage, Summe ${res.sum} / ${res.total} Min. → ${res.ok ? 'OK' : 'verworfen'}\n${ocr.text.slice(0, 600)}`);
          const diff = rep.total != null ? Math.abs(res.sum - rep.total) : 0;
          if (res.ok && (!best || diff < best.diff)) best = { res, diff };
          if (best && best.diff === 0) break; // Summe stimmt exakt
        }
        if (best) {
          rep.days = best.res.days;
          rep.kind = 'daily';
          rep.ocr = true;
          break;
        }
      } catch (e) {
        log.push(`Bild ${c.label}: ${e.message}`);
      }
    }
  } catch (e) {
    log.push(`Fehler: ${e.message}`);
  }
  return log.join('\n');
}

function renderStatus() {
  if (!db.lastSync) { setStatus(auth.hasSession() ? 'Noch nicht abgeglichen.' : 'Nicht verbunden – siehe Einstellungen.'); return; }
  const d = new Date(db.lastSync);
  setStatus(`Zuletzt abgeglichen: ${d.toLocaleDateString('de-AT')} ${d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`);
}

function maybeAutoSync() {
  const due = !db.lastSync || db.appVersion !== APP_VERSION || Date.now() - new Date(db.lastSync).getTime() > AUTO_SYNC_MIN * 60000;
  if (due && cfg().clientId && (auth.hasSession() || auth.hadSession())) sync({ silent: true });
}

// ---------- Timeline ----------
function renderTimeline() {
  const el = $('#timeline');
  const keys = Object.keys(db.days).sort();
  if (!keys.length && !Object.keys(db.weekTotals || {}).length) {
    const r = db.lastResult;
    const hint = !cfg().folderId || !auth.hadSession()
      ? 'Verbinde Outlook in den Einstellungen – die Wochenberichte werden dann automatisch eingetragen.'
      : !r
        ? 'Outlook ist verbunden. Der erste Abgleich läuft gleich bzw. über ↻ oben rechts.'
        : `Outlook ist verbunden (Ordner „${escapeHtml(cfg().folderName)}“). Beim letzten Abgleich: ${r.found} Mails gefunden, ${r.neu} übernommen, ${r.unk} nicht erkannt${r.other ? `, ${r.other} wegen Namensfilter übersprungen` : ''}. Details unter Einstellungen → Verarbeitete E-Mails.`;
    el.innerHTML = `<div class="empty"><p>Noch keine Einträge.</p><p class="muted">${hint}</p></div>`;
    return;
  }
  const wts = Object.keys(db.weekTotals || {}).sort();
  // Frühester Tag aus Tageswerten oder Wochensummen (eine der beiden Listen kann leer sein)
  const firstDay = [keys[0], wts[0]].filter(Boolean).sort()[0];
  const first = weekStartOf(firstDay);
  const lastKey = keys.length && keys[keys.length - 1] > ymd(new Date()) ? keys[keys.length - 1] : ymd(new Date());
  const last = weekStartOf(lastKey);
  const custom = cfg().customFree;
  const maxMin = Math.max(240, ...keys.map((k) => db.days[k].min));

  let html = '';
  for (let w = last; w >= first; w = addDays(w, -7)) {
    const days = [...Array(7)].map((_, i) => addDays(w, i));
    const vals = days.map((d) => db.days[d]).filter(Boolean);
    const wt = db.weekTotals?.[w];
    if (!vals.length && !wt && w !== last) {
      html += `<div class="week gap">${fmtWeek(w)} · kein Bericht</div>`;
      continue;
    }
    const sum = wt && !vals.length ? wt.total : vals.reduce((a, v) => a + v.min, 0);
    const avgTxt = wt && !vals.length ? fmtMin(wt.total / 7) : vals.length ? fmtMin(sum / vals.length) : '–';
    const holidays = [...new Set(days.map((d) => holidayFor(d, custom)).filter(Boolean))];
    html += `<section class="week">
      <header><div><h3>${fmtWeek(w)}</h3></div>
      <div class="wsum"><strong>${fmtHM(sum)} h</strong><span class="muted">Ø ${avgTxt}</span></div></header>
      ${wt && !vals.length ? '<p class="small muted wnote">Nur Wochensumme laut Bericht – die Tageswerte im Diagramm waren nicht lesbar.</p>' : ''}
      ${holidays.length ? `<div class="chips">${holidays.map((h) => `<span class="chip hol">${escapeHtml(h)}</span>`).join('')}</div>` : ''}
      <ul>`;
    for (const d of days) {
      const v = db.days[d];
      const hol = holidayFor(d, custom);
      const we = weekdayIndex(d) >= 5;
      const pct = v && v.min > 0 ? Math.max(1.5, (v.min / maxMin) * 100) : 0;
      const tag = v?.src === 'manual' ? '<span class="tag" title="Manuell eingetragen">✎</span>' : '';
      html += `<li class="day${hol ? ' is-hol' : ''}${we ? ' is-we' : ''}" data-day="${d}">
        <span class="dname">${WD_SHORT[weekdayIndex(d)]}<small>${fmtDate(d)}</small></span>
        <span class="track"><span class="fill${hol ? ' hol' : ''}" style="width:${pct}%"></span></span>
        <span class="val">${v ? fmtHM(v.min) : '–'}${tag}</span>
      </li>`;
    }
    html += '</ul></section>';
  }
  el.innerHTML = html;
}

function editDay(day) {
  const cur = db.days[day];
  const inp = prompt(`Bildschirmzeit für ${WD_SHORT[weekdayIndex(day)]}, ${fmtDate(day, true)}\nz. B. 3:20 oder 3,5 (leer = löschen)`, cur ? fmtHM(cur.min) : '');
  if (inp === null) return;
  if (inp.trim() === '') { setManual(day, null); render(); return; }
  const min = parseUserDuration(inp);
  if (min == null || min > 1440) { toast('Ungültige Eingabe', 'err'); return; }
  setManual(day, min);
  render();
}

// ---------- Diagramm ----------
function pct(x) {
  return `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`;
}

function renderStats() {
  const st = stats(db.days, cfg().customFree, db.weekTotals || {});
  const tiles = [
    ['Seit November 2025', st.change != null ? pct(st.change) : '–', st.nov != null ? `Nov.: Ø ${fmtMin(st.nov)} → zuletzt Ø ${fmtMin(st.recent)} / Tag` : 'Noch keine Daten aus November'],
    ['Trend', st.slopePerWeek != null ? `${st.slopePerWeek >= 0 ? '+' : '−'}${Math.abs(Math.round(st.slopePerWeek))} Min.` : '–', 'pro Tag, je Woche'],
    ['Schultag', st.schule != null ? fmtHM(st.schule) + ' h' : '–', 'Ø Mo–Fr ohne Ferien'],
    ['Ferientag', st.ferien != null ? fmtHM(st.ferien) + ' h' : '–', 'Ø in Ferien & Feiertagen'],
    ['Wochenende', st.wochenende != null ? fmtHM(st.wochenende) + ' h' : '–', 'Ø Sa/So außerhalb Ferien'],
  ];
  $('#tiles').innerHTML = tiles.map(([l, v, s]) => `<div class="tile"><span class="tl">${l}</span><span class="tv">${v}</span><span class="ts">${s}</span></div>`).join('');
  renderChart($('#chart'), $('#tip'), st, cfg().customFree || []);
  $('#monthTable tbody').innerHTML = st.monthRows.map((r) => `<tr><td>${r.label}</td><td>${fmtHM(r.avg)}</td><td>${r.schule != null ? fmtHM(r.schule) : '–'}</td><td>${r.ferien != null ? fmtHM(r.ferien) : '–'}</td><td>${r.n}</td></tr>`).join('');
}

// ---------- Einstellungen ----------
function renderSettings() {
  const s = cfg();
  $('#clientId').value = s.clientId;
  $('#tenant').value = s.tenant || 'consumers';
  $('#childName').value = s.childName || '';
  $('#redirectUri').textContent = auth.redirectUri();
  $('#folderName').textContent = s.folderName || 'kein Ordner gewählt';
  $('#loginState').textContent = auth.hasSession() ? 'Verbunden' : 'Nicht angemeldet';
  $('#btnLogin').textContent = auth.hasSession() ? 'Abmelden' : 'Bei Microsoft anmelden';
  $('#btnFolders').disabled = !auth.hasSession();
  $('#version').textContent = APP_VERSION;

  $('#customList').innerHTML = (s.customFree || []).map((c, i) => `<li>${escapeHtml(c.name || 'Schulfrei')}: ${fmtDate(c.from, true)}${c.to !== c.from ? ' – ' + fmtDate(c.to, true) : ''} <button class="link danger" data-del="${i}">entfernen</button></li>`).join('') || '<li class="muted">keine</li>';

  const proc = Object.entries(db.processed).sort((a, b) => ((a[1].received || '') < (b[1].received || '') ? 1 : -1));
  $('#mailCount').textContent = proc.length;
  const weeksOk = proc.filter(([, p]) => p.weekStart && (p.status === 'übernommen' || p.status === 'nur Summe')).map(([, p]) => p.weekStart).sort();
  $('#mailRange').innerHTML = weeksOk.length
    ? `<strong>${weeksOk.length} Wochenberichte</strong> von ${fmtDate(weeksOk[0], true)} bis ${fmtDate(addDays(weeksOk[weeksOk.length - 1], 6), true)}`
    : '';
  $('#mailLog').innerHTML = proc.slice(0, 60).map(([k, p]) => `<li><span class="st st-${p.status === 'übernommen' ? 'ok' : p.status === 'nicht erkannt' ? 'err' : 'mute'}">${escapeHtml(p.status)}</span>
    ${escapeHtml(p.subject || '(ohne Betreff)')}<br><small class="muted">${p.received ? new Date(p.received).toLocaleDateString('de-AT') : ''}${p.weekStart ? ` · Woche ${fmtDate(p.weekStart)}–${fmtDate(p.weekEnd)}` : ''}${p.kind && p.kind !== 'daily' && p.kind !== 'none' ? ' · nur Durchschnitt' : ''}</small>
    ${db.rawSamples[k] ? `<details><summary>Rohtext anzeigen</summary><button class="copy" data-copy="${escapeHtml(k)}">Text kopieren</button><pre>${escapeHtml(db.rawSamples[k])}</pre></details>` : ''}</li>`).join('');
  $('#mailLog').onclick = async (e) => {
    const k = e.target.dataset?.copy;
    if (!k) return;
    try { await navigator.clipboard.writeText(db.rawSamples[k]); toast('Text kopiert', 'ok'); } catch { toast('Kopieren nicht möglich – Text bitte markieren', 'err'); }
  };
}

async function loadFolders() {
  const token = await auth.getToken(cfg());
  if (!token) { toast('Bitte zuerst anmelden', 'err'); return; }
  const sel = $('#folderSelect');
  sel.innerHTML = '<option>Lade Ordner …</option>';
  sel.hidden = false;
  try {
    const folders = await graph.listFolders(token);
    sel.innerHTML = '<option value="">– Ordner wählen –</option>' + folders.map((f) => `<option value="${escapeHtml(f.id)}"${f.id === cfg().folderId ? ' selected' : ''}>${escapeHtml(f.path)} (${f.count})</option>`).join('');
  } catch (e) {
    toast(e.message, 'err');
    sel.hidden = true;
  }
}

function bindSettings() {
  $('#clientId').onchange = (e) => { cfg().clientId = e.target.value.trim(); save(); };
  $('#tenant').onchange = (e) => { cfg().tenant = e.target.value; save(); };
  $('#childName').onchange = (e) => { cfg().childName = e.target.value.trim(); save(); };
  $('#btnLogin').onclick = () => {
    if (auth.hasSession()) { auth.logout(); renderSettings(); renderStatus(); return; }
    cfg().clientId = $('#clientId').value.trim();
    save();
    if (!cfg().clientId) { toast('Bitte zuerst die Client-ID eintragen', 'err'); return; }
    auth.login(cfg());
  };
  $('#btnFolders').onclick = loadFolders;
  $('#folderSelect').onchange = (e) => {
    const o = e.target.selectedOptions[0];
    if (!o.value) return;
    const changed = cfg().folderId && cfg().folderId !== o.value;
    cfg().folderId = o.value;
    cfg().folderName = o.textContent.replace(/ \(\d+\)$/, '');
    if (changed) db.lastReceived = null;
    save();
    e.target.hidden = true;
    renderSettings();
    sync();
  };
  $('#btnSync').onclick = () => sync();
  $('#btnAddFree').onclick = () => {
    const from = $('#freeFrom').value, to = $('#freeTo').value || from, name = $('#freeName').value.trim();
    if (!from) { toast('Bitte ein Datum wählen', 'err'); return; }
    cfg().customFree = [...(cfg().customFree || []), { from, to: to < from ? from : to, name: name || 'Schulautonom frei' }];
    save();
    $('#freeFrom').value = $('#freeTo').value = $('#freeName').value = '';
    render();
  };
  $('#customList').onclick = (e) => {
    const i = e.target.dataset.del;
    if (i == null) return;
    cfg().customFree.splice(+i, 1);
    save();
    render();
  };
  $('#btnExport').onclick = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bildschirmzeit-${ymd(new Date())}.json`;
    a.click();
  };
  $('#importFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { importJson(await f.text()); toast('Sicherung importiert', 'ok'); render(); } catch (err) { toast(err.message, 'err'); }
  };
  $('#btnRebuild').onclick = () => {
    if (!confirm('Alle aus Mails übernommenen Werte verwerfen und neu aus Outlook einlesen? Manuelle Einträge bleiben erhalten.')) return;
    resetMailData();
    render();
    sync();
  };
  $('#btnTest').onclick = () => {
    const txt = $('#testText').value;
    const r = parseReport(txt, new Date());
    $('#testOut').textContent = JSON.stringify(r, null, 1);
  };
}

// ---------- Navigation ----------
function showTab(name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'chart') renderStats();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function render() {
  renderTimeline();
  if (!$('#view-chart').hidden) renderStats();
  if (!$('#view-settings').hidden) renderSettings();
}

// ---------- Start ----------
async function init() {
  document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $('#timeline').onclick = (e) => { const li = e.target.closest('.day'); if (li) editDay(li.dataset.day); };
  $('#syncBtn').onclick = () => sync();
  bindSettings();
  let lastW = innerWidth;
  // iOS meldet beim Scrollen 'resize' (Höhe ändert sich) – nur bei geänderter Breite neu zeichnen
  window.addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; if (!$('#view-chart').hidden) renderStats(); } });

  try {
    if (await auth.handleRedirect(cfg())) toast('Mit Microsoft verbunden', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }

  const hashTab = location.hash.slice(1);
  showTab(['timeline', 'chart', 'settings'].includes(hashTab) ? hashTab : cfg().clientId && auth.hasSession() && !cfg().folderId ? 'settings' : 'timeline');
  renderTimeline();
  renderStatus();
  maybeAutoSync();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { maybeAutoSync(); swUpdate(); } });
}

// ---------- Selbst-Update über Service Worker ----------
let reg = null;
function swUpdate() { reg?.update().catch(() => {}); }

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((r) => { reg = r; swUpdate(); });
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller; // erste Installation: kein Neuladen
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController || syncing) return;
    reloaded = true;
    location.reload();
  });
}

init();
