// Modo demo: sin servidor. Las pestañas del mismo navegador se pasan los cambios con
// BroadcastChannel y el documento se guarda en localStorage. Sirve para probar la
// edición en simultáneo abriendo el mismo documento en dos pestañas.
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

export const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export const demoStateKey = (id) => `age-doc-${id}`;

export function demoLoadState(id) {
  try { const v = localStorage.getItem(demoStateKey(id)); return v ? fromBase64(v) : null; } catch { return null; }
}
export function demoSaveState(id, bytes) {
  try { localStorage.setItem(demoStateKey(id), toBase64(bytes)); return true; } catch { return false; }
}

export class DemoProvider {
  constructor(id, doc) {
    this.id = id;
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.listeners = {};
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel(`age-doc-${id}`) : null;
    this.saveTimer = null;
    this.saveFailed = false;

    const stored = demoLoadState(id);
    if (stored) Y.applyUpdate(doc, stored, this);

    this.onUpdate = (update, origin) => {
      if (origin !== this) this.channel?.postMessage({ t: 'u', u: update });
      this.scheduleSave();
    };
    this.onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      const changed = added.concat(updated, removed);
      this.channel?.postMessage({ t: 'a', a: encodeAwarenessUpdate(this.awareness, changed) });
    };
    doc.on('update', this.onUpdate);
    this.awareness.on('update', this.onAwareness);

    if (this.channel) {
      this.channel.onmessage = ({ data }) => {
        if (data.t === 'u') Y.applyUpdate(doc, data.u, this);
        else if (data.t === 'a') applyAwarenessUpdate(this.awareness, data.a, this);
        else if (data.t === 'q') {
          // Una pestaña nueva pide el estado: se le manda todo
          this.channel.postMessage({ t: 'u', u: Y.encodeStateAsUpdate(doc) });
          this.channel.postMessage({ t: 'a', a: encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]) });
        }
      };
      this.channel.postMessage({ t: 'q' });
    }
    this.onUnload = () => removeAwarenessStates(this.awareness, [doc.clientID], 'unload');
    window.addEventListener('beforeunload', this.onUnload);
    setTimeout(() => this.emit('synced'), 0);
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach(fn => fn(data)); }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.emit('saving');
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    clearTimeout(this.saveTimer);
    const ok = demoSaveState(this.id, Y.encodeStateAsUpdate(this.doc));
    this.saveFailed = !ok;
    this.emit(ok ? 'saved' : 'save-error');
  }

  destroy() {
    this.flush();
    this.onUnload();
    window.removeEventListener('beforeunload', this.onUnload);
    this.doc.off('update', this.onUpdate);
    this.awareness.off('update', this.onAwareness);
    this.awareness.destroy();
    this.channel?.close();
  }
}
