// Página de un documento (#/documento/<id>): se llega desde la bitácora o las notificaciones.
// Muestra la vista previa (si Google la deja incrustar) y el botón para abrirlo en Google.
import { esc, icon, fmtDateTime, embedUrl } from '../ui.js?v=202611241200';
import { linkKind } from './documentos.js?v=202611241200';

export async function renderDocumento(el, ctx) {
  const { api, params } = ctx;
  const [id] = params;
  const doc = await api.doc(id);
  if (!doc || !doc.link_url) {
    el.innerHTML = '<div class="page"><div class="empty"><strong>No encontramos el documento</strong><p>Puede que lo hayan sacado o que no tengas acceso. <a href="#/documentos">Ver los documentos</a></p></div></div>';
    return;
  }
  const scope = doc.project_id
    ? { label: doc.projects?.name || 'Proyecto', href: `#/proyecto/${doc.project_id}/documentos` }
    : doc.event_id
      ? { label: doc.events?.title || 'Evento', href: `#/evento/${doc.event_id}/documentos` }
      : { label: 'Documentos', href: '#/documentos' };
  const preview = embedUrl(doc.link_url);
  el.innerHTML = `
    <div class="page gdoc-page">
      <header class="project-head">
        <div>
          <a class="crumb" href="${esc(scope.href)}">← ${esc(scope.label)}</a>
          <h1><span class="docs-ico google">${icon('link')}</span>${esc(doc.title)}</h1>
          <p class="muted">${esc(linkKind(doc.link_url))}${doc.folder ? ` · ${esc(doc.folder)}` : ''} · agregado ${esc(fmtDateTime(doc.created_at))}</p>
        </div>
        <div class="head-actions">
          <a class="btn primary" href="${esc(doc.link_url)}" target="_blank" rel="noopener noreferrer">${icon('external')} Abrir</a>
        </div>
      </header>
      <p class="gdoc-note">Se abre en Google con tu cuenta. Si te pide acceso, pedíselo a quien lo creó (o que lo comparta con toda la escuela).</p>
      ${preview ? `<div class="gdoc-frame"><iframe src="${esc(preview)}" title="Vista previa de ${esc(doc.title)}" loading="lazy"></iframe></div>` : ''}
    </div>`;
}
