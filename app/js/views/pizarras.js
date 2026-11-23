// Pizarras: dibujos, diagramas y lluvias de ideas con Excalidraw (cargado desde CDN, sin compilar).
// La lista está en #/pizarras y en la pestaña Pizarras de proyectos y eventos; cada pizarra se abre
// a pantalla completa en #/pizarra/<id>. Se guarda sola en la base y, mientras varias personas la
// tienen abierta, los cambios viajan en tiempo real (api.boardChannel).
import { esc, icon, name, isStaff, field, openForm, confirmAction, toast, errorMessage, timeAgo, emptyState } from '../ui.js?v=202611241500';

const XV = '0.18.1';
const REACT = 'react@19.1.0';
const REACT_DOM = 'react-dom@19.1.0';
let lib = null;
function loadExcalidraw() {
  window.EXCALIDRAW_ASSET_PATH = `https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@${XV}/dist/prod/`;
  if (!document.getElementById('excalidraw-css')) {
    document.head.insertAdjacentHTML('beforeend', `<link id="excalidraw-css" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@${XV}/dist/prod/index.css"/>`);
  }
  lib ||= Promise.all([
    import(`https://esm.sh/${REACT}`),
    import(`https://esm.sh/${REACT_DOM}/client?deps=${REACT}`),
    import(`https://esm.sh/@excalidraw/excalidraw@${XV}?deps=${REACT},${REACT_DOM}`),
  ]).then(([React, ReactDOM, X]) => ({ React, ReactDOM, X })).catch((e) => { lib = null; throw e; });
  return lib;
}

const COLORS = ['#e8710a', '#1a73e8', '#d93025', '#188038', '#9334e6', '#e52592', '#12b5cb', '#c26401'];
const colorFor = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initials = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
const prefs = { get: () => { try { return JSON.parse(localStorage.getItem('age-pizarras') || '{}'); } catch { return {}; } }, set: (v) => { try { localStorage.setItem('age-pizarras', JSON.stringify(v)); } catch { /* nada */ } } };

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------
export async function renderPizarras(el, ctx) {
  el.innerHTML = `<div class="page">
    <section class="hello"><div><h1>Pizarras</h1><p>Para dibujar ideas, esquemas y diagramas entre varios a la vez. Se guardan solas.</p></div></section>
    <div id="pz-root"></div></div>`;
  await renderBoardList(el.querySelector('#pz-root'), ctx, { scope: 'all' });
}

export async function renderBoardList(el, ctx, scope) {
  const { api, me } = ctx;
  const staff = isStaff(me);
  const hub = scope.scope === 'all';
  const [boards, people] = await Promise.all([
    api.boards({ projectId: scope.projectId, eventId: scope.eventId }),
    api.profiles().catch(() => ctx.members || []),
  ]);
  const person = (id) => people.find(p => p.id === id);
  const where = (b) => (b.project_id ? b.projects?.name || 'Proyecto' : b.event_id ? b.events?.title || 'Evento' : 'Todo el taller');
  const canDelete = (b) => staff || b.created_by === me.id;
  const state = { q: '' };

  el.innerHTML = `
    <div class="toolbar">
      <input type="search" class="search" id="pz-q" placeholder="Buscar pizarras" aria-label="Buscar pizarras"/>
      <span class="grow"></span>
      <button class="btn primary" id="pz-new">${icon('plus')} Nueva pizarra</button>
    </div>
    <div id="pz-grid"></div>`;
  const grid = el.querySelector('#pz-grid');

  function draw() {
    const q = state.q.trim().toLowerCase();
    const list = boards.filter(b => !q || b.title.toLowerCase().includes(q));
    if (!boards.length) { grid.innerHTML = emptyState('Todavía no hay pizarras', 'Tocá "Nueva pizarra" para empezar la primera.'); return; }
    if (!list.length) { grid.innerHTML = emptyState('No hay pizarras que coincidan'); return; }
    grid.innerHTML = `<div class="pz-grid">${list.map(b => `
      <article class="pz-card" data-id="${b.id}">
        <a class="pz-thumb" href="#/pizarra/${b.id}">${b.preview ? `<img src="${esc(b.preview)}" alt="" loading="lazy"/>` : `<span>${icon('board')}</span>`}</a>
        <div class="pz-info">
          <a class="pz-title" href="#/pizarra/${b.id}">${esc(b.title)}</a>
          <small>${hub ? `${esc(where(b))} · ` : ''}${timeAgo(b.updated_at)}${b.updated_by && person(b.updated_by) ? ` · ${esc(name(person(b.updated_by)).split(' ')[0])}` : ''}</small>
        </div>
        <div class="pz-actions">
          <button class="icon-btn" data-act="rename" title="Cambiar el nombre" aria-label="Cambiar el nombre">${icon('edit')}</button>
          ${canDelete(b) ? `<button class="icon-btn" data-act="delete" title="Borrar" aria-label="Borrar">✕</button>` : ''}
        </div>
      </article>`).join('')}</div>`;
  }
  draw();
  el.querySelector('#pz-q').addEventListener('input', (ev) => { state.q = ev.target.value; draw(); });

  grid.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const board = boards.find(x => x.id === b.closest('[data-id]').dataset.id);
    try {
      if (b.dataset.act === 'rename') {
        const data = await openForm({ title: 'Cambiar el nombre', body: field('Nombre', `<input name="title" required maxlength="200" value="${esc(board.title)}"/>`) });
        if (!data) return;
        await api.updateBoard(board.id, { title: data.title });
        board.title = data.title;
      } else if (b.dataset.act === 'delete') {
        if (!await confirmAction('Borrar la pizarra', `Se borra "${board.title}" con todo lo que tiene dibujado. No se puede deshacer.`)) return;
        await api.deleteBoard(board);
        boards.splice(boards.indexOf(board), 1);
        toast('Pizarra borrada');
      }
      draw();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });

  el.querySelector('#pz-new').addEventListener('click', async () => {
    let opts = [];
    if (hub) {
      const [projects, events] = await Promise.all([api.projects().catch(() => []), api.events().catch(() => [])]);
      const mine = (list) => list.filter(x => staff || (x.project_members || x.event_members || []).some(m => m.user_id === me.id));
      opts = [
        ...mine(projects.filter(p => !p.archived)).map(p => [`p:${p.id}`, `Proyecto · ${p.name}`]),
        ...mine(events).map(e => [`e:${e.id}`, `Evento · ${e.title}`]),
        ...(staff ? [['taller', 'Todo el taller']] : []),
      ];
      if (!opts.length) { toast('Para crear una pizarra tenés que estar en un proyecto o en un evento.', 'error'); return; }
    }
    const last = prefs.get().place;
    const data = await openForm({
      title: 'Nueva pizarra',
      submit: 'Crear',
      body: `${field('Nombre', '<input name="title" required maxlength="200" placeholder="Ej.: Ideas para el chasis"/>')}
        ${hub ? field('Quién la ve', `<select name="place">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === last ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'La ven y la dibujan los integrantes de ese proyecto o evento (y los docentes y líderes).') : ''}`,
    });
    if (!data) return;
    let place = { project_id: scope.projectId || null, event_id: scope.eventId || null };
    if (hub) {
      prefs.set({ ...prefs.get(), place: data.place });
      const [kind, id] = data.place.split(':');
      place = { project_id: kind === 'p' ? id : null, event_id: kind === 'e' ? id : null };
    }
    try {
      const id = await api.createBoard({ ...place, title: data.title });
      location.hash = `#/pizarra/${id}`;
    } catch (e) { toast(errorMessage(e), 'error'); }
  });
}

// ---------------------------------------------------------------------
// Una pizarra, a pantalla completa
// ---------------------------------------------------------------------
let open = null;   // { id, close }

export async function renderPizarra(el, ctx) {
  const { api, me, params } = ctx;
  const [id] = params;
  if (open?.id === id) return;
  open?.close();

  const board = await api.board(id);
  if (!board) {
    el.innerHTML = '<div class="page"><div class="empty"><strong>No encontramos la pizarra</strong><p>Puede que la hayan borrado o que no tengas acceso. <a href="#/pizarras">Ver las pizarras</a></p></div></div>';
    return;
  }
  const back = board.project_id ? `#/proyecto/${board.project_id}/pizarras` : board.event_id ? `#/evento/${board.event_id}/pizarras` : '#/pizarras';
  el.innerHTML = '<div class="loading">Abriendo la pizarra…</div>';
  let X, React, ReactDOM;
  try { ({ X, React, ReactDOM } = await loadExcalidraw()); } catch {
    el.innerHTML = `<div class="page"><div class="empty"><strong>No se pudo cargar la pizarra</strong><p>Revisá la conexión a internet y volvé a intentar. <a href="${esc(back)}">Volver</a></p></div></div>`;
    return;
  }
  if (!location.hash.startsWith(`#/pizarra/${id}`)) return;

  const user = { id: me.id, name: me.full_name || me.email, color: colorFor(me.id) };
  const host = document.createElement('div');
  host.className = 'pz';
  host.innerHTML = `
    <header class="pz-top">
      <a class="pz-back" href="${esc(back)}" title="Volver">${icon('board')}</a>
      <input class="pz-name" value="${esc(board.title)}" maxlength="200" aria-label="Nombre de la pizarra"/>
      <span class="pz-status" data-s="ok">Guardado</span>
      <span class="grow"></span>
      <div class="pz-people"></div>
      <a class="btn ghost small" href="${esc(back)}">Cerrar</a>
    </header>
    <div class="pz-canvas"></div>`;
  document.body.appendChild(host);
  document.body.classList.add('pz-open');
  el.innerHTML = '';

  const status = host.querySelector('.pz-status');
  const setStatus = (s, text) => { status.dataset.s = s; status.textContent = text; };
  let xapi = null;
  const lastVersion = new Map();   // id del elemento -> última versión mandada/recibida
  const savedFiles = new Set(Object.keys(board.files || {}));
  const collaborators = new Map();
  let dirty = false, saveTimer = null, sendTimer = null, pending = new Map(), lastPreview = 0, closed = false;
  (board.elements || []).forEach(e => lastVersion.set(e.id, e.version));

  // ---------- Tiempo real ----------
  const channel = api.boardChannel(id, {
    me: user,
    onStatus: (s) => { if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('warn', 'Sin tiempo real: guardando igual'); },
    onPeers: (peers) => {
      const keys = new Set(peers.map(p => p.key));
      [...collaborators.keys()].forEach(k => { if (!keys.has(k)) collaborators.delete(k); });
      peers.forEach(p => {
        const c = collaborators.get(p.key) || {};
        collaborators.set(p.key, { ...c, username: p.name, id: p.id, color: { background: p.color, stroke: p.color } });
      });
      xapi?.updateScene({ collaborators: new Map(collaborators) });
      const seen = new Map(peers.filter(p => p.id !== me.id).map(p => [p.id, p]));
      host.querySelector('.pz-people').innerHTML = [...seen.values()].slice(0, 6)
        .map(p => `<span class="pz-av" style="--c:${esc(p.color)}" title="${esc(p.name)} está en la pizarra">${esc(initials(p.name))}</span>`).join('');
    },
    onMessage: (m) => {
      if (!xapi || !m) return;
      if (m.t === 'el') {
        const remote = X.restoreElements(m.els, null);
        const merged = X.reconcileElements(xapi.getSceneElementsIncludingDeleted(), remote, xapi.getAppState());
        merged.forEach(e => { if ((lastVersion.get(e.id) ?? -1) < e.version) lastVersion.set(e.id, e.version); });
        xapi.updateScene({ elements: merged, captureUpdate: X.CaptureUpdateAction.NEVER });
      } else if (m.t === 'files') {
        api.boardFiles(id).then(files => {
          const have = xapi.getFiles();
          const add = Object.values(files).filter(f => !have[f.id]);
          add.forEach(f => savedFiles.add(f.id));
          if (add.length) xapi.addFiles(add);
        }).catch(() => {});
      } else if (m.t === 'hola') {
        // Alguien recién abrió la pizarra: se le manda todo lo que hay (en partes)
        setTimeout(() => sendElements(xapi.getSceneElementsIncludingDeleted()), Math.random() * 400);
      } else if (m.t === 'ptr') {
        const c = collaborators.get(m.key) || { username: m.name, id: m.id, color: { background: m.color, stroke: m.color } };
        collaborators.set(m.key, { ...c, pointer: { x: m.x, y: m.y, tool: 'pointer' }, button: m.button });
        xapi.updateScene({ collaborators: new Map(collaborators) });
      } else if (m.t === 'titulo') {
        host.querySelector('.pz-name').value = m.title;
      }
    },
  });
  function sendElements(els) {
    for (let i = 0; i < els.length; i += 80) channel.send({ t: 'el', els: els.slice(i, i + 80) });
  }

  // ---------- Guardado ----------
  async function save() {
    clearTimeout(saveTimer);
    if (!xapi || !dirty) return;
    dirty = false;
    setStatus('saving', 'Guardando…');
    try {
      let preview = null;
      const elements = xapi.getSceneElements();
      if (Date.now() - lastPreview > 15000 || closed) {
        lastPreview = Date.now();
        preview = elements.length ? await toDataUrl(await X.exportToBlob({ elements, files: xapi.getFiles(), appState: { exportBackground: true, viewBackgroundColor: '#ffffff' }, maxWidthOrHeight: 420, mimeType: 'image/png' })).catch(() => null) : '';
      }
      await api.saveBoard(id, elements, preview);
      setStatus('ok', 'Guardado');
    } catch (e) {
      dirty = true;
      setStatus('warn', 'No se pudo guardar');
      toast(errorMessage(e), 'error');
    }
  }
  const toDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });

  async function saveFiles(files) {
    const nuevos = Object.values(files || {}).filter(f => f?.dataURL && !savedFiles.has(f.id));
    if (!nuevos.length) return;
    nuevos.forEach(f => savedFiles.add(f.id));
    try {
      await api.addBoardFiles(id, Object.fromEntries(nuevos.map(f => [f.id, f])));
      channel.send({ t: 'files' });
    } catch (e) {
      nuevos.forEach(f => savedFiles.delete(f.id));
      toast(errorMessage(e), 'error');
    }
  }

  function onChange(elements, _appState, files) {
    let changed = false;
    for (const e of elements) {
      if ((lastVersion.get(e.id) ?? -1) < e.version) { lastVersion.set(e.id, e.version); pending.set(e.id, e); changed = true; }
    }
    saveFiles(files);
    if (!changed) return;
    dirty = true;
    setStatus('saving', 'Sin guardar…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1500);
    if (!sendTimer) {
      sendTimer = setTimeout(() => { sendTimer = null; sendElements([...pending.values()]); pending.clear(); }, 80);
    }
  }

  let lastPtr = 0;
  function onPointerUpdate({ pointer, button }) {
    if (Date.now() - lastPtr < 50) return;
    lastPtr = Date.now();
    channel.send({ t: 'ptr', key: channel.key, x: pointer.x, y: pointer.y, button, name: user.name, id: me.id, color: user.color });
  }

  // ---------- Nombre ----------
  const nameInput = host.querySelector('.pz-name');
  nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') nameInput.blur(); });
  nameInput.addEventListener('change', async () => {
    const t = nameInput.value.trim();
    if (!t) { nameInput.value = board.title; return; }
    try { await api.updateBoard(id, { title: t }); board.title = t; channel.send({ t: 'titulo', title: t }); } catch (e) { toast(errorMessage(e), 'error'); nameInput.value = board.title; }
  });

  // ---------- Excalidraw ----------
  const root = ReactDOM.createRoot(host.querySelector('.pz-canvas'));
  root.render(React.createElement(X.Excalidraw, {
    initialData: { elements: board.elements || [], files: board.files || {}, appState: { viewBackgroundColor: '#ffffff' }, scrollToContent: true },
    langCode: 'es-ES',
    name: board.title,
    isCollaborating: true,
    excalidrawAPI: (a) => { xapi = a; setTimeout(() => channel.send({ t: 'hola' }), 300); },
    onChange,
    onPointerUpdate,
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } },
  }));

  const onUnload = (ev) => { if (dirty) { save(); ev.preventDefault(); ev.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('beforeunload', onUnload);
    save().finally(() => {
      channel.close();
      root.unmount();
      host.remove();
    });
    document.body.classList.remove('pz-open');
    open = null;
  };
  const onHash = () => { if (!location.hash.startsWith(`#/pizarra/${id}`)) close(); };
  window.addEventListener('hashchange', onHash);
  open = { id, close };
}
