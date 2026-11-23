// Paneles laterales: comentarios, historial de versiones y esquema; y la caja de buscar.
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { ic, dialog, toast } from './menu.js';
import { commentRanges, headings, scrollToPos, escapeHtml as esc, hydrateImages } from './custom.js';
import { baseExtensions } from './extensions.js';

const timeFmt = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

export function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} d`;
  return dateFmt.format(new Date(d));
}

export const initials = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
export function avatarHtml(person, color, size = '') {
  if (person?.avatar_url) return `<img class="dz-av ${size}" src="${esc(person.avatar_url)}" alt="" referrerpolicy="no-referrer" style="--c:${color}"/>`;
  return `<span class="dz-av ${size}" style="--c:${color}">${esc(initials(person?.name || person?.full_name || person?.email))}</span>`;
}

// ---------- Comentarios ----------
export function createComments(ctx, panel) {
  const { editor, ydoc } = ctx;
  const map = ydoc.getMap('comments');
  let showResolved = false;
  let draft = null;   // { id, quote }
  let active = null;

  const list = () => [...map.values()];
  const canDelete = (c) => c.authorId === ctx.me.id || ctx.staff;

  const save = (c) => map.set(c.id, { ...c });

  function startDraft() {
    if (!ctx.canEdit) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) { toast('Seleccioná el texto que querés comentar'); return; }
    cancelDraft();
    const id = crypto.randomUUID();
    const quote = editor.state.doc.textBetween(from, to, ' ', ' ').slice(0, 200);
    editor.chain().setComment(id).setActiveComment(id).run();
    draft = { id, quote };
    ctx.openPanel('comments', true);
    render();
    panel.querySelector('.dz-cm-draft textarea')?.focus();
  }
  function cancelDraft() {
    if (!draft) return;
    if (!map.has(draft.id)) editor.commands.removeCommentMarks(draft.id);
    draft = null;
  }

  function setActive(id, scrollText = false) {
    active = id;
    editor.commands.setActiveComment(id);
    panel.querySelectorAll('.dz-cm-card').forEach(c => c.classList.toggle('active', c.dataset.id === id));
    const card = panel.querySelector(`.dz-cm-card[data-id="${CSS.escape(id || '')}"]`);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (scrollText && id) {
      const r = commentRanges(editor.state.doc).get(id);
      if (r) editor.view.domAtPos(r.from)?.node?.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  const card = (c, orphan) => {
    const replies = c.replies || [];
    return `<article class="dz-cm-card ${c.resolved ? 'resolved' : ''} ${active === c.id ? 'active' : ''}" data-id="${esc(c.id)}">
      <header>
        ${avatarHtml({ name: c.authorName, avatar_url: c.authorAvatar }, c.authorColor)}
        <div class="dz-cm-who"><b>${esc(c.authorName)}</b><small>${timeAgo(c.createdAt)}</small></div>
        ${ctx.canEdit && !c.resolved ? `<button type="button" class="dz-icon" data-act="resolve" title="Marcar como resuelto">${ic('check')}</button>` : ''}
        ${c.resolved && !orphan && ctx.canEdit ? `<button type="button" class="dz-icon" data-act="reopen" title="Volver a abrir">${ic('replay')}</button>` : ''}
        ${canDelete(c) && ctx.canEdit ? `<button type="button" class="dz-icon" data-act="delete" title="Borrar el comentario">${ic('delete')}</button>` : ''}
      </header>
      ${c.quote ? `<blockquote>${esc(c.quote)}</blockquote>` : ''}
      <p class="dz-cm-text">${esc(c.text)}</p>
      ${replies.map(r => `<div class="dz-cm-reply">
        <header>${avatarHtml({ name: r.authorName, avatar_url: r.authorAvatar }, r.authorColor, 'sm')}<div class="dz-cm-who"><b>${esc(r.authorName)}</b><small>${timeAgo(r.createdAt)}</small></div>
        ${(r.authorId === ctx.me.id || ctx.staff) && ctx.canEdit ? `<button type="button" class="dz-icon sm" data-act="del-reply" data-reply="${esc(r.id)}" title="Borrar la respuesta">${ic('close')}</button>` : ''}</header>
        <p class="dz-cm-text">${esc(r.text)}</p></div>`).join('')}
      ${c.resolved ? `<p class="dz-cm-state">${orphan ? 'El texto comentado se borró' : `Resuelto por ${esc(c.resolvedBy || '')}`}</p>` : ''}
      ${ctx.canEdit && !c.resolved ? `<form class="dz-cm-replyform"><textarea rows="1" placeholder="Responder…" data-reply-for="${esc(c.id)}"></textarea><div class="dz-cm-actions"><button type="button" class="dz-btn ghost sm" data-act="cancel-reply">Cancelar</button><button type="submit" class="dz-btn primary sm">Responder</button></div></form>` : ''}
    </article>`;
  };

  function render() {
    // Se conserva lo que se estaba escribiendo
    const drafts = {};
    let focused = null;
    panel.querySelectorAll('textarea').forEach(t => {
      const key = t.dataset.replyFor || 'new';
      drafts[key] = t.value;
      if (document.activeElement === t) focused = key;
    });

    const ranges = commentRanges(editor.state.doc);
    const all = list();
    const open = all.filter(c => !c.resolved && ranges.has(c.id)).sort((a, b) => ranges.get(a.id).from - ranges.get(b.id).from);
    const closed = all.filter(c => c.resolved || !ranges.has(c.id)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    ctx.setCommentCount(open.length);

    panel.innerHTML = `
      <header class="dz-side-head"><h2>Comentarios</h2>
        <button type="button" class="dz-icon" data-act="close" title="Cerrar">${ic('close')}</button></header>
      <div class="dz-side-body">
        ${draft ? `<form class="dz-cm-card dz-cm-draft active">
          <header>${avatarHtml(ctx.me, ctx.user.color)}<div class="dz-cm-who"><b>${esc(ctx.user.name)}</b></div></header>
          <blockquote>${esc(draft.quote)}</blockquote>
          <textarea rows="2" placeholder="Escribí tu comentario…" data-reply-for="new" required></textarea>
          <div class="dz-cm-actions"><button type="button" class="dz-btn ghost sm" data-act="cancel-draft">Cancelar</button><button type="submit" class="dz-btn primary sm">Comentar</button></div>
        </form>` : ''}
        ${open.map(c => card(c, false)).join('')}
        ${!open.length && !draft ? `<div class="dz-empty">${ic('add_comment', 'big')}<p>No hay comentarios abiertos.</p>${ctx.canEdit ? '<p class="dz-hint">Seleccioná un texto y tocá el botón de comentario (o Ctrl+Alt+M).</p>' : ''}</div>` : ''}
        ${closed.length ? `<button type="button" class="dz-cm-toggle" data-act="toggle-resolved">${ic(showResolved ? 'expand_less' : 'expand_more')} ${showResolved ? 'Ocultar' : 'Ver'} resueltos (${closed.length})</button>` : ''}
        ${showResolved ? closed.map(c => card(c, !ranges.has(c.id))).join('') : ''}
      </div>`;

    panel.querySelectorAll('textarea').forEach(t => {
      const key = t.dataset.replyFor || 'new';
      if (drafts[key]) { t.value = drafts[key]; t.closest('.dz-cm-replyform')?.classList.add('typing'); }
      if (focused === key) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      t.addEventListener('input', () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; t.closest('.dz-cm-replyform')?.classList.toggle('typing', !!t.value); });
      t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); t.form.requestSubmit(); } });
    });
  }

  panel.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const ta = form.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const author = { authorId: ctx.me.id, authorName: ctx.user.name, authorColor: ctx.user.color, authorAvatar: ctx.me.avatar_url || '' };
    if (form.classList.contains('dz-cm-draft')) {
      save({ id: draft.id, ...author, text, quote: draft.quote, createdAt: new Date().toISOString(), resolved: false, replies: [] });
      active = draft.id;
      draft = null;
      ta.value = '';
    } else {
      const c = map.get(ta.dataset.replyFor);
      if (!c) return;
      ta.value = '';
      save({ ...c, replies: [...(c.replies || []), { id: crypto.randomUUID(), ...author, text, createdAt: new Date().toISOString() }] });
    }
    render();
  });

  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    const cardEl = ev.target.closest('.dz-cm-card');
    const id = cardEl?.dataset.id;
    if (!b) { if (id && !cardEl.classList.contains('dz-cm-draft')) setActive(id, true); return; }
    const c = id ? map.get(id) : null;
    switch (b.dataset.act) {
      case 'close': cancelDraft(); ctx.closePanel(); editor.commands.setActiveComment(null); break;
      case 'cancel-draft': cancelDraft(); editor.commands.setActiveComment(null); render(); break;
      case 'cancel-reply': { const t = cardEl.querySelector('textarea'); t.value = ''; t.closest('.dz-cm-replyform').classList.remove('typing'); t.blur(); break; }
      case 'toggle-resolved': showResolved = !showResolved; render(); break;
      case 'resolve':
        save({ ...c, resolved: true, resolvedBy: ctx.user.name, resolvedAt: new Date().toISOString() });
        editor.commands.setActiveComment(null);
        toast('Comentario resuelto');
        break;
      case 'reopen': save({ ...c, resolved: false }); break;
      case 'delete':
        dialog({ title: 'Borrar el comentario', body: '<p>Se borra el comentario con todas sus respuestas.</p>', submit: 'Borrar' }).then((ok) => {
          if (!ok) return;
          map.delete(id);
          editor.commands.removeCommentMarks(id);
        });
        break;
      case 'del-reply': save({ ...c, replies: (c.replies || []).filter(r => r.id !== b.dataset.reply) }); break;
      default:
    }
  });

  // Tocar un texto comentado abre su comentario
  editor.view.dom.addEventListener('click', (ev) => {
    const span = ev.target.closest('.dz-comment');
    if (!span) return;
    const id = span.dataset.commentId;
    const c = map.get(id);
    if (!c || c.resolved) return;
    ctx.openPanel('comments', true);
    setActive(id);
  });

  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => ctx.isOpen('comments') ? render() : ctx.setCommentCount(countOpen()), 250); };
  const countOpen = () => { const r = commentRanges(editor.state.doc); return list().filter(c => !c.resolved && r.has(c.id)).length; };
  map.observe(later);
  editor.on('update', later);
  ctx.setCommentCount(countOpen());

  return { render, startDraft, cancelDraft, countOpen };
}

// ---------- Historial de versiones ----------
export function createHistory(ctx, panel) {
  let versions = [];

  async function load() {
    panel.innerHTML = `<header class="dz-side-head"><h2>Historial de versiones</h2><button type="button" class="dz-icon" data-act="close" title="Cerrar">${ic('close')}</button></header><div class="dz-side-body"><p class="dz-hint pad">Cargando…</p></div>`;
    try { versions = (await ctx.api.docVersions(ctx.doc.id)).map(v => ({ ...v, can_delete: ctx.canEdit && (v.created_by === ctx.me.id || ctx.staff) })); } catch (e) { versions = []; toast('No se pudo cargar el historial: ' + (e.message || e), 'error'); }
    render();
  }

  function render() {
    const groups = new Map();
    versions.forEach(v => {
      const d = new Date(v.created_at);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      const key = diff === 0 ? 'Hoy' : diff === 1 ? 'Ayer' : dayFmt.format(d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    });
    panel.innerHTML = `
      <header class="dz-side-head"><h2>Historial de versiones</h2><button type="button" class="dz-icon" data-act="close" title="Cerrar">${ic('close')}</button></header>
      <div class="dz-side-body">
        ${ctx.canEdit ? `<button type="button" class="dz-btn primary block" data-act="save">${ic('bookmark_add')} Guardar esta versión con nombre</button>` : ''}
        <div class="dz-ver current"><b>Versión actual</b><small>La que estás viendo</small></div>
        ${[...groups].map(([g, list]) => `<h3 class="dz-ver-group">${esc(g)}</h3>${list.map(v => `
          <button type="button" class="dz-ver" data-id="${v.id}">
            <b>${v.label ? esc(v.label) : timeFmt.format(new Date(v.created_at))}</b>
            <small>${v.label ? timeFmt.format(new Date(v.created_at)) + ' · ' : ''}${v.auto ? 'Guardado automático' : 'Guardada a mano'}${v.author ? ' · ' + esc(v.author) : ''}</small>
          </button>`).join('')}`).join('')}
        ${!versions.length ? '<p class="dz-hint pad">Todavía no hay versiones guardadas. El servidor guarda una versión automática cada media hora de trabajo, y también podés guardar una con nombre.</p>' : ''}
      </div>`;
  }

  panel.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act],[data-id]');
    if (!b) return;
    if (b.dataset.act === 'close') { ctx.closePanel(); return; }
    if (b.dataset.act === 'save') { if (await ctx.saveVersion()) load(); return; }
    const v = versions.find(x => x.id === b.dataset.id);
    if (v) preview(v);
  });

  async function preview(v) {
    let bytes;
    try { bytes = await ctx.api.docVersionState(v.id); } catch (e) { toast('No se pudo abrir la versión: ' + (e.message || e), 'error'); return; }
    const vdoc = new Y.Doc();
    Y.applyUpdate(vdoc, bytes);
    const json = yXmlFragmentToProsemirrorJSON(vdoc.getXmlFragment('default'));
    const layer = document.createElement('div');
    layer.className = 'dz-preview';
    const when = `${dayFmt.format(new Date(v.created_at))}, ${timeFmt.format(new Date(v.created_at))}`;
    layer.innerHTML = `
      <header>
        <button type="button" class="dz-icon" data-act="back" title="Volver">${ic('arrow_back')}</button>
        <div class="dz-preview-title"><b>${esc(v.label || 'Versión del ' + when)}</b><small>${esc(when)}${v.author ? ' · ' + esc(v.author) : ''}</small></div>
        ${ctx.canEdit ? `<button type="button" class="dz-btn primary" data-act="restore">${ic('restore')} Restaurar esta versión</button>` : ''}
        ${v.can_delete ? `<button type="button" class="dz-btn ghost" data-act="delete">${ic('delete')} Borrar</button>` : ''}
      </header>
      <div class="dz-preview-body"><div class="dz-page"><div class="dz-preview-content"></div></div></div>`;
    ctx.root.appendChild(layer);
    const view = new Editor({ element: layer.querySelector('.dz-preview-content'), extensions: baseExtensions(), content: json, editable: false });
    view.view.dom.classList.add('dz-doc');
    hydrateImages(view.view.dom);
    const close = () => { view.destroy(); layer.remove(); vdoc.destroy(); };
    layer.addEventListener('click', async (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') close();
      if (act === 'delete') {
        if (!await dialog({ title: 'Borrar esta versión', body: '<p>Se borra del historial. El documento actual no cambia.</p>', submit: 'Borrar' })) return;
        try { await ctx.api.deleteDocVersion(v.id); close(); load(); } catch (e) { toast(e.message || String(e), 'error'); }
      }
      if (act === 'restore') {
        const ok = await dialog({ title: 'Restaurar esta versión', body: '<p>El documento vuelve a quedar como en esta versión, para todos. Antes se guarda la versión actual en el historial, así no se pierde nada.</p>', submit: 'Restaurar' });
        if (!ok) return;
        try {
          await ctx.api.saveDocVersion(ctx.doc.id, Y.encodeStateAsUpdate(ctx.ydoc), 'Antes de restaurar una versión');
        } catch (e) { toast('No se pudo guardar la versión actual: ' + (e.message || e), 'error'); return; }
        ctx.editor.commands.setContent(json);
        close();
        load();
        toast('Versión restaurada');
      }
    });
  }

  return { load };
}

// ---------- Esquema (títulos del documento) ----------
export function createOutline(ctx, panel) {
  const { editor } = ctx;
  function render() {
    const list = headings(editor.state.doc);
    const { from } = editor.state.selection;
    let current = -1;
    list.forEach((h, i) => { if (h.pos <= from) current = i; });
    panel.innerHTML = `<header class="dz-outline-head">${ic('notes')}<b>Esquema</b><button type="button" class="dz-icon sm" data-act="close" title="Ocultar el esquema">${ic('close')}</button></header>
      ${list.length ? list.map((h, i) => `<a class="dz-ol-item l${h.level} ${i === current ? 'on' : ''}" data-pos="${h.pos}">${esc(h.text || 'Sin título')}</a>`).join('')
        : '<p class="dz-hint">Los títulos que agregues al documento van a aparecer acá.</p>'}`;
  }
  panel.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="close"]')) { ctx.toggleOutline(false); return; }
    const a = ev.target.closest('[data-pos]');
    if (a) scrollToPos(editor, Number(a.dataset.pos));
  });
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(() => { if (ctx.isOpen('outline')) render(); }, 200); };
  editor.on('update', later);
  editor.on('selectionUpdate', later);
  return { render };
}

// ---------- Buscar y reemplazar ----------
export function createFind(ctx, box) {
  const { editor } = ctx;
  box.innerHTML = `
    <div class="dz-find-row">
      <input type="search" placeholder="Buscar en el documento" data-f="term" aria-label="Buscar"/>
      <span class="dz-find-count" data-f="count"></span>
      <button type="button" class="dz-icon sm" data-act="prev" title="Anterior">${ic('keyboard_arrow_up')}</button>
      <button type="button" class="dz-icon sm" data-act="next" title="Siguiente">${ic('keyboard_arrow_down')}</button>
      <button type="button" class="dz-icon sm dz-case" data-act="case" title="Distinguir mayúsculas">Aa</button>
      ${ctx.canEdit ? `<button type="button" class="dz-icon sm" data-act="more" title="Reemplazar">${ic('find_replace')}</button>` : ''}
      <button type="button" class="dz-icon sm" data-act="close" title="Cerrar">${ic('close')}</button>
    </div>
    <div class="dz-find-row replace" hidden>
      <input type="text" placeholder="Reemplazar con" data-f="with" aria-label="Reemplazar con"/>
      <button type="button" class="dz-btn ghost sm" data-act="replace">Reemplazar</button>
      <button type="button" class="dz-btn ghost sm" data-act="all">Todo</button>
    </div>`;
  const term = box.querySelector('[data-f="term"]');
  const withEl = box.querySelector('[data-f="with"]');
  const count = box.querySelector('[data-f="count"]');
  const st = () => editor.storage.searchReplace;
  const update = () => {
    const s = st();
    count.textContent = s.term ? (s.results.length ? `${s.index + 1} de ${s.results.length}` : '0 resultados') : '';
  };
  term.addEventListener('input', () => { editor.commands.setSearchTerm(term.value); update(); });
  term.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); editor.commands.goToResult(ev.shiftKey ? -1 : 1); update(); }
    if (ev.key === 'Escape') close();
  });
  withEl.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); if (ev.key === 'Enter') { ev.preventDefault(); replaceOne(); } });
  const replaceOne = () => { editor.commands.replaceCurrent(withEl.value); editor.commands.setSearchTerm(term.value); update(); };
  box.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
  box.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'next' || act === 'prev') { editor.commands.goToResult(act === 'next' ? 1 : -1); update(); }
    if (act === 'case') { const on = !st().caseSensitive; ev.target.closest('button').classList.toggle('on', on); editor.commands.setSearchCase(on); update(); }
    if (act === 'more') box.querySelector('.replace').hidden = !box.querySelector('.replace').hidden;
    if (act === 'replace') replaceOne();
    if (act === 'all') {
      const n = st().results.length;
      editor.commands.replaceAll(withEl.value);
      editor.commands.setSearchTerm(term.value);
      update();
      toast(n ? `Se reemplazaron ${n} coincidencias` : 'No hay coincidencias');
    }
    if (act === 'close') close();
  });
  editor.on('update', update);
  function open(replace) {
    box.hidden = false;
    if (replace && ctx.canEdit) box.querySelector('.replace').hidden = false;
    const { from, to, empty } = editor.state.selection;
    if (!empty) { term.value = editor.state.doc.textBetween(from, to, ' ').slice(0, 100); editor.commands.setSearchTerm(term.value); }
    term.focus();
    term.select();
    update();
  }
  function close() {
    box.hidden = true;
    editor.commands.setSearchTerm('');
    editor.commands.focus();
  }
  return { open, close, isOpen: () => !box.hidden };
}
