// Microsoft-Anmeldung (OAuth 2.0 Authorization Code + PKCE), ohne externe Bibliothek.
// Tokens bleiben nur auf diesem Gerät (localStorage).

const SCOPES = 'openid profile offline_access User.Read Mail.Read';
const TOKEN_KEY = 'bz.tokens';
const PKCE_KEY = 'bz.pkce';

export function redirectUri() {
  // immer das App-Verzeichnis (…/bildschirmzeit/), ohne index.html / Query
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

function authority(tenant) {
  return `https://login.microsoftonline.com/${tenant || 'consumers'}/oauth2/v2.0`;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 64) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a).slice(0, len);
}

export async function login(cfg, { silent = false } = {}) {
  localStorage.setItem('bz.hadSession', '1');
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(24);
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (!silent) p.set('prompt', 'select_account');
  location.assign(`${authority(cfg.tenant)}/authorize?${p}`);
}

/** Nach der Rückleitung von Microsoft den Code gegen Tokens tauschen */
export async function handleRedirect(cfg) {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', redirectUri());
  if (q.has('error')) throw new Error(`Anmeldung fehlgeschlagen: ${q.get('error_description') || q.get('error')}`);
  const pkce = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  localStorage.removeItem(PKCE_KEY);
  if (!pkce || pkce.state !== q.get('state')) throw new Error('Anmeldung ungültig (state stimmt nicht). Bitte erneut anmelden.');
  const tokens = await tokenRequest(cfg, {
    grant_type: 'authorization_code',
    code: q.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: pkce.verifier,
  });
  return tokens;
}

async function tokenRequest(cfg, params) {
  const res = await fetch(`${authority(cfg.tenant)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES, ...params }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error_description || j.error || 'Token-Fehler');
  const tokens = {
    access: j.access_token,
    refresh: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in - 120) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}

export function hasSession() {
  return !!localStorage.getItem(TOKEN_KEY);
}

/** Gültiges Access-Token oder null (dann ist eine neue Anmeldung nötig) */
export async function getToken(cfg) {
  const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  if (!t) return null;
  if (t.access && Date.now() < t.expiresAt) return t.access;
  if (!t.refresh) return null;
  try {
    const n = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: t.refresh });
    return n.access;
  } catch (e) {
    console.warn('Refresh fehlgeschlagen', e);
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('bz.hadSession');
}

/**
 * Microsoft begrenzt Anmeldungen von Web-Apps auf 24 Stunden. Wer schon einmal verbunden war,
 * wird daher automatisch kurz zu Microsoft und zurück geleitet (meist ohne Eingabe).
 * Höchstens einmal alle 10 Minuten, damit keine Schleife entsteht.
 */
export function autoRelogin(cfg) {
  if (!localStorage.getItem('bz.hadSession') || !cfg.clientId) return false;
  const last = +localStorage.getItem('bz.autoLoginAt') || 0;
  if (Date.now() - last < 10 * 60000) return false;
  localStorage.setItem('bz.autoLoginAt', String(Date.now()));
  login(cfg, { silent: true });
  return true;
}

export function hadSession() {
  return !!localStorage.getItem('bz.hadSession');
}
