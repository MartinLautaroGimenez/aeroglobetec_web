// Servidor de documentos colaborativos de AeroGlobETec.
// Hace de punto de encuentro en tiempo real (Hocuspocus + Yjs): cada navegador manda sus cambios
// y el servidor se los reparte al resto. Guarda el contenido en Supabase (document_states) y,
// cada tanto, una versión automática para el historial (document_versions).
//
// Permisos: cada conexión trae la sesión de Supabase de la persona. El servidor le pregunta a la
// base (función document_access) si puede editar o solo leer ese documento. Así rigen las mismas
// reglas que en el resto de la plataforma.
//
// Además atiende /google/…: crea Google Docs en el Drive de la cuenta del taller y le da acceso
// a cada persona cuando lo abre desde la plataforma (ver google.js).
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { createClient } from '@supabase/supabase-js';
import * as google from './google.js';

const env = process.env;
const PORT = Number(env.PORT || 1234);
const HOST = env.HOST || '0.0.0.0';
const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY || '';
const ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const VERSION_EVERY_MIN = Number(env.VERSION_EVERY_MIN || 30);
const MAX_AUTO_VERSIONS = Number(env.MAX_AUTO_VERSIONS || 60);
// Solo para probar en la compu: sin login ni base de datos (los documentos viven en memoria)
const DEV = env.DEV_SIN_AUTH === '1';

if (DEV && env.NODE_ENV === 'production') {
  console.error('DEV_SIN_AUTH no se puede usar con NODE_ENV=production.');
  process.exit(1);
}
if (!DEV && (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY)) {
  console.error('Faltan SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_SERVICE_KEY (ver .env.example).');
  process.exit(1);
}

const admin = DEV ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const memory = new Map();   // modo DEV

const DOC_NAME = /^doc:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const docId = (name) => {
  const m = DOC_NAME.exec(name || '');
  if (!m) throw new Error('Nombre de documento inválido');
  return m[1].toLowerCase();
};

// bytea de Postgres <-> bytes (PostgREST usa el formato hexadecimal "\x0a1b…")
const toBytea = (bytes) => '\\x' + Buffer.from(bytes).toString('hex');
const fromBytea = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && value.startsWith('\\x')) return new Uint8Array(Buffer.from(value.slice(2), 'hex'));
  return null;
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

// La sesión de Supabase de quien se conecta: quién es y un cliente que consulta con SUS permisos
async function session(token) {
  if (!token) throw httpError(401, 'Falta la sesión');
  const { data: who, error } = await admin.auth.getUser(token);
  if (error || !who?.user) throw httpError(401, 'Sesión vencida o inválida');
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { user: who.user, asUser };
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

const server = new Server({
  name: 'aeroglobetec-docs',
  port: PORT,
  address: HOST,
  quiet: true,
  // Junta los cambios y guarda como mucho cada 2 s (y a los 10 s sí o sí, aunque sigan escribiendo)
  debounce: 2000,
  maxDebounce: 10000,
  websocketOptions: { maxPayload: 8 * 1024 * 1024 },

  async onRequest({ request, response }) {
    const url = new URL(request.url, 'http://localhost');
    // Puede venir con prefijo (por ejemplo /docs-ws/… detrás de Caddy o nginx)
    if (/\/(salud|health)$/.test(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      const g = await google.status().catch(() => ({}));
      response.end(JSON.stringify({ ok: true, documentos_abiertos: server.hocuspocus.getDocumentsCount(), conexiones: server.hocuspocus.getConnectionsCount(), google: { configurado: !!g.configurado, conectado: !!g.conectado } }));
      throw null; // corta acá: Hocuspocus no agrega su respuesta por defecto
    }
    const i = url.pathname.indexOf('/google/');
    if (i >= 0) {
      await handleGoogle(request, response, url.pathname.slice(i + '/google'.length), url.searchParams);
      throw null;
    }
  },

  async onConnect({ requestHeaders, documentName }) {
    docId(documentName);
    const origin = (requestHeaders.get('origin') || '').replace(/\/$/, '');
    if (ORIGINS.length && !ORIGINS.includes(origin)) {
      log('Rechazado por origen', origin || '(sin origen)');
      throw new Error('Origen no permitido');
    }
  },

  async onAuthenticate({ token, documentName, connectionConfig }) {
    const id = docId(documentName);
    if (DEV) return { userId: null };
    // La consulta va con la sesión de la persona: la base decide según sus reglas
    const { user, asUser } = await session(token);
    const { data: access, error } = await asUser.rpc('document_access', { d: id });
    if (error) throw new Error('No se pudo comprobar el permiso: ' + error.message);
    if (access !== 'editar' && access !== 'leer') throw new Error('Sin permiso para este documento');
    if (access === 'leer') connectionConfig.readOnly = true;
    log('Conectado', user.email, '→', id, access);
    return { userId: user.id };
  },

  extensions: [
    new Database({
      async fetch({ documentName }) {
        const id = docId(documentName);
        if (DEV) return memory.get(id) || null;
        const { data, error } = await admin.from('document_states').select('state').eq('document_id', id).maybeSingle();
        if (error) throw error;
        return fromBytea(data?.state);
      },
      async store({ documentName, state, lastContext }) {
        const id = docId(documentName);
        if (DEV) { memory.set(id, new Uint8Array(state)); return; }
        const now = new Date().toISOString();
        const { error } = await admin.from('document_states')
          .upsert({ document_id: id, state: toBytea(state), updated_at: now });
        if (error) { log('Error al guardar', id, error.message); throw error; }
        await admin.from('documents').update({ updated_at: now, updated_by: lastContext?.userId || null }).eq('id', id);
        await autoVersion(id, state, lastContext?.userId || null);
      },
    }),
  ],
});

// Versión automática si la última tiene más de VERSION_EVERY_MIN minutos
async function autoVersion(id, state, userId) {
  try {
    const { data: last } = await admin.from('document_versions').select('created_at')
      .eq('document_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.created_at).getTime() < VERSION_EVERY_MIN * 60000) return;
    await admin.from('document_versions').insert({ document_id: id, state: toBytea(state), auto: true, created_by: userId });
    // Se quedan las últimas MAX_AUTO_VERSIONS automáticas (las que tienen nombre no se borran)
    const { data: old } = await admin.from('document_versions').select('id')
      .eq('document_id', id).eq('auto', true).order('created_at', { ascending: false }).range(MAX_AUTO_VERSIONS, MAX_AUTO_VERSIONS + 50);
    if (old?.length) await admin.from('document_versions').delete().in('id', old.map(v => v.id));
  } catch (e) {
    log('No se pudo guardar la versión automática', id, e.message);
  }
}

// =====================================================================
// Google Docs (rutas HTTP /google/…)
// =====================================================================
const MAX_BODY = 25 * 1024 * 1024;
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(httpError(413, 'El archivo es demasiado grande (máximo 18 MB).')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (!chunks.length) return resolve({});
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError(400, 'Pedido inválido')); }
  });
  req.on('error', reject);
});

function cors(req, res) {
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  if (origin && (!ORIGINS.length || ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
const sendJson = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const sendPage = (res, status, title, text) => {
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;color:#1f1f1f"><h1 style="font-size:22px">${esc(title)}</h1><p>${esc(text)}</p></body>`);
};
const ROLE = { editar: 'writer', leer: 'commenter' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGoogle(req, res, path, query) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    // ----- Conectar la cuenta de Google del taller (lo hace un admin, una vez) -----
    if (req.method === 'GET' && path === '/conectar') {
      res.writeHead(302, { Location: google.authUrl(query.get('clave') || '') });
      res.end();
      return;
    }
    if (req.method === 'GET' && path === '/callback') {
      try {
        const email = await google.handleCallback({ code: query.get('code'), state: query.get('state'), error: query.get('error') });
        log('Google Docs conectado con la cuenta', email);
        sendPage(res, 200, 'Google Docs conectado', `Listo: los documentos se van a crear en el Drive de ${email}. Ya podés cerrar esta pestaña.`);
      } catch (e) {
        sendPage(res, e.status || 500, 'No se pudo conectar Google', e.message);
      }
      return;
    }

    if (DEV) throw httpError(503, 'En el modo de prueba (DEV_SIN_AUTH) no hay Google Docs.');
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { user, asUser } = await session(token);

    // ----- Estado -----
    if (req.method === 'GET' && path === '/estado') {
      sendJson(res, 200, await google.status());
      return;
    }

    // ----- Crear -----
    if (req.method === 'POST' && path === '/documentos') {
      const body = await readBody(req);
      const title = String(body.title || 'Documento sin título').trim().slice(0, 200) || 'Documento sin título';
      const projectId = UUID.test(body.project_id || '') ? body.project_id : null;
      const eventId = !projectId && UUID.test(body.event_id || '') ? body.event_id : null;
      const { data: allowed, error } = await asUser.rpc('can_create_document', { p: projectId, e: eventId });
      if (error) throw httpError(502, 'No se pudo comprobar el permiso: ' + error.message);
      if (!allowed) throw httpError(403, projectId || eventId ? 'No tenés permiso para crear documentos ahí.' : 'Los documentos del taller los crean docentes y líderes.');

      let scopeKey = 'taller', scopeName = 'Del taller';
      if (projectId) {
        const { data } = await admin.from('projects').select('name').eq('id', projectId).single();
        scopeKey = `p:${projectId}`; scopeName = `Proyecto · ${data?.name || projectId}`;
      } else if (eventId) {
        const { data } = await admin.from('events').select('title').eq('id', eventId).single();
        scopeKey = `e:${eventId}`; scopeName = `Evento · ${data?.title || eventId}`;
      }
      const source = body.docx ? { docx: Buffer.from(String(body.docx), 'base64') } : body.html ? { html: String(body.html) } : {};
      const file = await google.createDocument({ name: title, scopeKey, scopeName, source });
      const { data: row, error: insError } = await admin.from('documents').insert({
        title, project_id: projectId, event_id: eventId, folder: String(body.folder || '').slice(0, 60),
        kind: 'google', google_id: file.id, google_url: file.url, created_by: user.id, updated_by: user.id,
      }).select('*').single();
      if (insError) { await google.trashDocument(file.id).catch(() => {}); throw httpError(502, 'No se pudo guardar el documento: ' + insError.message); }
      await google.ensurePermission(file.id, user.email, 'writer').catch((e) => log('No se pudo compartir con', user.email, e.message));
      log('Google Doc creado', file.id, 'por', user.email);
      sendJson(res, 201, row);
      return;
    }

    const m = path.match(/^\/documentos\/([0-9a-f-]{36})(\/acceso)?$/i);
    if (!m) throw httpError(404, 'No existe esa ruta');
    const id = m[1].toLowerCase();

    // ----- Borrar: la base decide si puede (RLS); el archivo va a la papelera de Drive -----
    if (req.method === 'DELETE' && !m[2]) {
      const { data: gone, error } = await asUser.from('documents').delete().eq('id', id).select('google_id');
      if (error) throw httpError(502, error.message);
      if (!gone?.length) throw httpError(403, 'Solo quien lo creó, un docente o un líder pueden borrarlo.');
      if (gone[0].google_id) await google.trashDocument(gone[0].google_id);
      sendJson(res, 200, { ok: true });
      return;
    }

    const { data: access, error: accError } = await asUser.rpc('document_access', { d: id });
    if (accError) throw httpError(502, 'No se pudo comprobar el permiso: ' + accError.message);
    if (access !== 'editar' && access !== 'leer') throw httpError(403, 'No tenés acceso a este documento.');
    const { data: doc } = await admin.from('documents').select('id, title, kind, google_id, google_url').eq('id', id).single();
    if (!doc?.google_id) throw httpError(400, 'Este documento no es un Google Doc.');

    // ----- Abrir: se le da acceso en Google con el rol que le toca y se devuelve el enlace -----
    if (req.method === 'POST' && m[2]) {
      const file = await google.getDocument(doc.google_id);
      if (file.trashed) throw httpError(410, 'Este documento está en la papelera de Google Drive del taller.');
      const role = await google.ensurePermission(doc.google_id, user.email, ROLE[access]);
      if (file.name && file.name !== doc.title) await admin.from('documents').update({ title: file.name.slice(0, 200) }).eq('id', id);
      sendJson(res, 200, { url: file.url, preview: `https://docs.google.com/document/d/${doc.google_id}/preview`, email: user.email, rol: role, title: file.name || doc.title });
      return;
    }

    // ----- Cambiar el nombre (en la plataforma y en Drive) -----
    if (req.method === 'PATCH' && !m[2]) {
      if (access !== 'editar') throw httpError(403, 'No tenés permiso para cambiar este documento.');
      const body = await readBody(req);
      const title = String(body.title || '').trim().slice(0, 200);
      if (!title) throw httpError(400, 'Falta el nombre.');
      await google.renameDocument(doc.google_id, title);
      await admin.from('documents').update({ title, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', id);
      sendJson(res, 200, { ok: true, title });
      return;
    }
    throw httpError(404, 'No existe esa ruta');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log('Error en /google' + path, e.message);
    if (!res.headersSent) sendJson(res, status, { error: e.message || 'Error' });
  }
}

await server.listen();
log(`Servidor de documentos escuchando en ws://${HOST}:${PORT}${DEV ? ' · MODO DEV SIN LOGIN (no usar en producción)' : ''}`);
if (!ORIGINS.length && !DEV) log('Aviso: ALLOWED_ORIGINS está vacío, se aceptan conexiones de cualquier origen.');
google.status().then((g) => log(g.conectado ? `Google Docs: conectado con ${g.cuenta}` : g.configurado ? 'Google Docs: falta conectar la cuenta del taller (/google/conectar?clave=…)' : 'Google Docs: no configurado'));
