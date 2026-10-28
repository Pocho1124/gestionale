#!/bin/sh
# Esegue i test pgTAP: fallisce se un test non passa o se il numero di test non torna con il piano.
set -eu
DIR="${1:-/tests}"
esito=0
for f in $(ls "$DIR"/*.sql | sort); do
  echo "== $(basename "$f")"
  out=$(psql -X -At -v ON_ERROR_STOP=1 -f "$f") || { echo "$out"; exit 1; }
  echo "$out" | grep -E '^(ok|not ok|# Looks like)' || true
  echo "$out" | grep -qE '^not ok|^# Looks like' && esito=1
  echo "$out" | grep -q '^ok' || { echo "Nessun test eseguito"; esito=1; }
done
[ "$esito" = 0 ] && echo "Tutti i test superati" || echo "TEST FALLITI"
exit $esito
