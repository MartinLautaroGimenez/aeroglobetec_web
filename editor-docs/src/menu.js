// Menús desplegables con submenús (barra Archivo, Editar… y listas de la barra de herramientas).
import { escapeHtml as esc } from './custom.js';

export const ic = (name, cls = '') => `<span class="msi ${cls}" aria-hidden="true">${name}</span>`;

let current = null;
export function closeMenus() {
  current?.close();
  current = null;
}

// items: [{ label, icon, shortcut, action, checked, disabled, sub: [...] | () => [...], html, keep }] o '-' (separador)
export function openMenu(anchor, items, { align = 'left', onClose, className = '' } = {}) {
  closeMenus();
  const root = document.createElement('div');
  root.className = 'dz-menu-layer';
  document.body.appendChild(root);
  // Tocar el menú no le saca el foco (ni la selección) al documento, salvo en campos para escribir
  root.addEventListener('mousedown', (ev) => { if (!ev.target.closest('input,textarea,select,label')) ev.preventDefault(); });
  const stack = [];

  const build = (list, parentItem, level) => {
    const el = document.createElement('div');
    el.className = `dz-menu ${className}`;
    el.setAttribute('role', 'menu');
    (typeof list === 'function' ? list() : list).forEach((it) => {
      if (it === '-') { el.insertAdjacentHTML('beforeend', '<div class="dz-menu-sep" role="separator"></div>'); return; }
      if (it.html) {
        const box = document.createElement('div');
        box.className = 'dz-menu-custom';
        box.innerHTML = it.html;
        it.mount?.(box, () => closeMenus());
        el.appendChild(box);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dz-menu-item' + (it.disabled ? ' disabled' : '') + (it.checked ? ' checked' : '');
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      b.innerHTML = `<span class="dz-mi-icon">${it.checked ? ic('check') : it.icon ? ic(it.icon) : ''}</span>`
        + `<span class="dz-mi-label" ${it.style ? `style="${it.style}"` : ''}>${esc(it.label)}</span>`
        + (it.shortcut ? `<span class="dz-mi-key">${esc(it.shortcut)}</span>` : '')
        + (it.sub ? `<span class="dz-mi-arrow">${ic('chevron_right')}</span>` : '');
      if (it.sub) {
        let timer;
        const open = () => {
          clearTimeout(timer);
          while (stack.length > level + 1) stack.pop().remove();
          if (stack[level + 1]?.owner === b) return;
          const sub = build(it.sub, it, level + 1);
          sub.owner = b;
          place(sub, b, 'right');
        };
        b.addEventListener('mouseenter', () => { timer = setTimeout(open, 120); });
        b.addEventListener('mouseleave', () => clearTimeout(timer));
        b.addEventListener('click', (ev) => { ev.stopPropagation(); open(); });
      } else {
        b.addEventListener('mouseenter', () => { while (stack.length > level + 1) stack.pop().remove(); });
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (it.disabled) return;
          if (!it.keep) closeMenus();
          it.action?.();
        });
      }
      el.appendChild(b);
    });
    root.appendChild(el);
    stack[level] = el;
    return el;
  };

  const place = (el, ref, side) => {
    const r = ref.getBoundingClientRect();
    el.style.visibility = 'hidden';
    const w = el.offsetWidth, h = el.offsetHeight;
    let x, y;
    if (side === 'right') {
      x = r.right - 2; y = r.top - 6;
      if (x + w > innerWidth - 8) x = r.left - w + 2;
    } else {
      x = align === 'right' ? r.right - w : r.left;
      y = r.bottom + 4;
    }
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    if (y + h > innerHeight - 8) y = Math.max(8, (side === 'right' ? innerHeight - h - 8 : r.top - h - 4));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = '';
  };

  const first = build(items, null, 0);
  place(first, anchor, 'below');
  anchor.classList.add('open');

  const onDown = (ev) => { if (!root.contains(ev.target) && !anchor.contains(ev.target)) closeMenus(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closeMenus(); } };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenus, { once: true });

  current = {
    anchor,
    close() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      anchor.classList.remove('open');
      root.remove();
      onClose?.();
    },
  };
  return current;
}

export const menuIsOpenFor = (anchor) => current?.anchor === anchor;

// Diálogo simple (formulario) con la estética del editor
export function dialog({ title, body, submit = 'Aceptar', cancel = 'Cancelar', wide = false, onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dz-dialog' + (wide ? ' wide' : '');
    dlg.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      <div class="dz-dialog-body">${body}</div>
      <footer>
        ${cancel ? `<button type="button" class="dz-btn ghost" data-cancel>${esc(cancel)}</button>` : ''}
        ${submit ? `<button type="submit" class="dz-btn primary">${esc(submit)}</button>` : ''}
      </footer></form>`;
    document.body.appendChild(dlg);
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (dlg.open) dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    dlg.addEventListener('close', () => finish(null));
    dlg.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const data = {};
      for (const el of ev.target.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') data[el.name] = el.checked;
        else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
        else if (el.type === 'file') data[el.name] = [...el.files];
        else data[el.name] = el.value;
      }
      finish(data);
    });
    dlg.showModal();
    onOpen?.(dlg, finish);
    dlg.querySelector('input:not([type=hidden]),textarea,select')?.focus();
  });
}

export function toast(message, kind = '') {
  let box = document.querySelector('.dz-toasts');
  if (!box) { box = document.createElement('div'); box.className = 'dz-toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `dz-toast ${kind}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3600);
}
