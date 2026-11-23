# CLAUDE.md · Guía rápida del repo AeroGlobETec

Notas para trabajar en este repo. El `README.md` está pensado para personas (puesta en marcha, funciones);
esto resume **cómo está armado por dentro** y las convenciones que hay que respetar.

## Qué es

Web + plataforma del taller **AeroGlobETec** (ETec · Universidad de Mendoza). Todo en español rioplatense.
Producción: `https://aeroglobe.wetec.um.edu.ar` (servidor de la escuela, archivos estáticos subidos tal cual).

Dos piezas que comparten un mismo backend **Supabase** (`nveisqekmbcdvnuebice.supabase.co`):

1. **Web pública** — `index.html` (raíz) + `assets/`. Sin login.
2. **Plataforma** — `app/`. SPA con login, para gestionar proyectos del taller. Es una PWA instalable.

**No hay build, ni bundler, ni npm, ni tests.** HTML + CSS + JS (ES modules nativos) servido estático.
Librerías por CDN (supabase-js `@2.45.4` desde jsdelivr, fuentes de Google).

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
  `?v=` (hoy `202610180031`). El proxy de la universidad cachea agresivo, así que **al cambiar cualquier
  archivo de `app/` hay que subir la versión en TODOS los archivos** (`app/index.html`, `main.js`, cada vista y
  tab que importe con `?v=`). Ej.: `grep -rl 'v=202610180031' app | xargs sed -i 's/v=202610180031/v=NUEVA/g'`.
- **Archivo nuevo en `app/`** → agregarlo a la lista `SHELL` de `app/sw.js`.
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
