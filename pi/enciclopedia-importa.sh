#!/bin/bash
# Importa (o aggiorna) i vini di X-Wines nell'enciclopedia. Le voci base e quelle aggiunte dal locale non vengono toccate.
# Uso:
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/enciclopedia-importa.sh > /tmp/enciclopedia-importa.sh
#   sudo bash /tmp/enciclopedia-importa.sh /tmp/XWines_Full_100K_wines.csv
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Lancia con sudo"; exit 1; }
FILE=${1:-}
[[ -s "$FILE" ]] || { echo "Indica il file dei vini di X-Wines, es. sudo bash $0 /tmp/XWines_Full_100K_wines.csv"; exit 1; }
SCRIPT=$(mktemp); trap 'rm -f "$SCRIPT"' EXIT
docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/enciclopedia-importa.py > "$SCRIPT"
python3 "$SCRIPT" "$FILE" | docker exec -i supabase-db psql -q -U postgres -d postgres
docker exec supabase-db psql -At -U postgres -d postgres -c "select fonte || ': ' || count(*) from public.enciclopedia_vini group by fonte order by fonte;"
