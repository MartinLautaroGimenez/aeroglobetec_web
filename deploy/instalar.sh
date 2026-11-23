#!/usr/bin/env bash
# =====================================================================
# Instalador de AeroGlobETec para un contenedor Debian/Ubuntu recién creado
# (por ejemplo un CT de Proxmox). Deja andando, en una sola máquina:
#   · la web pública y la plataforma (servidas por Caddy)
#   · el servidor de documentos colaborativos (docs-server, con systemd)
#   · Caddy pasando /docs-ws al servidor de documentos, con https si hay dominio
#
# Uso (como root):
#   curl -fsSL https://raw.githubusercontent.com/MartinLautaroGimenez/aeroglobetec_web/main/deploy/instalar.sh | bash
#
# Se puede volver a correr para ACTUALIZAR: recuerda lo que contestaste
# (/etc/aeroglobetec/instalar.conf) y no vuelve a pedir la clave secreta.
# También queda el comando: aeroglobetec-actualizar
#
# Sin preguntas (todo por variables de entorno):
#   RAMA=main MODO=local SUPABASE_SERVICE_KEY=sb_secret_... NO_INTERACTIVO=1 bash instalar.sh
#   MODO: local (http, para probar en la red) · dominio (https automático) · cloudflare (Cloudflare Tunnel)
#   Otras: DOMINIO, CF_TUNNEL_TOKEN, SUPABASE_DB_URL (para cargar schema.sql), REPO_URL
# =====================================================================
set -Eeuo pipefail

main() {
  REPO_URL=${REPO_URL:-https://github.com/MartinLautaroGimenez/aeroglobetec_web.git}
  DIR=/opt/aeroglobetec_web
  WEB=/var/www/aeroglobetec
  CONF=/etc/aeroglobetec/instalar.conf
  USUARIO=aeroglobe
  PUERTO_DOCS=1234

  if [ -t 1 ]; then B=$'\e[1m'; V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; V=; A=; R=; N=; fi
  trap 'echo "${R}✗ Falló en la línea $LINENO. Revisá el mensaje de arriba y volvé a correr el instalador.${N}" >&2' ERR

  [ "$(id -u)" = 0 ] || falla "Corré el instalador como root (en el CT entrás como root; si no, con sudo)."
  command -v apt-get >/dev/null || falla "Este instalador es para Debian o Ubuntu."

  echo "${B}AeroGlobETec · instalación de la web, la plataforma y los documentos${N}"
  cargar_conf

  # ---------- Preguntas (solo las que faltan) ----------
  preguntar RAMA "Rama del repositorio" "main"
  if [ -z "${MODO:-}" ]; then
    tty_ok && cat > /dev/tty <<'EOF'

¿Cómo se va a entrar a esta máquina?
  1) local       Solo desde la red (http://IP-del-CT). Para probar.
  2) dominio     Con un dominio propio que apunta a esta máquina (puertos 80 y 443 abiertos): https automático.
  3) cloudflare  Con Cloudflare Tunnel: https sin abrir puertos en el router.
EOF
    preguntar MODO "Elegí 1, 2 o 3" "1"
  fi
  case "$MODO" in 1|local) MODO=local ;; 2|dominio) MODO=dominio ;; 3|cloudflare) MODO=cloudflare ;; *) falla "MODO tiene que ser local, dominio o cloudflare." ;; esac
  if [ "$MODO" != local ]; then
    preguntar DOMINIO "Dominio (ej.: docs.tudominio.com)" ""
    [ -n "$DOMINIO" ] || falla "Para el modo $MODO hace falta el dominio."
  fi
  guardar_conf

  # ---------- Paquetes ----------
  paso "Instalando paquetes del sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt_instalar ca-certificates curl git gnupg rsync
  instalar_node
  instalar_caddy
  ok "Paquetes listos (node $(node -v), $(caddy version | cut -d' ' -f1))"

  # ---------- Código ----------
  paso "Bajando el código (rama $RAMA)"
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" remote set-url origin "$REPO_URL"
    git -C "$DIR" fetch -q --depth 1 origin "$RAMA"
    git -C "$DIR" checkout -q -B "$RAMA" FETCH_HEAD
    git -C "$DIR" reset -q --hard FETCH_HEAD
  else
    git clone -q --depth 1 --branch "$RAMA" "$REPO_URL" "$DIR"
  fi
  [ -f "$DIR/docs-server/server.js" ] || falla "La rama \"$RAMA\" todavía no tiene los documentos colaborativos. Probá con RAMA=claude/magical-ritchie-z2s9si (o la rama donde estén)."
  ok "Código en $DIR ($(git -C "$DIR" log -1 --format='%h · %s'))"

  SUPABASE_URL=$(sed -n "s/^export const SUPABASE_URL = '\(.*\)';.*/\1/p" "$DIR/app/js/config.js")
  SUPABASE_ANON_KEY=$(sed -n "s/^export const SUPABASE_KEY = '\(.*\)';.*/\1/p" "$DIR/app/js/config.js")
  [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ] || falla "No encontré la URL o la clave pública de Supabase en app/js/config.js."

  # ---------- Servidor de documentos ----------
  paso "Preparando el servidor de documentos"
  id "$USUARIO" >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$USUARIO"
  (cd "$DIR/docs-server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)

  local envf="$DIR/docs-server/.env" previa=""
  [ -f "$envf" ] && previa=$(sed -n 's/^SUPABASE_SERVICE_KEY=//p' "$envf")
  if [ -z "${SUPABASE_SERVICE_KEY:-}" ] && [ -n "$previa" ]; then
    SUPABASE_SERVICE_KEY=$previa
    ok "Se usa la secret key que ya estaba guardada"
  fi
  if [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
    tty_ok && echo "La secret key está en Supabase → Project Settings → API Keys (empieza con sb_secret_). Queda solo en esta máquina." > /dev/tty
    preguntar SUPABASE_SERVICE_KEY "Pegá la secret key de Supabase (no se ve al escribir)" "" secreto
  fi
  [ -n "${SUPABASE_SERVICE_KEY:-}" ] || falla "Sin la secret key de Supabase el servidor de documentos no puede guardar."

  umask 027
  cat > "$envf" <<EOF
# Generado por deploy/instalar.sh ($(date '+%F %R')). Se reescribe al actualizar.
PORT=$PUERTO_DOCS
HOST=127.0.0.1
NODE_ENV=production
SUPABASE_URL=$SUPABASE_URL
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
ALLOWED_ORIGINS=$(origenes)
VERSION_EVERY_MIN=30
MAX_AUTO_VERSIONS=60
EOF
  umask 022
  chown root:"$USUARIO" "$envf"
  chmod 640 "$envf"
  probar_supabase
  cargar_base

  # ---------- Web y plataforma ----------
  paso "Publicando la web y la plataforma en $WEB"
  mkdir -p "$WEB"
  rsync -a --delete "$DIR/index.html" "$DIR/assets" "$DIR/app" "$WEB/"
  # La plataforma se conecta al servidor de documentos en la misma dirección (/docs-ws)
  sed -i "s#^export const DOCS_SERVER_URL = .*#export const DOCS_SERVER_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/docs-ws'; // puesto por deploy/instalar.sh#" "$WEB/app/js/config.js"
  grep -q "puesto por deploy/instalar.sh" "$WEB/app/js/config.js" || falla "No pude configurar DOCS_SERVER_URL en app/js/config.js."
  ok "Web lista"

  # ---------- Caddy ----------
  paso "Configurando Caddy"
  local sitio=":80"
  [ "$MODO" = dominio ] && sitio="$DOMINIO"
  mkdir -p /etc/caddy
  cat > /etc/caddy/Caddyfile <<EOF
# Generado por deploy/instalar.sh. Se reescribe al actualizar.
$sitio {
	encode zstd gzip

	# Servidor de documentos (tiempo real)
	handle /docs-ws* {
		reverse_proxy 127.0.0.1:$PUERTO_DOCS
	}

	# Web pública y plataforma
	handle {
		root * $WEB
		header /app/* Cache-Control "no-cache"
		header /index.html Cache-Control "no-cache"
		file_server
	}
}
EOF
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; falla "La configuración de Caddy tiene un error."; }
  ok "Caddy configurado (${sitio})"

  [ "$MODO" = cloudflare ] && instalar_cloudflared

  # ---------- Servicios ----------
  paso "Arrancando los servicios"
  if hay_systemd; then
    sed "s#^ExecStart=.*#ExecStart=$(command -v node) server.js#" "$DIR/docs-server/aeroglobetec-docs.service" > /etc/systemd/system/aeroglobetec-docs.service
    systemctl daemon-reload
    systemctl enable -q aeroglobetec-docs caddy
    systemctl restart aeroglobetec-docs
    systemctl reload-or-restart caddy
  else
    aviso "Esta máquina no usa systemd: arranco los servicios a mano (no vuelven solos si se reinicia)."
    pkill -f "docs-server/server.js" 2>/dev/null || true; sleep 1
    setsid setpriv --reuid="$USUARIO" --regid="$USUARIO" --init-groups -- node --env-file="$DIR/docs-server/.env" "$DIR/docs-server/server.js" >> /var/log/aeroglobetec-docs.log 2>&1 < /dev/null &
    disown
    caddy stop >/dev/null 2>&1 || true
    caddy start --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
  fi

  # Comando para actualizar después
  cat > /usr/local/bin/aeroglobetec-actualizar <<'EOF'
#!/usr/bin/env bash
# Actualiza AeroGlobETec con la última versión de la rama guardada
exec bash -c "$(curl -fsSL "https://raw.githubusercontent.com/MartinLautaroGimenez/aeroglobetec_web/$(sed -n 's/^RAMA=//p' /etc/aeroglobetec/instalar.conf)/deploy/instalar.sh")"
EOF
  chmod 755 /usr/local/bin/aeroglobetec-actualizar

  # ---------- Comprobación ----------
  paso "Comprobando"
  local salud=""
  for _ in $(seq 1 20); do salud=$(curl -fsS "http://127.0.0.1:$PUERTO_DOCS/salud" 2>/dev/null) && break; sleep 0.5; done
  [ -n "$salud" ] && ok "Servidor de documentos: $salud" || aviso "El servidor de documentos no responde. Mirá: journalctl -u aeroglobetec-docs -n 50"
  if [ "$MODO" = dominio ]; then
    curl -fsS -o /dev/null --max-time 20 "https://$DOMINIO/app/" && ok "https://$DOMINIO/app/ responde" \
      || aviso "Todavía no responde https://$DOMINIO (el certificado puede tardar un minuto; revisá que el dominio apunte acá y que los puertos 80 y 443 lleguen al CT)."
  else
    curl -fsS -o /dev/null "http://127.0.0.1/app/" && ok "La plataforma responde en el puerto 80" || aviso "Caddy no responde en el puerto 80. Mirá: journalctl -u caddy -n 50"
  fi

  resumen
}

# =====================================================================
paso()  { echo; echo "${B}▸ $*${N}"; }
ok()    { echo "  ${V}✓${N} $*"; }
aviso() { echo "  ${A}!${N} $*"; }
falla() { echo "${R}✗ $*${N}" >&2; exit 1; }
tty_ok() { [ -z "${NO_INTERACTIVO:-}" ] && (: < /dev/tty) 2>/dev/null; }
hay_systemd() { [ -d /run/systemd/system ]; }
apt_instalar() { apt-get install -y -qq "$@" >/dev/null 2> >(grep -v '^debconf:' >&2 || true); }

# preguntar VARIABLE "texto" "por defecto" [secreto]: no pregunta si la variable ya tiene valor
preguntar() {
  local var=$1 texto=$2 def=${3-} secreto=${4-} resp=""
  [ -n "${!var:-}" ] && return 0
  if tty_ok; then
    if [ -n "$secreto" ]; then read -r -s -p "  $texto: " resp < /dev/tty; echo > /dev/tty
    else read -r -p "  $texto${def:+ [$def]}: " resp < /dev/tty; fi
  fi
  printf -v "$var" '%s' "${resp:-$def}"
}

# Lo que se contestó la vez anterior (nunca guarda secretos). Las variables de entorno mandan.
cargar_conf() {
  [ -f "$CONF" ] || return 0
  local k v
  while IFS='=' read -r k v; do
    case "$k" in RAMA|MODO|DOMINIO) [ -z "${!k:-}" ] && printf -v "$k" '%s' "$v" ;; esac
  done < "$CONF"
  ok "Usando la configuración guardada en $CONF"
}
guardar_conf() {
  mkdir -p "$(dirname "$CONF")"
  printf 'RAMA=%s\nMODO=%s\nDOMINIO=%s\n' "$RAMA" "$MODO" "${DOMINIO:-}" > "$CONF"
}

origenes() {
  local o="https://aeroglobe.wetec.um.edu.ar"
  if [ "$MODO" = local ]; then
    local ip
    for ip in $(hostname -I 2>/dev/null) ; do case "$ip" in *:*) o="$o,http://[$ip]" ;; *) o="$o,http://$ip" ;; esac; done
    o="$o,http://localhost,http://127.0.0.1,http://$(hostname)"
  else
    o="$o,https://$DOMINIO"
  fi
  echo "$o"
}

instalar_node() {
  local mayor
  mayor=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
  if [ -n "$mayor" ] && [ "$mayor" -ge 22 ]; then return 0; fi
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt_instalar nodejs
}

instalar_caddy() {
  command -v caddy >/dev/null && return 0
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt_instalar caddy
}

instalar_cloudflared() {
  paso "Configurando Cloudflare Tunnel"
  if ! command -v cloudflared >/dev/null; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg > /usr/share/keyrings/cloudflare-main.gpg
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq
    apt_instalar cloudflared
  fi
  if hay_systemd && systemctl is-enabled -q cloudflared 2>/dev/null; then
    ok "El túnel ya estaba instalado"
    return 0
  fi
  tty_ok && cat > /dev/tty <<EOF
  En Cloudflare: Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared).
  Copiá el token (lo que va después de "service install") y, en "Public Hostname",
  poné $DOMINIO apuntando a  http://localhost:80
EOF
  preguntar CF_TUNNEL_TOKEN "Token del túnel" "" secreto
  [ -n "${CF_TUNNEL_TOKEN:-}" ] || falla "Para el modo cloudflare hace falta el token del túnel."
  if hay_systemd; then
    cloudflared service install "$CF_TUNNEL_TOKEN" >/dev/null 2>&1
  else
    (setsid cloudflared tunnel --no-autoupdate run --token "$CF_TUNNEL_TOKEN" >> /var/log/cloudflared.log 2>&1 < /dev/null &)
  fi
  ok "Túnel instalado"
}

# ¿Anda la secret key? ¿Está cargada la base?
probar_supabase() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SUPABASE_URL/rest/v1/documents?select=id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_KEY" || true)
  case "$code" in
    200) ok "La secret key funciona y la base ya tiene las tablas de documentos"; BASE_OK=1 ;;
    401|403) falla "Supabase rechazó la secret key. Revisala en Project Settings → API Keys y volvé a correr con SUPABASE_SERVICE_KEY=…" ;;
    404) aviso "La secret key funciona, pero la base todavía no tiene las tablas de documentos (falta correr supabase/schema.sql)." ;;
    *) aviso "No pude comprobar Supabase (respuesta $code). Sigo igual." ;;
  esac
}

# Carga supabase/schema.sql si se pasa la cadena de conexión (opcional)
cargar_base() {
  [ "${BASE_OK:-}" = 1 ] && [ -z "${SUPABASE_DB_URL:-}" ] && return 0
  if [ -z "${SUPABASE_DB_URL:-}" ] && tty_ok; then
    cat > /dev/tty <<'EOF'
  Para cargar la base desde acá, pegá la cadena de conexión de Supabase
  (Connect → Session pooler; reemplazá [YOUR-PASSWORD] por la contraseña de la base).
  Enter para saltear y correr supabase/schema.sql a mano en el SQL Editor.
EOF
    preguntar SUPABASE_DB_URL "Cadena de conexión (no se ve al escribir)" "" secreto
  fi
  [ -n "${SUPABASE_DB_URL:-}" ] || { aviso "Acordate de correr supabase/schema.sql en el SQL Editor de Supabase."; return 0; }
  command -v psql >/dev/null || apt_instalar postgresql-client
  if PGOPTIONS='--client-min-messages=warning' psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/supabase/schema.sql" >/dev/null; then
    ok "Base cargada (supabase/schema.sql)"
  else
    aviso "No se pudo cargar la base desde acá. Corré supabase/schema.sql a mano en el SQL Editor de Supabase."
  fi
}

resumen() {
  local url
  case "$MODO" in
    local) url="http://$(hostname -I 2>/dev/null | awk '{print $1}')" ;;
    *) url="https://$DOMINIO" ;;
  esac
  cat <<EOF

${V}${B}✓ Listo${N}

  Web pública:  $url/
  Plataforma:   $url/app/
  Probar sin login (modo demo): $url/app/?demo#/documentos

${B}Falta en Supabase (una sola vez):${N}
  · Authentication → URL Configuration → Redirect URLs: agregá  $url/app/
$( [ "${BASE_OK:-}" = 1 ] || echo "  · SQL Editor: corré supabase/schema.sql (o volvé a correr esto con SUPABASE_DB_URL=…)")
  · Si usan login con Google: en Google Cloud agregá  $url  en "Orígenes autorizados de JavaScript".
$( [ "$MODO" = local ] && echo "
${A}Modo local:${N} sin https el login con link al mail y con Google puede fallar, y la app no se puede instalar.
Para usarlo de verdad, volvé a correr con MODO=dominio o MODO=cloudflare.")

${B}Para actualizar:${N}   aeroglobetec-actualizar
${B}Ver qué pasa:${N}      $(hay_systemd && echo "journalctl -u aeroglobetec-docs -f    ·    journalctl -u caddy -f" || echo "tail -f /var/log/aeroglobetec-docs.log")
EOF
}

main "$@"
