#!/bin/sh
# Installa sul server l'aggiornamento automatico del gestionale e pubblica il backoffice sulla porta 80.
# Rilanciabile senza danni. Uso (terminale di Cockpit):
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/installa-pi.sh | sudo sh
set -eu
[ "$(id -u)" = 0 ] || { echo "Lancia con sudo"; exit 1; }
LAN_CIDR="${LAN_CIDR:-192.168.111.0/24}"
SITO=/opt/gestionale/sito
mkdir -p /opt/gestionale "$SITO/www" "$SITO/conf"

# ---------- 1. Script di aggiornamento ----------
cat > /opt/gestionale/aggiorna.sh <<'SCRIPT'
#!/bin/sh
# Controlla se su GitHub c'è una nuova versione: aggiorna database e backoffice.
set -eu
exec 9>/opt/gestionale/.lock
flock -n 9 || { echo "Aggiornamento già in corso"; exit 0; }
IMG="ghcr.io/pocho1124/gestionale-migrator:latest"
STATO=/opt/gestionale/versione-installata
SITO=/opt/gestionale/sito

if ! docker pull -q "$IMG" >/dev/null 2>&1; then
  echo "Registro non raggiungibile (offline?): riprovo al prossimo giro"
  exit 0
fi
NUOVA=$(docker image inspect -f '{{.Id}}' "$IMG")
if [ "$NUOVA" = "$(cat "$STATO" 2>/dev/null || true)" ] && [ "${1:-}" != "--forza" ]; then
  exit 0
fi

echo "Nuova versione trovata: applico le migrazioni"
PGPASSWORD=$(grep '^POSTGRES_PASSWORD=' /opt/supabase/.env | cut -d= -f2-)
export PGPASSWORD
docker run --rm --network supabase_default \
  -e PGHOST=db -e PGUSER=postgres -e PGDATABASE=postgres -e PGPASSWORD "$IMG"

echo "Aggiorno il backoffice"
CID=$(docker create "$IMG")
rm -rf "$SITO/www.nuovo"
mkdir -p "$SITO/www.nuovo"
docker cp "$CID:/web/." "$SITO/www.nuovo/" >/dev/null
docker rm "$CID" >/dev/null
# Sostituzione rapida: la cartella montata è $SITO, quindi il gateway vede subito la nuova versione
rm -rf "$SITO/www.vecchio"
if [ -d "$SITO/www" ]; then mv "$SITO/www" "$SITO/www.vecchio"; fi
mv "$SITO/www.nuovo" "$SITO/www"
rm -rf "$SITO/www.vecchio"
chmod -R a+rX "$SITO/www"

echo "$NUOVA" > "$STATO"
docker image prune -f >/dev/null
echo "Aggiornamento completato"
SCRIPT
chmod 700 /opt/gestionale/aggiorna.sh

# ---------- 2. Configurazione pubblica del backoffice (solo la anon key, pubblica per design) ----------
ANON=$(grep '^ANON_KEY=' /opt/supabase/.env | cut -d= -f2-)
printf '{"anonKey":"%s"}\n' "$ANON" > "$SITO/conf/config.json"
chmod 644 "$SITO/conf/config.json"

# ---------- 3. Gateway: porta 80 con backoffice + API sullo stesso indirizzo ----------
cat > /opt/supabase/docker-compose.override.yml <<'YML'
# Aggiunto da installa-pi.sh: backoffice del gestionale sulla porta 80
services:
  gateway:
    ports:
      - "80:80"
    volumes:
      - /opt/gestionale/sito:/srv:ro
YML

if ! grep -q '# BACKOFFICE' /opt/supabase/Caddyfile; then
  cat >> /opt/supabase/Caddyfile <<'CADDY'

# BACKOFFICE (aggiunto da installa-pi.sh): app del gestionale + API Supabase sullo stesso indirizzo
:80 {
	route {
		@rt_blocked path /realtime/v1/api/tenants* /realtime/v1/api/openapi*
		respond @rt_blocked 403

		handle_path /auth/v1/* {
			reverse_proxy auth:9999
		}
		handle_path /rest/v1/* {
			reverse_proxy rest:3000
		}
		handle_path /realtime/v1/api/* {
			rewrite * /api{uri}
			reverse_proxy realtime-dev.supabase-realtime:4000 {
				header_up Host {upstream_hostport}
			}
		}
		handle_path /realtime/v1/* {
			rewrite * /socket{uri}
			reverse_proxy realtime-dev.supabase-realtime:4000 {
				header_up Host {upstream_hostport}
			}
		}
		handle /config.json {
			header Cache-Control "no-store"
			root * /srv/conf
			file_server
		}
		handle {
			@pagine not path /assets/*
			header @pagine Cache-Control "no-cache"
			root * /srv/www
			try_files {path} /index.html
			file_server
		}
	}
}
CADDY
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow from "$LAN_CIDR" to any port 80 proto tcp >/dev/null
fi

# ---------- 4. Servizio e timer ----------
cat > /etc/systemd/system/gestionale-aggiorna.service <<'UNIT'
[Unit]
Description=Aggiornamento automatico del gestionale
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/gestionale/aggiorna.sh
UNIT

cat > /etc/systemd/system/gestionale-aggiorna.timer <<'UNIT'
[Unit]
Description=Controllo aggiornamenti del gestionale ogni 5 minuti

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
# Ferma il timer durante l'installazione: niente aggiornamenti in parallelo
systemctl stop gestionale-aggiorna.timer 2>/dev/null || true
systemctl enable gestionale-aggiorna.timer >/dev/null
/opt/gestionale/aggiorna.sh --forza
(cd /opt/supabase && docker compose up -d gateway >/dev/null && docker compose restart gateway >/dev/null)
systemctl start gestionale-aggiorna.timer

IP=$(hostname -I | awk '{print $1}')
echo "Aggiornamento automatico attivo: controllo ogni 5 minuti (log in Cockpit > Registri)."
echo "Backoffice: http://$IP"
