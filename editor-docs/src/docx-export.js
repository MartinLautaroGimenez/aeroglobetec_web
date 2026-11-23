// Exporta el documento (JSON del editor) a un archivo de Word (.docx) con la librería "docx".
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, LevelFormat, PageBreak, BorderStyle, ShadingType, Math as DocxMath, MathRun,
} from 'docx';
import { INDENT_STEP, resolveImageSrc } from './custom.js';

const PX_TO_TWIP = 15;          // 1 px (96 dpi) = 15 twips
const PAGE_WIDTH_PX = 794 - 2 * 96;   // A4 menos márgenes de 2,54 cm
const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

const hex = (c) => {
  if (!c) return undefined;
  const s = String(c).trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return m[1].toUpperCase();
  m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) return [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
};
// Tamaño en medios puntos (docx): "11pt" -> 22, "16px" -> 24
const halfPoints = (v) => {
  if (!v) return undefined;
  const n = parseFloat(v);
  if (!n) return undefined;
  return Math.round((String(v).endsWith('px') ? n * 0.75 : n) * 2);
};
const firstFont = (f) => (f ? String(f).split(',')[0].replace(/["']/g, '').trim() : undefined);

export async function exportDocx(json, { title = 'Documento' } = {}) {
  const ctx = { orderedInstance: 0, headings: collectHeadings(json) };
  const children = await blocks(json.content || [], ctx, {});
  const doc = new Document({
    title,
    creator: 'AeroGlobETec',
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 40, bold: false, color: '000000' }, paragraph: { spacing: { before: 400, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, color: '000000' }, paragraph: { spacing: { before: 360, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, color: '434343' }, paragraph: { spacing: { before: 320, after: 80 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, color: '666666' }, paragraph: { spacing: { before: 280, after: 80 } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'viñetas', levels: [0, 1, 2, 3, 4, 5].map(level => ({ level, format: LevelFormat.BULLET, text: ['●', '○', '■'][level % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) },
        { reference: 'numerada', levels: [0, 1, 2, 3, 4, 5].map(level => ({ level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3], text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: children.length ? children : [new Paragraph('')],
    }],
  });
  return Packer.toBlob(doc);
}

async function blocks(nodes, ctx, opts) {
  const out = [];
  for (const node of nodes) out.push(...await block(node, ctx, opts));
  return out;
}

function paragraphProps(node, opts) {
  const a = node.attrs || {};
  const p = {};
  if (a.textAlign && ALIGN[a.textAlign]) p.alignment = ALIGN[a.textAlign];
  if (a.lineHeight) p.spacing = { line: Math.round(parseFloat(a.lineHeight) * 240) };
  const left = (a.indent || 0) * INDENT_STEP * PX_TO_TWIP + (opts.quote ? 600 : 0);
  const task = opts.taskIndent ? opts.taskIndent * 360 : 0;
  if ((left || task) && !opts.list) p.indent = { left: left + task };
  if (opts.quote) p.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'C7CED9', space: 12 } };
  if (opts.list) p.numbering = opts.list;
  return p;
}

async function block(node, ctx, opts) {
  switch (node.type) {
    case 'paragraph':
      return [new Paragraph({ ...paragraphProps(node, opts), children: await inline(node.content || [], opts) })];
    case 'heading':
      return [new Paragraph({ ...paragraphProps(node, opts), heading: HEADINGS[node.attrs?.level] || HeadingLevel.HEADING_1, children: await inline(node.content || [], opts) })];
    case 'blockquote':
      return blocks(node.content || [], ctx, { ...opts, quote: true });
    case 'codeBlock':
      return (node.content?.[0]?.text || '').split('\n').map(line => new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: 'F1F3F4', color: 'auto' }, spacing: { after: 0 },
        children: [new TextRun({ text: line, font: 'Courier New', size: 20 })],
      }));
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const level = opts.listLevel ?? 0;
      const instance = node.type === 'orderedList' && level === 0 ? ++ctx.orderedInstance : opts.list?.instance;
      const out = [];
      for (const item of node.content || []) {
        const checked = item.type === 'taskItem' ? (item.attrs?.checked ? '☑ ' : '☐ ') : '';
        let first = true;
        for (const child of item.content || []) {
          if (['bulletList', 'orderedList', 'taskList'].includes(child.type)) {
            out.push(...await block(child, ctx, { ...opts, listLevel: level + 1, list: opts.list }));
            continue;
          }
          const list = node.type === 'taskList'
            ? null
            : { reference: node.type === 'orderedList' ? 'numerada' : 'viñetas', level, ...(node.type === 'orderedList' ? { instance: instance ?? 1 } : {}) };
          const paras = await block(child, ctx, { ...opts, list: list || undefined, prefix: first ? checked : '', taskIndent: node.type === 'taskList' ? level + 1 : 0 });
          out.push(...paras);
          first = false;
        }
      }
      return out;
    }
    case 'horizontalRule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFC5CE', space: 1 } }, children: [] })];
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image': {
      const run = await imageRun(node.attrs || {});
      return run ? [new Paragraph({ alignment: ALIGN[node.attrs?.align] || AlignmentType.CENTER, children: [run] })] : [];
    }
    case 'blockMath':
      return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new DocxMath({ children: [new MathRun(node.attrs?.latex || '')] })] })];
    case 'table':
      return [await table(node, ctx, opts)];
    case 'tableOfContents':
      return [new Paragraph({ children: [new TextRun({ text: 'Índice', bold: true, size: 28 })] }), ...tocParagraphs(ctx)];
    default:
      return node.content ? blocks(node.content, ctx, opts) : [];
  }
}

// El índice se arma como texto: Word lo muestra igual sin tener que actualizar campos
function tocParagraphs(ctx) {
  return (ctx.headings || []).map(h => new Paragraph({ indent: { left: (h.level - 1) * 360 }, children: [new TextRun(h.text)] }));
}

async function table(node, ctx, opts) {
  const rows = [];
  for (const row of node.content || []) {
    const cells = [];
    for (const cell of row.content || []) {
      const a = cell.attrs || {};
      const width = a.colwidth?.[0];
      cells.push(new TableCell({
        children: (await blocks(cell.content || [], ctx, opts)).filter(Boolean),
        columnSpan: a.colspan > 1 ? a.colspan : undefined,
        rowSpan: a.rowspan > 1 ? a.rowspan : undefined,
        width: width ? { size: width * PX_TO_TWIP, type: WidthType.DXA } : undefined,
        shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'F1F3F4', color: 'auto' } : undefined,
      }));
    }
    rows.push(new TableRow({ children: cells, tableHeader: row.content?.every(c => c.type === 'tableHeader') }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function inline(nodes, opts) {
  const out = [];
  if (opts.prefix) out.push(new TextRun(opts.prefix));
  for (const n of nodes) {
    if (n.type === 'text') {
      const marks = n.marks || [];
      const link = marks.find(m => m.type === 'link');
      const run = new TextRun(runProps(n.text, marks, !!link));
      out.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
    } else if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
    } else if (n.type === 'inlineMath') {
      out.push(new DocxMath({ children: [new MathRun(n.attrs?.latex || '')] }));
    } else if (n.type === 'image') {
      const run = await imageRun(n.attrs || {});
      if (run) out.push(run);
    }
  }
  return out;
}

function runProps(text, marks, isLink) {
  const p = { text };
  for (const m of marks) {
    const a = m.attrs || {};
    if (m.type === 'bold') p.bold = true;
    else if (m.type === 'italic') p.italics = true;
    else if (m.type === 'underline') p.underline = {};
    else if (m.type === 'strike') p.strike = true;
    else if (m.type === 'superscript') p.superScript = true;
    else if (m.type === 'subscript') p.subScript = true;
    else if (m.type === 'code') { p.font = 'Courier New'; p.shading = { type: ShadingType.CLEAR, fill: 'F1F3F4', color: 'auto' }; }
    else if (m.type === 'highlight') p.shading = { type: ShadingType.CLEAR, fill: hex(a.color) || 'FFF59D', color: 'auto' };
    else if (m.type === 'textStyle') {
      if (hex(a.color)) p.color = hex(a.color);
      if (a.fontFamily) p.font = firstFont(a.fontFamily);
      if (halfPoints(a.fontSize)) p.size = halfPoints(a.fontSize);
    }
  }
  if (isLink) { p.color = p.color || '1155CC'; p.underline = p.underline || {}; }
  return p;
}

async function imageRun(attrs) {
  try {
    const url = await resolveImageSrc(attrs.src);
    if (!url) return null;
    const blob = await (await fetch(url)).blob();
    // Word acepta png, jpg, gif y bmp: el resto (webp, svg) se pasa a png
    let type = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }[blob.type];
    const bitmap = await createImageBitmap(blob);
    let data;
    if (type) data = await blob.arrayBuffer();
    else {
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext('2d').drawImage(bitmap, 0, 0);
      data = await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer();
      type = 'png';
    }
    let w = Number(attrs.width) || bitmap.width;
    let h = Number(attrs.height) || (bitmap.height * w) / bitmap.width;
    if (w > PAGE_WIDTH_PX) { h = (h * PAGE_WIDTH_PX) / w; w = PAGE_WIDTH_PX; }
    return new ImageRun({ type, data, transformation: { width: Math.round(w), height: Math.round(h) } });
  } catch {
    return null;
  }
}

// Recolecta los títulos para el índice antes de exportar
export function collectHeadings(json) {
  const out = [];
  const walk = (n) => {
    if (n.type === 'heading') out.push({ level: n.attrs?.level || 1, text: (n.content || []).map(c => c.text || '').join('') });
    else (n.content || []).forEach(walk);
  };
  walk(json);
  return out;
}
