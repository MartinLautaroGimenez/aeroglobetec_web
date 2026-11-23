// Acciones del editor que abren diálogos o trabajan con archivos: links, imágenes, ecuaciones,
// tablas, caracteres especiales, contador de palabras, descargas e impresión.
import { dialog, toast, ic } from './menu.js';
import katex from 'katex';
import { escapeHtml as esc, resolveImageSrc } from './custom.js';

// ---------- Links ----------
export async function editLink(editor) {
  const prev = editor.getAttributes('link').href || '';
  const { from, to, empty } = editor.state.selection;
  const selected = editor.state.doc.textBetween(from, to, ' ');
  const data = await dialog({
    title: prev ? 'Editar enlace' : 'Insertar enlace',
    submit: 'Aplicar',
    body: `
      ${empty && !prev ? `<label class="dz-field"><span>Texto</span><input name="text" maxlength="300" placeholder="Texto que se muestra"/></label>` : ''}
      <label class="dz-field"><span>Enlace</span><input name="href" value="${esc(prev)}" placeholder="https://… o un mail" autocomplete="off" ${selected ? '' : ''}/></label>`,
  });
  if (!data) { editor.commands.focus(); return; }
  let href = (data.href || '').trim();
  if (!href) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) href = 'mailto:' + href;
  else if (!/^(https?:|mailto:|tel:|#)/i.test(href)) href = 'https://' + href;
  if (!/^(https?:|mailto:|tel:|#)/i.test(href)) { toast('Ese enlace no es válido', 'error'); return; }
  if (data.text) {
    editor.chain().focus().insertContent({ type: 'text', text: data.text, marks: [{ type: 'link', attrs: { href } }] }).run();
  } else if (empty && !prev) {
    editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
  } else {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

// ---------- Imágenes ----------
// Achica las fotos grandes antes de subirlas (máximo 2000 px de lado, en JPEG)
export async function prepareImage(file, maxSide = 2000) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 2.5 * 1024 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const keepPng = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
    const blob = await new Promise(r => c.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.86));
    return new File([blob], file.name.replace(/\.\w+$/, keepPng ? '.png' : '.jpg'), { type: blob.type });
  } catch { return file; }
}

export async function insertImageFiles(ctx, files, pos) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return false;
  toast(imgs.length > 1 ? 'Subiendo imágenes…' : 'Subiendo imagen…');
  for (const f of imgs) {
    try {
      const src = await ctx.uploadImage(await prepareImage(f));
      const chain = ctx.editor.chain().focus();
      (pos != null ? chain.insertContentAt(pos, { type: 'image', attrs: { src, alt: f.name } }) : chain.setImage({ src, alt: f.name })).run();
    } catch (e) { toast('No se pudo subir la imagen: ' + (e.message || e), 'error'); }
  }
  return true;
}

export function pickImage(ctx) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => insertImageFiles(ctx, input.files);
  input.click();
}

export async function imageFromUrl(ctx) {
  const data = await dialog({ title: 'Insertar imagen desde un enlace', submit: 'Insertar', body: '<label class="dz-field"><span>Enlace de la imagen</span><input name="url" placeholder="https://…" autocomplete="off"/></label><p class="dz-hint">La imagen tiene que estar publicada en internet.</p>' });
  const url = data?.url?.trim();
  if (!url) return;
  if (!/^https:\/\//i.test(url)) { toast('Usá un enlace que empiece con https://', 'error'); return; }
  ctx.editor.chain().focus().setImage({ src: url }).run();
}

// ---------- Ecuaciones (LaTeX) ----------
export async function editMath(editor, { node, pos, kind = 'inline' } = {}) {
  const latex = node?.attrs?.latex || '';
  const data = await dialog({
    title: node ? 'Editar ecuación' : 'Insertar ecuación',
    submit: node ? 'Guardar' : 'Insertar',
    wide: true,
    body: `
      <label class="dz-field"><span>Ecuación en LaTeX</span><textarea name="latex" rows="3" spellcheck="false" placeholder="Ej.: F = m \\cdot a   ·   \\frac{1}{2} m v^2   ·   \\sqrt{x^2+y^2}">${esc(latex)}</textarea></label>
      <div class="dz-math-preview" aria-live="polite"></div>
      ${node ? '' : `<label class="dz-check"><input type="checkbox" name="block" ${kind === 'block' ? 'checked' : ''}/> En su propio renglón, centrada</label>`}
      <p class="dz-hint">Algunos ejemplos: <code>x^2</code> potencia · <code>x_1</code> subíndice · <code>\\frac{a}{b}</code> fracción · <code>\\alpha \\beta \\Omega</code> letras griegas · <code>\\pm \\times \\leq</code> símbolos.</p>`,
    onOpen: (dlg) => {
      const ta = dlg.querySelector('textarea');
      const prev = dlg.querySelector('.dz-math-preview');
      const draw = () => { try { prev.innerHTML = ta.value.trim() ? katex.renderToString(ta.value, { throwOnError: false, displayMode: true }) : '<span class="dz-hint">Vista previa</span>'; } catch { prev.textContent = 'Revisá la ecuación'; } };
      ta.addEventListener('input', draw);
      draw();
    },
  });
  if (!data) { editor.commands.focus(); return; }
  const value = data.latex.trim();
  if (node) {
    if (!value) { editor.chain().focus().setNodeSelection(pos).deleteSelection().run(); return; }
    if (kind === 'block') editor.chain().focus().updateBlockMath({ latex: value, pos }).run();
    else editor.chain().focus().updateInlineMath({ latex: value, pos }).run();
    return;
  }
  if (!value) return;
  if (data.block) editor.chain().focus().insertBlockMath({ latex: value }).run();
  else editor.chain().focus().insertInlineMath({ latex: value }).run();
}

// ---------- Tabla: cuadrícula para elegir filas y columnas ----------
export function tableGridItem(editor) {
  const COLS = 10, ROWS = 8;
  return {
    html: `<div class="dz-grid">${Array.from({ length: ROWS * COLS }, (_, i) => `<i data-r="${Math.floor(i / COLS) + 1}" data-c="${(i % COLS) + 1}"></i>`).join('')}</div><div class="dz-grid-label">1 × 1</div>`,
    mount: (box, close) => {
      const label = box.querySelector('.dz-grid-label');
      const cells = [...box.querySelectorAll('i')];
      const mark = (r, c) => { cells.forEach(x => x.classList.toggle('on', x.dataset.r <= r && x.dataset.c <= c)); label.textContent = `${c} × ${r}`; };
      box.addEventListener('mouseover', (ev) => { const t = ev.target.closest('i'); if (t) mark(+t.dataset.r, +t.dataset.c); });
      box.addEventListener('click', (ev) => {
        const t = ev.target.closest('i');
        if (!t) return;
        close();
        editor.chain().focus().insertTable({ rows: +t.dataset.r, cols: +t.dataset.c, withHeaderRow: +t.dataset.r > 1 }).run();
      });
    },
  };
}

// ---------- Caracteres especiales ----------
const SPECIAL = '° ± × ÷ ≈ ≠ ≤ ≥ ∞ √ ∑ ∫ ∂ ∆ π µ Ω α β γ δ θ λ σ φ ω → ← ↑ ↓ ↔ ⇒ • · … – — « » “ ” ¡ ¿ € $ © ® ™ ½ ¼ ¾ ² ³ ✓ ✗ ★ ☐ ☑ ⚠'.split(' ');
export function specialCharsItem(editor) {
  return {
    html: `<div class="dz-chars">${SPECIAL.map(c => `<button type="button" title="${c}">${c}</button>`).join('')}</div>`,
    mount: (box, close) => box.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      close();
      editor.chain().focus().insertContent(b.textContent).run();
    }),
  };
}

// ---------- Paleta de colores ----------
const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
];
export function paletteItem({ current, onPick, resetLabel }) {
  return {
    html: `<button type="button" class="dz-pal-reset" data-reset>${ic('format_color_reset')} ${esc(resetLabel)}</button>
      <div class="dz-palette">${PALETTE.map(c => `<button type="button" style="--c:${c}" data-c="${c}" title="${c}" class="${current && current.toLowerCase() === c ? 'on' : ''}"></button>`).join('')}</div>
      <label class="dz-pal-custom">${ic('colorize')} Personalizado <input type="color" value="${/^#[0-9a-f]{6}$/i.test(current || '') ? current : '#2b62a6'}"/></label>`,
    mount: (box, close) => {
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        close();
        onPick(b.dataset.reset !== undefined ? null : b.dataset.c);
      });
      box.querySelector('input').addEventListener('change', (ev) => { close(); onPick(ev.target.value); });
    },
  };
}

// ---------- Contador de palabras ----------
export function wordCount(editor) {
  const cc = editor.storage.characterCount;
  const { from, to, empty } = editor.state.selection;
  const selText = empty ? '' : editor.state.doc.textBetween(from, to, ' ', ' ');
  const words = cc.words();
  const chars = cc.characters();
  const noSpaces = editor.state.doc.textContent.replace(/\s/g, '').length;
  const pages = Math.max(1, Math.ceil(words / 450));
  const row = (l, v) => `<tr><td>${l}</td><td>${v.toLocaleString('es-AR')}</td></tr>`;
  dialog({
    title: 'Contador de palabras',
    submit: '', cancel: 'Cerrar',
    body: `<table class="dz-count">
      ${selText ? row('Palabras seleccionadas', selText.trim().split(/\s+/).filter(Boolean).length) : ''}
      ${row('Páginas (aprox.)', pages)}${row('Palabras', words)}${row('Caracteres', chars)}${row('Caracteres sin espacios', noSpaces)}
    </table>`,
  });
}

// ---------- Descargas ----------
export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const safeFile = (name) => (name || 'Documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'Documento';

export async function downloadDocx(ctx) {
  toast('Preparando el archivo de Word…');
  try {
    const { exportDocx } = await import('./docx-export.js');
    const blob = await exportDocx(ctx.editor.getJSON(), { title: ctx.title() });
    download(blob, `${safeFile(ctx.title())}.docx`);
  } catch (e) { console.error(e); toast('No se pudo generar el .docx: ' + (e.message || e), 'error'); }
}

export function downloadText(ctx) {
  download(new Blob([ctx.editor.getText({ blockSeparator: '\n\n' })], { type: 'text/plain;charset=utf-8' }), `${safeFile(ctx.title())}.txt`);
}

export async function downloadHtml(ctx) {
  const holder = document.createElement('div');
  holder.innerHTML = ctx.editor.getHTML();
  // Las imágenes privadas se incrustan para que el archivo funcione solo
  for (const img of holder.querySelectorAll('img[data-src^="storage:"]')) {
    try {
      const blob = await (await fetch(await resolveImageSrc(img.dataset.src))).blob();
      img.src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      img.removeAttribute('data-src');
    } catch { /* queda la imagen sin incrustar */ }
  }
  holder.querySelectorAll('[data-comment-id]').forEach(s => s.replaceWith(...s.childNodes));
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(ctx.title())}</title>
<style>body{font:11pt/1.5 Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#202124}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c7ced9;padding:6px 8px;vertical-align:top}th{background:#f1f3f4}blockquote{border-left:3px solid #c7ced9;margin-left:0;padding-left:16px;color:#555}[data-page-break]{page-break-after:always;height:0}</style>
</head><body>${holder.innerHTML}</body></html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeFile(ctx.title())}.html`);
}

export function printDocument(ctx) {
  const prev = document.title;
  document.title = ctx.title();
  document.body.classList.add('dz-printing');
  const done = () => { document.body.classList.remove('dz-printing'); document.title = prev; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

export const SHORTCUTS = [
  ['Negrita', 'Ctrl + B'], ['Cursiva', 'Ctrl + I'], ['Subrayado', 'Ctrl + U'], ['Tachado', 'Ctrl + Mayús + S'],
  ['Insertar enlace', 'Ctrl + K'], ['Comentario', 'Ctrl + Alt + M'], ['Buscar', 'Ctrl + F'], ['Buscar y reemplazar', 'Ctrl + H'],
  ['Deshacer', 'Ctrl + Z'], ['Rehacer', 'Ctrl + Y'], ['Texto normal', 'Ctrl + Alt + 0'], ['Título 1 a 4', 'Ctrl + Alt + 1 … 4'],
  ['Lista numerada', 'Ctrl + Mayús + 7'], ['Lista con viñetas', 'Ctrl + Mayús + 8'], ['Lista de tareas', 'Ctrl + Mayús + 9'],
  ['Alinear a la izquierda / centro / derecha', 'Ctrl + Mayús + L / E / R'], ['Justificar', 'Ctrl + Mayús + J'],
  ['Aumentar / reducir sangría', 'Tab / Mayús + Tab'], ['Salto de página', 'Ctrl + Enter'], ['Borrar formato', 'Ctrl + \\'],
  ['Contador de palabras', 'Ctrl + Mayús + C'], ['Imprimir o guardar como PDF', 'Ctrl + P'],
];

export function showShortcuts() {
  dialog({
    title: 'Atajos de teclado', submit: '', cancel: 'Cerrar', wide: true,
    body: `<p class="dz-hint">En Mac usá ⌘ en lugar de Ctrl.</p><table class="dz-count keys">${SHORTCUTS.map(([a, k]) => `<tr><td>${esc(a)}</td><td><kbd>${esc(k)}</kbd></td></tr>`).join('')}</table>`,
  });
}
