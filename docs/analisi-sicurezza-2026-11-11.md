# Analisi di sicurezza ed escalation dei permessi — 11/11/2026

Ambito: database (46 migrazioni: funzioni RPC, RLS, ruoli, codici personali), backoffice React, pagine pubbliche,
bot Telegram, pubblicatore, Worker, stampa, Whisper, installer, pipeline. Nessuna falla critica trovata.

## Corrette in questo intervento

| Gravità | Falla | Correzione |
|-|-|-|
| Alta | Cambio del proprio codice: il «codice attuale» si poteva provare all'infinito dalla sessione lasciata aperta di un collega e scoprirne il codice | il tentativo sbagliato conta e blocca come all'ingresso (migrazione `rinforzi_codici`) |
| Media | Codice di una persona indovinabile cambiando sessione: il conteggio si azzerava al blocco (10 tentativi ogni 15 min) | conteggio continuo, blocco crescente 15 min → 1 h → 2 h 15 … fino a 24 h |
| Media | Un responsabile poteva rendere «esente dal codice» un cameriere (lavora in sala senza codice) | esenzione solo dal titolare; mai su una postazione |
| Media | Bot: un ID Telegram del file di configurazione restava autorizzato anche se disattivato nel backoffice | chi è disattivato nella tabella resta fuori (`bot.mjs`, `autorizzato`) |
| Media | Bot: `/annulla` era unico per tutti, una persona annullava la modifica di un'altra | un `/annulla` per chat |
| Bassa | Postazioni ed esenti potevano avere ed usare un codice come persone | rifiutato da `imposta_codice` ed `entra_operatore` |
| Bassa | Comanda stampata falsificabile con una nota del cliente con a capo («2 x Aragosta», «ANNULLATO») | gli a capo dei testi diventano spazi (`stampa.mjs`) |
| Funzionale | Con il codice obbligatorio le prenotazioni non si salvavano (regola di scrittura chiedeva il codice senza tastierino) | prenotazioni con il ruolo dell'account; aprire il tavolo all'arrivo chiede il codice |
| Guardia | — | test pgTAP: ogni tabella dello schema `public` ha l'RLS attivo |

## Verificato a posto

- **Funzioni del database**: tutte quelle concesse allo staff hanno un controllo di permesso (`puo`, `controlla_gestione`,
  `ruolo_in_locale`, …); le uniche senza sono funzioni pure (normalizzazione testi, partita IVA) o le funzioni pubbliche del tavolo,
  protette da token + segreto. Il pubblico (`anon`) esegue solo le 8 funzioni previste (test `anon`).
- **RLS** attivo su ogni tabella; ordini, conti, sessioni e pagamenti si scrivono solo dalle funzioni (nessuna regola di scrittura diretta).
- **Escalation del personale**: membri modificabili solo dal titolare; `crea_utente` / `modifica_ruolo_utente` solo verso ruoli inferiori;
  una postazione ha per vincolo il ruolo di cameriere o caposala, quindi niente catalogo, aspetto, magazzino, cassa, impostazioni.
- **Codici**: hash bcrypt, blocchi per dispositivo e per persona, scadenza, il ruolo è quello di chi inserisce il codice, conto e
  pagamenti visibili a chi ha il codice; cassa e fatture solo al titolare.
- **Backoffice**: nessun HTML costruito da stringhe (niente `dangerouslySetInnerHTML`), finestra di stampa con CSP senza script.
- **Pagina pubblica e Worker**: ogni valore passa da `esc()`, colori e font in allowlist, dati nello script con `<` neutralizzato,
  Worker solo GET/HEAD con chiavi validate e intestazioni di sicurezza.
- **Bot**: solo chat private, IA con numeri presi dal testo ed enum dal DB, anteprima → conferma con id monouso → `/annulla`,
  eliminazioni solo da regole.
- **Stampa**: solo reti 192.168/16 e 10/8, porte 9100-9109, caratteri di controllo scartati (niente comandi ESC/POS).
- **Installer e pipeline**: env con permessi 600, token mai in `argv` di curl, input validati, azioni della CI fissate per hash.

## Ancora aperte (da pianificare)

| Gravità | Falla | Proposta |
|-|-|-|
| ~~Alta~~ | ~~Aggiornamento automatico dall'immagine `:latest` senza verifica~~ | **Chiusa**: immagine firmata con cosign keyless in CI, `aggiorna.sh` verifica la firma e usa il digest. Resta da valutare l'approvazione manuale delle migrazioni |
| Media | Token Cloudflare DNS sul server con modifica di tutta la zona | delegare `_acme-challenge` a una zona dedicata o token limitato |
| Media | `archivio-installa.sh` riusa la password del superuser per `supabase_storage_admin` | password dedicata casuale |
| ~~Media~~ | ~~L'account del bot ha il ruolo di responsabile~~ | **Chiusa** (12/11, `bot_ruolo_dedicato`): solo catalogo e sala, niente utenti, impostazioni, magazzino, struttura del locale, chiusura e storno |
| ~~Media~~ | ~~`/annulla` dopo un'eliminazione dal bot ripristina solo la riga principale~~ | **Chiusa** (12/11): ripristina scelte, scheda del vino, foto, abbinamenti e aggiunte della categoria; piatti con ricetta di magazzino non si eliminano dal bot |
| ~~Bassa~~ | ~~Eliminazioni dal bot con nome approssimato~~ | **Chiusa** (12/11): «elimina» vale solo con il nome esatto |
| Bassa | Whisper e `/ora` del pubblicatore senza autenticazione sulla rete Docker condivisa con il database | rete interna dedicata, `cap_drop`, `no-new-privileges` |
| Bassa | Backoffice in HTTP sulla rete locale (provvisorio) | attivare HTTPS in loco (Da fare n. 1) |
| Bassa | Modello GGUF scaricato senza SHA256; `JWT_SECRET` in `argv` di openssl; token di stampa valido 5 anni | verifica dell'hash; segreto da file; token più breve |
| Bassa | CI: `persist-credentials` sui checkout, immagini base senza digest, `npm ci` senza `--ignore-scripts` | fissare i digest e disattivare gli script di installazione |
| ~~Bassa~~ | ~~`crea_utente` accetta un'email arbitraria già confermata~~ | **Chiusa** (12/11, `utenti_solo_nome`): solo nomi utente |
| Bassa | Codici a 4 cifre ammessi | consigliare 6 cifre al personale |
