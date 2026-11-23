// Punto de entrada del editor de documentos. La plataforma (app/js/views/documento.js y
// documentos.js) lo carga con import() y usa estas funciones.
import * as Y from 'yjs';
import { generateJSON, getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import { baseExtensions } from './extensions.js';
import { TEMPLATES } from './templates.js';
import { loadAssets } from './assets.js';

export { mountEditor } from './editor.js';
export { demoLoadState, demoSaveState, toBase64, fromBase64 } from './demo-provider.js';
export { loadAssets };

export const templates = TEMPLATES.map(({ id, name, hint }) => ({ id, name, hint }));

let schema;
// Arma el contenido inicial (estado de Yjs) de un documento nuevo a partir de HTML
export function stateFromHtml(html) {
  const ext = baseExtensions();
  schema ||= getSchema(ext);
  const json = generateJSON(html || '<p></p>', ext);
  const ydoc = prosemirrorJSONToYDoc(schema, json, 'default');
  const state = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return state;
}

export function stateFromTemplate(id) {
  const t = TEMPLATES.find(x => x.id === id) || TEMPLATES[0];
  return t.id === 'blanco' ? null : stateFromHtml(t.html());
}

export async function stateFromDocx(file, uploadImage) {
  const { importDocx } = await import('./docx-import.js');
  return stateFromHtml(await importDocx(file, uploadImage));
}

// Copia: el mismo contenido y comentarios, en un documento nuevo
export function copyState(state) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
  copy.getMap('meta').delete('title');
  const out = Y.encodeStateAsUpdate(copy);
  ydoc.destroy();
  copy.destroy();
  return out;
}

// Ícono con la miniatura de la plantilla (para la galería de "Empezar un documento")
export function templatePreview(id) {
  const t = TEMPLATES.find(x => x.id === id);
  return t ? t.html() : '';
}
