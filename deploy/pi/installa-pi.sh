#!/bin/sh
# Installa sul Pi l'aggiornamento automatico del gestionale.
# Uso (terminale di Cockpit):
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/installa-pi.sh | sudo sh
set -eu
[ "$(id -u)" = 0 ] || { echo "Lancia con sudo"; exit 1; }
mkdir -p /opt/gestionale

cat > /opt/gestionale/aggiorna.sh <<'SCRIPT'
#!/bin/sh
# Controlla se su GitHub c'è una nuova versione e, se sì, aggiorna il database.
set -eu
IMG="ghcr.io/pocho1124/gestionale-migrator:latest"
STATO=/opt/gestionale/versione-installata

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

echo "$NUOVA" > "$STATO"
docker image prune -f >/dev/null
echo "Aggiornamento completato"
SCRIPT
chmod 700 /opt/gestionale/aggiorna.sh

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
systemctl enable --now gestionale-aggiorna.timer >/dev/null
/opt/gestionale/aggiorna.sh --forza
echo "Aggiornamento automatico attivo: controllo ogni 5 minuti (log in Cockpit > Registri)."
