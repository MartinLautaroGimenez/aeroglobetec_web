#!/usr/bin/env bash
# =====================================================================
# Publica la web pública y la plataforma de AeroGlobETec en un contenedor Debian/Ubuntu
# (por ejemplo un CT de Proxmox, para probar fuera del servidor de la escuela).
# Instala Caddy, baja el código y lo sirve; https automático con dominio o Cloudflare Tunnel.
#
# Uso (como root):
#   curl -fsSL https://raw.githubusercontent.com/MartinLautaroGimenez/aeroglobetec_web/main/deploy/instalar.sh | bash
#
# Se puede volver a correr para ACTUALIZAR: recuerda lo que contestaste (/etc/aeroglobetec/instalar.conf).
# También queda el comando: aeroglobetec-actualizar
#
# Sin preguntas: RAMA=main MODO=local NO_INTERACTIVO=1 bash instalar.sh
#   MODO: local (http, para probar en la red) · dominio (https automático) · cloudflare (Cloudflare Tunnel)
#   Otras: DOMINIO, CF_TUNNEL_TOKEN, REPO_URL
#   Otro proyecto de Supabase (uno de prueba): SUPABASE_URL y SUPABASE_ANON_KEY (la publishable key).
# =====================================================================
set -Eeuo pipefail

main() {
  REPO_URL=${REPO_URL:-https://github.com/MartinLautaroGimenez/aeroglobetec_web.git}
  DIR=/opt/aeroglobetec_web
  WEB=/var/www/aeroglobetec
  CONF=/etc/aeroglobetec/instalar.conf

  if [ -t 1 ]; then B=$'\e[1m'; V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; V=; A=; R=; N=; fi
  trap 'echo "${R}✗ Falló en la línea $LINENO. Revisá el mensaje de arriba y volvé a correr el instalador.${N}" >&2' ERR

  [ "$(id -u)" = 0 ] || falla "Corré el instalador como root (en el CT entrás como root; si no, con sudo)."
  command -v apt-get >/dev/null || falla "Este instalador es para Debian o Ubuntu."

  echo "${B}AeroGlobETec · publicar la web y la plataforma${N}"
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
    preguntar DOMINIO "Dominio (ej.: aeroglobe.tudominio.com)" ""
    [ -n "$DOMINIO" ] || falla "Para el modo $MODO hace falta el dominio."
  fi
  guardar_conf

  # ---------- Paquetes ----------
  paso "Instalando paquetes del sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt_instalar ca-certificates curl git gnupg rsync
  instalar_caddy
  ok "Paquetes listos ($(caddy version | cut -d' ' -f1))"

  # ---------- Código ----------
  paso "Bajando el código (rama $RAMA)"
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" remote set-url origin "$REPO_URL"
    git -C "$DIR" fetch -q --depth 1 origin "$RAMA"
    git -C "$DIR" checkout -q -B "$RAMA" FETCH_HEAD
    git -C "$DIR" reset -q --hard FETCH_HEAD
    git -C "$DIR" clean -fdxq
  else
    git clone -q --depth 1 --branch "$RAMA" "$REPO_URL" "$DIR"
  fi
  [ -f "$DIR/app/index.html" ] || falla "No encontré la plataforma en la rama \"$RAMA\"."
  ok "Código en $DIR ($(git -C "$DIR" log -1 --format='%h · %s'))"

  # Proyecto de Supabase: el del taller (app/js/config.js) u otro, por ejemplo uno de prueba
  local orig_url orig_key
  orig_url=$(sed -n "s/^export const SUPABASE_URL = '\(.*\)';.*/\1/p" "$DIR/app/js/config.js")
  orig_key=$(sed -n "s/^export const SUPABASE_KEY = '\(.*\)';.*/\1/p" "$DIR/app/js/config.js")
  [ -n "$orig_url" ] && [ -n "$orig_key" ] || falla "No encontré la URL o la clave pública de Supabase en app/js/config.js."
  if [ -z "${SUPABASE_URL:-}" ] && tty_ok; then
    echo "  ¿Qué proyecto de Supabase uso? Enter = el del taller. Para uno de prueba, pegá su URL (Project Settings → Data API)." > /dev/tty
  fi
  preguntar SUPABASE_URL "URL del proyecto" "$orig_url"
  SUPABASE_URL=${SUPABASE_URL%/}
  [[ "$SUPABASE_URL" =~ ^https://[^/]+$ ]] || falla "La URL de Supabase tiene que ser como https://xxxx.supabase.co"
  if [ "$SUPABASE_URL" = "$orig_url" ]; then
    SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-$orig_key}
  else
    preguntar SUPABASE_ANON_KEY "Publishable key de ese proyecto (Project Settings → API Keys)" ""
    [ -n "${SUPABASE_ANON_KEY:-}" ] || falla "Para otro proyecto de Supabase hace falta su publishable key."
  fi
  guardar_conf
  ok "Supabase: $SUPABASE_URL$( [ "$SUPABASE_URL" = "$orig_url" ] && echo ' (el del taller)' || echo ' (otro proyecto)')"

  # ---------- Web y plataforma ----------
  paso "Publicando la web y la plataforma en $WEB"
  mkdir -p "$WEB"
  rsync -a --delete "$DIR/index.html" "$DIR/assets" "$DIR/app" "$WEB/"
  # Otro proyecto de Supabase: se cambia la dirección y la clave pública en la copia publicada
  if [ "$SUPABASE_URL" != "$orig_url" ] || [ "$SUPABASE_ANON_KEY" != "$orig_key" ]; then
    local ref_o ref_n
    ref_o=$(sed -E 's#^https://([^.]+)\..*#\1#' <<< "$orig_url")
    ref_n=$(sed -E 's#^https://([^.]+)\..*#\1#' <<< "$SUPABASE_URL")
    grep -rlF -e "$orig_url" -e "$orig_key" --include='*.html' --include='*.js' "$WEB/index.html" "$WEB/app" \
      | xargs -r sed -i "s#$orig_url#$SUPABASE_URL#g; s#$orig_key#$SUPABASE_ANON_KEY#g; s#$ref_o#$ref_n#g"
    grep -qF "'$SUPABASE_URL'" "$WEB/app/js/config.js" || falla "No pude cambiar el proyecto de Supabase en app/js/config.js."
    ok "La web y la plataforma usan $SUPABASE_URL"
  fi
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
	root * $WEB
	header /app/* Cache-Control "no-cache"
	header /index.html Cache-Control "no-cache"
	file_server
}
EOF
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; falla "La configuración de Caddy tiene un error."; }
  ok "Caddy configurado (${sitio})"

  [ "$MODO" = cloudflare ] && instalar_cloudflared

  # ---------- Servicios ----------
  paso "Arrancando"
  if hay_systemd; then
    # El servidor de documentos de la versión anterior ya no se usa
    if [ -f /etc/systemd/system/aeroglobetec-docs.service ]; then
      systemctl disable -q --now aeroglobetec-docs 2>/dev/null || true
      rm -f /etc/systemd/system/aeroglobetec-docs.service
      systemctl daemon-reload
      ok "Se apagó el servidor de documentos anterior (ya no hace falta)"
    fi
    systemctl enable -q caddy
    systemctl reload-or-restart caddy
  else
    pkill -f "docs-server/server.js" 2>/dev/null || true
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
    case "$k" in RAMA|MODO|DOMINIO|SUPABASE_URL|SUPABASE_ANON_KEY) [ -z "${!k:-}" ] && printf -v "$k" '%s' "$v" ;; esac
  done < "$CONF"
  ok "Usando la configuración guardada en $CONF"
}
guardar_conf() {
  mkdir -p "$(dirname "$CONF")"
  # La publishable key es pública por diseño
  printf 'RAMA=%s\nMODO=%s\nDOMINIO=%s\nSUPABASE_URL=%s\nSUPABASE_ANON_KEY=%s\n' "$RAMA" "$MODO" "${DOMINIO:-}" "${SUPABASE_URL:-}" "${SUPABASE_ANON_KEY:-}" > "$CONF"
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

url_publica() {
  case "$MODO" in
    local) echo "http://$(hostname -I 2>/dev/null | awk '{print $1}')" ;;
    *) echo "https://$DOMINIO" ;;
  esac
}

resumen() {
  local url
  url=$(url_publica)
  cat <<EOF

${V}${B}✓ Listo${N}

  Web pública:  $url/
  Plataforma:   $url/app/
  Probar sin login (modo demo): $url/app/?demo

${B}En Supabase (${SUPABASE_URL}):${N}
  · SQL Editor: corré supabase/schema.sql cada vez que cambie.
  · Authentication → URL Configuration → Redirect URLs: agregá  $url/app/
$( [ "$MODO" = local ] && echo "
${A}Modo local:${N} sin https el login puede fallar y la app no se puede instalar.
Para usarlo de verdad, volvé a correr con MODO=dominio o MODO=cloudflare.")

${B}Para actualizar:${N}   aeroglobetec-actualizar
EOF
}

main "$@"
