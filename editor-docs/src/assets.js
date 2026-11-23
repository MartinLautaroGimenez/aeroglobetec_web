// Fuentes del documento, íconos (Material Symbols, solo los que se usan) y estilos de KaTeX.
// Se cargan una sola vez, cuando se abre el primer documento.
// eslint-disable-next-line no-undef
const ICONS = __ICONS__;   // lo completa vite.config.js al compilar
const FONTS = 'family=Comic+Neue:wght@400;700&family=DM+Sans:opsz,wght@9..40,400;9..40,600&family=Lato:ital,wght@0,400;0,700;1,400&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Montserrat:ital,wght@0,400;0,700;1,400&family=Open+Sans:ital,wght@0,400;0,700;1,400&family=Roboto:ital,wght@0,400;0,700;1,400&family=Roboto+Mono:wght@400;700&family=Carlito:ital,wght@0,400;0,700;1,400';
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.18.10/dist/katex.min.css';

let loaded = false;
export function loadAssets() {
  if (loaded) return;
  loaded = true;
  const link = (href) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
    return l;
  };
  const icons = link('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..24,400,0..1,0&icon_names=' + ICONS + '&display=block');
  link('https://fonts.googleapis.com/css2?' + FONTS + '&display=swap');
  link(KATEX);
  // Hasta que llega la fuente de íconos no se muestran (si no, aparece el nombre del ícono)
  const ready = () => document.documentElement.classList.add('dz-icons-ready');
  const check = () => document.fonts.load('20px "Material Symbols Outlined"', 'undo').then((f) => { if (f.length) ready(); }).catch(() => {});
  if (document.fonts?.load) {
    icons.addEventListener('load', check);
    check();
    setTimeout(ready, 5000);
  } else ready();
}
