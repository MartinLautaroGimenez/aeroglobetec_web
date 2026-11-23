// Editor de documentos colaborativo de AeroGlobETec (estilo Google Docs).
// mountEditor() arma la pantalla completa: encabezado con el título, menús, barra de
// herramientas, la hoja, los paneles y la conexión en tiempo real.
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { editorExtensions } from './extensions.js';
import { DemoProvider } from './demo-provider.js';
import { ic, dialog, toast, closeMenus } from './menu.js';
import { toolbarHtml, bindToolbar, ZOOMS } from './toolbar.js';
import { bindMenubar } from './menubar.js';
import { createComments, createHistory, createOutline, createFind, avatarHtml } from './panels.js';
import { editMath, editLink, insertImageFiles, wordCount, printDocument, showShortcuts } from './actions.js';
import { setImageResolver, hydrateImages, escapeHtml as esc } from './custom.js';
import { loadAssets } from './assets.js';

const COLORS = ['#e8710a', '#1a73e8', '#d93025', '#188038', '#9334e6', '#e52592', '#12b5cb', '#c26401', '#5f6368', '#0b8043'];
export const colorFor = (id) => {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
const pref = {
  get(k, d) { try { const v = localStorage.getItem('dz-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dz-' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

/**
 * @param {HTMLElement} root  contenedor (ocupa toda la pantalla)
 * @param {object} opts
 *   api, me, doc (fila de documents), scopeLabel, scopeHref, backHref, demo, serverUrl,
 *   canEdit, canManage, staff, people, onNew(), onCopy(state), seedHtml
 */
export function mountEditor(root, opts) {
  loadAssets();
  const { api, me, doc } = opts;
  const user = { id: me.id, name: me.full_name || me.email, color: colorFor(me.id), avatar: me.avatar_url || '' };
  const ydoc = new Y.Doc();
  const meta = ydoc.getMap('meta');
  const destroyers = [];
  let canEdit = !!opts.canEdit;
  let zoom = pref.get('zoom', 100);
  let showRuler = pref.get('ruler', true);

  // ---------- Estructura ----------
  root.classList.add('dz');
  root.innerHTML = `
    <header class="dz-top">
      <a class="dz-logo" href="${esc(opts.backHref)}" title="Volver a la lista de documentos">${ic('description')}</a>
      <div class="dz-titlebox">
        <div class="dz-titlerow">
          <input class="dz-title" value="${esc(doc.title)}" maxlength="200" aria-label="Nombre del documento" spellcheck="false" ${canEdit ? '' : 'readonly'}/>
          <a class="dz-where" href="${esc(opts.scopeHref || opts.backHref)}" title="Ver dónde está guardado">${ic('folder', 'sm')}<span>${esc(opts.scopeLabel || '')}${doc.folder ? ' / ' + esc(doc.folder) : ''}</span></a>
          <span class="dz-status" data-status="connecting" title="">${ic('sync')}<span>Conectando…</span></span>
        </div>
        <nav class="dz-menubar" aria-label="Menú del documento"></nav>
      </div>
      <div class="dz-top-right">
        <div class="dz-people" aria-label="Personas en el documento"></div>
        <button type="button" class="dz-icon big dz-hist-btn" data-open="history" title="Historial de versiones">${ic('history')}</button>
        <button type="button" class="dz-icon big dz-cm-btn" data-open="comments" title="Comentarios">${ic('comment')}<b class="dz-badge" hidden></b></button>
        <button type="button" class="dz-btn primary dz-share" data-act="share">${ic('lock', 'sm')}<span>Compartir</span></button>
        <a class="dz-icon big" href="${esc(opts.backHref)}" title="Cerrar el documento">${ic('close')}</a>
      </div>
    </header>
    <div class="dz-toolbar" role="toolbar" aria-label="Formato">${toolbarHtml()}</div>
    <div class="dz-readonly" hidden>${ic('visibility', 'sm')} <span>Solo lectura: lo editan docentes y estudiantes líderes. Podés leerlo, copiarlo, descargarlo e imprimirlo.</span></div>
    <div class="dz-body">
      <aside class="dz-outline" hidden></aside>
      <button type="button" class="dz-outline-open" title="Mostrar el esquema">${ic('notes')}</button>
      <div class="dz-canvas">
        <div class="dz-find" hidden></div>
        <div class="dz-zoom">
          <div class="dz-ruler" aria-hidden="true"></div>
          <div class="dz-page"><div class="dz-editor"></div></div>
          <div class="dz-foot"><span data-words></span></div>
        </div>
      </div>
      <aside class="dz-side" hidden></aside>
    </div>
    <div class="dz-loading"><div class="dz-spinner"></div><p>Abriendo el documento…</p></div>
    <div class="dz-bubble" hidden></div>`;

  const $ = (s) => root.querySelector(s);
  const status = $('.dz-status');
  const sidePanel = $('.dz-side');
  const outlinePanel = $('.dz-outline');

  // ---------- Conexión ----------
  let provider;
  let synced = false;
  let lastError = '';
  const setStatus = (state, text, title = '') => {
    status.dataset.status = state;
    const icons = { connecting: 'sync', saving: 'sync', saved: 'cloud_done', offline: 'cloud_off', error: 'error', local: 'computer' };
    status.innerHTML = `${ic(icons[state] || 'sync')}<span>${esc(text)}</span>`;
    status.title = title;
  };

  if (opts.demo) {
    provider = new DemoProvider(doc.id, ydoc);
    provider.on('saving', () => setStatus('saving', 'Guardando…'));
    provider.on('saved', () => setStatus('local', 'Guardado en este navegador', 'Modo demo: el documento se guarda solo en este navegador. Abrilo en otra pestaña para ver la edición en simultáneo.'));
    provider.on('save-error', () => setStatus('error', 'No entra en el navegador', 'El modo demo guarda en el navegador y se llenó el espacio. Probá con imágenes más chicas.'));
    provider.on('synced', () => onSynced());
    setStatus('local', 'Guardado en este navegador', 'Modo demo: el documento se guarda solo en este navegador.');
  } else {
    provider = new HocuspocusProvider({
      url: opts.serverUrl,
      name: `doc:${doc.id}`,
      document: ydoc,
      token: async () => (await api.docAccessToken()) || '',
      onAuthenticationFailed: ({ reason }) => {
        lastError = reason || 'Sin permiso';
        showFatal('No pudiste entrar al documento', /permiso/i.test(lastError) ? 'No tenés permiso para abrir este documento.' : `El servidor de documentos rechazó la conexión (${lastError}). Probá cerrar sesión y volver a entrar.`);
      },
      onSynced: () => onSynced(),
      onStatus: ({ status: s }) => {
        if (s === 'connected') updateSaveStatus();
        else if (s === 'connecting') setStatus('connecting', synced ? 'Reconectando…' : 'Conectando…');
        else setStatus('offline', 'Sin conexión', 'Los cambios quedan en esta pestaña y se guardan cuando vuelva la conexión. No la cierres.');
      },
      onUnsyncedChanges: () => updateSaveStatus(),
      onAuthenticated: ({ scope }) => {
        if (scope === 'readonly' && canEdit) setReadOnly();
      },
    });
    // Si no conecta en un rato, se avisa (servidor apagado o mal configurado)
    const t = setTimeout(() => {
      if (!synced) showFatal('No se pudo conectar al servidor de documentos', 'Revisá tu conexión. Si sigue sin andar, puede que el servidor de documentos esté apagado: avisale a un docente.', true);
    }, 15000);
    destroyers.push(() => clearTimeout(t));
  }

  function updateSaveStatus() {
    if (opts.demo || !synced) return;
    if (provider.hasUnsyncedChanges) setStatus('saving', 'Guardando…');
    else setStatus('saved', 'Guardado', 'Todos los cambios están guardados en el servidor del taller.');
  }

  function showFatal(title, text, retry = false) {
    const box = $('.dz-loading');
    box.hidden = false;
    box.classList.add('error');
    box.innerHTML = `${ic('cloud_off', 'big')}<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dz-row">${retry ? '<button type="button" class="dz-btn primary" data-act="retry">Reintentar</button>' : ''}<a class="dz-btn ghost" href="${esc(opts.backHref)}">Volver</a></div>`;
    box.querySelector('[data-act="retry"]')?.addEventListener('click', () => location.reload());
  }

  // ---------- Editor ----------
  setImageResolver((path) => api.fileUrl(path));
  const editor = new Editor({
    element: $('.dz-editor'),
    extensions: editorExtensions({
      ydoc, provider, user,
      onMathClick: (node, pos, kind) => { if (editor.isEditable) editMath(editor, { node, pos, kind }); },
    }),
    editable: false,
    editorProps: {
      attributes: { class: 'dz-doc', spellcheck: String(pref.get('spellcheck', true)), lang: 'es' },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
        if (!files.length || !editor.isEditable) return false;
        insertImageFiles(ctx, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !editor.isEditable) return false;
        const files = [...(event.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertImageFiles(ctx, files, pos);
        return true;
      },
    },
  });

  // ---------- Contexto compartido por menús, barra y paneles ----------
  const ctx = {
    api, me, doc, ydoc, editor, user, root,
    staff: !!opts.staff,
    get canEdit() { return canEdit; },
    title: () => $('.dz-title').value.trim() || 'Documento sin título',
    uploadImage: (file) => api.uploadDocImage(doc, file),
    print: () => printDocument(ctx),
    zoom: () => zoom,
    setZoom: (z) => setZoom(z),
    ruler: () => showRuler,
    toggleRuler: () => { showRuler = !showRuler; pref.set('ruler', showRuler); $('.dz-ruler').hidden = !showRuler; },
    spellcheck: () => editor.view.dom.getAttribute('spellcheck') === 'true',
    toggleSpellcheck: () => { const on = !ctx.spellcheck(); editor.view.dom.setAttribute('spellcheck', String(on)); pref.set('spellcheck', on); toast(on ? 'Revisión de ortografía activada' : 'Revisión de ortografía desactivada'); },
    fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.()),
    focusTitle: () => { const t = $('.dz-title'); t.focus(); t.select(); },
    indent: (dir) => {
      const list = editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;
      if (list) editor.chain().focus()[dir > 0 ? 'sinkListItem' : 'liftListItem'](list).run();
      else editor.chain().focus()[dir > 0 ? 'indentParagraph' : 'outdentParagraph']().run();
    },
    clearFormatting: () => {
      editor.chain().focus()
        .unsetMark('bold').unsetMark('italic').unsetMark('underline').unsetMark('strike')
        .unsetMark('highlight').unsetMark('subscript').unsetMark('superscript').unsetMark('code')
        .unsetMark('textStyle')
        .setParagraphLineHeight(null)
        .run();
    },
    changeCase: (kind) => {
      const { from, to, empty } = editor.state.selection;
      if (empty) { toast('Seleccioná el texto primero'); return; }
      const tr = editor.state.tr;
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const s = Math.max(from, pos), e = Math.min(to, pos + node.text.length);
        const part = node.text.slice(s - pos, e - pos);
        const out = kind === 'upper' ? part.toLocaleUpperCase('es') : kind === 'lower' ? part.toLocaleLowerCase('es')
          : part.toLocaleLowerCase('es').replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('es'));
        if (out !== part) tr.replaceWith(tr.mapping.map(s), tr.mapping.map(e), editor.schema.text(out, node.marks));
      });
      editor.view.dispatch(tr);
      editor.commands.setTextSelection({ from, to });
    },
    paste: async () => {
      try {
        const text = await navigator.clipboard.readText();
        editor.chain().focus().insertContent(text).run();
      } catch { toast('Usá Ctrl+V para pegar'); }
    },
    openPanel: (name, keep) => openPanel(name, keep),
    closePanel: () => closePanel(),
    isOpen: (name) => (name === 'outline' ? !outlinePanel.hidden : !sidePanel.hidden && sidePanel.dataset.panel === name),
    toggleOutline: (force) => toggleOutline(force),
    openFind: (replace) => find.open(replace),
    setCommentCount: (n) => { const b = $('.dz-cm-btn .dz-badge'); b.hidden = !n; b.textContent = n > 9 ? '9+' : n; },
    addComment: () => comments.startDraft(),
    saveVersion: async () => {
      const data = await dialog({ title: 'Guardar una versión con nombre', submit: 'Guardar', body: '<label class="dz-field"><span>Nombre de la versión</span><input name="label" maxlength="120" required placeholder="Ej.: Entregado al jurado"/></label><p class="dz-hint">Queda en el historial y la pueden restaurar quienes editan el documento.</p>' });
      if (!data?.label?.trim()) return false;
      try { await api.saveDocVersion(doc.id, Y.encodeStateAsUpdate(ydoc), data.label.trim()); toast('Versión guardada'); return true; } catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'error'); return false; }
    },
    newDocument: opts.onNew || null,
    makeCopy: opts.onCopy ? () => opts.onCopy(Y.encodeStateAsUpdate(ydoc), ctx.title()) : null,
    importDocx: async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        toast('Importando el archivo…');
        try {
          const { importDocx } = await import('./docx-import.js');
          const html = await importDocx(f, ctx.uploadImage);
          editor.chain().focus().insertContent(html).run();
          toast('Listo: se agregó el contenido del archivo');
        } catch (e) { console.error(e); toast('No se pudo importar el archivo: ' + (e.message || e), 'error'); }
      };
      input.click();
    },
    moveFolder: async () => {
      const data = await dialog({ title: 'Mover a una carpeta', submit: 'Mover', body: `<label class="dz-field"><span>Carpeta</span><input name="folder" maxlength="60" value="${esc(doc.folder || '')}" placeholder="Sin carpeta" list="dz-folders"/></label><datalist id="dz-folders">${(opts.folders || []).map(f => `<option value="${esc(f)}">`).join('')}</datalist><p class="dz-hint">Dejalo vacío para sacarlo de la carpeta.</p>` });
      if (!data) return;
      try {
        await api.updateDoc(doc.id, { folder: data.folder.trim() });
        doc.folder = data.folder.trim();
        $('.dz-where span').textContent = (opts.scopeLabel || '') + (doc.folder ? ' / ' + doc.folder : '');
        toast(doc.folder ? `Movido a "${doc.folder}"` : 'Quedó sin carpeta');
      } catch (e) { toast(e.message || String(e), 'error'); }
    },
    share: () => shareDialog(),
    details: () => detailsDialog(),
    help: () => dialog({
      title: 'Cómo funcionan los documentos', submit: '', cancel: 'Cerrar', wide: true,
      body: `<ul class="dz-help">
        <li><b>Se guarda solo.</b> Cada cambio se guarda en el servidor del taller a los pocos segundos. Arriba, al lado del nombre, ves si está todo guardado.</li>
        <li><b>Edición en simultáneo.</b> Varias personas pueden escribir a la vez: ves sus cursores con su nombre y sus fotos arriba a la derecha.</li>
        <li><b>Comentarios.</b> Seleccioná un texto y tocá ${ic('add_comment', 'sm')}. Se puede responder y marcar como resuelto.</li>
        <li><b>Historial.</b> En ${ic('history', 'sm')} están las versiones anteriores: se pueden ver y restaurar.</li>
        <li><b>Word y PDF.</b> En Archivo → Descargar. Para PDF elegí "Guardar como PDF" al imprimir.</li>
        <li><b>Quién lo ve.</b> Lo ven las mismas personas que ven el proyecto o evento donde está guardado.</li>
      </ul>`,
    }),
  };

  // ---------- Barra, menús y paneles ----------
  const toolbar = bindToolbar($('.dz-toolbar'), ctx);
  bindMenubar($('.dz-menubar'), ctx);
  const comments = createComments(ctx, sidePanel);
  const history = createHistory(ctx, sidePanel);
  const outline = createOutline(ctx, outlinePanel);
  const find = createFind(ctx, $('.dz-find'));

  function openPanel(name, keep = false) {
    if (!keep && ctx.isOpen(name)) { closePanel(); return; }
    sidePanel.hidden = false;
    sidePanel.dataset.panel = name;
    root.querySelectorAll('[data-open]').forEach(b => b.classList.toggle('on', b.dataset.open === name));
    if (name === 'comments') comments.render();
    if (name === 'history') history.load();
  }
  function closePanel() {
    if (sidePanel.dataset.panel === 'comments') comments.cancelDraft();
    sidePanel.hidden = true;
    sidePanel.dataset.panel = '';
    root.querySelectorAll('[data-open]').forEach(b => b.classList.remove('on'));
  }
  function toggleOutline(force) {
    const show = force ?? outlinePanel.hidden;
    outlinePanel.hidden = !show;
    $('.dz-outline-open').hidden = show;
    pref.set('outline', show);
    if (show) outline.render();
  }

  root.addEventListener('click', (ev) => {
    const open = ev.target.closest('[data-open]');
    if (open) openPanel(open.dataset.open);
    if (ev.target.closest('[data-act="share"]')) shareDialog();
    if (ev.target.closest('.dz-outline-open')) toggleOutline(true);
  });

  // ---------- Zoom y regla ----------
  function setZoom(z) {
    zoom = ZOOMS.includes(z) ? z : 100;
    pref.set('zoom', zoom);
    $('.dz-zoom').style.zoom = zoom === 100 ? '' : String(zoom / 100);
    toolbar.sync();
  }
  setZoom(zoom);
  $('.dz-ruler').hidden = !showRuler;
  $('.dz-ruler').innerHTML = rulerSvg();
  if (pref.get('outline', false) && innerWidth > 1100) toggleOutline(true);

  // ---------- Título ----------
  const titleInput = $('.dz-title');
  let titleTimer;
  const fitTitle = () => { titleInput.style.width = `${Math.min(520, Math.max(120, (titleInput.value.length + 2) * 9.2))}px`; };
  fitTitle();
  titleInput.addEventListener('input', () => {
    fitTitle();
    clearTimeout(titleTimer);
    titleTimer = setTimeout(saveTitle, 700);
  });
  titleInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); editor.commands.focus(); } });
  titleInput.addEventListener('blur', () => { if (!titleInput.value.trim()) titleInput.value = 'Documento sin título'; saveTitle(); });
  async function saveTitle() {
    clearTimeout(titleTimer);
    const t = titleInput.value.trim();
    if (!t || t === doc.title || !canEdit) return;
    doc.title = t;
    meta.set('title', t);
    document.title = `${t} · AeroGlobETec`;
    try { await api.updateDoc(doc.id, { title: t }); } catch (e) { toast('No se pudo cambiar el nombre: ' + (e.message || e), 'error'); }
  }
  meta.observe(() => {
    const t = meta.get('title');
    if (t && t !== titleInput.value && document.activeElement !== titleInput) { titleInput.value = t; doc.title = t; fitTitle(); document.title = `${t} · AeroGlobETec`; }
  });
  document.title = `${doc.title} · AeroGlobETec`;

  // ---------- Al terminar de cargar ----------
  function onSynced() {
    if (synced) return;
    synced = true;
    $('.dz-loading').hidden = true;
    // El nombre de la base manda (lo pueden haber cambiado desde la lista)
    if (canEdit && meta.get('title') !== doc.title) meta.set('title', doc.title);
    // Modo demo: documentos de ejemplo que todavía no tienen contenido
    if (opts.seedHtml && editor.isEmpty) editor.commands.setContent(opts.seedHtml);
    editor.setEditable(canEdit);
    if (!canEdit) setReadOnly();
    updateSaveStatus();
    hydrateImages(editor.view.dom);
    if (canEdit && editor.isEmpty) editor.commands.focus('start');
    updateWords();
  }
  function setReadOnly() {
    canEdit = false;
    editor.setEditable(false);
    root.classList.add('readonly');
    $('.dz-readonly').hidden = false;
    titleInput.readOnly = true;
  }

  // ---------- Colaboradores ----------
  const awareness = provider.awareness;
  const people = $('.dz-people');
  const drawPeople = () => {
    const seen = new Map();
    awareness.getStates().forEach((st, clientId) => {
      const u = st.user;
      if (!u || clientId === ydoc.clientID || u.id === me.id) return;
      if (!seen.has(u.id)) seen.set(u.id, u);
    });
    const list = [...seen.values()];
    people.innerHTML = list.slice(0, 5).map(u => `<span class="dz-person" title="${esc(u.name)} está en el documento">${avatarHtml({ name: u.name, avatar_url: u.avatar }, u.color)}</span>`).join('')
      + (list.length > 5 ? `<span class="dz-person more" title="${esc(list.slice(5).map(u => u.name).join(', '))}">+${list.length - 5}</span>` : '');
  };
  awareness.on('change', drawPeople);
  awareness.setLocalStateField('user', user);
  drawPeople();

  // ---------- Contador de palabras abajo ----------
  let wordsTimer;
  const updateWords = () => {
    clearTimeout(wordsTimer);
    wordsTimer = setTimeout(() => {
      const n = editor.storage.characterCount.words();
      $('[data-words]').textContent = `${n.toLocaleString('es-AR')} palabra${n === 1 ? '' : 's'}`;
    }, 300);
  };
  editor.on('update', updateWords);
  editor.on('update', () => requestAnimationFrame(() => hydrateImages(editor.view.dom)));

  // ---------- Globitos: link e imagen seleccionados ----------
  const bubble = $('.dz-bubble');
  const placeBubble = (rect) => {
    const r = root.getBoundingClientRect();
    bubble.hidden = false;
    const w = bubble.offsetWidth;
    bubble.style.left = `${Math.max(8, Math.min(rect.left - r.left, r.width - w - 8))}px`;
    bubble.style.top = `${rect.bottom - r.top + 6}px`;
  };
  const syncBubble = () => {
    const { selection } = editor.state;
    if (!editor.isFocused && !bubble.matches(':hover')) { bubble.hidden = true; return; }
    if (editor.isActive('link') && selection.empty) {
      const href = editor.getAttributes('link').href || '';
      bubble.innerHTML = `${ic('public', 'sm')}<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href.replace(/^https?:\/\//, '').slice(0, 48))}</a>`
        + (canEdit ? `<button type="button" class="dz-icon sm" data-b="edit-link" title="Editar el enlace">${ic('edit')}</button><button type="button" class="dz-icon sm" data-b="unlink" title="Quitar el enlace">${ic('link_off')}</button>` : '');
      const coords = editor.view.coordsAtPos(selection.from);
      placeBubble({ left: coords.left, bottom: coords.bottom });
      return;
    }
    if (canEdit && selection.node?.type.name === 'image') {
      const a = selection.node.attrs;
      bubble.innerHTML = ['left', 'center', 'right'].map(al => `<button type="button" class="dz-icon sm ${a.align === al ? 'on' : ''}" data-b="align-${al}" title="${{ left: 'A la izquierda', center: 'Centrada', right: 'A la derecha' }[al]}">${ic(`format_align_${al}`)}</button>`).join('')
        + '<span class="dz-tb-sep"></span>'
        + [25, 50, 75, 100].map(p => `<button type="button" class="dz-btn ghost sm" data-b="size-${p}">${p}%</button>`).join('')
        + `<span class="dz-tb-sep"></span><button type="button" class="dz-icon sm" data-b="del-img" title="Borrar la imagen">${ic('delete')}</button>`;
      const dom = editor.view.nodeDOM(selection.from);
      if (dom?.getBoundingClientRect) placeBubble(dom.getBoundingClientRect());
      return;
    }
    bubble.hidden = true;
  };
  bubble.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
  bubble.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-b]')?.dataset.b;
    if (!act) return;
    const c = editor.chain().focus();
    if (act === 'edit-link') editLink(editor);
    else if (act === 'unlink') c.extendMarkRange('link').unsetLink().run();
    else if (act.startsWith('align-')) c.updateAttributes('image', { align: act.slice(6) }).run();
    else if (act.startsWith('size-')) {
      const pageW = $('.dz-editor').clientWidth;
      const node = editor.state.selection.node;
      const w = Math.round(pageW * Number(act.slice(5)) / 100);
      const ratio = node.attrs.width && node.attrs.height ? node.attrs.height / node.attrs.width : null;
      c.updateAttributes('image', { width: w, height: ratio ? Math.round(w * ratio) : null }).run();
    } else if (act === 'del-img') c.deleteSelection().run();
    requestAnimationFrame(syncBubble);
  });
  editor.on('selectionUpdate', syncBubble);
  editor.on('blur', () => setTimeout(syncBubble, 150));
  editor.on('focus', syncBubble);
  $('.dz-canvas').addEventListener('scroll', () => { bubble.hidden = true; }, { passive: true });

  // ---------- Atajos ----------
  const onKey = (ev) => {
    if (!root.isConnected) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const k = ev.key.toLowerCase();
    if (k === 'k' && !ev.shiftKey && canEdit) { ev.preventDefault(); editLink(editor); }
    else if (k === 'm' && ev.altKey && canEdit) { ev.preventDefault(); ctx.addComment(); }
    else if (k === 'f' && !ev.shiftKey) { ev.preventDefault(); find.open(false); }
    else if (k === 'h' && !ev.shiftKey) { ev.preventDefault(); find.open(true); }
    else if (k === 'p') { ev.preventDefault(); ctx.print(); }
    else if (k === 's') { ev.preventDefault(); toast(opts.demo ? 'Se guarda solo en este navegador' : 'No hace falta: se guarda solo'); }
    else if (k === 'c' && ev.shiftKey) { ev.preventDefault(); wordCount(editor); }
    else if (k === '\\' && canEdit) { ev.preventDefault(); ctx.clearFormatting(); }
    else if (k === '/') { ev.preventDefault(); showShortcuts(); }
    else if (ev.altKey && /^[0-4]$/.test(ev.key) && canEdit) {
      ev.preventDefault();
      if (ev.key === '0') editor.chain().focus().setParagraph().run();
      else editor.chain().focus().toggleHeading({ level: Number(ev.key) }).run();
    }
  };
  document.addEventListener('keydown', onKey);

  // Avisar si se cierra la pestaña con cambios sin guardar
  const onBeforeUnload = (ev) => {
    if (!opts.demo && provider.hasUnsyncedChanges) { ev.preventDefault(); ev.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  // ---------- Compartir / detalles ----------
  async function shareDialog() {
    const scope = opts.scopeLabel || 'el taller';
    const canManage = opts.canManage;
    const data = await dialog({
      title: `Compartir "${ctx.title()}"`,
      submit: canManage ? 'Guardar' : '',
      cancel: canManage ? 'Cancelar' : 'Cerrar',
      body: `
        <div class="dz-share-who">${ic('group')}<div><b>Quién lo ve</b><p>${doc.project_id ? `Los integrantes del proyecto <b>${esc(scope)}</b>, los docentes y los estudiantes líderes.` : doc.event_id ? `El equipo de <b>${esc(scope)}</b>, los docentes y los estudiantes líderes.` : 'Todas las cuentas aprobadas del taller.'}</p></div></div>
        <fieldset class="dz-share-opts" ${canManage ? '' : 'disabled'}>
          <legend>Quién lo edita</legend>
          <label class="dz-radio"><input type="radio" name="editable_by" value="equipo" ${doc.editable_by !== 'staff' ? 'checked' : ''}/><span><b>Todos los que lo ven</b><small>Pueden escribir, comentar y restaurar versiones.</small></span></label>
          <label class="dz-radio"><input type="radio" name="editable_by" value="staff" ${doc.editable_by === 'staff' ? 'checked' : ''} ${opts.staff ? '' : 'disabled'}/><span><b>Solo docentes y estudiantes líderes</b><small>El resto lo puede leer, descargar e imprimir.</small></span></label>
        </fieldset>
        ${canManage ? '' : '<p class="dz-hint">Esto lo cambian quien creó el documento, los docentes y los líderes.</p>'}
        <button type="button" class="dz-btn ghost" data-copy>${ic('link')} Copiar el enlace</button>`,
      onOpen: (dlg) => dlg.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(location.href); toast('Enlace copiado'); } catch { toast(location.href); }
      }),
    });
    if (!data || !canManage || data.editable_by === doc.editable_by) return;
    try {
      await api.updateDoc(doc.id, { editable_by: data.editable_by });
      doc.editable_by = data.editable_by;
      toast(data.editable_by === 'staff' ? 'Ahora solo docentes y líderes lo editan' : 'Ahora lo editan todos los que lo ven');
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  function detailsDialog() {
    const cc = editor.storage.characterCount;
    const fmt = (d) => (d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' }) : '—');
    dialog({
      title: 'Detalles del documento', submit: '', cancel: 'Cerrar',
      body: `<table class="dz-count">
        <tr><td>Dónde está</td><td>${esc(opts.scopeLabel || 'Taller')}${doc.folder ? ' / ' + esc(doc.folder) : ''}</td></tr>
        <tr><td>Lo creó</td><td>${esc(opts.personName?.(doc.created_by) || '—')}</td></tr>
        <tr><td>Creado</td><td>${fmt(doc.created_at)}</td></tr>
        <tr><td>Último cambio</td><td>${fmt(doc.updated_at)}${doc.updated_by ? ' · ' + esc(opts.personName?.(doc.updated_by) || '') : ''}</td></tr>
        <tr><td>Palabras</td><td>${cc.words().toLocaleString('es-AR')}</td></tr>
        <tr><td>Quién lo edita</td><td>${doc.editable_by === 'staff' ? 'Docentes y líderes' : 'Todos los que lo ven'}</td></tr>
      </table>`,
    });
  }

  // ---------- Limpieza ----------
  return {
    editor,
    destroy() {
      saveTitle();
      closeMenus();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      destroyers.forEach(fn => fn());
      if (opts.demo) opts.onDemoClose?.(Y.encodeStateAsUpdate(ydoc));
      editor.destroy();
      provider.destroy();
      ydoc.destroy();
      root.innerHTML = '';
      root.classList.remove('dz', 'readonly');
    },
  };
}

// Regla con centímetros (A4: 21 cm, márgenes de 2,54 cm)
function rulerSvg() {
  const W = 794, CM = 37.795, M = 96;
  let ticks = '';
  for (let i = 0; i <= 84; i++) {
    const x = (i * CM) / 4;
    if (x > W) break;
    const major = i % 4 === 0;
    const half = i % 2 === 0;
    ticks += `<line x1="${x}" x2="${x}" y1="${major ? 9 : half ? 13 : 15}" y2="18"/>`;
    if (major && i > 0 && i < 84) ticks += `<text x="${x}" y="8">${i / 4}</text>`;
  }
  return `<svg viewBox="0 0 ${W} 20" width="${W}" height="20"><rect class="m" x="0" y="0" width="${M}" height="20"/><rect class="m" x="${W - M}" y="0" width="${M}" height="20"/>${ticks}<path class="mk" d="M${M - 5} 0h10l-5 6z"/><path class="mk" d="M${W - M - 5} 0h10l-5 6z"/></svg>`;
}
