// Zugriff auf Outlook über Microsoft Graph (nur Lesen).

const BASE = 'https://graph.microsoft.com/v1.0';

async function get(token, url) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw Object.assign(new Error('Anmeldung abgelaufen'), { code: 401 });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    throw new Error(`Outlook-Fehler (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function me(token) {
  return get(token, '/me?$select=displayName,userPrincipalName,mail');
}

/** Alle Mail-Ordner inkl. Unterordner als flache Liste mit Pfad */
export async function listFolders(token) {
  const out = [];
  async function walk(url, prefix, depth) {
    let next = url;
    while (next) {
      const j = await get(token, next);
      for (const f of j.value) {
        const path = prefix ? `${prefix} / ${f.displayName}` : f.displayName;
        out.push({ id: f.id, path, count: f.totalItemCount });
        if (f.childFolderCount > 0 && depth < 4) {
          await walk(`/me/mailFolders/${f.id}/childFolders?$top=100`, path, depth + 1);
        }
      }
      next = j['@odata.nextLink'];
    }
  }
  await walk('/me/mailFolders?$top=100', '', 0);
  return out;
}

/** Nachrichten eines Ordners ab einem Datum (ISO) */
export async function listMessages(token, folderId, sinceIso) {
  const sel = 'id,internetMessageId,subject,receivedDateTime,from,body';
  const filter = sinceIso ? `&$filter=receivedDateTime ge ${sinceIso}` : '';
  let next = `/me/mailFolders/${folderId}/messages?$select=${sel}&$top=25&$orderby=receivedDateTime asc${filter}`;
  const out = [];
  while (next) {
    const j = await get(token, next);
    out.push(...j.value);
    next = j['@odata.nextLink'];
    if (out.length > 2000) break;
  }
  return out;
}

/**
 * Bilder einer Mail als Kandidaten für das Diagramm, größte/passendste zuerst.
 * Eingebettete Bilder (cid:) kommen über Graph, externe Bilder werden direkt geladen.
 * @returns {Promise<{list: Array<{label, load: () => Promise<Blob>}>, info: string[]}>}
 */
export async function chartImageCandidates(token, msg) {
  const doc = new DOMParser().parseFromString(msg.body?.content || '', 'text/html');
  const imgs = [...doc.querySelectorAll('img')].map((img, i) => ({
    i,
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    w: +(img.getAttribute('width') || img.style?.width?.replace('px', '') || 0),
    h: +(img.getAttribute('height') || img.style?.height?.replace('px', '') || 0),
  }));
  const info = imgs.map((x) => `Bild ${x.i}: ${x.src.startsWith('cid:') ? 'eingebettet' : x.src.slice(0, 90)} | alt="${x.alt}" | ${x.w}x${x.h}`);

  let atts = [];
  if (imgs.some((x) => x.src.startsWith('cid:'))) {
    try {
      atts = (await get(token, `/me/messages/${msg.id}/attachments`)).value || [];
      info.push(`Anhänge: ${atts.map((a) => `${a.name} (${a.contentType}, ${a.size} B, cid=${a.contentId})`).join('; ')}`);
    } catch (e) {
      info.push(`Anhänge nicht lesbar: ${e.message}`);
    }
  }

  const cands = [];
  for (const x of imgs) {
    if ((x.w && x.w < 150) || (x.h && x.h < 80)) continue; // Logos & App-Symbole
    const score = (/(diagramm|chart|graph|zeit|time|activity|aktivit)/i.test(x.alt + x.src) ? 1e7 : 0) + x.w * (x.h || 1);
    if (x.src.startsWith('cid:')) {
      const id = x.src.slice(4).replace(/[<>]/g, '');
      const a = atts.find((a) => (a.contentId || '').replace(/[<>]/g, '') === id);
      if (!a?.contentBytes || a.size < 3000) continue;
      cands.push({ score: score + a.size, label: `eingebettet ${a.name}`, load: async () => b64ToBlob(a.contentBytes, a.contentType) });
    } else if (/^https?:/.test(x.src)) {
      cands.push({ score, label: x.src.slice(0, 80), load: async () => { const r = await fetch(x.src, { mode: 'cors' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); } });
    } else if (x.src.startsWith('data:image')) {
      cands.push({ score, label: 'data-URL', load: async () => (await fetch(x.src)).blob() });
    }
  }
  // Anhänge ohne Verweis im HTML (selten) ebenfalls versuchen
  for (const a of atts) {
    if (a.contentBytes && /^image\//.test(a.contentType) && a.size > 8000 && !cands.some((c) => c.label.endsWith(a.name))) {
      cands.push({ score: a.size, label: `Anhang ${a.name}`, load: async () => b64ToBlob(a.contentBytes, a.contentType) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return { list: cands, info };
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

/** HTML-Mailtext in lesbaren Text umwandeln (Tabellenzellen getrennt, Zeilen erhalten) */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,head,title').forEach((e) => e.remove());
  doc.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(` ${img.getAttribute('alt')} `));
  doc.querySelectorAll('br').forEach((e) => e.replaceWith('\n'));
  doc.querySelectorAll('td,th').forEach((e) => e.append(' | '));
  doc.querySelectorAll('p,div,tr,li,h1,h2,h3,h4,h5,h6,table').forEach((e) => e.append('\n'));
  return (doc.body?.textContent || '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/( ?\| ?)+\n/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
