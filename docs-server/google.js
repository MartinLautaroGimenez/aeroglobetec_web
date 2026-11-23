// Google Docs del taller: el servidor actúa en nombre de UNA cuenta de Google del taller
// (la que se conecta una vez en /google/conectar). Esa cuenta es la dueña de los documentos,
// así no se pierden cuando un estudiante egresa y le borran la cuenta.
//
// Usa solo el permiso "drive.file": la app ve y maneja únicamente los archivos que crea ella.
// La cuenta queda guardada en GOOGLE_STATE_FILE (token para renovar el acceso y carpetas).
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const env = process.env;
const CLIENT_ID = env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = env.GOOGLE_REDIRECT_URI || '';
const SETUP_KEY = env.GOOGLE_SETUP_KEY || '';
const STATE_FILE = env.GOOGLE_STATE_FILE || './google.json';
// Direcciones de Google (se pueden cambiar solo para pruebas)
const AUTH_URL = env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const USERINFO_URL = env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const API = (env.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/$/, '');

const SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
const DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'AeroGlobETec · Documentos';

export class GoogleError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export const configured = () => !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

// ---------- Estado guardado (token y carpetas) ----------
let state = null;
async function loadState() {
  if (state) return state;
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { state = {}; }
  state.folders ||= {};
  return state;
}
async function saveState() {
  const tmp = `${STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(tmp, STATE_FILE);
}

export async function status() {
  const s = await loadState();
  return { configurado: configured(), conectado: configured() && !!s.refresh_token, cuenta: s.email || null };
}

// ---------- Conectar la cuenta del taller (una sola vez) ----------
const pending = new Map();   // state anti-CSRF -> vencimiento
export function authUrl(key) {
  if (!configured()) throw new GoogleError('Falta configurar GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI.', 503);
  if (!SETUP_KEY || key !== SETUP_KEY) throw new GoogleError('Clave de configuración incorrecta.', 403);
  const nonce = randomBytes(16).toString('hex');
  pending.set(nonce, Date.now() + 10 * 60000);
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: nonce,
  });
  return `${AUTH_URL}?${q}`;
}

export async function handleCallback({ code, state: nonce, error }) {
  if (error) throw new GoogleError(`Google no dio permiso: ${error}`, 400);
  const exp = pending.get(nonce);
  pending.delete(nonce);
  if (!exp || exp < Date.now()) throw new GoogleError('El enlace venció. Volvé a abrir /google/conectar.', 400);
  const tok = await tokenRequest({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
  if (!tok.refresh_token) throw new GoogleError('Google no devolvió un permiso permanente. Quitá el acceso de la app en la cuenta de Google y volvé a conectar.', 400);
  if (!String(tok.scope || '').includes('drive.file')) throw new GoogleError('Hay que tildar el permiso de Google Drive al conectar la cuenta.', 400);
  const info = await (await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json().catch(() => ({}));
  const s = await loadState();
  // Si cambia la cuenta, las carpetas de la anterior ya no sirven
  if (s.email && info.email && s.email !== info.email) { s.root_id = null; s.folders = {}; }
  Object.assign(s, { refresh_token: tok.refresh_token, email: info.email || s.email || null, connected_at: new Date().toISOString() });
  access = { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 - 60000 };
  await saveState();
  return s.email;
}

// ---------- Acceso a la API ----------
let access = null;
async function tokenRequest(params) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.error === 'invalid_grant') throw new GoogleError('La cuenta de Google del taller se desconectó. Un admin tiene que volver a conectarla.', 503);
    throw new GoogleError(`Google rechazó el acceso (${data.error || r.status}).`, 502);
  }
  return data;
}
async function accessToken() {
  if (access && access.exp > Date.now()) return access.token;
  const s = await loadState();
  if (!configured() || !s.refresh_token) throw new GoogleError('Google Docs todavía no está conectado al taller.', 503);
  const tok = await tokenRequest({ refresh_token: s.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token' });
  access = { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 - 60000 };
  return access.token;
}

async function g(path, { method = 'GET', query, body, raw, headers = {} } = {}) {
  const url = new URL(API + path);
  Object.entries({ supportsAllDrives: 'true', ...(query || {}) }).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || `Error ${r.status} de Google Drive`;
    const err = new GoogleError(msg, r.status === 404 ? 404 : 502);
    err.google = data.error;
    throw err;
  }
  return data;
}

// ---------- Carpetas: AeroGlobETec · Documentos / <proyecto o evento> ----------
async function createFolder(name, parent) {
  const f = await g('/drive/v3/files', { method: 'POST', query: { fields: 'id' }, body: { name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) } });
  return f.id;
}
async function folderFor(scopeKey, scopeName, retry = true) {
  const s = await loadState();
  try {
    if (!s.root_id) { s.root_id = await createFolder(ROOT_NAME); await saveState(); }
    if (!s.folders[scopeKey]) { s.folders[scopeKey] = await createFolder(scopeName, s.root_id); await saveState(); }
    return s.folders[scopeKey];
  } catch (e) {
    // Si alguien borró las carpetas en Drive, se vuelven a crear
    if (e.status === 404 && retry) { s.root_id = null; s.folders = {}; await saveState(); return folderFor(scopeKey, scopeName, false); }
    throw e;
  }
}

// ---------- Documentos ----------
const FIELDS = 'id,name,webViewLink,trashed';
const editUrl = (f) => f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`;

/**
 * Crea un Google Doc en la carpeta del proyecto/evento.
 * source: nada (en blanco) · { html } (plantilla) · { docx: Buffer } (Word que se convierte)
 */
export async function createDocument({ name, scopeKey, scopeName, source = {} }, retry = true) {
  const parent = await folderFor(scopeKey, scopeName);
  const meta = { name, mimeType: DOC_MIME, parents: [parent] };
  let file;
  try {
    if (!source.html && !source.docx) {
      file = await g('/drive/v3/files', { method: 'POST', query: { fields: FIELDS }, body: meta });
    } else {
      const media = source.docx
        ? { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: Buffer.from(source.docx) }
        : { type: 'text/html; charset=UTF-8', data: Buffer.from(source.html, 'utf8') };
      const boundary = `aeroglobetec${randomBytes(8).toString('hex')}`;
      const raw = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${media.type}\r\n\r\n`),
        media.data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      file = await g('/upload/drive/v3/files', { method: 'POST', query: { uploadType: 'multipart', fields: FIELDS }, raw, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
    }
  } catch (e) {
    // La carpeta del proyecto se borró en Drive: se crea de nuevo y se reintenta
    if (e.status === 404 && retry) {
      const s = await loadState();
      delete s.folders[scopeKey];
      await saveState();
      return createDocument({ name, scopeKey, scopeName, source }, false);
    }
    throw e;
  }
  return { id: file.id, name: file.name, url: editUrl(file) };
}

export async function getDocument(id) {
  const f = await g(`/drive/v3/files/${encodeURIComponent(id)}`, { query: { fields: FIELDS } });
  return { id: f.id, name: f.name, url: editUrl(f), trashed: !!f.trashed };
}

export async function renameDocument(id, name) {
  await g(`/drive/v3/files/${encodeURIComponent(id)}`, { method: 'PATCH', query: { fields: 'id' }, body: { name } });
}

// A la papelera de Drive (se puede recuperar durante 30 días)
export async function trashDocument(id) {
  try {
    await g(`/drive/v3/files/${encodeURIComponent(id)}`, { method: 'PATCH', query: { fields: 'id' }, body: { trashed: true } });
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}

// Le da acceso a una persona con el rol que le corresponde ('writer' o 'commenter').
// Si ya lo tenía con otro rol, lo cambia. No le manda mail: entra desde la plataforma.
export async function ensurePermission(id, email, role) {
  const mail = String(email || '').toLowerCase();
  if (!mail) throw new GoogleError('Tu cuenta no tiene mail.', 400);
  const s = await loadState();
  if (s.email && s.email.toLowerCase() === mail) return 'owner';
  const list = await g(`/drive/v3/files/${encodeURIComponent(id)}/permissions`, { query: { fields: 'permissions(id,type,emailAddress,role)', pageSize: '100' } });
  const mine = (list.permissions || []).find(p => p.type === 'user' && String(p.emailAddress || '').toLowerCase() === mail);
  if (mine) {
    if (mine.role === role || mine.role === 'owner') return mine.role;
    await g(`/drive/v3/files/${encodeURIComponent(id)}/permissions/${mine.id}`, { method: 'PATCH', query: { fields: 'id' }, body: { role } });
    return role;
  }
  try {
    await g(`/drive/v3/files/${encodeURIComponent(id)}/permissions`, { method: 'POST', query: { sendNotificationEmail: 'false', fields: 'id' }, body: { type: 'user', role, emailAddress: mail } });
  } catch (e) {
    if (/no Google account|not a Google account|cuenta de Google/i.test(e.message)) {
      throw new GoogleError(`Tu mail (${mail}) no tiene cuenta de Google, así que no se puede compartir el documento con vos.`, 400);
    }
    if (/sharing|share|outside|domain|dominio/i.test(e.message)) {
      throw new GoogleError(`Google no dejó compartir el documento con ${mail}: puede que la escuela no permita compartir con esta cuenta. (${e.message})`, 403);
    }
    throw e;
  }
  return role;
}
