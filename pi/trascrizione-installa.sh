#!/bin/bash
# Installa la trascrizione dei vocali per il bot Telegram (Whisper in locale, nessun audio esce dal server).
# Uso (terminale di Cockpit):
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/trascrizione-installa.sh > /tmp/trascrizione-installa.sh && sudo bash /tmp/trascrizione-installa.sh
# Opzionale: MODELLO=medium (più preciso, circa 3 volte più lento)
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Lancia con sudo"; exit 1; }
SORGENTE=/opt/gestionale/bot/trascrizione
[[ -f $SORGENTE/server.py ]] || { echo "File della trascrizione assenti: attendi l'aggiornamento automatico o lancia /opt/gestionale/aggiorna.sh --forza"; exit 1; }
MODELLO="${MODELLO:-small}"

echo "== 1/3 Preparo l'immagine (la prima volta qualche minuto)"
docker build -q -t gestionale-trascrizione:locale "$SORGENTE" >/dev/null

echo "== 2/3 Avvio il servizio"
mkdir -p /opt/gestionale/trascrizione-servizio
cat > /opt/gestionale/trascrizione-servizio/docker-compose.yml <<YML
# Trascrizione vocale locale: nessuna porta pubblicata, usata solo dal bot
name: gestionale-trascrizione
services:
  trascrizione:
    container_name: gestionale-trascrizione
    image: gestionale-trascrizione:locale
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    mem_limit: 3g
    environment:
      MODELLO: "$MODELLO"
      OMP_NUM_THREADS: "4"
    volumes:
      - modelli:/modelli
    networks:
      - servizi
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:9000/salute')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15m

networks:
  servizi:
    external: true
    name: supabase_default

volumes:
  modelli:
YML
cd /opt/gestionale/trascrizione-servizio
docker compose up -d --force-recreate >/dev/null

echo "== 3/3 Attendo il modello «$MODELLO» (al primo avvio lo scarica: alcuni minuti)"
for _ in $(seq 1 120); do
  if docker logs gestionale-trascrizione 2>&1 | grep -q "Trascrizione pronta"; then
    docker logs --tail 3 gestionale-trascrizione
    echo
    echo "Trascrizione attiva. Su Telegram invia un vocale al bot, ad esempio: «la margherita costa sette euro»."
    exit 0
  fi
  sleep 5
done
echo "Il modello non è ancora pronto dopo 10 minuti. Stato:"
docker logs --tail 10 gestionale-trascrizione
exit 1
