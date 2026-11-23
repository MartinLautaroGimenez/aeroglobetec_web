# CLAUDE.md · Guía rápida del repo AeroGlobETec

Notas para trabajar en este repo. El `README.md` está pensado para personas (puesta en marcha, funciones);
esto resume **cómo está armado por dentro** y las convenciones que hay que respetar.

## Qué es

Web + plataforma del taller **AeroGlobETec** (ETec · Universidad de Mendoza). Todo en español rioplatense.
Producción: `https://aeroglobe.wetec.um.edu.ar` (servidor de la escuela, archivos estáticos subidos tal cual).

Dos piezas que comparten un mismo backend **Supabase** (`nveisqekmbcdvnuebice.supabase.co`):

1. **Web pública** — `index.html` (raíz) + `assets/`. Sin login.
2. **Plataforma** — `app/`. SPA con login, para gestionar proyectos del taller. Es una PWA instalable.

**La web y la plataforma no tienen build, ni bundler, ni tests.** HTML + CSS + JS (ES modules nativos) servido estático.
Librerías por CDN (supabase-js `@2.45.4` desde jsdelivr, fuentes de Google).
**Única excepción:** el editor de documentos (`editor-docs/`, con npm + Vite) se compila a `app/docs/` y
ese resultado compilado se commitea, así la publicación sigue siendo copiar archivos.

## Topología

```
index.html              web pública (un solo archivo grande, ~950 líneas con algunas de 14k chars)
assets/                 logos/íconos de la web pública (el contenido publicado los referencia)
app/
  index.html            shell de la SPA; registra sw.js y carga js/main.js
  tutorial.html         recorrido animado de la plataforma (usa su propia copia de datos demo)
  manifest.webmanifest  PWA
  sw.js                 service worker (network-first para la app, cache-first para CDN)
  css/app.css           todos los estilos de la plataforma
  sitio/editor.html     editor CMS de la web pública (standalone, ~630 líneas, se embebe en iframe)
  js/config.js          URL + publishable key de Supabase, DEMO_MODE, ALLOWED_DOMAINS
  js/api.js             ÚNICA capa de datos real (objeto `api` con métodos async sobre supabase-js)
  js/demo-api.js        misma interfaz `api` pero con datos falsos en localStorage (modo ?demo)
  js/ui.js              helpers: esc, avatar, icon, toast, openForm/field, fechas, roles (isStaff…)
  js/export.js          exportación a Excel (.xlsx)
  js/main.js            arranque: elige api, sesión, shell (sidebar), router por hash
  js/views/*.js         pantallas: login, dashboard, project, users, report, turnos, eventos,
                        evento, sitio, marca
  js/views/tabs/*.js    pestañas de un proyecto: summary, presentation, tasks, updates,
                        milestones, ensayos, team, files, inventory, performance, activity
  js/views/documentos.js  lista de documentos + galería de plantillas (hub #/documentos y pestañas)
  js/views/documento.js   abre el editor a pantalla completa (#/documento/<id>)
  css/docs.css          estilos del editor (se carga solo al abrir un documento)
  docs/                 editor compilado (NO editar a mano: sale de editor-docs/)
editor-docs/            código del editor estilo Google Docs (TipTap 3 + Yjs), Vite 8
  src/editor.js         mountEditor(): pantalla, conexión, título, colaboradores, atajos
  src/toolbar.js        barra de herramientas · src/menubar.js  menús Archivo/Editar/… · src/menu.js  menús y diálogos
  src/panels.js         comentarios, historial de versiones, esquema, buscar y reemplazar
  src/custom.js         extensiones propias (interlineado, sangría, salto de página, índice, comentarios, búsqueda, imágenes)
  src/actions.js        links, imágenes, ecuaciones, tablas, descargas, impresión
  src/docx-export.js · src/docx-import.js   Word (docx / mammoth, se cargan aparte)
  src/demo-provider.js  modo demo: sincroniza pestañas con BroadcastChannel y guarda en localStorage
  src/index.js          lo que exporta el paquete (mountEditor, stateFromTemplate, stateFromDocx, copyState…)
docs-server/            servidor de tiempo real (Hocuspocus 4) para el CT de Proxmox; ver su README
  google.js             Google Docs en el Drive de la cuenta del taller (OAuth + Drive API con fetch)
deploy/instalar.sh      instalador para un contenedor Debian/Ubuntu virgen: Node 22, Caddy (web + /docs-ws),
                        systemd, .env, https (dominio o Cloudflare Tunnel). Re-ejecutable = actualizar.
                        Copia el sitio a /var/www/aeroglobetec y ahí le pone DOCS_SERVER_URL = mismo origen + /docs-ws.
supabase/
  schema.sql            TODA la base: tipos, tablas, RLS, triggers, funciones, buckets. Idempotente.
  *.sql                 scripts de carga puntuales (textos borrador, imágenes, presentación Dron Rover)
```

## Cómo funciona la plataforma (`app/`)

- **Arranque** (`main.js`): `DEMO_MODE` (si la URL tiene `?demo`) → importa `demo-api.js`, si no `api.js`.
  `api.me()` trae el perfil. Sin perfil → login. Perfil sin acceso (`access` ≠ `aprobado`) → pantalla de espera.
  Con acceso → `renderShell()` (sidebar) + `route()`.
- **Router por hash** (tabla `routes` en `main.js`): `#/`, `#/proyecto/<id>/<tab>`, `#/proyecto/<id>/informe`,
  `#/usuarios`, `#/turnos`, `#/eventos`, `#/evento/<id>/<tab>`, `#/sitio/<tab>`, `#/marca`.
  Cada vista exporta `renderX(...)` y pinta con template strings en `innerHTML` (siempre escapar con `esc()`).
  Las pestañas de proyecto están en el array `TABS` de `views/project.js`.
- **Patrón de vistas**: HTML con template literals + `addEventListener` después de pintar; formularios con
  `openForm`/`field` de `ui.js`; avisos con `toast`; errores con `errorMessage`.
- **Login**: magic link / código OTP por mail y Google OAuth, flujo PKCE (`api.js`).
- **Roles** (`profiles.role`): `docente` | `lider` | `estudiante`, derivado del dominio del mail
  (`@etec.um.edu.ar` → docente, `@alumno.etec.um.edu.ar` → estudiante). Además `admins` (tabla, por email,
  solo se edita por SQL) y `invited_emails` (mails externos invitados con un rol).
  - `isStaff` = admin | docente | lider → gestiona proyectos, tareas, eventos.
  - `canManageRoles` = admin | docente → usuarios y editor del sitio.
  - Cuentas nuevas quedan `access = 'pendiente'` hasta que un docente/admin las aprueba (Usuarios).
- **Permisos reales = RLS en Supabase.** La UI solo oculta botones. Helpers SQL: `is_admin()`, `is_approved()`,
  `is_staff()`, `is_docente()`, `can_view_project()`, `can_view_event()`, `can_edit_site()`. Al final del
  schema hay una política *restrictive* en cada tabla que exige cuenta aprobada.
- **Triggers** importantes: `handle_new_user` (crea perfil, rol, acceso), `guard_*` (validan quién puede
  cambiar qué campos: tareas, avances, inventario, ensayos, fallas, turnos sin superposición…),
  `track_*` (escriben `activity` = bitácora y `notifications`). Rendimiento: `student_performance()` y
  `area_performance()` (50 % cumplimiento, 30 % calidad, 20 % puntualidad).
- **Storage**: bucket privado `proyectos` (carpetas `<project_id>/…` y `eventos/<id>/…`), públicos
  `aero-media` (fotos de la web) y `marca` (imagen de marca).

### Tablas principales
`profiles, admins, invited_emails, projects, project_members, areas, area_members, milestones, tasks,
updates, comments, project_files, inventory, activity, notifications, tests, issues (ensayos/fallas),
equipment, reservations (turnos), events, event_members, event_projects, event_materials, event_tasks,
brand_assets, aero_draft, aero_published, site_teachers, site_trayectoria`.

## Documentos colaborativos

- Tablas: `documents` (fila: título, carpeta, `project_id` | `event_id` | ninguno = del taller, `editable_by`
  'equipo'|'staff'), `document_states` (estado Yjs, bytea) y `document_versions` (historial; `auto` = del servidor).
- Permisos: `can_view_doc_scope`, `can_view_document`, `can_edit_document`, `document_access(d)` → 'editar'|'leer'.
  El contenido NO se escribe desde la web: lo guarda `docs-server` con la service key. La web solo crea la fila,
  carga el contenido inicial (`initDocState`, insert) y lee/guarda versiones.
- Flujo: navegador ⇄ `wss` Hocuspocus (`DOCS_SERVER_URL` en config.js, nombre `doc:<uuid>`, token = sesión de
  Supabase) ⇄ Supabase. Sin `DOCS_SERVER_URL` solo anda el modo demo.
- Dentro del Y.Doc: fragmento `default` (el texto), mapa `comments` (comentarios y respuestas, la marca
  `comment` en el texto guarda el id) y mapa `meta` (título en vivo; manda el de la base al abrir).
- Imágenes: bucket privado `proyectos`, en el documento queda `storage:<ruta>` y se muestra con link firmado.
- Íconos: Material Symbols de Google Fonts, pedidos solo los que se usan. `vite.config.js` junta la lista sola
  de `ic('…')`, `icon: '…'` y `b('…', '…')`; un ícono escrito de otra forma va en `EXTRA_ICONS`.
- **Google Docs** (`kind = 'google'`, columnas `google_id`/`google_url`): los crea `docs-server/google.js` en el Drive
  de UNA cuenta del taller (OAuth con refresh token guardado en `GOOGLE_STATE_FILE`, permiso `drive.file`, carpetas
  por proyecto/evento). Rutas HTTP del servidor: `GET /google/estado`, `POST /google/documentos` (en blanco, `html`
  o `docx` en base64), `POST /google/documentos/<id>/acceso` (comparte con el mail de quien abre: writer/commenter
  según `document_access`), `PATCH`/`DELETE /google/documentos/<id>`, `GET /google/conectar?clave=` y `/google/callback`.
  Aceptan cualquier prefijo (`/docs-ws/google/…`). La web llama con `docsServer()` en `api.js` (misma dirección que
  `DOCS_SERVER_URL` pero http/https). Un trigger impide que un usuario cree o cambie filas `google` a mano.
  En `app/`: `views/documentos.js` (selector Google Docs / Editor del taller, `openGoogleDoc` abre la pestaña en el
  clic para que no la bloqueen) y `views/documento.js` (página con vista previa `/preview` + botón "Abrir").
  Plantillas para Google: `app/docs/plantillas.js` (segunda entrada de Vite, `googleTemplate(id)`).
- **Links pegados** (`kind = 'link'`, columna `link_url`, solo https): los crea cualquiera que pueda crear en ese
  proyecto/evento, sin servidor ni API. En la lista el nombre es un `<a target=_blank>` al link; `#/documento/<id>`
  muestra vista previa con `embedUrl()` de ui.js. `linkKind(url)` en documentos.js dice si es Docs/Sheets/Slides…
- Menús y barras hacen `preventDefault` en `mousedown` para no sacarle el foco al editor (si no, se pierde la
  selección y Enter puede borrar texto). Mantenerlo en cualquier control nuevo.

## Cómo funciona la web pública (`index.html`)

- Página única con "rutas" por hash (`#inicio`, `#sumate`, `#profes`, `#trayectoria`, `#trayectoria-<slug>`…),
  manejadas con `history.pushState` + `hashchange`. Bilingüe ES/EN (botones `.aero-lang`, guardado en localStorage).
- `window.AERO_BACKEND` (script `#aero-cms-config`) tiene URL + anon key.
- **CMS**: al cargar hace `fetch` REST a `aero_published?id=eq.main` (primero solo `version`; si cambió,
  trae `content`) y lo aplica (`applyPublishedState`: textos por nodo, imágenes, galerías, páginas extra,
  colores `--blue/--blue2`). Cachea en localStorage `aero-published-cache`. HTML del CMS se sanitiza con
  `cleanHtml` (lista blanca de tags) y `safeUrl`.
- `site_teachers` y `site_trayectoria` se leen directo (se ven al instante, sin publicar).
- Modo vista previa: `window.aeroPreviewDraft(data)` (lo usa el editor).

## Editor del sitio (`app/sitio/editor.html`)

Se abre dentro de la plataforma (`views/sitio.js` lo mete en un `<iframe>`). Toma el `access_token` de la
sesión de Supabase guardada en localStorage (`sb-…`) y habla por REST:
`aero_draft` (borrador con `revision` → bloqueo optimista en el PATCH) → **Publicar** copia a
`aero_published` (incrementa `version`). La web solo muestra lo publicado.
Docentes, trayectoria y otras pestañas de "Sitio web" están en `views/sitio.js`.

## Convenciones a respetar

- **Cache-busting `?v=AAAAMMDDHHMM`**: todos los imports JS, el CSS y el registro de `sw.js` llevan el mismo
  `?v=` (hoy `202611241000`). El proxy de la universidad cachea agresivo, así que **al cambiar cualquier
  archivo de `app/` hay que subir la versión en TODOS los archivos** (`app/index.html`, `main.js`, cada vista y
  tab que importe con `?v=`). Ej.: `grep -rl 'v=202611241000' app | xargs sed -i 's/v=202611241000/v=NUEVA/g'`.
- **Archivo nuevo en `app/`** → agregarlo a la lista `SHELL` de `app/sw.js`.
- **Cambio en el editor de documentos** → editar `editor-docs/src/`, correr `cd editor-docs && npm ci && npm run build`
  (regenera `app/docs/`), commitear también `app/docs/`, y subir el `?v=` como en cualquier cambio de `app/`.
- **Método nuevo de datos** → implementarlo en `api.js` **y** en `demo-api.js` (misma firma), si no el modo demo se rompe.
- **Cambio de base** → editar `supabase/schema.sql` manteniéndolo idempotente (`if not exists`, `create or
  replace`, políticas que se borran y recrean). Se corre a mano en el SQL Editor de Supabase.
- Nunca poner la *secret key* de Supabase en el código; la publishable key es pública por diseño.
- Textos de UI y comentarios en español rioplatense (vos, tenés…), tono simple.
- Commits/PRs en español, descriptivos (ver `git log`).

## Probar

```bash
python -m http.server 8765
```
- `http://localhost:8765/` web pública · `http://localhost:8765/app/?demo` plataforma sin login
  (barra arriba para cambiar de usuario/rol) · `/app/` real (necesita red a Supabase).
- Para verificar visualmente usar Playwright (preinstalado) contra el server local con `?demo`.
- Documentos en modo demo: `/app/?demo#/documentos`; abrir el mismo documento en dos pestañas prueba la edición
  en simultáneo. Con servidor real: `cd docs-server && npm install && npm run dev` (sin login, en memoria) y montar
  el editor apuntando a `ws://localhost:1234`.
