// Documentos: links a Google Docs, Sheets, Slides, carpetas de Drive, Canva… de cada proyecto,
// evento o del taller. El documento vive en Google; acá queda el link y quién lo ve.
// Se usa en #/documentos (todo lo que veo) y en la pestaña Documentos de proyectos y eventos.
import { esc, icon, name, isStaff, field, openForm, confirmAction, toast, errorMessage, timeAgo, emptyState } from '../ui.js?v=202611241200';

// Qué es, según la dirección
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
    <section class="hello"><div><h1>Documentos</h1><p>Los Google Docs, Sheets, Slides y carpetas de Drive de cada proyecto, a mano y en un solo lugar.</p></div></section>
    <div id="docs-root"></div></div>`;
  await renderDocList(el.querySelector('#docs-root'), ctx, { scope: 'all' });
}

/**
 * Lista de documentos.
 * scope: { scope: 'all' } (todo lo que veo), { projectId } o { eventId }
 */
export async function renderDocList(el, ctx, scope) {
  const { api, me } = ctx;
  const staff = isStaff(me);
  const hub = scope.scope === 'all';
  const [docs, people] = await Promise.all([
    api.docs({ projectId: scope.projectId, eventId: scope.eventId }),
    api.profiles().catch(() => ctx.members || []),
  ]);
  const person = (id) => people.find(p => p.id === id);
  const state = { q: '', folder: '', where: hub ? (prefs.get().where || '') : '' };
  const where = (d) => (d.project_id ? d.projects?.name || 'Proyecto' : d.event_id ? d.events?.title || 'Evento' : 'Taller');
  const whereKey = (d) => (d.project_id ? `p:${d.project_id}` : d.event_id ? `e:${d.event_id}` : 'taller');
  const canEdit = (d) => staff || d.created_by === me.id;

  el.innerHTML = `
    <div class="toolbar docs-filters">
      <input type="search" class="search" id="docs-q" placeholder="Buscar documentos" aria-label="Buscar documentos"/>
      ${hub ? `<select id="docs-where" aria-label="Dónde"><option value="">Todos los lugares</option>${placesOptions(docs, where, whereKey)}</select>` : ''}
      <span class="grow"></span>
      <button class="btn primary" id="docs-link">${icon('link')} Pegar link de Google</button>
    </div>
    <div class="docs-folders" id="docs-folders"></div>
    <section class="panel docs-list-panel"><div id="docs-rows"></div></section>`;

  const rows = el.querySelector('#docs-rows');
  const foldersBox = el.querySelector('#docs-folders');

  function draw() {
    const inWhere = docs.filter(d => !state.where || whereKey(d) === state.where);
    const folders = [...new Set(inWhere.map(d => d.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (state.folder && !folders.includes(state.folder)) state.folder = '';
    foldersBox.innerHTML = folders.length ? ['', ...folders].map(f => `<button class="docs-chip ${state.folder === f ? 'on' : ''}" data-folder="${esc(f)}">${f ? icon('folder') : ''}${esc(f || 'Todas')}</button>`).join('') : '';
    const q = state.q.trim().toLowerCase();
    const list = inWhere.filter(d => (!state.folder || d.folder === state.folder) && (!q || d.title.toLowerCase().includes(q) || (d.folder || '').toLowerCase().includes(q)));
    if (!docs.length) { rows.innerHTML = emptyState('Todavía no hay documentos', 'Tocá "Pegar link de Google" para sumar el primero.'); return; }
    if (!list.length) { rows.innerHTML = emptyState('No hay documentos que coincidan'); return; }
    rows.innerHTML = `<div class="docs-table" role="table">
      <div class="docs-tr head" role="row"><span role="columnheader">Nombre</span>${hub ? '<span role="columnheader">Dónde</span>' : ''}<span role="columnheader" class="hide-sm">Lo agregó</span><span role="columnheader">Último cambio</span><span></span></div>
      ${list.map(d => `
        <div class="docs-tr" role="row" data-id="${d.id}">
          <a class="docs-name" role="cell" href="${esc(d.link_url)}" target="_blank" rel="noopener noreferrer" title="Abrir en otra pestaña">
            <span class="docs-ico google">${icon('link')}</span>
            <span class="grow"><b>${esc(d.title)}</b><small><span class="docs-gtag">${esc(linkKind(d.link_url))}</span>${d.folder ? `${icon('folder')}${esc(d.folder)}` : ''}</small></span>
          </a>
          ${hub ? `<span role="cell" class="docs-where"><i style="--c:${esc(d.projects?.color || d.events?.color || '#8a9bb5')}"></i>${esc(where(d))}</span>` : ''}
          <span role="cell" class="muted hide-sm">${esc(name(person(d.created_by)))}</span>
          <span role="cell" class="muted">${timeAgo(d.updated_at)}${d.updated_by && person(d.updated_by) ? ` · ${esc(name(person(d.updated_by)).split(' ')[0])}` : ''}</span>
          <span role="cell" class="docs-actions">
            ${canEdit(d) ? `<button class="icon-btn" data-act="edit" title="Cambiar nombre, link o carpeta" aria-label="Editar">${icon('edit')}</button>
            <button class="icon-btn" data-act="delete" title="Sacar de la plataforma" aria-label="Sacar">✕</button>` : ''}
          </span>
        </div>`).join('')}
    </div>`;
  }
  draw();

  el.querySelector('#docs-q').addEventListener('input', (ev) => { state.q = ev.target.value; draw(); });
  el.querySelector('#docs-where')?.addEventListener('change', (ev) => { state.where = ev.target.value; prefs.set({ ...prefs.get(), where: state.where }); draw(); });
  if (hub && state.where) { const sel = el.querySelector('#docs-where'); sel.value = state.where; if (sel.value !== state.where) { state.where = ''; draw(); } }
  foldersBox.addEventListener('click', (ev) => { const b = ev.target.closest('[data-folder]'); if (b) { state.folder = b.dataset.folder; draw(); } });

  const folderList = () => `<datalist id="doc-folders">${[...new Set(docs.map(x => x.folder).filter(Boolean))].map(f => `<option value="${esc(f)}">`).join('')}</datalist>`;

  rows.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    ev.preventDefault();
    const d = docs.find(x => x.id === b.closest('[data-id]').dataset.id);
    try {
      if (b.dataset.act === 'edit') {
        const data = await openForm({
          title: 'Editar',
          body: `${field('Nombre', `<input name="title" required maxlength="200" value="${esc(d.title)}"/>`)}
            ${field('Link', `<input name="url" required type="url" value="${esc(d.link_url)}"/>`)}
            ${field('Carpeta', `<input name="folder" maxlength="60" list="doc-folders" value="${esc(d.folder)}" placeholder="Sin carpeta"/>${folderList()}`)}`,
        });
        if (!data) return;
        const url = cleanLink(data.url);
        if (!url) { toast('El link tiene que empezar con https://', 'error'); return; }
        await api.updateDoc(d.id, { title: data.title, link_url: url, folder: data.folder });
        Object.assign(d, { title: data.title, link_url: url, folder: data.folder, updated_at: new Date().toISOString(), updated_by: me.id });
      } else if (b.dataset.act === 'delete') {
        if (!await confirmAction('Sacar el documento', `Se saca "${d.title}" de la plataforma. El documento sigue en Google, no se borra.`, 'Sacar')) return;
        await api.deleteDoc(d);
        docs.splice(docs.indexOf(d), 1);
        toast('Listo');
      }
      draw();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });

  // ---------- Pegar un link ----------
  el.querySelector('#docs-link').addEventListener('click', async () => {
    let opts = [];
    if (hub) {
      const [projects, events] = await Promise.all([api.projects().catch(() => []), api.events().catch(() => [])]);
      const mine = (list) => list.filter(x => staff || (x.project_members || x.event_members || []).some(m => m.user_id === me.id));
      opts = [
        ...mine(projects.filter(p => !p.archived)).map(p => [`p:${p.id}`, `Proyecto · ${p.name}`]),
        ...mine(events).map(e => [`e:${e.id}`, `Evento · ${e.title}`]),
        ...(staff ? [['taller', 'Todo el taller']] : []),
      ];
      if (!opts.length) { toast('Para agregar un documento tenés que estar en un proyecto o en un evento.', 'error'); return; }
    }
    const last = prefs.get().place;
    const data = await openForm({
      title: 'Pegar link de Google',
      submit: 'Agregar',
      body: `${field('Link', '<input name="url" required type="url" placeholder="https://docs.google.com/document/d/…"/>', 'Un Google Doc, Sheet, Slides, una carpeta de Drive, un Canva…')}
        ${field('Nombre', '<input name="title" required maxlength="200" placeholder="Ej.: Presupuesto del CATE"/>')}
        ${hub ? field('Quién lo ve', `<select name="place">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === (state.where || last) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'En la plataforma lo ven los integrantes de ese proyecto o evento (y los docentes y líderes).') : ''}
        ${field('Carpeta', `<input name="folder" maxlength="60" list="doc-folders" value="${esc(state.folder)}" placeholder="Sin carpeta (opcional)"/>${folderList()}`)}
        <p class="hint">Acordate de compartirlo también en Google (botón <b>Compartir</b>) con esas personas, o con "Cualquier persona de la escuela que tenga el vínculo".</p>`,
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
      await api.createDoc({ ...place, title: data.title, folder: data.folder || '', kind: 'link', link_url: url });
      toast('Documento agregado');
      ctx.reload();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });
}

function placesOptions(docs, where, whereKey) {
  const seen = new Map();
  docs.forEach(d => { if (!seen.has(whereKey(d))) seen.set(whereKey(d), where(d)); });
  return [...seen].sort((a, b) => (a[0] === 'taller' ? -1 : b[0] === 'taller' ? 1 : a[1].localeCompare(b[1])))
    .map(([k, l]) => `<option value="${esc(k)}">${esc(l === 'Taller' ? 'Todo el taller' : l)}</option>`).join('');
}
