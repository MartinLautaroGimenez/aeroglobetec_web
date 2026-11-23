# Servidor de documentos colaborativos

Hace que varias personas puedan escribir a la vez en el mismo documento de la plataforma, como en Google Docs. Usa [Hocuspocus](https://tiptap.dev/docs/hocuspocus) (Yjs) y guarda todo en Supabase.

```
navegador ──wss──▶ este servidor ──▶ Supabase
                    · reparte los cambios en tiempo real
                    · pregunta a la base si la persona puede editar o solo leer (función document_access)
                    · guarda el contenido (document_states) y versiones automáticas (document_versions)
```

Los permisos son los mismos de la plataforma: cada conexión trae la sesión de Supabase de la persona, y la base decide.

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
