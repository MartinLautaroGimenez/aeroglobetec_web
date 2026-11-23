// Barra de menús: Archivo, Editar, Ver, Insertar, Formato, Herramientas y Ayuda.
import { openMenu, menuIsOpenFor, closeMenus, toast } from './menu.js';
import {
  editLink, pickImage, imageFromUrl, editMath, tableGridItem, specialCharsItem, wordCount,
  downloadDocx, downloadText, downloadHtml, showShortcuts,
} from './actions.js';
import { STYLES, LINE_HEIGHTS, setStyle } from './toolbar.js';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function menus(ctx) {
  const { editor } = ctx;
  const can = ctx.canEdit;
  const ro = !can;
  const c = () => editor.chain().focus();
  const inTable = () => editor.isActive('table');

  return {
    Archivo: () => [
      { label: 'Nuevo documento', icon: 'note_add', action: ctx.newDocument, disabled: !ctx.newDocument },
      { label: 'Hacer una copia', icon: 'content_copy', action: ctx.makeCopy, disabled: !ctx.makeCopy },
      '-',
      { label: 'Compartir y permisos', icon: 'group', action: ctx.share },
      { label: 'Cambiar el nombre', icon: 'drive_file_rename_outline', action: ctx.focusTitle, disabled: ro },
      { label: 'Mover a una carpeta', icon: 'folder', action: ctx.moveFolder, disabled: ro },
      '-',
      { label: 'Importar un Word (.docx)', icon: 'upload_file', action: ctx.importDocx, disabled: ro },
      {
        label: 'Descargar', icon: 'download', sub: [
          { label: 'Microsoft Word (.docx)', action: () => downloadDocx(ctx) },
          { label: 'Documento PDF (.pdf)', action: () => { toast('Elegí "Guardar como PDF" en la ventana de impresión'); ctx.print(); } },
          { label: 'Página web (.html)', action: () => downloadHtml(ctx) },
          { label: 'Texto sin formato (.txt)', action: () => downloadText(ctx) },
        ],
      },
      '-',
      {
        label: 'Historial de versiones', icon: 'history', sub: [
          { label: 'Ver el historial de versiones', action: () => ctx.openPanel('history') },
          { label: 'Guardar una versión con nombre', action: ctx.saveVersion, disabled: ro },
        ],
      },
      { label: 'Detalles del documento', icon: 'info', action: ctx.details },
      '-',
      { label: 'Imprimir', icon: 'print', shortcut: `${MOD}P`, action: ctx.print },
    ],
    Editar: () => [
      { label: 'Deshacer', icon: 'undo', shortcut: `${MOD}Z`, disabled: ro || !editor.can().undo(), action: () => c().undo().run() },
      { label: 'Rehacer', icon: 'redo', shortcut: `${MOD}Y`, disabled: ro || !editor.can().redo(), action: () => c().redo().run() },
      '-',
      { label: 'Cortar', icon: 'content_cut', shortcut: `${MOD}X`, disabled: ro, action: () => { editor.commands.focus(); if (!document.execCommand('cut')) toast(`Usá ${MOD}X para cortar`); } },
      { label: 'Copiar', icon: 'content_copy', shortcut: `${MOD}C`, action: () => { editor.commands.focus(); if (!document.execCommand('copy')) toast(`Usá ${MOD}C para copiar`); } },
      { label: 'Pegar', icon: 'content_paste', shortcut: `${MOD}V`, disabled: ro, action: ctx.paste },
      '-',
      { label: 'Seleccionar todo', icon: 'select_all', shortcut: `${MOD}A`, action: () => c().selectAll().run() },
      { label: 'Borrar', icon: 'delete', disabled: ro, action: () => c().deleteSelection().run() },
      '-',
      { label: 'Buscar y reemplazar', icon: 'find_replace', shortcut: `${MOD}H`, action: () => ctx.openFind(true) },
    ],
    Ver: () => [
      { label: 'Mostrar el esquema', icon: 'notes', checked: ctx.isOpen('outline'), action: () => ctx.toggleOutline() },
      { label: 'Mostrar la regla', icon: 'straighten', checked: ctx.ruler(), action: () => ctx.toggleRuler() },
      { label: 'Ver los comentarios', icon: 'comment', checked: ctx.isOpen('comments'), action: () => ctx.openPanel('comments', true) },
      '-',
      { label: 'Pantalla completa', icon: 'fullscreen', action: ctx.fullscreen },
    ],
    Insertar: () => [
      { label: 'Imagen', icon: 'image', disabled: ro, sub: [{ label: 'Subir desde la compu o el celu', icon: 'upload', action: () => pickImage(ctx) }, { label: 'Desde un enlace', icon: 'link', action: () => imageFromUrl(ctx) }] },
      { label: 'Tabla', icon: 'table', disabled: ro, sub: () => [tableGridItem(editor)] },
      { label: 'Ecuación', icon: 'functions', disabled: ro, action: () => editMath(editor) },
      '-',
      { label: 'Enlace', icon: 'link', shortcut: `${MOD}K`, disabled: ro, action: () => editLink(editor) },
      { label: 'Comentario', icon: 'add_comment', shortcut: `${MOD}Alt+M`, disabled: ro, action: ctx.addComment },
      '-',
      { label: 'Línea horizontal', icon: 'horizontal_rule', disabled: ro, action: () => c().setHorizontalRule().run() },
      { label: 'Salto de página', icon: 'insert_page_break', shortcut: `${MOD}Enter`, disabled: ro, action: () => c().setPageBreak().run() },
      { label: 'Índice', icon: 'toc', disabled: ro, action: () => c().insertTableOfContents().run() },
      { label: 'Lista de tareas', icon: 'checklist', disabled: ro, action: () => c().toggleTaskList().run() },
      { label: 'Cita', icon: 'format_quote', disabled: ro, action: () => c().toggleBlockquote().run() },
      { label: 'Bloque de código', icon: 'code', disabled: ro, action: () => c().toggleCodeBlock().run() },
      '-',
      { label: 'Fecha de hoy', icon: 'calendar_today', disabled: ro, action: () => c().insertContent(new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })).run() },
      { label: 'Caracteres especiales', icon: 'special_character', disabled: ro, sub: () => [specialCharsItem(editor)] },
    ],
    Formato: () => [
      {
        label: 'Texto', icon: 'format_bold', disabled: ro, sub: [
          { label: 'Negrita', icon: 'format_bold', shortcut: `${MOD}B`, checked: editor.isActive('bold'), action: () => c().toggleBold().run() },
          { label: 'Cursiva', icon: 'format_italic', shortcut: `${MOD}I`, checked: editor.isActive('italic'), action: () => c().toggleItalic().run() },
          { label: 'Subrayado', icon: 'format_underlined', shortcut: `${MOD}U`, checked: editor.isActive('underline'), action: () => c().toggleUnderline().run() },
          { label: 'Tachado', icon: 'strikethrough_s', shortcut: `${MOD}Mayús+S`, checked: editor.isActive('strike'), action: () => c().toggleStrike().run() },
          '-',
          { label: 'Superíndice', icon: 'superscript', shortcut: `${MOD}.`, checked: editor.isActive('superscript'), action: () => c().toggleSuperscript().run() },
          { label: 'Subíndice', icon: 'subscript', shortcut: `${MOD},`, checked: editor.isActive('subscript'), action: () => c().toggleSubscript().run() },
          { label: 'Código', icon: 'code', shortcut: `${MOD}E`, checked: editor.isActive('code'), action: () => c().toggleCode().run() },
          '-',
          { label: 'MAYÚSCULAS', action: () => ctx.changeCase('upper') },
          { label: 'minúsculas', action: () => ctx.changeCase('lower') },
          { label: 'Tipo Título', action: () => ctx.changeCase('title') },
        ],
      },
      {
        label: 'Estilos de párrafo', icon: 'title', disabled: ro, sub: [
          ...STYLES.map(([v, label, style]) => ({ label, style, shortcut: `${MOD}Alt+${v === 'p' ? 0 : v}`, action: () => setStyle(editor, v) })),
          '-',
          { label: 'Cita', icon: 'format_quote', checked: editor.isActive('blockquote'), action: () => c().toggleBlockquote().run() },
        ],
      },
      {
        label: 'Alinear y sangría', icon: 'format_align_left', disabled: ro, sub: [
          { label: 'Izquierda', icon: 'format_align_left', shortcut: `${MOD}Mayús+L`, action: () => c().setTextAlign('left').run() },
          { label: 'Centro', icon: 'format_align_center', shortcut: `${MOD}Mayús+E`, action: () => c().setTextAlign('center').run() },
          { label: 'Derecha', icon: 'format_align_right', shortcut: `${MOD}Mayús+R`, action: () => c().setTextAlign('right').run() },
          { label: 'Justificado', icon: 'format_align_justify', shortcut: `${MOD}Mayús+J`, action: () => c().setTextAlign('justify').run() },
          '-',
          { label: 'Aumentar sangría', icon: 'format_indent_increase', shortcut: 'Tab', action: () => ctx.indent(1) },
          { label: 'Reducir sangría', icon: 'format_indent_decrease', shortcut: 'Mayús+Tab', action: () => ctx.indent(-1) },
        ],
      },
      {
        label: 'Interlineado', icon: 'format_line_spacing', disabled: ro, sub: LINE_HEIGHTS.map(([v, label]) => ({ label, action: () => c().setParagraphLineHeight(v === '1.15' ? null : v).run() })),
      },
      {
        label: 'Listas', icon: 'format_list_bulleted', disabled: ro, sub: [
          { label: 'Con viñetas', icon: 'format_list_bulleted', checked: editor.isActive('bulletList'), action: () => c().toggleBulletList().run() },
          { label: 'Numerada', icon: 'format_list_numbered', checked: editor.isActive('orderedList'), action: () => c().toggleOrderedList().run() },
          { label: 'De tareas', icon: 'checklist', checked: editor.isActive('taskList'), action: () => c().toggleTaskList().run() },
        ],
      },
      {
        label: 'Tabla', icon: 'table', disabled: ro || !inTable(), sub: [
          { label: 'Insertar fila arriba', action: () => c().addRowBefore().run() },
          { label: 'Insertar fila abajo', action: () => c().addRowAfter().run() },
          { label: 'Insertar columna a la izquierda', action: () => c().addColumnBefore().run() },
          { label: 'Insertar columna a la derecha', action: () => c().addColumnAfter().run() },
          '-',
          { label: 'Borrar fila', action: () => c().deleteRow().run() },
          { label: 'Borrar columna', action: () => c().deleteColumn().run() },
          { label: 'Borrar tabla', icon: 'delete', action: () => c().deleteTable().run() },
          '-',
          { label: 'Combinar celdas', disabled: !editor.can().mergeCells(), action: () => c().mergeCells().run() },
          { label: 'Separar celdas', disabled: !editor.can().splitCell(), action: () => c().splitCell().run() },
          { label: 'Fila de encabezado', checked: editor.isActive('tableHeader'), action: () => c().toggleHeaderRow().run() },
        ],
      },
      '-',
      { label: 'Borrar formato', icon: 'format_clear', shortcut: `${MOD}\\`, disabled: ro, action: ctx.clearFormatting },
    ],
    Herramientas: () => [
      { label: 'Contador de palabras', icon: 'text_fields', shortcut: `${MOD}Mayús+C`, action: () => wordCount(editor) },
      { label: 'Revisar ortografía', icon: 'spellcheck', checked: ctx.spellcheck(), action: ctx.toggleSpellcheck },
    ],
    Ayuda: () => [
      { label: 'Atajos de teclado', icon: 'keyboard', shortcut: `${MOD}/`, action: showShortcuts },
      { label: 'Cómo funciona', icon: 'help', action: ctx.help },
    ],
  };
}

export function bindMenubar(bar, ctx) {
  const defs = menus(ctx);
  bar.innerHTML = Object.keys(defs).map(n => `<button type="button" class="dz-mb" data-menu="${n}">${n}</button>`).join('');
  const open = (btn) => openMenu(btn, defs[btn.dataset.menu]);
  bar.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
  bar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-menu]');
    if (!btn) return;
    if (menuIsOpenFor(btn)) closeMenus(); else open(btn);
  });
  // Con un menú abierto, pasar el mouse por otro lo abre (como en Docs)
  bar.addEventListener('mouseover', (ev) => {
    const btn = ev.target.closest('[data-menu]');
    if (!btn || menuIsOpenFor(btn)) return;
    if (bar.querySelector('.dz-mb.open')) open(btn);
  });
}
