# Gestionale ristorazione

## Come arrivano gli aggiornamenti al Pi
1. Le modifiche vengono caricate sul ramo `main` di questo repository.
2. GitHub Actions esegue i test (logica di dominio + policy RLS su Postgres) e, solo se passano,
   pubblica l'immagine `ghcr.io/pocho1124/gestionale-migrator` per Raspberry Pi (arm64).
3. Il Pi controlla ogni 5 minuti: se trova una versione nuova applica le migrazioni del database.
   Se è offline riprova al giro successivo; il locale continua a funzionare.

Stato e log: Cockpit (`https://IP_DEL_PI:9090`) > Registri, filtrando `gestionale-aggiorna`.

## Struttura
- `supabase/migrations/` schema del database (una migrazione per file, mai modificare quelle già rilasciate)
- `supabase/tests/database/` test pgTAP delle policy RLS
- `packages/core/` logica di dominio (importi in centesimi, IVA)
- `deploy/` immagine di rilascio e installer per il Pi
