// Extensiones propias del editor: interlineado y sangría de párrafo, salto de página,
// comentarios, buscar y reemplazar, índice e imágenes guardadas en el bucket privado.
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Image from '@tiptap/extension-image';

const BLOCKS = ['paragraph', 'heading'];
export const INDENT_STEP = 48;   // px por nivel (≈ 1,27 cm, como Word)
const MAX_INDENT = 8;

// ---------- Interlineado, sangría y espacio entre párrafos ----------
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: BLOCKS,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: el => el.style.lineHeight || null,
          renderHTML: a => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: el => Math.min(MAX_INDENT, Math.round((parseInt(el.style.marginLeft, 10) || 0) / INDENT_STEP)),
          renderHTML: a => (a.indent ? { style: `margin-left:${a.indent * INDENT_STEP}px` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const setAttr = (fn) => ({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!BLOCKS.includes(node.type.name)) return;
        const attrs = fn(node.attrs);
        if (!attrs) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        changed = true;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return {
      setParagraphLineHeight: (value) => setAttr(() => ({ lineHeight: value || null })),
      indentParagraph: () => setAttr(a => (a.indent < MAX_INDENT ? { indent: a.indent + 1 } : null)),
      outdentParagraph: () => setAttr(a => (a.indent > 0 ? { indent: a.indent - 1 } : null)),
    };
  },
  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive('listItem') || this.editor.isActive('taskItem');
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false;
        if (inList()) return this.editor.commands.sinkListItem(this.editor.isActive('taskItem') ? 'taskItem' : 'listItem');
        return this.editor.commands.indentParagraph();
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) return false;
        if (inList()) return this.editor.commands.liftListItem(this.editor.isActive('taskItem') ? 'taskItem' : 'listItem');
        return this.editor.commands.outdentParagraph();
      },
    };
  },
});

// ---------- Salto de página ----------
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr.page-break' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'dz-page-break' }), ['span', {}, 'Salto de página']];
  },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run() };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

// ---------- Índice (tabla de contenidos) ----------
// Se dibuja solo a partir de los títulos del documento; se actualiza mientras se escribe.
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'dz-toc' })];
  },
  addCommands() {
    return { insertTableOfContents: () => ({ chain }) => chain().insertContent([{ type: 'tableOfContents' }, { type: 'paragraph' }]).run() };
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div');
      dom.className = 'dz-toc';
      dom.contentEditable = 'false';
      const draw = () => {
        const items = headings(editor.state.doc);
        dom.innerHTML = '<div class="dz-toc-title">Índice</div>' + (items.length
          ? items.map(h => `<a class="dz-toc-item l${h.level}" data-pos="${h.pos}">${escapeHtml(h.text || 'Sin título')}</a>`).join('')
          : '<p class="dz-toc-empty">Agregá títulos (Formato → Estilos de párrafo) y van a aparecer acá.</p>');
      };
      dom.addEventListener('mousedown', (ev) => {
        const a = ev.target.closest('[data-pos]');
        if (!a) return;
        ev.preventDefault();
        scrollToPos(editor, Number(a.dataset.pos));
      });
      draw();
      editor.on('update', draw);
      return { dom, ignoreMutation: () => true, destroy: () => editor.off('update', draw) };
    };
  },
});

export function headings(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent.trim(), pos });
    return node.type.name !== 'heading';
  });
  return out;
}

export function scrollToPos(editor, pos) {
  const dom = editor.view.nodeDOM(pos);
  if (dom?.scrollIntoView) dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
  editor.chain().setTextSelection(pos + 1).focus(undefined, { scrollIntoView: false }).run();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Comentarios ----------
// El texto comentado lleva una marca con el id; el comentario (autor, texto, respuestas)
// vive en el mapa "comments" del documento Yjs, así se sincroniza en tiempo real.
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: el => el.getAttribute('data-comment-id'),
        renderHTML: a => ({ 'data-comment-id': a.commentId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'dz-comment' }), 0];
  },
  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => commands.setMark(this.name, { commentId }),
      removeCommentMarks: (commentId) => ({ tr, state, dispatch }) => {
        const type = state.schema.marks.comment;
        let found = false;
        state.doc.descendants((node, pos) => {
          node.marks.forEach(m => {
            if (m.type === type && m.attrs.commentId === commentId) {
              tr.removeMark(pos, pos + node.nodeSize, m);
              found = true;
            }
          });
        });
        if (found && dispatch) dispatch(tr);
        return found;
      },
    };
  },
});

// Dónde está cada comentario en el documento (para ordenarlos y saltar a ellos)
export function commentRanges(doc) {
  const ranges = new Map();
  doc.descendants((node, pos) => {
    node.marks.forEach(m => {
      if (m.type.name !== 'comment') return;
      const r = ranges.get(m.attrs.commentId);
      if (r) { r.from = Math.min(r.from, pos); r.to = Math.max(r.to, pos + node.nodeSize); }
      else ranges.set(m.attrs.commentId, { from: pos, to: pos + node.nodeSize });
    });
  });
  return ranges;
}

// Resaltado del comentario activo
const activeCommentKey = new PluginKey('activeComment');
export const ActiveComment = Extension.create({
  name: 'activeComment',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: activeCommentKey,
      state: {
        init: () => null,
        apply: (tr, value) => (tr.getMeta(activeCommentKey) !== undefined ? tr.getMeta(activeCommentKey) : value),
      },
      props: {
        decorations(state) {
          const id = activeCommentKey.getState(state);
          if (!id) return null;
          const r = commentRanges(state.doc).get(id);
          return r ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: 'dz-comment-active' })]) : null;
        },
      },
    })];
  },
  addCommands() {
    return { setActiveComment: (id) => ({ tr, dispatch }) => { if (dispatch) dispatch(tr.setMeta(activeCommentKey, id || null).setMeta('addToHistory', false)); return true; } };
  },
});

// ---------- Buscar y reemplazar ----------
const searchKey = new PluginKey('search');
export const SearchReplace = Extension.create({
  name: 'searchReplace',
  addStorage() {
    return { term: '', caseSensitive: false, results: [], index: 0 };
  },
  addCommands() {
    const refresh = (tr, dispatch) => { if (dispatch) dispatch(tr.setMeta(searchKey, true).setMeta('addToHistory', false)); return true; };
    return {
      setSearchTerm: (term) => ({ tr, dispatch }) => { this.storage.term = term; this.storage.index = 0; return refresh(tr, dispatch); },
      setSearchCase: (value) => ({ tr, dispatch }) => { this.storage.caseSensitive = value; return refresh(tr, dispatch); },
      goToResult: (step) => ({ editor, tr, dispatch }) => {
        const s = this.storage;
        if (!s.results.length) return false;
        s.index = (s.index + step + s.results.length) % s.results.length;
        const r = s.results[s.index];
        refresh(tr, dispatch);
        requestAnimationFrame(() => {
          editor.commands.setTextSelection(r);
          editor.view.domAtPos(r.from)?.node?.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        });
        return true;
      },
      replaceCurrent: (text) => ({ state, dispatch }) => {
        const s = this.storage;
        const r = s.results[s.index];
        if (!r) return false;
        if (dispatch) dispatch(state.tr.insertText(text, r.from, r.to));
        return true;
      },
      replaceAll: (text) => ({ state, dispatch }) => {
        const list = [...this.storage.results].reverse();
        if (!list.length) return false;
        const tr = state.tr;
        list.forEach(r => tr.insertText(text, r.from, r.to));
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old, _o, state) {
          if (!tr.docChanged && !tr.getMeta(searchKey)) return old.map(tr.mapping, tr.doc);
          storage.results = findAll(state.doc, storage.term, storage.caseSensitive);
          if (storage.index >= storage.results.length) storage.index = 0;
          return DecorationSet.create(state.doc, storage.results.map((r, i) =>
            Decoration.inline(r.from, r.to, { class: i === storage.index ? 'dz-search-hit current' : 'dz-search-hit' })));
        },
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});

function findAll(doc, term, caseSensitive) {
  if (!term) return [];
  const results = [];
  const needle = caseSensitive ? term : term.toLowerCase();
  // Se busca dentro de cada bloque de texto, así una coincidencia puede cruzar negritas o links
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else { map.push(-1); text += '￼'; }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1 && results.length < 2000) {
      const from = map[i], to = map[i + needle.length - 1];
      if (from >= 0 && to >= 0) results.push({ from, to: to + 1 });
      i = hay.indexOf(needle, i + Math.max(1, needle.length));
    }
    return false;
  });
  return results;
}

// ---------- Imágenes ----------
// Las imágenes se suben al bucket privado y en el documento queda "storage:<ruta>".
// Al mostrarlas se cambia por un link firmado (dura una hora) que da la plataforma.
const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#eef2f7"/></svg>');
const signed = new Map();   // ruta -> link firmado
let resolver = null;
export function setImageResolver(fn) { resolver = fn; }
export const isStorageSrc = (src) => typeof src === 'string' && src.startsWith('storage:');

export async function resolveImageSrc(src) {
  if (!isStorageSrc(src)) return src;
  if (signed.has(src)) return signed.get(src);
  if (!resolver) return PLACEHOLDER;
  const url = await resolver(src.slice('storage:'.length));
  signed.set(src, url);
  return url;
}

// Cambia los marcadores por las imágenes reales dentro de un elemento (editor, vista previa)
export function hydrateImages(root) {
  root.querySelectorAll('img[data-src^="storage:"]').forEach(async (img) => {
    const src = img.getAttribute('data-src');
    const url = signed.get(src) || await resolveImageSrc(src).catch(() => null);
    if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
  });
}

export const StorageImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: el => el.getAttribute('data-src') || el.getAttribute('src'),
        renderHTML: a => (isStorageSrc(a.src) ? { src: signed.get(a.src) || PLACEHOLDER, 'data-src': a.src } : { src: a.src }),
      },
      align: {
        default: 'center',
        parseHTML: el => el.getAttribute('data-align') || 'center',
        renderHTML: a => ({ 'data-align': a.align || 'center' }),
      },
    };
  },
});
