#!/bin/sh
# Applica in ordine le migrazioni SQL non ancora eseguite.
# Usa la stessa tabella di storico della Supabase CLI (supabase_migrations.schema_migrations).
set -eu
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
DIR="${1:-/migrations}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

$PSQL -c "create schema if not exists supabase_migrations;
          create table if not exists supabase_migrations.schema_migrations
            (version text primary key, statements text[], name text);"

n=0
for f in $(ls "$DIR"/*.sql | sort); do
  base=$(basename "$f" .sql)
  versione=${base%%_*}
  nome=${base#*_}
  case "$versione" in ''|*[!0-9]*) echo "Nome file non valido: $base"; exit 1 ;; esac
  case "$nome" in ''|*[!a-z0-9_]*) echo "Nome file non valido: $base"; exit 1 ;; esac

  gia=$($PSQL -At -c "select 1 from supabase_migrations.schema_migrations where version = '$versione'")
  [ -n "$gia" ] && continue

  echo "Applico $base"
  # Migrazione e registrazione nella stessa transazione: o tutto o niente
  $PSQL --single-transaction -f "$f" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$versione', '$nome')"
  n=$((n + 1))
done
echo "Migrazioni applicate: $n"
