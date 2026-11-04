#!/bin/bash
# Menu pubblico dei clienti sul dominio del locale tramite Cloudflare (Worker + database D1 per le pagine + archivio KV per le immagini).
# Il server non apre porte: è lui a inviare pagine e immagini a Cloudflare quando il menu cambia.
# Due token Cloudflare: CONFIGURAZIONE (usato solo ora, non salvato) e PUBBLICAZIONE (solo KV e D1, salvato sul server).
# Uso (terminale di Cockpit):
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/pubblicatore-installa.sh > /tmp/pubblicatore-installa.sh && sudo bash /tmp/pubblicatore-installa.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Lancia con sudo"; exit 1; }
[[ -f /opt/gestionale/bot/pubblicatore.mjs ]] || { echo "Codice del pubblicatore assente: lancia prima sudo /opt/gestionale/aggiorna.sh --forza"; exit 1; }
IMMAGINE=ghcr.io/pocho1124/gestionale-migrator:latest
API=https://api.cloudflare.com/client/v4
ENVF=/opt/gestionale/pubblicatore.env
WORKER=$(mktemp)
trap 'rm -f "$WORKER"' EXIT
docker run --rm --entrypoint cat "$IMMAGINE" /deploy/cloudflare/menu-worker.js > "$WORKER"
[[ -s "$WORKER" ]] || { echo "Worker del menu non trovato nell'immagine: aggiorna prima il server"; exit 1; }
ANON=$(grep '^ANON_KEY=' /opt/supabase/.env | cut -d= -f2-)
PSQL=(docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At)
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
ok() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else (print(json.dumps(d.get('errors')), file=sys.stderr) or 1))"; }

ELENCO=$("${PSQL[@]}" -c "select string_agg(slug, ',' order by slug) from public.locali where attivo")
echo "Locali da pubblicare: ${ELENCO:-nessuno}"
read -rp "Premi Invio per confermare, oppure scrivi gli indirizzi separati da virgola: " SCELTA
SLUGS=${SCELTA:-$ELENCO}; SLUGS=${SLUGS// /}
[[ "$SLUGS" =~ ^[a-z0-9-]+(,[a-z0-9-]+)*$ ]] || { echo "Elenco non valido."; exit 1; }
SLUG=${SLUGS%%,*}

read -rp "ID account Cloudflare (Panoramica del dominio, colonna a destra): " ACCOUNT
[[ "$ACCOUNT" =~ ^[0-9a-f]{32}$ ]] || { echo "ID account non valido"; exit 1; }
read -rp "Dominio [enotechiasantalucia.it]: " DOMINIO; DOMINIO=${DOMINIO:-enotechiasantalucia.it}
read -rp "Indirizzo del menu [menu.$DOMINIO]: " HOST; HOST=${HOST:-menu.$DOMINIO}
[[ "$HOST" =~ ^[a-z0-9.-]+$ ]] || { echo "Indirizzo non valido"; exit 1; }
read -rsp "Token di CONFIGURAZIONE (non viene salvato): " TCONF; echo
read -rsp "Token di PUBBLICAZIONE (solo KV e D1): " TPUB; echo
cf() { local metodo=$1 percorso=$2; shift 2; curl -sS --max-time 30 -X "$metodo" "$API$percorso" -H "Authorization: Bearer $TCONF" "$@"; }

echo "== 1/6 Verifica dei token"
curl -sS "$API/user/tokens/verify" -H "Authorization: Bearer $TCONF" | ok || { echo "Token di configurazione non valido"; exit 1; }
curl -sS "$API/user/tokens/verify" -H "Authorization: Bearer $TPUB" | ok || { echo "Token di pubblicazione non valido"; exit 1; }

echo "== 2/6 Zona del dominio"
ZONA=$(cf GET "/zones?name=$DOMINIO" | json "d['result'][0]['id'] if d.get('result') else ''")
[[ -n "$ZONA" ]] || { echo "Dominio $DOMINIO non trovato nell'account (o token senza permesso Zone: Read)"; exit 1; }

echo "== 3/6 Archivio del menu (KV)"
KV=$(cf GET "/accounts/$ACCOUNT/storage/kv/namespaces?per_page=100" | json "next((n['id'] for n in d.get('result') or [] if n['title']=='menu-gestionale'), '')")
[[ -n "$KV" ]] || KV=$(cf POST "/accounts/$ACCOUNT/storage/kv/namespaces" -H "Content-Type: application/json" --data '{"title":"menu-gestionale"}' | json "d['result']['id']")
echo "Archivio: $KV"

echo "== 3b/6 Database delle pagine (D1): aggiornamenti visibili subito"
D1=$(cf GET "/accounts/$ACCOUNT/d1/database?name=menu-gestionale" | json "next((x['uuid'] for x in d.get('result') or [] if x['name']=='menu-gestionale'), '')")
[[ -n "$D1" ]] || D1=$(cf POST "/accounts/$ACCOUNT/d1/database" -H "Content-Type: application/json" --data '{"name":"menu-gestionale"}' | json "d['result']['uuid']")
[[ -n "$D1" ]] || { echo "Creazione del database D1 non riuscita (permesso Account: D1 - Edit sul token di configurazione?)"; exit 1; }
cf POST "/accounts/$ACCOUNT/d1/database/$D1/query" -H "Content-Type: application/json" \
  --data '{"sql":"create table if not exists pagine (chiave text primary key, contenuto text not null, tipo text not null, aggiornato text not null default current_timestamp)"}' | ok \
  || { echo "Creazione della tabella delle pagine non riuscita"; exit 1; }
echo "Database: $D1"

echo "== 4/6 Worker del menu"
META=$(printf '{"main_module":"menu-worker.js","compatibility_date":"2025-01-01","bindings":[{"type":"kv_namespace","name":"MENU","namespace_id":"%s"},{"type":"d1","name":"DB","id":"%s"},{"type":"plain_text","name":"PREDEFINITO","text":"%s"}]}' "$KV" "$D1" "$SLUG")
cf PUT "/accounts/$ACCOUNT/workers/scripts/menu" -F "metadata=$META;type=application/json" -F "menu-worker.js=@$WORKER;filename=menu-worker.js;type=application/javascript+module" | ok \
  || { echo "Caricamento del Worker non riuscito"; exit 1; }

echo "== 5/6 Indirizzo $HOST"
cf PUT "/accounts/$ACCOUNT/workers/domains" -H "Content-Type: application/json" \
  --data "{\"environment\":\"production\",\"hostname\":\"$HOST\",\"service\":\"menu\",\"zone_id\":\"$ZONA\"}" | ok \
  || { echo "Collegamento di $HOST non riuscito (se esiste già un record DNS «${HOST%%.*}», eliminalo e riprova)"; exit 1; }

echo "== 6/6 Pubblicatore"
curl -sS -X PUT "$API/accounts/$ACCOUNT/storage/kv/namespaces/$KV/values/prova-scrittura" -H "Authorization: Bearer $TPUB" \
  -F value=ok -F 'metadata={"tipo":"text/plain"}' | ok || { echo "Il token di pubblicazione non può scrivere nell'archivio KV"; exit 1; }
curl -sS -X DELETE "$API/accounts/$ACCOUNT/storage/kv/namespaces/$KV/values/prova-scrittura" -H "Authorization: Bearer $TPUB" >/dev/null
curl -sS -X POST "$API/accounts/$ACCOUNT/d1/database/$D1/query" -H "Authorization: Bearer $TPUB" -H "Content-Type: application/json" \
  --data '{"sql":"select count(*) from pagine"}' | ok || { echo "Il token di pubblicazione non può usare il database D1 (permesso Account: D1 - Edit)"; exit 1; }
[[ -f "$ENVF" ]] && cp "$ENVF" "$ENVF.precedente"
umask 077
cat > "$ENVF" <<ENV
SUPABASE_URL=http://gateway:8000
SUPABASE_ANON_KEY=$ANON
SLUGS=$SLUGS
INTERVALLO_SECONDI=5
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT
CLOUDFLARE_KV_ID=$KV
CLOUDFLARE_D1_ID=$D1
CLOUDFLARE_TOKEN=$TPUB
MENU_URL=https://$HOST
ENV
chmod 600 "$ENVF"
umask 022
unset TCONF TPUB

mkdir -p /opt/gestionale/pubblicatore-servizio
cat > /opt/gestionale/pubblicatore-servizio/docker-compose.yml <<'YML'
# Pubblicatore del menu: solo connessioni in uscita verso Cloudflare
name: gestionale-pubblicatore
services:
  pubblicatore:
    container_name: gestionale-pubblicatore
    image: node:22-slim
    restart: unless-stopped
    user: node
    read_only: true
    mem_limit: 128m
    command: ["node", "/app/pubblicatore.mjs"]
    env_file: /opt/gestionale/pubblicatore.env
    volumes:
      - /opt/gestionale/bot:/app:ro
    networks:
      - servizi

networks:
  servizi:
    external: true
    name: supabase_default
YML
cd /opt/gestionale/pubblicatore-servizio
docker compose up -d --force-recreate >/dev/null
sleep 10
docker logs --tail 6 gestionale-pubblicatore

echo
echo "Indirizzi pubblici del menu (da usare nei QR code):"
for S in ${SLUGS//,/ }; do echo "  https://$HOST/$S/"; done
echo "Il certificato HTTPS può richiedere qualche minuto alla prima apertura. Ora puoi eliminare il token di CONFIGURAZIONE da Cloudflare."
