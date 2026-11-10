#!/bin/sh
# Esegue i test pgTAP: fallisce se un test non passa o se il numero di test non torna con il piano.
set -eu
DIR="${1:-/tests}"
esito=0
falliti=""
for f in $(ls "$DIR"/*.sql | sort); do
  echo "== $(basename "$f")"
  out=$(psql -X -At -v ON_ERROR_STOP=1 -f "$f") || { echo "$out"; exit 1; }
  echo "$out" | grep -E '^(ok|not ok|# Looks like)' || true
  if echo "$out" | grep -qE '^not ok|^# Looks like'; then
    esito=1
    falliti="$falliti
$(basename "$f"): $(echo "$out" | grep -E '^not ok|^# Looks like' | tr '\n' ' ')"
  fi
  echo "$out" | grep -q '^ok' || { echo "Nessun test eseguito"; esito=1; }
done
[ "$esito" = 0 ] && echo "Tutti i test superati" || echo "TEST FALLITI:$falliti"
exit $esito
