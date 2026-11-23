// Servidor de documentos colaborativos de AeroGlobETec.
// Hace de punto de encuentro en tiempo real (Hocuspocus + Yjs): cada navegador manda sus cambios
// y el servidor se los reparte al resto. Guarda el contenido en Supabase (document_states) y,
// cada tanto, una versión automática para el historial (document_versions).
//
// Permisos: cada conexión trae la sesión de Supabase de la persona. El servidor le pregunta a la
// base (función document_access) si puede editar o solo leer ese documento. Así rigen las mismas
// reglas que en el resto de la plataforma.
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { createClient } from '@supabase/supabase-js';

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
    if (request.url === '/salud' || request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, documentos_abiertos: server.hocuspocus.getDocumentsCount(), conexiones: server.hocuspocus.getConnectionsCount() }));
      throw null; // corta acá: Hocuspocus no agrega su respuesta por defecto
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
    if (!token) throw new Error('Falta la sesión');

    const { data: who, error: userError } = await admin.auth.getUser(token);
    if (userError || !who?.user) throw new Error('Sesión vencida o inválida');

    // La consulta va con la sesión de la persona: la base decide según sus reglas
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: access, error } = await asUser.rpc('document_access', { d: id });
    if (error) throw new Error('No se pudo comprobar el permiso: ' + error.message);
    if (access !== 'editar' && access !== 'leer') throw new Error('Sin permiso para este documento');
    if (access === 'leer') connectionConfig.readOnly = true;
    log('Conectado', who.user.email, '→', id, access);
    return { userId: who.user.id };
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

await server.listen();
log(`Servidor de documentos escuchando en ws://${HOST}:${PORT}${DEV ? ' · MODO DEV SIN LOGIN (no usar en producción)' : ''}`);
if (!ORIGINS.length && !DEV) log('Aviso: ALLOWED_ORIGINS está vacío, se aceptan conexiones de cualquier origen.');
