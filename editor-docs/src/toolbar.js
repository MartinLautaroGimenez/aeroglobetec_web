// Barra de herramientas (deshacer, estilos, fuente, tamaño, formato, alineación, listas…)
import { ic, openMenu, menuIsOpenFor, closeMenus } from './menu.js';
import { editLink, pickImage, paletteItem } from './actions.js';
import { escapeHtml as esc } from './custom.js';

export const FONTS = [
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Calibri', 'Calibri, Carlito, sans-serif'],
  ['Comic Neue', '"Comic Neue", "Comic Sans MS", cursive'],
  ['Courier New', '"Courier New", Courier, monospace'],
  ['DM Sans', '"DM Sans", sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Lato', 'Lato, sans-serif'],
  ['Merriweather', 'Merriweather, serif'],
  ['Montserrat', 'Montserrat, sans-serif'],
  ['Open Sans', '"Open Sans", sans-serif'],
  ['Roboto', 'Roboto, sans-serif'],
  ['Roboto Mono', '"Roboto Mono", monospace'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
];
export const SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
export const STYLES = [
  ['p', 'Texto normal', 'font-size:14px'],
  ['1', 'Título 1', 'font-size:22px'],
  ['2', 'Título 2', 'font-size:18px'],
  ['3', 'Título 3', 'font-size:16px;color:#434343'],
  ['4', 'Título 4', 'font-size:14px;font-weight:600;color:#666'],
];
export const LINE_HEIGHTS = [['1', 'Sencillo'], ['1.15', '1,15'], ['1.5', '1,5'], ['2', 'Doble']];
export const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
const ALIGNS = [['left', 'format_align_left', 'Alinear a la izquierda'], ['center', 'format_align_center', 'Centrar'], ['right', 'format_align_right', 'Alinear a la derecha'], ['justify', 'format_align_justify', 'Justificar']];
const DEFAULT_FONT = 'Arial';
const DEFAULT_SIZE = 11;

const b = (cmd, icon, title, extra = '') => `<button type="button" class="dz-tb" data-cmd="${cmd}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${ic(icon)}</button>`;
const sep = '<span class="dz-tb-sep"></span>';

export function toolbarHtml() {
  return `
    <div class="dz-tb-group">
      ${b('undo', 'undo', 'Deshacer (Ctrl+Z)')}${b('redo', 'redo', 'Rehacer (Ctrl+Y)')}${b('print', 'print', 'Imprimir o PDF (Ctrl+P)')}
      <button type="button" class="dz-tb dz-tb-drop zoom" data-drop="zoom" title="Zoom"><span data-val>100%</span>${ic('arrow_drop_down')}</button>
    </div>${sep}
    <div class="dz-tb-group edit-only">
      <button type="button" class="dz-tb dz-tb-drop style" data-drop="style" title="Estilos"><span data-val>Texto normal</span>${ic('arrow_drop_down')}</button>
    </div>${sep}
    <div class="dz-tb-group edit-only">
      <button type="button" class="dz-tb dz-tb-drop font" data-drop="font" title="Fuente"><span data-val>Arial</span>${ic('arrow_drop_down')}</button>
    </div>${sep}
    <div class="dz-tb-group dz-size edit-only">
      ${b('size-down', 'remove', 'Achicar la letra')}
      <input class="dz-size-input" type="text" inputmode="numeric" value="11" aria-label="Tamaño de la letra" title="Tamaño de la letra"/>
      ${b('size-up', 'add', 'Agrandar la letra')}
    </div>${sep}
    <div class="dz-tb-group edit-only">
      ${b('bold', 'format_bold', 'Negrita (Ctrl+B)')}${b('italic', 'format_italic', 'Cursiva (Ctrl+I)')}${b('underline', 'format_underlined', 'Subrayado (Ctrl+U)')}
      <button type="button" class="dz-tb dz-color" data-drop="color" title="Color del texto">${ic('format_color_text')}<i class="bar" data-bar="color"></i></button>
      <button type="button" class="dz-tb dz-color" data-drop="highlight" title="Color de resaltado">${ic('ink_highlighter')}<i class="bar" data-bar="highlight"></i></button>
    </div>${sep}
    <div class="dz-tb-group edit-only">
      ${b('link', 'link', 'Insertar enlace (Ctrl+K)')}${b('comment', 'add_comment', 'Agregar comentario (Ctrl+Alt+M)')}${b('image', 'image', 'Insertar imagen')}
    </div>${sep}
    <div class="dz-tb-group edit-only">
      <button type="button" class="dz-tb dz-tb-drop icon" data-drop="align" title="Alinear">${ic('format_align_left')}${ic('arrow_drop_down', 'small')}</button>
      <button type="button" class="dz-tb dz-tb-drop icon" data-drop="spacing" title="Interlineado">${ic('format_line_spacing')}${ic('arrow_drop_down', 'small')}</button>
      ${b('taskList', 'checklist', 'Lista de tareas (Ctrl+Mayús+9)')}${b('bulletList', 'format_list_bulleted', 'Lista con viñetas (Ctrl+Mayús+8)')}${b('orderedList', 'format_list_numbered', 'Lista numerada (Ctrl+Mayús+7)')}
      ${b('outdent', 'format_indent_decrease', 'Reducir sangría (Mayús+Tab)')}${b('indent', 'format_indent_increase', 'Aumentar sangría (Tab)')}
      ${b('clear', 'format_clear', 'Borrar formato (Ctrl+\\)')}
    </div>
    <span class="dz-tb-fill"></span>
    <div class="dz-tb-group dz-mode" title="Modo"></div>`;
}

const sizeOf = (editor) => {
  const v = editor.getAttributes('textStyle').fontSize;
  if (!v) return DEFAULT_SIZE;
  const n = parseFloat(v);
  return String(v).endsWith('px') ? Math.round(n * 0.75) : n;
};
const fontOf = (editor) => {
  const f = editor.getAttributes('textStyle').fontFamily;
  if (!f) return DEFAULT_FONT;
  const first = f.split(',')[0].replace(/["']/g, '').trim();
  return FONTS.find(([n]) => n.toLowerCase() === first.toLowerCase())?.[0] || first;
};
const styleOf = (editor) => {
  for (let l = 1; l <= 4; l++) if (editor.isActive('heading', { level: l })) return String(l);
  return 'p';
};
const alignOf = (editor) => ALIGNS.find(([a]) => editor.isActive({ textAlign: a }))?.[0] || 'left';

export function setStyle(editor, v) {
  if (v === 'p') editor.chain().focus().setParagraph().run();
  else editor.chain().focus().setHeading({ level: Number(v) }).run();
}
export function setFontSize(editor, pt) {
  const n = Math.max(1, Math.min(400, Math.round(Number(pt) || DEFAULT_SIZE)));
  if (n === DEFAULT_SIZE) editor.chain().focus().unsetFontSize().run();
  else editor.chain().focus().setFontSize(`${n}pt`).run();
}
export function stepFontSize(editor, dir) {
  const cur = sizeOf(editor);
  const next = dir > 0 ? (SIZES.find(s => s > cur) || cur + 10) : ([...SIZES].reverse().find(s => s < cur) || Math.max(1, cur - 1));
  setFontSize(editor, next);
}

export function bindToolbar(bar, ctx) {
  const { editor } = ctx;
  const run = (cmd) => {
    const c = editor.chain().focus();
    switch (cmd) {
      case 'undo': c.undo().run(); break;
      case 'redo': c.redo().run(); break;
      case 'print': ctx.print(); break;
      case 'bold': c.toggleBold().run(); break;
      case 'italic': c.toggleItalic().run(); break;
      case 'underline': c.toggleUnderline().run(); break;
      case 'link': editLink(editor); break;
      case 'comment': ctx.addComment(); break;
      case 'image': pickImage(ctx); break;
      case 'taskList': c.toggleTaskList().run(); break;
      case 'bulletList': c.toggleBulletList().run(); break;
      case 'orderedList': c.toggleOrderedList().run(); break;
      case 'indent': ctx.indent(1); break;
      case 'outdent': ctx.indent(-1); break;
      case 'clear': ctx.clearFormatting(); break;
      case 'size-up': stepFontSize(editor, 1); break;
      case 'size-down': stepFontSize(editor, -1); break;
      default:
    }
  };

  const drops = {
    zoom: () => ZOOMS.map(z => ({ label: `${z}%`, checked: ctx.zoom() === z, action: () => ctx.setZoom(z) })),
    style: () => STYLES.map(([v, label, style]) => ({ label, style, checked: styleOf(editor) === v, action: () => setStyle(editor, v) })),
    font: () => FONTS.map(([n, css]) => ({ label: n, style: `font-family:${css}`, checked: fontOf(editor) === n, action: () => (n === DEFAULT_FONT ? editor.chain().focus().unsetFontFamily().run() : editor.chain().focus().setFontFamily(css).run()) })),
    align: () => ALIGNS.map(([a, icon, label]) => ({ label, icon, checked: alignOf(editor) === a, action: () => editor.chain().focus().setTextAlign(a).run() })),
    spacing: () => {
      const cur = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').lineHeight || '1.15';
      return [
        ...LINE_HEIGHTS.map(([v, label]) => ({ label, checked: cur === v, action: () => editor.chain().focus().setParagraphLineHeight(v === '1.15' ? null : v).run() })),
      ];
    },
    color: () => [paletteItem({ current: editor.getAttributes('textStyle').color, resetLabel: 'Color automático', onPick: (c) => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run()) })],
    highlight: () => [paletteItem({ current: editor.getAttributes('highlight').color, resetLabel: 'Sin resaltado', onPick: (c) => (c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run()) })],
  };

  bar.addEventListener('mousedown', (ev) => {
    // Que tocar un botón no le saque la selección al texto
    if (ev.target.closest('button')) ev.preventDefault();
  });
  bar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.drop) {
      if (menuIsOpenFor(btn)) { closeMenus(); return; }
      const narrow = ['color', 'highlight'].includes(btn.dataset.drop);
      openMenu(btn, drops[btn.dataset.drop](), { className: narrow ? 'palette' : btn.dataset.drop === 'font' ? 'fonts' : '' });
      return;
    }
    if (btn.dataset.cmd) run(btn.dataset.cmd);
  });

  const sizeInput = bar.querySelector('.dz-size-input');
  sizeInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); setFontSize(editor, sizeInput.value); }
    if (ev.key === 'Escape') { sizeInput.value = sizeOf(editor); editor.commands.focus(); }
  });
  sizeInput.addEventListener('focus', () => sizeInput.select());
  sizeInput.addEventListener('change', () => setFontSize(editor, sizeInput.value));

  // Estado de los botones según dónde está el cursor
  const sync = () => {
    const set = (cmd, on) => bar.querySelector(`[data-cmd="${cmd}"]`)?.classList.toggle('on', !!on);
    set('bold', editor.isActive('bold'));
    set('italic', editor.isActive('italic'));
    set('underline', editor.isActive('underline'));
    set('link', editor.isActive('link'));
    set('taskList', editor.isActive('taskList'));
    set('bulletList', editor.isActive('bulletList'));
    set('orderedList', editor.isActive('orderedList'));
    bar.querySelector('[data-cmd="undo"]').disabled = !editor.can().undo();
    bar.querySelector('[data-cmd="redo"]').disabled = !editor.can().redo();
    bar.querySelector('[data-drop="style"] [data-val]').textContent = STYLES.find(s => s[0] === styleOf(editor))[1];
    bar.querySelector('[data-drop="font"] [data-val]').textContent = fontOf(editor);
    if (document.activeElement !== sizeInput) sizeInput.value = sizeOf(editor);
    bar.querySelector('[data-drop="zoom"] [data-val]').textContent = `${ctx.zoom()}%`;
    bar.querySelector('[data-drop="align"] .msi').textContent = ALIGNS.find(a => a[0] === alignOf(editor))[1];
    bar.querySelector('[data-bar="color"]').style.background = editor.getAttributes('textStyle').color || '#000';
    bar.querySelector('[data-bar="highlight"]').style.background = editor.getAttributes('highlight').color || 'transparent';
  };
  editor.on('selectionUpdate', sync);
  editor.on('transaction', sync);
  sync();
  return { sync };
}
