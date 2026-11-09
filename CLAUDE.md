# Gestionale ristorazione – Enotechia Santa Lucia

Gestionale per un'enoteca/vineria: menu pubblico, ordini dal tavolo con QR, sala con piantina, comande in stampa,
magazzino, cassa, bot Telegram con IA locale, enciclopedia dei vini. Tutto gira su un server nel locale;
su internet c'è solo il menu pubblico (Cloudflare).

## Regole di lavoro (obbligatorie)
- **Lingua**: italiano corretto in codice, commenti, interfaccia e messaggi (è, ò, à: mai e', o', a').
  Nomi di variabili e funzioni in italiano, come nel resto del codice.
- **Sicurezza prima di tutto** (ISO 27001/27701): mai segreti in chiaro (solo variabili d'ambiente / placeholder),
  mai dati personali reali nei test (solo dati sintetici), OWASP, RLS su ogni tabella, minimo privilegio.
- **Il database decide**: prezzi, totali, permessi e validazioni si calcolano in PostgreSQL (funzioni RPC + RLS),
  mai fidarsi del client. Il telefono del cliente invia solo ID.
- **L'IA non inventa dati**: prezzi, percentuali, tipo/corpo dei vini non vengono mai dal modello. Il modello sceglie
  solo tra valori presenti (enum da DB) e i numeri devono comparire nel testo dell'utente. Ogni modifica dal bot passa
  da anteprima → conferma → /annulla.
- **Modifiche al DB solo con nuove migrazioni** (mai modificare una migrazione già applicata sul server).
  Ogni migrazione nuova ha i suoi test pgTAP in `supabase/tests/database/`.
- **Consegna degli aggiornamenti**: Claudio carica i file su GitHub dal sito (non ancora GitHub Desktop).
  Indicare sempre file per file, cartella per cartella, cosa sostituire.
- **Diff minimi**: modificare solo le parti interessate, niente `// TODO` o codice incompleto.

## Infrastruttura
| Elemento | Dettaglio |
|---|---|
| Server | Lenovo i7, 16 GB RAM, Ubuntu Server 24.04, IP fisso `192.168.111.183`, utente SSH `gestionale` |
| Database | Supabase self-hosted (PostgreSQL 17) in Docker, `/opt/supabase` (gateway Kong porta 8000) |
| Gateway web | Caddy porta 80 (backoffice), 443 preparato (`https-installa.sh`, non ancora attivo) |
| Pannello | Cockpit `https://192.168.111.183:9090` |
| IA locale | Ollama `qwen2.5:3b` (container `ollama`, `http://ollama:11434`); llama.cpp pronto ma in standby |
| Trascrizione vocali | Whisper `small` (servizio `apps/bot/trascrizione`, porta 9000) |
| Backup | `/opt/gestionale/backup.sh`, disco LUKS2, timer 03:30, 7 giornalieri + 4 settimanali |
| Repo | `github.com/Pocho1124/gestionale` (privato), monorepo pnpm + Turborepo |
| Dominio | `enotechiasantalucia.it` (registrato su IONOS, DNS su Cloudflare) |
| Menu pubblico | `https://menu.enotechiasantalucia.it/enotechia-santalucia/` (Cloudflare Worker + D1 + KV) |
| Sito vetrina | IONOS MyWebsite Now (dominio principale e `www`, record A/AAAA in «Solo DNS») |

### File di configurazione sul server (contengono segreti: mai nel repo)
| Percorso | Contenuto |
|---|---|
| `/opt/supabase/.env` | segreti DB, JWT, ANON_KEY |
| `/opt/gestionale/bot.env` | token Telegram, credenziali utente del bot, `LOCALE_ID`, `LLM_TIPO`/`LLM_URL` (facoltativi) |
| `/opt/gestionale/pubblicatore.env` | `SLUGS`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_ID`, `CLOUDFLARE_D1_ID`, `CLOUDFLARE_TOKEN` (solo KV+D1), `MENU_URL` |
| `/opt/gestionale/stampa.env` | token JWT del ruolo `servizio_stampa` |
| `/opt/gestionale/immagini.env` | credenziali Storage |
| `/opt/gestionale/bot/` | copia di `apps/bot` (aggiornata da `aggiorna.sh`) |
| `/opt/gestionale/sito/` | backoffice compilato |

**Attenzione**: dopo una modifica a un file `.env` serve `docker compose up -d --force-recreate` nella cartella del
servizio. `docker restart` NON rilegge le variabili.

## Flusso di rilascio
1. Commit su `main` → GitHub Actions (`.github/workflows/pipeline.yml`): test di dominio (vitest), build del backoffice,
   migrazioni + test pgTAP su `supabase/postgres`, poi immagine `ghcr.io/pocho1124/gestionale-migrator:latest`
   (contiene migrazioni, `apps/bot`, sito compilato, `deploy/pi` in `/deploy`, `deploy/cloudflare` in `/deploy/cloudflare`).
2. Sul server: `sudo /opt/gestionale/aggiorna.sh --forza` → applica migrazioni, aggiorna sito e codice del bot, riavvia i servizi.
3. Installer in `/deploy` dell'immagine, sempre con:
   `sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/<nome>.sh > /tmp/<nome>.sh && sudo bash /tmp/<nome>.sh`

| Installer (`deploy/pi`) | Scopo |
|---|---|
| `installa-pi.sh` | installazione base del server |
| `bot-installa.sh`, `trascrizione-installa.sh` | bot Telegram e Whisper |
| `pubblicatore-installa.sh` | menu su Cloudflare: crea KV, D1, carica il Worker, collega `menu.<dominio>`, scrive l'env (chiede token CONFIGURAZIONE temporaneo + token PUBBLICAZIONE) |
| `stampa-installa.sh` | servizio stampanti ESC/POS |
| `archivio-installa.sh` | Supabase Storage per le immagini |
| `https-installa.sh` | HTTPS interno (da attivare) |
| `enciclopedia-importa.sh` + `.py` | importa X-Wines (CSV) nell'enciclopedia: `sudo bash /tmp/enciclopedia-importa.sh /tmp/XWines_Full_100K_wines.csv` |
| `llm-installa.sh`, `llm-confronto.sh` | llama.cpp affiancato a Ollama e confronto prestazioni (in standby) |

## Struttura del repository
```
apps/web/            Backoffice React + Vite (TypeScript), anche menu interno /m/<slug> e pagina tavolo /t/<token>
  src/pagine/        Sala, Catalogo, Aspetto, Magazzino, Cassa, Impostazioni, Enciclopedia (voce «Vini»), MenuPubblico, OrdinaTavolo, Accesso
  src/componenti/    MenuVista (menu), SchedaPiatto, TrovaVino (quiz), MappaRegioni, ServizioSala, Componi, ...
  src/lib/           supabase, sessione, permessi, tipi, immagini (+worker), archivio, regioni.ts, mappaItalia.ts
apps/bot/            Servizi Node 22 senza dipendenze esterne
  bot.mjs            bot Telegram (@Enotechiabot)
  pubblicatore.mjs   genera la pagina statica del menu e la pubblica su Cloudflare
  stampa.mjs         comande su stampanti ESC/POS di rete
  vitigni.mjs        base di conoscenza dei vitigni (ripiego se l'enciclopedia non risponde)
  descrizioni.mjs    descrizioni dei vini composte da dati verificati
  regioni.mjs        zona di produzione → regione italiana (copia in apps/web/src/lib/regioni.ts: tenerle allineate)
  mappa-italia.mjs   confini regioni ISTAT (CC BY 4.0) in SVG (copia in apps/web/src/lib/mappaItalia.ts)
  migra-immagini.mjs migrazione immagini base64 → Storage
  trascrizione/      servizio Whisper (Python)
packages/core/       logica di dominio condivisa (denaro, con test vitest)
supabase/migrations/ 22 migrazioni (vedi sotto)
supabase/tests/database/  test pgTAP (221 test)
deploy/migrator/     Dockerfile dell'immagine, applica.sh (migrazioni), test.sh (pgTAP)
deploy/cloudflare/menu-worker.js   Worker del menu pubblico
deploy/pi/           installer per il server
```

## Database (migrazioni in ordine)
| Migrazione | Contenuto |
|---|---|
| `fondamenta` | organizzazioni, locali, membri, ruoli, profili, audit_log |
| `catalogo` | categorie, prodotti, gruppi_opzioni, opzioni, aspetto |
| `aspetto_logo_tema`, `aspetto_sfondo`, `sfondo_modo` | logo, temi, font, foto di sfondo (su tutto il menu o solo intestazione) |
| `foto_piatti` | foto dei prodotti |
| `vini_abbinamenti` | schede vini, abbinamenti piatto↔vino |
| `sala`, `piantina`, `pavimento` | sale, tavoli, sessioni, Wi-Fi ospiti, piantina disegnabile |
| `ordini`, `richieste_tavolo`, `conto_telegram` | ordini dal tavolo, richieste QR, conto, utenti Telegram |
| `anon_minimo` | il ruolo `anon` esegue SOLO 8 funzioni: menu_pubblico, foto_prodotto, tavolo_cliente, invia_ordine, ordini_tavolo, richiedi_tavolo, stato_richiesta, chiedi_conto |
| `archivio_immagini` | Supabase Storage, contenitore `immagini` (2 MB, JPEG/PNG/WebP), percorsi `<locale>/<tipo>/<uuid>.<ext>` |
| `ruolo_caposala`, `permessi_utenti` | funzione `puo(locale, capacità)`, creazione utenti anti-escalation |
| `reparti_magazzino_cassa` | stampanti, reparti, comande, articoli, movimenti, cassa, chiusure |
| `rinforzi_sicurezza` | account condivisi tra org, indirizzi stampanti (solo 192.168.x/10.x, porte 9100-9109), ruolo `servizio_stampa` |
| `piatti_componibili` | piatti con gruppi di scelte (es. tagliere), prezzo calcolato dal DB |
| `enciclopedia_vini` | enciclopedia (base curata, X-Wines, aggiunte del locale), `cerca_vino()` con pg_trgm e indici, capacità `catalogo` |
| `descrizioni_vini` | acidità, gradazione, profilo aromatico dei vitigni principali |

### Ruoli e capacità (`puo()`)
| Capacità | owner | manager | caposala | cameriere | cucina |
|---|:-:|:-:|:-:|:-:|:-:|
| sala.apri, sala.comanda, ordini.conferma | ✅ | ✅ | ✅ | ✅ | — |
| sala.chiudi, ordini.annulla | ✅ | ✅ | ✅ | — | — |
| cucina.avanza, esauriti | ✅ | ✅ | ✅ | ✅ | ✅ |
| magazzino, reparti, utenti, catalogo | ✅ | ✅ | — | — | — |
| cassa | ✅ | — | — | — | — |

## Componenti
### Menu pubblico (Cloudflare)
- `pubblicatore.mjs` legge `menu_pubblico(slug)` ogni 5 s (o subito su richiesta del bot), genera HTML statico,
  scrive pagine e `versione.json` su **D1** (letto sempre aggiornato) e immagini su **KV** con nome versionato
  (`logo.<hash>.webp`), poi elimina le immagini non più usate.
- `menu-worker.js`: solo lettura; `/` → `/<PREDEFINITO>/`; pagine `no-cache`, immagini `immutable`; intestazioni di sicurezza.
- Funzioni della pagina: scheda del piatto (foto intera, `object-fit: contain`), abbinamenti con percorso
  («← Torna a …», niente rimandi circolari), quiz «Trova il tuo vino» (colore vincolante), vini raggruppati e
  filtrati per regione, mappa d'Italia («Scegli dalla mappa»), aggiornamento automatico quando cambia la versione.
- **Regola CSS**: `[hidden]{display:none !important}` in testa: un `display` assegnato da stile vince sull'attributo
  `hidden` (bug reale: la mappa restava sempre aperta). Nei test controllare la visibilità calcolata, non l'attributo.

### Bot Telegram
- Long polling, utenti autorizzati da `TELEGRAM_UTENTI` + tabella `telegram_utenti`.
- Prima le **regole** (immediate), poi l'**IA** (`chiediModello()`, Ollama o llama.cpp, JSON vincolato da schema).
- Comandi principali: prezzi (singoli e in %), esauriti, visibilità, nuovi piatti e categorie, **più prodotti in un
  messaggio** («aggiungi in birre Andromeda, Mida e Rubra a 6 € l'una»; se manca il prezzo lo chiede), elenchi
  incollati, descrizioni, foto (anche «aggiungi … a 34 euro descrizione: …» con foto = nuovo piatto con foto), vini e
  abbinamenti, «suggerisci abbinamenti», «completa le schede dei vini» (da enciclopedia), «enciclopedia Nome: rosso,
  strutturato, Campania, vitigno …», «descrivi / riscrivi le descrizioni dei vini», vocali (Whisper), notifiche di sala.
- Eliminazioni solo con comandi espliciti, mai interpretate dall'IA.

### Enciclopedia dei vini
- Fonti: 92 voci base curate, ~100.000 vini **X-Wines** (CC0, de Azambuja et al. 2023, citare la fonte), aggiunte del locale.
- `cerca_vino(testo)`: nomi interi contenuti nel testo (indice GIN sulle chiavi) poi somiglianza (pg_trgm); ~10 ms.
- Le voci base e X-Wines non sono modificabili; quelle del locale solo con capacità `catalogo`.

### Backoffice
`http://192.168.111.183` – Sala (servizio, piantina, cartoncini QR), Catalogo (anche componibili), Aspetto,
Vini (enciclopedia), Magazzino, Cassa (solo titolare), Impostazioni (personale, reparti/stampanti, bot).

## Test
- **Database**: `sh deploy/migrator/applica.sh supabase/migrations` poi `sh deploy/migrator/test.sh supabase/tests/database`
  (su un PostgreSQL con pgTAP; in CI usa `supabase/postgres`). Atteso: 221 test superati.
- **Backoffice**: `pnpm --filter web build` (TypeScript + Vite). **Core**: `vitest` in `packages/core`.
- **Bot/pubblicatore/stampa**: modalità di test con variabili `BOT_TEST=1`, `PUBBLICATORE_TEST=1`, `STAMPA_TEST=1`
  (non avviano i servizi, espongono le funzioni). Le prove fatte finora erano script esterni con `fetch` simulato e
  jsdom: da portare nel repo (es. `apps/bot/test/`) come primo lavoro utile.

## Da fare
1. HTTPS: `gestionale.enotechiasantalucia.it` con certificato Let's Encrypt via DNS Cloudflare (DNS-01), solo rete locale.
2. Ponte ordini `ordini.enotechiasantalucia.it` su Cloudflare (ordini dal telefono solo con HTTPS; nel frattempo solo comande dal tablet).
3. QR stampabili con il nuovo dominio (non ancora stampato nulla).
4. Verifiche sul posto: accesso di un utente creato dal pannello, stampa di prova su stampante reale.
5. Backup: aggiungere immagini Storage (patch pronta), prova di ripristino.
6. Valutare llama.cpp con `llm-confronto.sh`; registratore telematico; report incassi avanzati; menu multilingua.
7. Portare nel repo i test automatici di bot e pagina pubblica.

## Note pratiche
- Prezzo sbagliato da sistemare: «Amaranta» (Birre) inserita a 3,50 € da una versione precedente del bot.
- Il nome del locale (slug) è `enotechia-santalucia`; se cambia, aggiornare `SLUGS` e la variabile `PREDEFINITO` del Worker.
- Token Cloudflare: CONFIGURAZIONE solo per gli installer (poi eliminato); PUBBLICAZIONE sul server con soli permessi KV e D1.
