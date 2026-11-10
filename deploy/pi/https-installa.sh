#!/bin/sh
# HTTPS nella rete del locale per il backoffice.
#  - Con --dominio (consigliato): certificato Let's Encrypt valido su tutti i dispositivi, ottenuto con la verifica DNS
#    di Cloudflare (il server NON deve essere raggiungibile da internet); record DNS creato in automatico verso
#    l'indirizzo locale; rinnovo automatico ogni notte.
#  - Senza dominio: certificato dell'autorità interna di Caddy, da installare a mano su ogni dispositivo.
# Le pagine dei clienti (/t/ tavolo, /m/ menu interno) restano raggiungibili anche in HTTP.
# Tutto il resto in HTTP viene reindirizzato su HTTPS.
# Uso:
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/https-installa.sh > /tmp/https-installa.sh && sudo sh /tmp/https-installa.sh --dominio gestionale.enotechiasantalucia.it
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Esegui con sudo"; exit 1; }

CADDY=/opt/supabase/Caddyfile
OVR=/opt/supabase/docker-compose.override.yml
IP=$(hostname -I | awk '{print $1}')
DOMINIO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dominio) DOMINIO=${2:-}; shift 2 ;;
    *) IP=$1; shift ;;
  esac
done
echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || { echo "Indirizzo IP non valido: $IP"; exit 1; }
if [ -n "$DOMINIO" ]; then
  echo "$DOMINIO" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' || { echo "Dominio non valido: $DOMINIO"; exit 1; }
fi
LEGO_IMMAGINE=goacme/lego:v4.29.0
CERT=/opt/gestionale/certificati
ENVH=/opt/gestionale/https.env
grep -q '# BACKOFFICE' "$CADDY" || { echo "Blocco del backoffice non trovato in $CADDY: esegui prima l'installer del gestionale"; exit 1; }

# ---------- Certificato Let's Encrypt (solo con --dominio) ----------
if [ -n "$DOMINIO" ]; then
  ZONA=$(echo "$DOMINIO" | awk -F. '{print $(NF-1)"."$NF}')
  umask 077
  if [ ! -s "$ENVH" ] || ! grep -q "^DOMINIO=$DOMINIO\$" "$ENVH"; then
    echo "== Token Cloudflare per la verifica DNS"
    echo "   Crealo su dash.cloudflare.com → Il mio profilo → Token API → Crea token → «Modifica DNS zona», con i permessi"
    echo "   Zona → Zona → Lettura e Zona → DNS → Modifica, solo per la zona $ZONA. Resta solo su questo server."
    printf "Token: "; stty -echo 2>/dev/null || true; read -r TOKEN; stty echo 2>/dev/null || true; echo
    echo "$TOKEN" | grep -Eq '^[A-Za-z0-9_-]{30,}$' || { echo "Token non valido"; exit 1; }
    printf "Email per gli avvisi di scadenza di Let's Encrypt: "; read -r EMAIL
    echo "$EMAIL" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || { echo "Email non valida"; exit 1; }
    printf 'CLOUDFLARE_DNS_API_TOKEN=%s\nLEGO_EMAIL=%s\nDOMINIO=%s\n' "$TOKEN" "$EMAIL" "$DOMINIO" > "$ENVH"
    chmod 600 "$ENVH"
  fi
  . "$ENVH"
  # Il token arriva a curl da stdin (non compare nella lista dei processi)
  cf() { printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_DNS_API_TOKEN" | curl -sS --max-time 30 -K - "$@"; }
  API=https://api.cloudflare.com/client/v4

  echo "== Record DNS $DOMINIO → $IP (solo DNS, non passa da Cloudflare)"
  ZID=$(cf "$API/zones?name=$ZONA" | grep -o '"id":"[0-9a-f]\{32\}"' | head -1 | cut -d'"' -f4)
  [ -n "$ZID" ] || { echo "Zona $ZONA non trovata: controlla i permessi del token (Zona → Lettura)"; exit 1; }
  RID=$(cf "$API/zones/$ZID/dns_records?type=A&name=$DOMINIO" | grep -o '"id":"[0-9a-f]\{32\}"' | head -1 | cut -d'"' -f4)
  CORPO=$(printf '{"type":"A","name":"%s","content":"%s","ttl":300,"proxied":false,"comment":"Gestionale: solo rete del locale"}' "$DOMINIO" "$IP")
  if [ -n "$RID" ]; then ESITO=$(cf -X PUT "$API/zones/$ZID/dns_records/$RID" -H "Content-Type: application/json" --data "$CORPO")
  else ESITO=$(cf -X POST "$API/zones/$ZID/dns_records" -H "Content-Type: application/json" --data "$CORPO"); fi
  echo "$ESITO" | grep -q '"success":true' || { echo "Record DNS non salvato: controlla i permessi del token (DNS → Modifica)"; exit 1; }

  # Niente controllo della propagazione interrogando direttamente i nameserver: molte reti (router, operatore) bloccano
  # o intercettano le richieste DNS in uscita e rispondono REFUSED. Si attendono 90 secondi: Cloudflare pubblica il
  # record in pochi secondi e la verifica vera la fa Let's Encrypt dai suoi server.
  echo "== Certificato Let's Encrypt (verifica DNS, circa due minuti)"
  mkdir -p "$CERT"
  if [ -s "$CERT/certificates/$DOMINIO.crt" ]; then AZIONE="renew --days 30"; else AZIONE="run"; fi
  # shellcheck disable=SC2086
  docker run --rm --env-file "$ENVH" -v "$CERT:/.lego" "$LEGO_IMMAGINE" --accept-tos --email "$LEGO_EMAIL" --dns cloudflare \
    --dns.resolvers 1.1.1.1:53 --dns.propagation-wait 90s --domains "$DOMINIO" --path /.lego $AZIONE \
    || { echo "Certificato non ottenuto: controlla token e dominio, poi rilancia"; exit 1; }
  [ -s "$CERT/certificates/$DOMINIO.crt" ] || { echo "Certificato non trovato dopo la richiesta"; exit 1; }
  # La chiave di lego è leggibile solo da root: se ne fa una copia per l'utente con cui gira il gateway
  GWID=$(cd /opt/supabase && docker compose ps -q gateway)
  UG=$(docker exec "$GWID" sh -c 'echo "$(id -u):$(id -g)"' 2>/dev/null || echo 0:0)
  echo "$UG" | grep -Eq '^[0-9]+:[0-9]+$' || UG=0:0
  copia_certificato() {
    install -d -m 750 -o "${UG%:*}" -g "${UG#*:}" "$CERT/gateway"
    install -m 644 -o "${UG%:*}" -g "${UG#*:}" "$CERT/certificates/$DOMINIO.crt" "$CERT/gateway/$DOMINIO.crt"
    install -m 600 -o "${UG%:*}" -g "${UG#*:}" "$CERT/certificates/$DOMINIO.key" "$CERT/gateway/$DOMINIO.key"
  }
  copia_certificato

  echo "== Rinnovo automatico ogni notte"
  cat > /opt/gestionale/rinnova-certificato.sh <<RINNOVO
#!/bin/sh
# Rinnova il certificato Let's Encrypt quando mancano meno di 30 giorni; se cambia, riavvia il gateway.
set -eu
. $ENVH
PRIMA=\$(sha256sum "$CERT/certificates/\$DOMINIO.crt" | cut -d' ' -f1)
docker run --rm --env-file $ENVH -v "$CERT:/.lego" $LEGO_IMMAGINE --accept-tos --email "\$LEGO_EMAIL" --dns cloudflare \\
  --dns.resolvers 1.1.1.1:53 --dns.propagation-wait 90s --domains "\$DOMINIO" --path /.lego renew --days 30
DOPO=\$(sha256sum "$CERT/certificates/\$DOMINIO.crt" | cut -d' ' -f1)
if [ "\$PRIMA" != "\$DOPO" ]; then
  install -m 644 -o ${UG%:*} -g ${UG#*:} "$CERT/certificates/\$DOMINIO.crt" "$CERT/gateway/\$DOMINIO.crt"
  install -m 600 -o ${UG%:*} -g ${UG#*:} "$CERT/certificates/\$DOMINIO.key" "$CERT/gateway/\$DOMINIO.key"
  (cd /opt/supabase && docker compose restart gateway >/dev/null); echo "Certificato rinnovato"
fi
RINNOVO
  chmod 700 /opt/gestionale/rinnova-certificato.sh
  cat > /etc/systemd/system/gestionale-certificato.service <<UNIT
[Unit]
Description=Rinnovo del certificato HTTPS del gestionale
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/gestionale/rinnova-certificato.sh
UNIT
  cat > /etc/systemd/system/gestionale-certificato.timer <<UNIT
[Unit]
Description=Rinnovo notturno del certificato HTTPS del gestionale
[Timer]
OnCalendar=*-*-* 04:15
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now gestionale-certificato.timer >/dev/null
fi

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
[ -z "$DOMINIO" ] || DATI="$DATI
      - $CERT/gateway:/certificati:ro"
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

(backoffice) {
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

https://$IP {
	tls internal
	import backoffice
}
$(if [ -n "$DOMINIO" ]; then printf '\nhttps://%s {\n\ttls /certificati/%s.crt /certificati/%s.key\n\timport backoffice\n}\n' "$DOMINIO" "$DOMINIO" "$DOMINIO"; fi)

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
		# Tutto il resto (backoffice, accesso, dati) solo in HTTPS; con il dominio si va sempre al nome con il certificato valido
		handle {
			redir https://$(if [ -n "$DOMINIO" ]; then printf '%s' "$DOMINIO"; else printf '{host}'; fi){uri} permanent
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
GW=$(cd /opt/supabase && docker compose ps -q gateway)
log_gateway() {
  echo "Porte pubblicate:"; docker port "$GW" 2>&1 | sed 's/^/   /' || true
  echo "Ultime righe del gateway:"; docker logs --tail 25 "$GW" 2>&1 | sed 's/^/   /' || true
}
# Con il dominio si verifica il nome (curl invia il nome del server, SNI); senza, l'indirizzo IP
if [ -n "$DOMINIO" ]; then URL_PROVA="https://$DOMINIO/"; OPZ="--resolve $DOMINIO:443:$IP"; else URL_PROVA="https://$IP/"; OPZ="-k"; fi
CODICE=000
for _ in 1 2 3 4 5 6 7 8; do
  sleep 5
  # shellcheck disable=SC2086
  CODICE=$(curl -s $OPZ --max-time 5 -o /dev/null -w '%{http_code}' "$URL_PROVA" || true)
  [ "$CODICE" = "200" ] && break
done
if [ "$(docker inspect -f '{{.State.Running}}' "$GW" 2>/dev/null)" != "true" ] || [ "$(docker inspect -f '{{.State.Restarting}}' "$GW")" = "true" ]; then
  echo "Il gateway non parte con la nuova configurazione."; log_gateway
  ripristina; exit 1
fi
# Con il dominio il certificato deve risultare valido (nessun -k)
[ "$CODICE" = "200" ] || { echo "$URL_PROVA non risponde in HTTPS (HTTP $CODICE)"; log_gateway; ripristina; exit 1; }
if [ -n "$DOMINIO" ]; then
  # L'accesso per indirizzo IP è solo di riserva: senza nome il gateway nel container può non trovare il certificato
  CODICE_IP=$(curl -sk --max-time 5 -o /dev/null -w '%{http_code}' "https://$IP/" || true)
  [ "$CODICE_IP" = "200" ] || echo "Nota: https://$IP non risponde (HTTP $CODICE_IP); usa https://$DOMINIO"
fi
REDIR=$(curl -s -o /dev/null -w '%{http_code}' "http://$IP/" || true)

echo "== 5/5 Certificato dell'autorità del locale"
docker exec "$GW" cat /data/caddy/pki/authorities/local/root.crt > /opt/gestionale/sito/conf/certificato-locale.crt
chmod 644 /opt/gestionale/sito/conf/certificato-locale.crt
IMPRONTA=$(openssl x509 -in /opt/gestionale/sito/conf/certificato-locale.crt -noout -fingerprint -sha256 | cut -d= -f2)

echo
if [ -n "$DOMINIO" ]; then
  echo "HTTPS attivo con certificato valido: https://$DOMINIO  (rinnovo automatico ogni notte)"
  echo "Sui dispositivi dello staff apri quell'indirizzo: non serve installare nessun certificato."
  echo "Se il nome non si apre in negozio, il router blocca i nomi che puntano alla rete locale (protezione «DNS rebinding»):"
  echo "aggiungi un'eccezione per $DOMINIO nelle impostazioni DNS del router."
fi
if [ -z "$DOMINIO" ]; then
  echo "HTTPS attivo: https://$IP"
  echo "Certificato da installare sui dispositivi dello staff: http://$IP/certificato-locale.crt"
  echo "Impronta SHA-256 da confrontare sul dispositivo: $IMPRONTA"
fi
echo "HTTP del backoffice -> HTTPS: risposta $REDIR"
echo "Le pagine dei clienti (/t/..., /m/...) restano raggiungibili anche in HTTP."
