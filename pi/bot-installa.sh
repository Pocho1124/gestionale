#!/bin/bash
# Installa il bot Telegram privato del gestionale (interattivo). Rilanciabile per cambiare token o utenti.
# Uso (terminale di Cockpit):
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/bot-installa.sh > /tmp/bot-installa.sh && sudo bash /tmp/bot-installa.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Lancia con sudo"; exit 1; }
[[ -f /opt/gestionale/bot/bot.mjs ]] || { echo "Codice del bot assente: rilancia prima installa-pi.sh."; exit 1; }
docker ps --format '{{.Names}}' | grep -qx gestionale-ollama || echo "Avviso: Ollama non è attivo, il bot userà solo le regole."

ENV=/opt/supabase/.env
leggi() { grep "^$1=" "$ENV" | cut -d= -f2-; }
ANON=$(leggi ANON_KEY)
SERVICE=$(leggi SERVICE_ROLE_KEY)
PSQL=(docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At)

# 1. Token del bot (non viene mai mostrato né salvato nei log)
read -rsp "Incolla il token del bot (da @BotFather) e premi Invio: " TOKEN; echo
NOME=$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe" | grep -o '"username":"[^"]*"' | cut -d'"' -f4 || true)
[[ -n "$NOME" ]] || { echo "Token non valido o Telegram non raggiungibile."; exit 1; }
echo "Bot riconosciuto: @$NOME"

# 2. Utenti autorizzati
read -rp "ID Telegram autorizzati (numeri separati da virgola): " UTENTI
UTENTI=${UTENTI// /}
[[ "$UTENTI" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "Formato non valido: servono solo numeri separati da virgola."; exit 1; }

# 3. Locale gestito dal bot
echo "Locali disponibili:"
"${PSQL[@]}" -c "select '  ' || slug || '  (' || nome || ')' from public.locali where attivo order by nome"
read -rp "Scrivi l'indirizzo (slug) del locale da gestire: " SLUG
[[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "Slug non valido."; exit 1; }
RIGA=$("${PSQL[@]}" -c "select id || '|' || organizzazione_id from public.locali where slug = '$SLUG'")
[[ -n "$RIGA" ]] || { echo "Locale non trovato."; exit 1; }
LOCALE_ID=${RIGA%%|*}; ORG_ID=${RIGA##*|}

# 4. Account dedicato del bot con ruolo di responsabile, limitato a questo locale
EMAIL="bot-telegram-${SLUG}@gestionale.local"
PASSWORD=$(openssl rand -hex 24)
ID_BOT=$("${PSQL[@]}" -c "select id from auth.users where email = '$EMAIL'")
if [[ -z "$ID_BOT" ]]; then
  RISPOSTA=$(printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"nome":"Assistente Telegram"}}' "$EMAIL" "$PASSWORD" |
    curl -s -X POST http://localhost:8000/auth/v1/admin/users \
      -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" --data @-)
  ID_BOT=$(printf '%s' "$RISPOSTA" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
else
  printf '{"password":"%s"}' "$PASSWORD" |
    curl -s -o /dev/null -X PUT "http://localhost:8000/auth/v1/admin/users/$ID_BOT" \
      -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" --data @-
fi
[[ -n "$ID_BOT" ]] || { echo "Creazione dell'account del bot non riuscita."; exit 1; }
"${PSQL[@]}" -c "insert into public.membri (organizzazione_id, user_id, ruolo, locale_id)
                 values ('$ORG_ID', '$ID_BOT', 'manager', '$LOCALE_ID')
                 on conflict (organizzazione_id, user_id) do update set ruolo = 'manager', locale_id = excluded.locale_id" >/dev/null
echo "Account del bot pronto: $EMAIL (responsabile del locale $SLUG)"

# 5. Configurazione (solo root) e servizio
umask 077
cat > /opt/gestionale/bot.env <<ENV
TELEGRAM_TOKEN=$TOKEN
TELEGRAM_UTENTI=$UTENTI
SUPABASE_URL=http://gateway:8000
SUPABASE_ANON_KEY=$ANON
BOT_EMAIL=$EMAIL
BOT_PASSWORD=$PASSWORD
LOCALE_ID=$LOCALE_ID
OLLAMA_URL=http://ollama:11434
OLLAMA_MODELLO=qwen2.5:3b
ENV
chmod 600 /opt/gestionale/bot.env
umask 022

mkdir -p /opt/gestionale/bot-servizio
cat > /opt/gestionale/bot-servizio/docker-compose.yml <<'YML'
# Bot Telegram del gestionale: nessuna porta aperta (long polling verso Telegram)
name: gestionale-bot
services:
  bot:
    container_name: gestionale-bot
    image: node:22-slim
    restart: unless-stopped
    user: node
    read_only: true
    mem_limit: 256m
    command: ["node", "/app/bot.mjs"]
    env_file: /opt/gestionale/bot.env
    volumes:
      - /opt/gestionale/bot:/app:ro
    networks:
      - servizi

networks:
  servizi:
    external: true
    name: supabase_default
YML

cd /opt/gestionale/bot-servizio
docker compose up -d --force-recreate >/dev/null
sleep 6
docker logs --tail 5 gestionale-bot
echo
echo "Bot attivo. Su Telegram apri @$NOME e invia /start."
