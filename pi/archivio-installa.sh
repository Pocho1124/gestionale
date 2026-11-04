#!/bin/sh
# Archivio immagini (Supabase Storage): immagini come file, fuori dal database, con limiti imposti dal server.
# Uso:
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/archivio-installa.sh > /tmp/archivio-installa.sh && sudo sh /tmp/archivio-installa.sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Esegui con sudo"; exit 1; }

VERSIONE=v1.69.2                       # supabase/storage-api, versione fissata
DIR=/opt/gestionale/immagini
ENVF=/opt/gestionale/immagini.env
SUPA=/opt/supabase/.env
val() { grep "^$1=" "$SUPA" | head -n1 | cut -d= -f2-; }

echo "== 1/6 Lettura della configurazione di Supabase"
PGPW=$(val POSTGRES_PASSWORD); JWT=$(val JWT_SECRET); ANON=$(val ANON_KEY); SERVICE=$(val SERVICE_ROLE_KEY)
PGDB=$(val POSTGRES_DB); PGDB=${PGDB:-postgres}
[ -n "$PGPW" ] && [ -n "$JWT" ] && [ -n "$ANON" ] && [ -n "$SERVICE" ] || { echo "Valori mancanti in $SUPA"; exit 1; }

echo "== 2/6 Accesso dell'archivio al database (ruolo supabase_storage_admin)"
# La password passa da stdin, non dalla riga di comando
printf 'alter role supabase_storage_admin with login password $pw$%s$pw$;\n' "$PGPW" \
  | docker exec -i supabase-db psql -q -U supabase_admin -d "$PGDB" -v ON_ERROR_STOP=1 >/dev/null

echo "== 3/6 Configurazione e avvio del servizio"
mkdir -p "$DIR/dati"
umask 077
cat > "$ENVF" <<CONF
ANON_KEY=$ANON
SERVICE_KEY=$SERVICE
AUTH_JWT_SECRET=$JWT
PGRST_JWT_SECRET=$JWT
POSTGREST_URL=http://rest:3000
DATABASE_URL=postgres://supabase_storage_admin:$PGPW@db:5432/$PGDB
FILE_SIZE_LIMIT=2097152
STORAGE_BACKEND=file
FILE_STORAGE_BACKEND_PATH=/var/lib/storage
TENANT_ID=stub
REGION=stub
GLOBAL_S3_BUCKET=immagini
ENABLE_IMAGE_TRANSFORMATION=false
REQUEST_ALLOW_X_FORWARDED_PATH=true
CONF
chmod 600 "$ENVF"
umask 022
cat > "$DIR/docker-compose.yml" <<YML
name: gestionale-immagini
services:
  immagini:
    image: supabase/storage-api:$VERSIONE
    container_name: gestionale-immagini
    restart: unless-stopped
    env_file: $ENVF
    volumes:
      - $DIR/dati:/var/lib/storage
    mem_limit: 512m
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:5000/status"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      supabase_default:
        aliases: [immagini]
networks:
  supabase_default:
    external: true
YML
(cd "$DIR" && docker compose up -d >/dev/null)
printf "Attendo l'avvio"
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' gestionale-immagini 2>/dev/null)" = "healthy" ]; do
  i=$((i + 1)); [ $i -le 30 ] || { echo; echo "L'archivio non parte. Ultime righe:"; docker logs --tail 20 gestionale-immagini; exit 1; }
  printf "."; sleep 3
done; echo " pronto"

echo "== 4/6 Contenitore «immagini» e regole di accesso"
# Eseguita dall'amministratore del database: le regole sulla tabella storage.objects richiedono i suoi permessi
docker exec -i supabase-db psql -q -At -U supabase_admin -d "$PGDB" -v ON_ERROR_STOP=1 \
  -c "alter function public.configura_archivio_immagini() owner to supabase_admin;" \
  -c "select public.configura_archivio_immagini();"

echo "== 5/6 Gateway: /storage/v1 sul backoffice (porta 80), richieste fino a 3 MB"
CADDY=/opt/supabase/Caddyfile
if ! grep -q '# ARCHIVIO' "$CADDY"; then
  cp "$CADDY" "$CADDY.prima-archivio"
  awk '
    /# BACKOFFICE/ { nel = 1 }
    nel && !fatto && /handle \/config\.json \{/ {
      print "\t\t# ARCHIVIO: immagini (Supabase Storage)"
      print "\t\thandle_path /storage/v1/* {"
      print "\t\t\trequest_body {"
      print "\t\t\t\tmax_size 3MB"
      print "\t\t\t}"
      print "\t\t\treverse_proxy immagini:5000"
      print "\t\t}"
      fatto = 1
    }
    { print }
    END { if (!fatto) exit 3 }' "$CADDY.prima-archivio" > "$CADDY" || { cp "$CADDY.prima-archivio" "$CADDY"; echo "Blocco del backoffice non trovato nel Caddyfile: nessuna modifica"; exit 1; }
fi
# Riavvio del gateway; se non resta in funzione si torna alla configurazione precedente
(cd /opt/supabase && docker compose restart gateway >/dev/null)
sleep 6
GW=$(cd /opt/supabase && docker compose ps -q gateway)
if [ "$(docker inspect -f '{{.State.Running}}' "$GW" 2>/dev/null)" != "true" ] || [ "$(docker inspect -f '{{.State.Restarting}}' "$GW")" = "true" ]; then
  echo "Il gateway non parte con la nuova configurazione: ripristino quella precedente"
  [ -f "$CADDY.prima-archivio" ] && cp "$CADDY.prima-archivio" "$CADDY"
  (cd /opt/supabase && docker compose restart gateway >/dev/null)
  exit 1
fi
CODICE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost/storage/v1/bucket/immagini -H "apikey: $ANON" -H "Authorization: Bearer $ANON" || true)
echo "Verifica del percorso /storage/v1 dal backoffice: risposta HTTP $CODICE (attesa 200, 400 o 404: il servizio risponde)"

echo "== 6/6 Spostamento delle immagini esistenti nell'archivio"
docker run --rm --network supabase_default -v /opt/gestionale/bot:/app:ro \
  -e SUPABASE_URL=http://gateway:8000 -e ARCHIVIO_URL=http://immagini:5000 --env-file "$ENVF" \
  node:22-slim node /app/migra-immagini.mjs || echo "Alcune immagini non sono state spostate: restano visibili dal database, puoi rilanciare questo script."

echo
echo "Archivio immagini attivo. File in $DIR/dati"
echo "IMPORTANTE: includi $DIR/dati nel backup notturno."
