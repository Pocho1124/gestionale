#!/bin/sh
# Servizio di stampa dei reparti (comande sulle stampanti termiche di rete).
# Uso:
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/stampa-installa.sh > /tmp/stampa-installa.sh && sudo sh /tmp/stampa-installa.sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Esegui con sudo"; exit 1; }
SUPA=/opt/supabase/.env
ENVF=/opt/gestionale/stampa.env
DIR=/opt/gestionale/stampa
[ -f /opt/gestionale/bot/stampa.mjs ] || { echo "Codice non trovato: lancia prima sudo /opt/gestionale/aggiorna.sh --forza"; exit 1; }
JWT=$(grep '^JWT_SECRET=' "$SUPA" | cut -d= -f2-)
ANON=$(grep '^ANON_KEY=' "$SUPA" | cut -d= -f2-)
[ -n "$JWT" ] && [ -n "$ANON" ] || { echo "JWT_SECRET o ANON_KEY mancanti in $SUPA"; exit 1; }

echo "== 1/2 Configurazione (token del ruolo servizio_stampa, non la chiave di servizio)"
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
TESTA=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
SCADENZA=$(( $(date +%s) + 5 * 365 * 24 * 3600 ))
CORPO=$(printf '{"role":"servizio_stampa","iss":"gestionale","iat":%s,"exp":%s}' "$(date +%s)" "$SCADENZA" | b64url)
FIRMA=$(printf '%s.%s' "$TESTA" "$CORPO" | openssl dgst -sha256 -hmac "$JWT" -binary | b64url)
umask 077
printf 'SUPABASE_URL=http://gateway:8000\nSUPABASE_ANON_KEY=%s\nSTAMPA_TOKEN=%s.%s.%s\nTZ=Europe/Rome\n' "$ANON" "$TESTA" "$CORPO" "$FIRMA" > "$ENVF"
chmod 600 "$ENVF"; umask 022
mkdir -p "$DIR"
cat > "$DIR/docker-compose.yml" <<YML
name: gestionale-stampa
services:
  stampa:
    image: node:22-slim
    container_name: gestionale-stampa
    restart: unless-stopped
    command: ["node", "/app/stampa.mjs"]
    env_file: $ENVF
    volumes:
      - /opt/gestionale/bot:/app:ro
    user: node
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 128m
    networks: [supabase_default]
networks:
  supabase_default:
    external: true
YML

echo "== 2/2 Avvio"
(cd "$DIR" && docker compose up -d --force-recreate >/dev/null)
sleep 4
docker logs --tail 3 gestionale-stampa
echo
echo "Servizio di stampa attivo. Aggiungi le stampanti in Impostazioni → Reparti e stampanti e usa «Stampa di prova»."
