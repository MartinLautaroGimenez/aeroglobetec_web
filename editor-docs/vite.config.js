// Compila el editor a app/docs/: editor.js (fijo, la plataforma lo importa con ?v=)
// y el resto en chunks/ con un hash en el nombre (así el proxy nunca sirve copias viejas).
import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';

// Íconos de Material Symbols que usa el editor: Google Fonts entrega solo esos (más liviano).
// Se juntan solos de los ic('…'), icon: '…' y botones b('…', '…') del código.
const EXTRA_ICONS = ['sync', 'cloud_done', 'cloud_off', 'error', 'computer', 'expand_less', 'expand_more'];
function iconNames() {
  const names = new Set(EXTRA_ICONS);
  const patterns = [/\bic\('([a-z0-9_]+)'/g, /\bicon: '([a-z0-9_]+)'/g, /\bb\('[^']*', '([a-z0-9_]+)'/g, /'(format_align_[a-z]+)'/g];
  for (const f of readdirSync('src').filter(n => n.endsWith('.js'))) {
    const src = readFileSync(`src/${f}`, 'utf8');
    for (const re of patterns) for (const m of src.matchAll(re)) names.add(m[1]);
  }
  return [...names].sort().join(',');   // Google Fonts los pide en orden alfabético
}

export default defineConfig({
  base: './',
  define: { __ICONS__: JSON.stringify(iconNames()) },
  build: {
    outDir: '../app/docs',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      // editor.js: el editor completo · plantillas.js: solo las plantillas (para la lista y Google Docs)
      input: { editor: 'src/index.js', plantillas: 'src/templates.js' },
      preserveEntrySignatures: 'exports-only',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
