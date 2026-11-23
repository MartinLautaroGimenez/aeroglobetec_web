// Abre un documento en el editor colaborativo (pantalla completa, encima de la plataforma).
// El editor vive en app/docs/editor.js; acá se le pasan la sesión, los permisos y la API.
import { esc, name, isStaff, toast, errorMessage } from '../ui.js?v=202611230200';
import { DOCS_SERVER_URL } from '../config.js?v=202611230200';
import { loadEditor } from './documentos.js?v=202611230200';

let open = null;   // { id, close }

function ensureCss() {
  if (document.getElementById('docs-css')) return;
  const l = document.createElement('link');
  l.id = 'docs-css';
  l.rel = 'stylesheet';
  l.href = 'css/docs.css?v=202611230200';
  document.head.appendChild(l);
}

export async function renderDocumento(el, ctx) {
  const { api, me, params } = ctx;
  const [id] = params;
  if (open?.id === id) return;
  open?.close();

  const doc = await api.doc(id);
  if (!doc) {
    el.innerHTML = '<div class="page"><div class="empty"><strong>No encontramos el documento</strong><p>Puede que lo hayan borrado o que no tengas acceso. <a href="#/documentos">Ver los documentos</a></p></div></div>';
    return;
  }
  const scope = doc.project_id
    ? { label: doc.projects?.name || 'Proyecto', href: `#/proyecto/${doc.project_id}/documentos` }
    : doc.event_id
      ? { label: doc.events?.title || 'Evento', href: `#/evento/${doc.event_id}/documentos` }
      : { label: 'Documentos del taller', href: '#/documentos' };

  if (!api.demo && !DOCS_SERVER_URL) {
    el.innerHTML = `<div class="page"><div class="empty"><strong>Los documentos todavía no están activados</strong>
      <p>Falta configurar el servidor de documentos (<code>DOCS_SERVER_URL</code> en <code>app/js/config.js</code>). Mientras tanto podés probarlos en el <a href="?demo#/documentos">modo demo</a>.</p>
      <p><a href="${esc(scope.href)}">Volver</a></p></div></div>`;
    return;
  }

  ensureCss();
  el.innerHTML = '<div class="loading">Abriendo el documento…</div>';
  const [mod, people, siblings] = await Promise.all([
    loadEditor(),
    api.profiles().catch(() => []),
    api.docs({ projectId: doc.project_id || undefined, eventId: doc.event_id || undefined }).catch(() => []),
  ]);
  if (!location.hash.startsWith(`#/documento/${id}`)) return;   // se fue mientras cargaba

  const staff = isStaff(me);
  const host = document.createElement('div');
  host.className = 'dz-host';
  document.body.appendChild(host);
  document.body.classList.add('dz-open');

  const createIn = async (row, state) => {
    const newId = await api.createDoc({ project_id: doc.project_id, event_id: doc.event_id, folder: doc.folder, ...row });
    if (state) await api.initDocState(newId, state);
    return newId;
  };

  const editor = mod.mountEditor(host, {
    api, me, doc, staff,
    demo: api.demo,
    serverUrl: DOCS_SERVER_URL,
    scopeLabel: scope.label,
    scopeHref: scope.href,
    backHref: scope.href,
    canEdit: doc.editable_by !== 'staff' || staff || doc.created_by === me.id,
    canManage: staff || doc.created_by === me.id,
    folders: [...new Set(siblings.map(d => d.folder).filter(Boolean))],
    personName: (uid) => name(people.find(p => p.id === uid)),
    seedHtml: api.demo ? doc.seed_html : null,
    onNew: async () => {
      try { location.hash = `#/documento/${await createIn({ title: 'Documento sin título', folder: doc.folder })}`; } catch (e) { toast(errorMessage(e), 'error'); }
    },
    onCopy: async (state, title) => {
      try {
        const newId = await createIn({ title: `Copia de ${title}`.slice(0, 200) }, mod.copyState(state));
        toast('Copia creada');
        location.hash = `#/documento/${newId}`;
      } catch (e) { toast(errorMessage(e), 'error'); }
    },
    onDemoClose: (state) => api.demoAutoVersion?.(doc.id, state),
  });
  el.innerHTML = '';

  const close = () => {
    window.removeEventListener('hashchange', onHash);
    try { editor.destroy(); } catch (e) { console.error(e); }
    host.remove();
    document.body.classList.remove('dz-open');
    document.title = 'Plataforma AeroGlobETec';
    open = null;
  };
  const onHash = () => { if (!location.hash.startsWith(`#/documento/${id}`)) close(); };
  window.addEventListener('hashchange', onHash);
  open = { id, close };
}
