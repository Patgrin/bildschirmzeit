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
