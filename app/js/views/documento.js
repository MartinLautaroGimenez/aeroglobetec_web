// Abre un documento en el editor colaborativo (pantalla completa, encima de la plataforma).
// El editor vive en app/docs/editor.js; acá se le pasan la sesión, los permisos y la API.
import { esc, name, isStaff, toast, errorMessage, icon, fmtDateTime } from '../ui.js?v=202611231700';
import { DOCS_SERVER_URL } from '../config.js?v=202611231700';
import { loadEditor, openGoogleDoc } from './documentos.js?v=202611231700';

let open = null;   // { id, close }

function ensureCss() {
  if (document.getElementById('docs-css')) return;
  const l = document.createElement('link');
  l.id = 'docs-css';
  l.rel = 'stylesheet';
  l.href = 'css/docs.css?v=202611231700';
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

  if (doc.kind === 'google') { await renderGoogleDoc(el, ctx, doc, scope); return; }

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

// Google Doc: se edita en Google. Acá se le da acceso a la persona, se muestra la vista previa
// (Google no deja incrustar el editor, solo la vista de lectura) y el botón para abrirlo.
async function renderGoogleDoc(el, ctx, doc, scope) {
  const { api } = ctx;
  el.innerHTML = `
    <div class="page gdoc-page">
      <header class="project-head">
        <div>
          <a class="crumb" href="${esc(scope.href)}">← ${esc(scope.label)}</a>
          <h1><span class="docs-ico google">${icon('file')}</span>${esc(doc.title)}</h1>
          <p class="muted">Google Docs${doc.folder ? ` · ${esc(doc.folder)}` : ''} · último cambio ${esc(fmtDateTime(doc.updated_at))}</p>
        </div>
        <div class="head-actions">
          <a class="btn primary" id="gdoc-open" href="#" target="_blank" rel="noopener noreferrer" aria-disabled="true">${icon('external')} Abrir en Google Docs</a>
        </div>
      </header>
      <p class="gdoc-note" id="gdoc-note">Dándote acceso al documento…</p>
      <div class="gdoc-frame" id="gdoc-frame"></div>
    </div>`;
  const btn = el.querySelector('#gdoc-open');
  const note = el.querySelector('#gdoc-note');
  const frame = el.querySelector('#gdoc-frame');
  btn.addEventListener('click', (ev) => {
    if (btn.getAttribute('aria-disabled') === 'true') { ev.preventDefault(); openGoogleDoc(api, doc); }
  });

  if (api.demo) {
    note.innerHTML = 'En el <b>modo demo</b> no se crean Google Docs de verdad. Con el servidor de documentos conectado, este botón abre el documento en Google Docs con tu cuenta de la escuela.';
    frame.innerHTML = `<div class="gdoc-empty">${icon('file')}<p>Acá se ve la vista previa del documento.</p></div>`;
    return;
  }
  try {
    const r = await api.googleOpen(doc.id);
    btn.href = r.url;
    btn.removeAttribute('aria-disabled');
    note.innerHTML = `${r.rol === 'commenter' ? 'Podés leerlo y comentar: lo editan docentes y estudiantes líderes.' : 'Podés editarlo.'}
      Entrá a Google con <b>${esc(r.email)}</b>; si estás con otra cuenta, Google te va a pedir acceso.`;
    frame.innerHTML = `<iframe src="${esc(r.preview)}" title="Vista previa de ${esc(doc.title)}" loading="lazy"></iframe>`;
  } catch (e) {
    note.classList.add('error');
    note.textContent = errorMessage(e);
    frame.innerHTML = '';
  }
}
