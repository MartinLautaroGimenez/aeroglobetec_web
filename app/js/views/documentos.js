// Documentos colaborativos: la lista (del taller, de un proyecto o de un evento) y la galería
// de plantillas para empezar uno nuevo. El editor está en app/docs/editor.js (se compila
// desde editor-docs/) y se abre en #/documento/<id>.
import { esc, icon, name, isStaff, field, openForm, confirmAction, toast, errorMessage, timeAgo, emptyState } from '../ui.js?v=202611241000';

export const loadEditor = () => import('../../docs/editor.js?v=202611241000');
const loadTemplates = () => import('../../docs/plantillas.js?v=202611241000');

// Abre un Google Doc en otra pestaña. La pestaña se abre en el momento del clic (si no, el
// navegador la bloquea) y recién después se le pone la dirección, cuando el servidor dio acceso.
export async function openGoogleDoc(api, d) {
  if (api.demo) { toast('En el modo demo no se crean Google Docs de verdad: probalo con el servidor conectado.'); return; }
  const w = window.open('', '_blank');
  try {
    const r = await api.googleOpen(d.id);
    if (w) { w.opener = null; w.location.href = r.url; } else location.href = r.url;
  } catch (e) {
    w?.close();
    toast(errorMessage(e), 'error');
  }
}

// Las mismas plantillas que editor-docs/src/templates.js (acá solo para dibujar la galería)
const TEMPLATES = [
  { id: 'blanco', name: 'En blanco', hint: 'Documento vacío' },
  { id: 'informe-ensayo', name: 'Informe de ensayo', hint: 'Objetivo, montaje, resultados' },
  { id: 'acta', name: 'Acta de reunión', hint: 'Temas, decisiones y tareas' },
  { id: 'informe-tecnico', name: 'Informe técnico', hint: 'Con índice y secciones' },
  { id: 'propuesta', name: 'Propuesta de proyecto', hint: 'Problema, objetivos, plan' },
];
const THUMB = {
  'informe-ensayo': '<i class="t h"></i><i class="t s"></i><i class="t l"></i><i class="t"></i><i class="t m"></i><i class="grid"></i><i class="t"></i><i class="t m"></i>',
  acta: '<i class="t h"></i><i class="t s"></i><i class="t"></i><i class="t l"></i><i class="t m"></i><i class="chk"></i><i class="chk"></i><i class="t m"></i>',
  'informe-tecnico': '<i class="t h c"></i><i class="t s c"></i><i class="sp"></i><i class="t m"></i><i class="t l"></i><i class="t l"></i><i class="t m"></i><i class="t l"></i>',
  propuesta: '<i class="t h"></i><i class="t l"></i><i class="t"></i><i class="t m"></i><i class="grid"></i><i class="t l"></i><i class="t"></i>',
};

// Links pegados a mano: qué es, según la dirección
export function linkKind(url) {
  let u;
  try { u = new URL(url); } catch { return 'Link'; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'docs.google.com') {
    if (u.pathname.startsWith('/document')) return 'Google Docs';
    if (u.pathname.startsWith('/spreadsheets')) return 'Google Sheets';
    if (u.pathname.startsWith('/presentation')) return 'Google Slides';
    if (u.pathname.startsWith('/forms')) return 'Google Forms';
    return 'Google';
  }
  if (host === 'drive.google.com') return 'Google Drive';
  if (host === 'canva.com') return 'Canva';
  return 'Link';
}
const cleanLink = (raw) => {
  const v = String(raw || '').trim();
  try { const u = new URL(v); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
};

const prefs = { get: () => { try { return JSON.parse(localStorage.getItem('age-docs-view') || '{}'); } catch { return {}; } }, set: (v) => { try { localStorage.setItem('age-docs-view', JSON.stringify(v)); } catch { /* nada */ } } };

// Hub general: #/documentos
export async function renderDocumentos(el, ctx) {
  el.innerHTML = `<div class="page">
    <section class="hello"><div><h1>Documentos</h1><p>Informes, actas, guiones y todo lo que se escribe en equipo. Se editan entre varias personas a la vez, como en Google Docs.</p></div></section>
    <div id="docs-root"></div></div>`;
  await renderDocList(el.querySelector('#docs-root'), ctx, { scope: 'all' });
}

/**
 * Lista de documentos.
 * scope: 'all' (todo lo que veo), o { projectId, projectName } / { eventId, eventTitle }
 */
export async function renderDocList(el, ctx, scope) {
  const { api, me } = ctx;
  const staff = isStaff(me);
  const hub = scope.scope === 'all';
  const [docs, people, google] = await Promise.all([
    api.docs({ projectId: scope.projectId, eventId: scope.eventId }),
    api.profiles().catch(() => ctx.members || []),
    api.googleStatus().catch(() => ({ conectado: false })),
  ]);
  const person = (id) => people.find(p => p.id === id);
  const state = { q: '', folder: '', where: hub ? (prefs.get().where || '') : '', mode: google.conectado ? (prefs.get().mode || (google.demo ? 'aero' : 'google')) : 'aero' };
  const where = (d) => (d.project_id ? d.projects?.name || 'Proyecto' : d.event_id ? d.events?.title || 'Evento' : 'Taller');
  const whereKey = (d) => (d.project_id ? `p:${d.project_id}` : d.event_id ? `e:${d.event_id}` : 'taller');
  const canDelete = (d) => staff || d.created_by === me.id;
  const canEdit = (d) => d.editable_by !== 'staff' || staff || d.created_by === me.id;

  el.innerHTML = `
    <section class="docs-new">
      <div class="docs-new-head"><h2>Empezar un documento nuevo</h2>
        ${google.conectado ? `<div class="docs-mode" role="radiogroup" aria-label="Dónde se crea">
          <button type="button" role="radio" data-mode="google" title="Se edita en Google Docs, con la cuenta de Google de cada uno">${icon('external')} Google Docs</button>
          <button type="button" role="radio" data-mode="aero" title="Se edita adentro de la plataforma">${icon('file')} Editor del taller</button>
        </div>` : ''}
        <span class="grow"></span>
        <button class="btn ghost small" id="docs-link">${icon('link')} Pegar link de Google</button>
        <button class="btn ghost small" id="docs-import">${icon('upload')} Subir un Word (.docx)</button></div>
      ${!google.conectado && google.configurado && staff ? '<p class="docs-hint">Google Docs está casi listo: falta que un admin conecte la cuenta de Google del taller (ver <code>docs-server/README.md</code>).</p>' : ''}
      ${google.conectado ? `<p class="docs-hint" data-mode-hint></p>` : ''}
      <div class="docs-templates">${TEMPLATES.map(t => `
        <button class="docs-tpl" data-tpl="${t.id}">
          <span class="docs-thumb ${t.id === 'blanco' ? 'blank' : ''}">${t.id === 'blanco' ? `<span class="plus">${icon('plus')}</span>` : THUMB[t.id]}</span>
          <b>${esc(t.name)}</b><small>${esc(t.hint)}</small>
        </button>`).join('')}</div>
    </section>
    <section class="panel docs-list-panel">
      <div class="toolbar docs-filters">
        <input type="search" class="search" id="docs-q" placeholder="Buscar documentos" aria-label="Buscar documentos"/>
        ${hub ? `<select id="docs-where" aria-label="Dónde"><option value="">Todos los lugares</option>${placesOptions(docs, where, whereKey)}</select>` : ''}
        <div class="docs-folders" id="docs-folders"></div>
      </div>
      <div id="docs-rows"></div>
    </section>`;

  const rows = el.querySelector('#docs-rows');
  const foldersBox = el.querySelector('#docs-folders');

  const drawMode = () => {
    el.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === state.mode); b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)); });
    const hint = el.querySelector('[data-mode-hint]');
    if (hint) {
      hint.innerHTML = state.mode === 'google'
        ? `Se crea en el Drive del taller (${esc(google.cuenta || 'cuenta de Google del taller')}) y se abre en Google Docs. Cada uno entra con su cuenta de Google de la escuela.`
        : 'Se edita adentro de la plataforma, entre varios a la vez.';
    }
  };
  drawMode();
  el.querySelector('.docs-mode')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    prefs.set({ ...prefs.get(), mode: state.mode });
    drawMode();
  });

  function draw() {
    const inWhere = docs.filter(d => !state.where || whereKey(d) === state.where);
    const folders = [...new Set(inWhere.map(d => d.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (state.folder && !folders.includes(state.folder)) state.folder = '';
    foldersBox.innerHTML = folders.length ? ['', ...folders].map(f => `<button class="docs-chip ${state.folder === f ? 'on' : ''}" data-folder="${esc(f)}">${f ? icon('folder') : ''}${esc(f || 'Todas')}</button>`).join('') : '';
    const q = state.q.trim().toLowerCase();
    const list = inWhere.filter(d => (!state.folder || d.folder === state.folder) && (!q || d.title.toLowerCase().includes(q) || (d.folder || '').toLowerCase().includes(q)));
    if (!docs.length) { rows.innerHTML = emptyState('Todavía no hay documentos', 'Elegí una plantilla de arriba para empezar el primero.'); return; }
    if (!list.length) { rows.innerHTML = emptyState('No hay documentos que coincidan'); return; }
    rows.innerHTML = `<div class="docs-table" role="table">
      <div class="docs-tr head" role="row"><span role="columnheader">Nombre</span>${hub ? '<span role="columnheader">Dónde</span>' : ''}<span role="columnheader" class="hide-sm">Creado por</span><span role="columnheader">Último cambio</span><span></span></div>
      ${list.map(d => `
        <div class="docs-tr" role="row" data-id="${d.id}">
          <a class="docs-name" role="cell" ${d.kind === 'link' ? `href="${esc(d.link_url)}" target="_blank" rel="noopener noreferrer" title="Abrir en otra pestaña"` : `href="#/documento/${d.id}"`}>
            <span class="docs-ico ${d.kind !== 'aero' && d.kind ? 'google' : ''}">${icon(d.kind === 'link' ? 'link' : 'file')}</span>
            <span class="grow"><b>${esc(d.title)}</b>${d.folder || (d.kind && d.kind !== 'aero') ? `<small>${d.kind === 'google' ? '<span class="docs-gtag">Google Docs</span>' : d.kind === 'link' ? `<span class="docs-gtag">${esc(linkKind(d.link_url))}</span>` : ''}${d.folder ? `${icon('folder')}${esc(d.folder)}` : ''}</small>` : ''}</span>
            ${d.editable_by === 'staff' ? `<span class="badge gray" title="Lo editan docentes y líderes; el resto lo lee">Solo lectura${canEdit(d) ? ' para estudiantes' : ''}</span>` : ''}
          </a>
          ${hub ? `<span role="cell" class="docs-where"><i style="--c:${esc(d.projects?.color || d.events?.color || '#8a9bb5')}"></i>${esc(where(d))}</span>` : ''}
          <span role="cell" class="muted hide-sm">${esc(name(person(d.created_by)))}</span>
          <span role="cell" class="muted">${timeAgo(d.updated_at)}${d.updated_by && person(d.updated_by) ? ` · ${esc(name(person(d.updated_by)).split(' ')[0])}` : ''}</span>
          <span role="cell" class="docs-actions">
            ${d.kind === 'google' ? `<button class="icon-btn" data-act="gopen" title="Abrir en Google Docs" aria-label="Abrir en Google Docs">${icon('external')}</button>` : ''}
            ${d.kind === 'link' && canEdit(d) ? `<button class="icon-btn" data-act="relink" title="Cambiar el link" aria-label="Cambiar el link">${icon('link')}</button>` : ''}
            ${canEdit(d) ? `<button class="icon-btn" data-act="rename" title="Cambiar el nombre" aria-label="Cambiar el nombre">${icon('edit')}</button>
            <button class="icon-btn" data-act="move" title="Mover a una carpeta" aria-label="Mover a una carpeta">${icon('folder')}</button>` : ''}
            ${canDelete(d) ? `<button class="icon-btn" data-act="delete" title="Borrar" aria-label="Borrar">✕</button>` : ''}
          </span>
        </div>`).join('')}
    </div>`;
  }
  draw();

  el.querySelector('#docs-q').addEventListener('input', (ev) => { state.q = ev.target.value; draw(); });
  el.querySelector('#docs-where')?.addEventListener('change', (ev) => { state.where = ev.target.value; prefs.set({ where: state.where }); draw(); });
  if (hub && state.where) { const sel = el.querySelector('#docs-where'); sel.value = state.where; if (sel.value !== state.where) { state.where = ''; draw(); } }
  foldersBox.addEventListener('click', (ev) => { const b = ev.target.closest('[data-folder]'); if (b) { state.folder = b.dataset.folder; draw(); } });

  rows.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    ev.preventDefault();
    const d = docs.find(x => x.id === b.closest('[data-id]').dataset.id);
    try {
      if (b.dataset.act === 'rename') {
        const data = await openForm({ title: 'Cambiar el nombre', body: field('Nombre', `<input name="title" required maxlength="200" value="${esc(d.title)}"/>`) });
        if (!data) return;
        await api.renameDoc(d, data.title);
        d.title = data.title;
      } else if (b.dataset.act === 'move') {
        const folders = [...new Set(docs.map(x => x.folder).filter(Boolean))];
        const data = await openForm({ title: 'Mover a una carpeta', submit: 'Mover', body: field('Carpeta', `<input name="folder" maxlength="60" list="doc-folders" value="${esc(d.folder)}" placeholder="Sin carpeta"/><datalist id="doc-folders">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`, 'Escribí una carpeta nueva o elegí una. Vacío: sin carpeta.') });
        if (!data) return;
        await api.updateDoc(d.id, { folder: data.folder });
        d.folder = data.folder;
      } else if (b.dataset.act === 'delete') {
        const msg = d.kind === 'link'
          ? `Se saca "${d.title}" de la plataforma. El documento sigue en Google, no se borra.`
          : d.kind === 'google'
          ? `Se saca "${d.title}" de la plataforma y el archivo va a la papelera del Drive del taller (se puede recuperar desde ahí durante 30 días).`
          : `Se borra "${d.title}" con su historial de versiones y sus comentarios. No se puede deshacer.`;
        if (!await confirmAction('Borrar el documento', msg)) return;
        await api.deleteDoc(d);
        docs.splice(docs.indexOf(d), 1);
        toast('Documento borrado');
      } else if (b.dataset.act === 'relink') {
        const data = await openForm({ title: 'Cambiar el link', body: field('Link', `<input name="url" required type="url" value="${esc(d.link_url)}"/>`) });
        if (!data) return;
        const url = cleanLink(data.url);
        if (!url) { toast('El link tiene que empezar con https://', 'error'); return; }
        await api.updateDoc(d.id, { link_url: url });
        d.link_url = url;
      } else if (b.dataset.act === 'gopen') {
        await openGoogleDoc(api, d);
        return;
      }
      draw();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });

  // ---------- Crear ----------
  async function pickPlace(title, defaultTitle) {
    if (!hub) return { title: defaultTitle, project_id: scope.projectId || null, event_id: scope.eventId || null };
    const [projects, events] = await Promise.all([api.projects().catch(() => []), api.events().catch(() => [])]);
    const mine = (list) => list.filter(x => staff || (x.project_members || x.event_members || []).some(m => m.user_id === me.id));
    const opts = [
      ...(staff ? [['taller', 'Documentos del taller (todos lo ven)']] : []),
      ...mine(projects.filter(p => !p.archived)).map(p => [`p:${p.id}`, `Proyecto · ${p.name}`]),
      ...mine(events).map(e => [`e:${e.id}`, `Evento · ${e.title}`]),
    ];
    if (!opts.length) { toast('Para crear un documento tenés que estar en un proyecto o en un evento.', 'error'); return null; }
    const last = prefs.get().place;
    const data = await openForm({
      title,
      submit: 'Crear',
      body: `${field('Nombre', `<input name="title" required maxlength="200" value="${esc(defaultTitle)}"/>`)}
        ${field('Dónde guardarlo', `<select name="place">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === (state.where || last) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'Lo ven las mismas personas que ven ese proyecto o evento.')}`,
    });
    if (!data) return null;
    prefs.set({ ...prefs.get(), place: data.place });
    const [kind, id] = data.place.split(':');
    return { title: data.title, project_id: kind === 'p' ? id : null, event_id: kind === 'e' ? id : null };
  }

  el.querySelector('.docs-templates').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-tpl]');
    if (!b) return;
    const t = TEMPLATES.find(x => x.id === b.dataset.tpl);
    const place = await pickPlace(`Nuevo documento: ${t.name.toLowerCase()}`, t.id === 'blanco' ? 'Documento sin título' : t.name);
    if (!place) return;
    b.disabled = true;
    try {
      if (state.mode === 'google') {
        toast('Creando el documento en Google Docs…');
        const { googleTemplate } = await loadTemplates();
        const html = googleTemplate(t.id);
        const id = await api.createGoogleDoc({ ...place, folder: state.folder || '' }, html ? { html } : {});
        location.hash = `#/documento/${id}`;
        return;
      }
      const [mod, id] = await Promise.all([loadEditor(), api.createDoc({ ...place, folder: state.folder || '' })]);
      const st = mod.stateFromTemplate(t.id);
      if (st) await api.initDocState(id, st);
      location.hash = `#/documento/${id}`;
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { b.disabled = false; }
  });

  // ---------- Pegar un link de Google (u otro) ----------
  el.querySelector('#docs-link').addEventListener('click', async () => {
    let opts = [['', '']];
    if (hub) {
      const [projects, events] = await Promise.all([api.projects().catch(() => []), api.events().catch(() => [])]);
      const mine = (list) => list.filter(x => staff || (x.project_members || x.event_members || []).some(m => m.user_id === me.id));
      opts = [
        ...mine(projects.filter(p => !p.archived)).map(p => [`p:${p.id}`, `Proyecto · ${p.name}`]),
        ...mine(events).map(e => [`e:${e.id}`, `Evento · ${e.title}`]),
        ...(staff ? [['taller', 'Todo el taller']] : []),
      ];
      if (!opts.length) { toast('Para agregar un link tenés que estar en un proyecto o en un evento.', 'error'); return; }
    }
    const last = prefs.get().place;
    const data = await openForm({
      title: 'Pegar link de Google',
      submit: 'Agregar',
      body: `${field('Link', '<input name="url" required type="url" placeholder="https://docs.google.com/document/d/…"/>', 'Un Google Doc, Sheet, Slides, una carpeta de Drive, un Canva…')}
        ${field('Nombre', '<input name="title" required maxlength="200" placeholder="Ej.: Presupuesto del CATE"/>')}
        ${hub ? field('Quién lo ve', `<select name="place">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === (state.where || last) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'Solo lo ven en la plataforma los integrantes de ese proyecto o evento (y los docentes y líderes).') : ''}
        <p class="hint">Acordate de compartirlo también en Google (botón <b>Compartir</b>) con esas personas, o con "Cualquier persona de la escuela que tenga el vínculo".</p>`,
      onOpen: (dlg) => {
        const url = dlg.querySelector('[name=url]'), title = dlg.querySelector('[name=title]');
        url.addEventListener('change', () => { if (!title.value && cleanLink(url.value)) title.value = linkKind(url.value) === 'Link' ? '' : `${linkKind(url.value)} sin nombre`; });
      },
    });
    if (!data) return;
    const url = cleanLink(data.url);
    if (!url) { toast('El link tiene que empezar con https://', 'error'); return; }
    let place = { project_id: scope.projectId || null, event_id: scope.eventId || null };
    if (hub) {
      prefs.set({ ...prefs.get(), place: data.place });
      const [kind, id] = data.place.split(':');
      place = { project_id: kind === 'p' ? id : null, event_id: kind === 'e' ? id : null };
    }
    try {
      const id = await api.createDoc({ ...place, title: data.title, folder: state.folder || '', kind: 'link', link_url: url });
      docs.unshift({ id, ...place, title: data.title, folder: state.folder || '', kind: 'link', link_url: url, created_by: me.id, updated_by: me.id, updated_at: new Date().toISOString(), editable_by: 'equipo', projects: null, events: null });
      toast('Link agregado');
      ctx.reload ? ctx.reload() : draw();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });

  el.querySelector('#docs-import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const place = await pickPlace('Subir un Word', f.name.replace(/\.docx$/i, ''));
      if (!place) return;
      toast('Importando el archivo…');
      try {
        if (state.mode === 'google') {
          const id = await api.createGoogleDoc({ ...place, folder: state.folder || '' }, { docx: f });
          location.hash = `#/documento/${id}`;
          return;
        }
        const mod = await loadEditor();
        const id = await api.createDoc({ ...place, folder: state.folder || '' });
        const row = { ...place, id };
        const st = await mod.stateFromDocx(f, (img) => api.uploadDocImage(row, img));
        await api.initDocState(id, st);
        location.hash = `#/documento/${id}`;
      } catch (e) { console.error(e); toast('No se pudo importar: ' + errorMessage(e), 'error'); }
    };
    input.click();
  });
}

function placesOptions(docs, where, whereKey) {
  const seen = new Map();
  docs.forEach(d => { if (!seen.has(whereKey(d))) seen.set(whereKey(d), where(d)); });
  return [...seen].sort((a, b) => (a[0] === 'taller' ? -1 : b[0] === 'taller' ? 1 : a[1].localeCompare(b[1])))
    .map(([k, l]) => `<option value="${esc(k)}">${esc(l === 'Taller' ? 'Documentos del taller' : l)}</option>`).join('');
}
