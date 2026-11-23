# Servidor de documentos colaborativos

Hace que varias personas puedan escribir a la vez en el mismo documento de la plataforma, como en Google Docs. Usa [Hocuspocus](https://tiptap.dev/docs/hocuspocus) (Yjs) y guarda todo en Supabase.

```
navegador ──wss──▶ este servidor ──▶ Supabase
                    · reparte los cambios en tiempo real
                    · pregunta a la base si la persona puede editar o solo leer (función document_access)
                    · guarda el contenido (document_states) y versiones automáticas (document_versions)
```

Los permisos son los mismos de la plataforma: cada conexión trae la sesión de Supabase de la persona, y la base decide.

> **¿Querés todo en un solo comando?** `deploy/instalar.sh` hace los pasos de esta guía solo (y además sirve la web y la plataforma desde la misma máquina). Ver el `README.md` principal. Esta guía es para instalar el servidor a mano.

## 1. Base de datos

Correr de nuevo `supabase/schema.sql` completo en **SQL Editor** de Supabase. Agrega las tablas `documents`, `document_states` y `document_versions`.

## 2. Instalar en el CT de Proxmox

Un contenedor LXC con Debian 12 o Ubuntu 24.04 alcanza: 1 núcleo, 512 MB de RAM y 4 GB de disco.

### Con Docker (recomendado)

```bash
apt update && apt install -y git docker.io docker-compose-v2
```

```bash
git clone https://github.com/MartinLautaroGimenez/aeroglobetec_web.git /opt/aeroglobetec_web
```

```bash
cd /opt/aeroglobetec_web/docs-server && cp .env.example .env && nano .env
```

Completá en el `.env`:

- `SUPABASE_ANON_KEY`: la **publishable key** (la misma que está en `app/js/config.js`).
- `SUPABASE_SERVICE_KEY`: la **secret key**, de Supabase → **Project Settings → API Keys**. Solo vive en este `.env`: nunca va en el código ni en la web.
- `ALLOWED_ORIGINS`: las direcciones desde donde se abre la plataforma.

Para Docker dentro de un LXC, en Proxmox activá **Options → Features → nesting** en el CT.

```bash
docker compose up -d --build
```

### Sin Docker (con systemd)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs git
```

```bash
git clone https://github.com/MartinLautaroGimenez/aeroglobetec_web.git /opt/aeroglobetec_web
```

```bash
cd /opt/aeroglobetec_web/docs-server && npm ci --omit=dev && cp .env.example .env && nano .env
```

```bash
useradd --system --no-create-home aeroglobe && cp aeroglobetec-docs.service /etc/systemd/system/
```

```bash
systemctl daemon-reload && systemctl enable --now aeroglobetec-docs
```

### Comprobar que anda

```bash
curl http://localhost:1234/salud
```

Tiene que responder `{"ok":true,...}`. Los registros se ven con `docker compose logs -f` o `journalctl -u aeroglobetec-docs -f`.

## 3. Ponerle https (wss)

La plataforma está en `https`, así que el navegador solo se conecta a un `wss://`. Hay dos caminos para el CT propio:

**Cloudflare Tunnel** (no hace falta abrir puertos en el router): en el panel de Cloudflare, **Zero Trust → Networks → Tunnels**, creá un túnel, instalá `cloudflared` en el CT con el comando que te da, y agregá un *public hostname* (por ejemplo `docs.tudominio.com`) que apunte a `http://localhost:1234`. Cloudflare ya deja pasar WebSockets.

**Caddy** (si el CT tiene el puerto 443 abierto a internet y un dominio que apunta a él):

```
docs.tudominio.com {
    reverse_proxy localhost:1234
}
```

## 4. Conectar la plataforma

En `app/js/config.js`:

```js
export const DOCS_SERVER_URL = 'wss://docs.tudominio.com';
```

Después subí la versión de los archivos (`?v=…`) como dice el `CLAUDE.md` y publicá.

## 5. Cuando pase al servidor de la escuela

Con el nginx de `aeroglobe.wetec.um.edu.ar` haciendo de puerta de entrada:

```nginx
location /docs-ws {
    proxy_pass http://IP_DEL_SERVIDOR_DE_DOCUMENTOS:1234;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

Y en `app/js/config.js`: `DOCS_SERVER_URL = 'wss://aeroglobe.wetec.um.edu.ar/docs-ws'`. En el `docker-compose.yml`, cambiá `127.0.0.1:1234:1234` por `1234:1234` si nginx corre en otra máquina.

No hay que migrar nada: los documentos están en Supabase, no en el servidor. Se puede apagar uno y prender el otro.

## Probar en la compu

```bash
npm install && npm run dev
```

`npm run dev` arranca **sin login ni base de datos** (los documentos quedan en memoria). Es solo para probar. En producción no arranca así.

## Google Docs (opcional)

Además del editor propio, la plataforma puede crear **Google Docs de verdad**. Se guardan en el Drive de una **cuenta de Google del taller** (conviene una cuenta del taller y no la de una persona: así los documentos no se pierden si alguien se va). El servidor actúa en nombre de esa cuenta:

- Crea el documento en `AeroGlobETec · Documentos / <proyecto o evento>`, en blanco, desde una plantilla o convirtiendo un Word.
- Cuando alguien lo abre desde la plataforma, lo comparte con su mail: **editor** si puede editar, **comentarista** si es de solo lectura. No le llega ningún mail de Google.
- Si se borra desde la plataforma, el archivo va a la papelera de ese Drive (se recupera durante 30 días).

Usa solo el permiso `drive.file`: la app ve únicamente los archivos que crea ella, no el resto del Drive.

### 1. Google Cloud

En [Google Cloud Console](https://console.cloud.google.com/), en el mismo proyecto del login con Google o en uno nuevo:

1. **APIs y servicios → Biblioteca**: habilitá **Google Drive API**.
2. **Pantalla de consentimiento de OAuth**:
   - Si la cuenta del taller es de la escuela (Google Workspace): elegí **Interno**.
   - Si es una cuenta común (Gmail): elegí **Externo** y después tocá **Publicar app**. Con `drive.file` no hace falta que Google la verifique. Si queda en "Prueba", Google corta el acceso a los 7 días.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**. En **URIs de redireccionamiento autorizados** poné la dirección del servidor + `/google/callback`:
   - con el instalador de un solo comando: `https://TU-DOMINIO/docs-ws/google/callback`
   - con el servidor solo: `https://docs.tudominio.com/google/callback`
4. Copiá el **ID de cliente** y el **secreto**: van en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del `.env` (el instalador los pregunta). `GOOGLE_REDIRECT_URI` tiene que ser exactamente la misma dirección del paso 3, y `GOOGLE_SETUP_KEY` una clave larga cualquiera.

### 2. Conectar la cuenta del taller (una sola vez)

Entrá a Google con la cuenta del taller y abrí:

```
https://TU-DOMINIO/docs-ws/google/conectar?clave=GOOGLE_SETUP_KEY
```

Aceptá los permisos (tildá el de Google Drive). Listo: en **Documentos** de la plataforma aparece la opción **Google Docs** al crear. En `/salud` se ve `"google":{"configurado":true,"conectado":true}`.

La conexión queda en `GOOGLE_STATE_FILE` (con el instalador, `/var/lib/aeroglobetec-docs/google.json`; con Docker, en el volumen `datos`). Para cambiar de cuenta, volvé a abrir el enlace con la otra.

### A tener en cuenta

- Cada persona tiene que entrar a Google con **el mismo mail** con el que entra a la plataforma: es al que se le comparte el documento.
- Si la escuela no deja compartir archivos de Drive con cuentas de afuera del dominio, los mails de afuera invitados a la plataforma no van a poder abrir los Google Docs.
- Si alguien sale de un proyecto, sigue teniendo acceso en Google a los documentos que ya abrió hasta que se lo saquen desde Drive (la plataforma da acceso, pero no lo quita).
