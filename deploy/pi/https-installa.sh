#!/bin/sh
# HTTPS nella rete del locale per il backoffice (certificati dell'autorità interna di Caddy).
# Le pagine dei clienti (/t/ tavolo, /m/ menu interno) restano raggiungibili anche in HTTP: i telefoni dei clienti
# non hanno il certificato del locale. Tutto il resto in HTTP viene reindirizzato su HTTPS.
# Uso:
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/https-installa.sh > /tmp/https-installa.sh && sudo sh /tmp/https-installa.sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Esegui con sudo"; exit 1; }

CADDY=/opt/supabase/Caddyfile
OVR=/opt/supabase/docker-compose.override.yml
IP=${1:-$(hostname -I | awk '{print $1}')}
echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || { echo "Indirizzo IP non valido: $IP"; exit 1; }
grep -q '# BACKOFFICE' "$CADDY" || { echo "Blocco del backoffice non trovato in $CADDY: esegui prima l'installer del gestionale"; exit 1; }

echo "== 1/5 Copia di sicurezza della configurazione"
STAMP=$(date +%Y%m%d-%H%M%S)
cp "$CADDY" "$CADDY.prima-https-$STAMP"
cp "$OVR" "$OVR.prima-https-$STAMP"
ripristina() {
  echo "Ripristino della configurazione precedente"
  cp "$CADDY.prima-https-$STAMP" "$CADDY"; cp "$OVR.prima-https-$STAMP" "$OVR"
  (cd /opt/supabase && docker compose up -d gateway >/dev/null 2>&1 || true)
}

echo "== 2/5 Gateway: porta 443 e certificati persistenti"
mkdir -p /opt/gestionale/caddy-dati
GW=$(cd /opt/supabase && docker compose ps -q gateway)
DATI=""
docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$GW" | tr ' ' '\n' | grep -qx /data || DATI="      - /opt/gestionale/caddy-dati:/data"
cat > "$OVR" <<YML
# Gestito da installa-pi.sh e https-installa.sh: backoffice sulle porte 80 e 443
services:
  gateway:
    ports:
      - "$IP:80:80"
      - "$IP:443:443"
    volumes:
      - /opt/gestionale/sito:/srv:ro
$DATI
YML

echo "== 3/5 Configurazione del gateway (HTTPS per lo staff, HTTP solo per le pagine dei clienti)"
# La sezione del backoffice è in fondo al file ed è generata dagli installer: si riscrive per intero
awk '/# BACKOFFICE/ { exit } { print }' "$CADDY.prima-https-$STAMP" > "$CADDY"
cat >> "$CADDY" <<CADDYCONF
# BACKOFFICE (gestito da https-installa.sh): app del gestionale + API Supabase sullo stesso indirizzo
(api_gestionale) {
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
	# ARCHIVIO: immagini (Supabase Storage)
	handle_path /storage/v1/* {
		request_body {
			max_size 3MB
		}
		reverse_proxy immagini:5000
	}
}

(sito_gestionale) {
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

https://$IP {
	tls internal
	header {
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy same-origin
		-Server
	}
	route {
		import api_gestionale
		import sito_gestionale
	}
}

:80 {
	route {
		# Certificato dell'autorità del locale, da installare sui dispositivi dello staff (è pubblico per natura)
		handle /certificato-locale.crt {
			header Content-Type application/x-x509-ca-cert
			root * /srv/conf
			file_server
		}
		# Pagine dei clienti e le sole API che usano: restano in HTTP
		@clienti path /t/* /m/* /assets/* /config.json /favicon* /rest/v1/rpc/* /storage/v1/object/public/*
		handle @clienti {
			route {
				import api_gestionale
				import sito_gestionale
			}
		}
		# Tutto il resto (backoffice, accesso, dati) solo in HTTPS
		handle {
			redir https://{host}{uri} permanent
		}
	}
}
CADDYCONF

if command -v ufw >/dev/null 2>&1; then
  RETE=$(ufw status | awk '$1=="80/tcp" && $2=="ALLOW" {print $3; exit}')
  if [ -n "$RETE" ]; then ufw allow from "$RETE" to any port 443 proto tcp >/dev/null; echo "Firewall: porta 443 aperta solo a $RETE"
  else echo "ATTENZIONE: regola della porta 80 non trovata in ufw: apri la 443 solo alla rete del locale"; fi
fi

echo "== 4/5 Riavvio del gateway"
(cd /opt/supabase && docker compose up -d gateway >/dev/null) || { ripristina; exit 1; }
sleep 8
GW=$(cd /opt/supabase && docker compose ps -q gateway)
if [ "$(docker inspect -f '{{.State.Running}}' "$GW" 2>/dev/null)" != "true" ] || [ "$(docker inspect -f '{{.State.Restarting}}' "$GW")" = "true" ]; then
  echo "Il gateway non parte con la nuova configurazione. Ultime righe:"; docker logs --tail 15 "$GW" 2>&1 || true
  ripristina; exit 1
fi
CODICE=$(curl -sk -o /dev/null -w '%{http_code}' "https://$IP/" || true)
[ "$CODICE" = "200" ] || { echo "Il backoffice in HTTPS non risponde (HTTP $CODICE)"; ripristina; exit 1; }
REDIR=$(curl -s -o /dev/null -w '%{http_code}' "http://$IP/" || true)

echo "== 5/5 Certificato dell'autorità del locale"
docker exec "$GW" cat /data/caddy/pki/authorities/local/root.crt > /opt/gestionale/sito/conf/certificato-locale.crt
chmod 644 /opt/gestionale/sito/conf/certificato-locale.crt
IMPRONTA=$(openssl x509 -in /opt/gestionale/sito/conf/certificato-locale.crt -noout -fingerprint -sha256 | cut -d= -f2)

echo
echo "HTTPS attivo: https://$IP  (HTTP del backoffice -> HTTPS: risposta $REDIR)"
echo "Certificato da installare sui dispositivi dello staff: http://$IP/certificato-locale.crt"
echo "Impronta SHA-256 da confrontare sul dispositivo: $IMPRONTA"
echo "Le pagine dei clienti (/t/..., /m/...) restano raggiungibili anche in HTTP."
