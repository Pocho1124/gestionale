#!/bin/bash
# Pubblica su internet SOLO il menu dei clienti, come pagina statica su GitHub Pages (gratuito).
# Il server non apre porte: invia lui la pagina a GitHub quando il menu cambia.
# Uso (terminale di Cockpit):
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/pubblicatore-installa.sh > /tmp/pubblicatore-installa.sh && sudo bash /tmp/pubblicatore-installa.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Lancia con sudo"; exit 1; }
[[ -f /opt/gestionale/bot/pubblicatore.mjs ]] || { echo "Codice del pubblicatore assente: rilancia prima installa-pi.sh."; exit 1; }
ANON=$(grep '^ANON_KEY=' /opt/supabase/.env | cut -d= -f2-)
PSQL=(docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At)

read -rp "Repository pubblico del menu [Pocho1124/menu]: " REPO
REPO=${REPO:-Pocho1124/menu}
[[ "$REPO" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || { echo "Nome del repository non valido."; exit 1; }

read -rsp "Incolla il token GitHub del menu e premi Invio: " TOKEN; echo
INFO=$(curl -s --max-time 15 -H "Authorization: Bearer $TOKEN" -H "User-Agent: gestionale" "https://api.github.com/repos/$REPO")
grep -q '"full_name"' <<<"$INFO" || { echo "Repository non trovato o token non valido."; exit 1; }
grep -q '"private": *false' <<<"$INFO" || { echo "Il repository deve essere PUBBLICO (GitHub Pages gratuito)."; exit 1; }
grep -q '"push": *true' <<<"$INFO" || { echo "Il token non ha il permesso di scrittura (Contents: Read and write)."; exit 1; }
echo "Repository $REPO raggiungibile, scrittura consentita."

ELENCO=$("${PSQL[@]}" -c "select string_agg(slug, ',' order by slug) from public.locali where attivo")
echo "Locali da pubblicare: ${ELENCO:-nessuno}"
read -rp "Premi Invio per confermare, oppure scrivi gli indirizzi separati da virgola: " SCELTA
SLUGS=${SCELTA:-$ELENCO}
SLUGS=${SLUGS// /}
[[ "$SLUGS" =~ ^[a-z0-9-]+(,[a-z0-9-]+)*$ ]] || { echo "Elenco non valido."; exit 1; }

umask 077
cat > /opt/gestionale/pubblicatore.env <<ENV
SUPABASE_URL=http://gateway:8000
SUPABASE_ANON_KEY=$ANON
GITHUB_TOKEN=$TOKEN
GITHUB_REPO=$REPO
SLUGS=$SLUGS
INTERVALLO_SECONDI=15
ENV
chmod 600 /opt/gestionale/pubblicatore.env
umask 022

mkdir -p /opt/gestionale/pubblicatore-servizio
cat > /opt/gestionale/pubblicatore-servizio/docker-compose.yml <<'YML'
# Pubblicatore del menu: solo connessioni in uscita verso GitHub
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

PROPRIETARIO=$(echo "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')
NOME_REPO=${REPO##*/}
echo
echo "Indirizzi pubblici del menu (da usare nei QR code):"
for S in ${SLUGS//,/ }; do echo "  https://$PROPRIETARIO.github.io/$NOME_REPO/$S/"; done
