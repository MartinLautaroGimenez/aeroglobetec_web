// Configuración de la plataforma.
// La "publishable key" es pública: los permisos los controla la base de datos (RLS).
// NUNCA poner acá la secret key: saltea todos los permisos.
export const SUPABASE_URL = 'https://nveisqekmbcdvnuebice.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Pjsh0xgZGNLchNWWNvTmfw_NllsCUSY';

// Modo demo: datos de ejemplo guardados solo en este navegador, sin login real.
// Se activa abriendo la app con ?demo en la URL (sirve para probar la interfaz).
export const DEMO_MODE = new URLSearchParams(location.search).has('demo') || !SUPABASE_URL || !SUPABASE_KEY;

export const ALLOWED_DOMAINS = ['etec.um.edu.ar', 'alumno.etec.um.edu.ar'];

// Servidor de documentos colaborativos (docs-server/, corre en el CT de Proxmox).
// Tiene que ser wss:// (con https) cuando la plataforma está publicada. Ejemplos:
//   'wss://docs.tudominio.com'                     (mientras corre en el CT propio)
//   'wss://aeroglobe.wetec.um.edu.ar/docs-ws'      (cuando quede en el servidor de la escuela)
//   'ws://localhost:1234'                          (para probar en la compu)
// Vacío: los documentos solo funcionan en el modo demo.
export const DOCS_SERVER_URL = '';
