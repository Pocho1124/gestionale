# Collaudo del gestionale

Prova completa in loco, in quest'ordine: ogni blocco usa quello che ha preparato il precedente.
Servono un tablet (o PC) per lo staff, un telefono che faccia da cliente e, per la stampa, la stampante collegata.
Usa solo dati di prova (nomi come «Cliente Prova», nessun dato reale di clienti).

Prima di iniziare: `git push`, pipeline verde, poi sul server `sudo /opt/gestionale/aggiorna.sh --forza`.

## 1. Impostazioni (titolare)

- [ ] Impostazioni → Ordini dal tavolo: **coperto** a persona (es. 2,50 €) e **sconto massimo del caposala** (es. 20 %).
- [ ] Attiva «Chiedi il nome del cliente» (facoltativo).
- [ ] Pagamenti con il POS: aggiungi un terminale (es. «POS cassa»).
- [ ] Reparti e stampanti: «Stampa di prova» sulla stampante reale (accenti ed € leggibili).

## 2. Catalogo e menu

- [ ] Catalogo → **＋ Aggiunte**: crea 2 aggiunte con prezzo (es. Burrata 3 €), una senza categorie (vale per tutto).
- [ ] Menu in inglese **automatico**: aspetta qualche minuto dopo l'aggiornamento (l'IA del server traduce un po' di voci al minuto).
  Nel Catalogo, aprendo «🇬🇧 In inglese» di un piatto, compare la traduzione con la scritta «automatica».
- [ ] Correggi a mano una traduzione: diventa «scritta a mano» e non cambia più; «↺ Torna alla traduzione automatica» la fa rifare.
- [ ] Cambia il nome italiano di un piatto: entro un paio di minuti cambia anche quello inglese.
- [ ] Menu pubblico `https://menu.enotechiasantalucia.it/enotechia-santalucia/` (dopo pochi secondi):
  - [ ] **🇮🇹 Italiano / 🇬🇧 English / 🇪🇸 Español** in alto, sopra «Trova il tuo vino» (pagina del tavolo: sotto il numero del tavolo), e non più in fondo; con English: nomi tradotti, gli altri in italiano, allergeni in inglese;
  - [ ] con Español: nomi, descrizioni, note dei vini, allergeni e testi della pagina in spagnolo (anche pagina del tavolo e menu interno `/m/`);
  - [ ] con Deutsch: nomi, descrizioni, note dei vini, allergeni e testi in tedesco (vino rosso = «Rotwein», nel quiz «keinen Rotwein» con la maiuscola);
  - [ ] sfondo a carosello (Aspetto › Foto di sfondo › Carosello): le foto sfumano a turno, il testo resta leggibile; con «riduci movimento» del telefono resta ferma la prima;
  - [ ] «Vini per regione» in un riquadro, con «Scegli dalla mappa» grande al centro e le regioni sotto;
  - [ ] quiz «Find your wine», scheda di un piatto, mappa delle regioni in inglese;
  - [ ] foto e logo visibili anche nella pagina inglese.
  - [ ] descrizioni dei piatti e note dei vini (scheda) in inglese, non solo i nomi.
- [ ] Menu interno `http://192.168.111.183/m/enotechia-santalucia`: bandierine in fondo, stesse traduzioni.

## 3. Cliente al tavolo (telefono)

- [ ] Sala → Cartoncini QR: inquadra il QR di un tavolo libero.
- [ ] La pagina si apre nella lingua del telefono; prova le bandierine in fondo e il tasto in alto.
- [ ] Aggiungi un piatto con **＋ Aggiunte**, scrivi il nome, invia: in Sala arriva la richiesta (🔔 con il nome).
- [ ] Dal tablet «Apri tavolo e conferma»: sul telefono compare il codice del tavolo.
- [ ] Secondo ordine dal telefono: va diretto in cucina.
- [ ] Codice sbagliato 10 volte da un altro telefono: si blocca; nel pannello del tavolo compare **Sblocca codice**.

## 4. Sala (tablet)

- [ ] Piantina: tavolo aperto con alone colorato, tempo e conto; coperti con − e + (il coperto entra nel conto).
- [ ] **+ Aggiungi all'ordine**: categorie, ricerca, «📝 Nota» con costo «+ €» (es. doppia mozzarella + 2 €), invio.
- [ ] **↔ Sposta** il tavolo su uno libero; **⊕ Unisci** due tavoli aperti (il secondo si libera, coperti sommati).
- [ ] **Prenotazioni**: nuova per stasera su un tavolo; sulla piantina compare «📅 ora»; «Arrivati» apre il tavolo.
  Prova una seconda prenotazione nello stesso orario sullo stesso tavolo: deve essere rifiutata.
- [ ] Piantina (modifica): muro allungato da un capo solo, oggetti nuovi (botte, bottigliera, divano…).
- [ ] ⛶ Modalità monitor sul monitor di sala.

## 5. Cucina

- [ ] Voce **Cucina** su un altro dispositivo: le comande compaiono da sole con il suono; filtro per reparto.
- [ ] «Inizia» → «Pronto»: in Sala il cruscotto mostra «Pronti da servire»; «Servito».
- [ ] La comanda esce sulla stampante del reparto, con aggiunte, supplemento e note.

## 6. Conto

- [ ] Pannello del tavolo: **Stampa preconto** (coperto e sconto nel preconto) → compare **Chiudi tavolo**.
- [ ] Sconto: da **caposala** oltre il tetto (es. 30 %) → rifiutato con il messaggio; entro il tetto → accettato.
- [ ] **Alla romana** diviso 3, **Per piatti** (pinsa e calice di una persona), **Importo o %**.
- [ ] Contanti con resto, **POS** in attesa → ✓ Approvato (o ✗ Rifiutato: i piatti tornano da pagare).
- [ ] «Chiudi tavolo» solo con il conto saldato al centesimo.

## 7. Cassa, report e fatture (titolare)

- [ ] Cassa: resoconto per metodo di pagamento e sconti; **Report incassi** (oggi, 7 giorni: barre e confronto).
- [ ] Fatture: dati fiscali del locale, fattura da un conto chiuso (con riga Coperto), copia di cortesia e **XML**.
  Prova la prima fattura sul portale «Fatture e Corrispettivi» prima di usarla con un cliente vero.
- [ ] Magazzino: un articolo sotto la scorta minima → numero arancione sulla voce «Magazzino».

## 8. Accessi e sicurezza

- [ ] Accesso con un utente creato dal pannello (cameriere): non vede Cassa, Fatture, Impostazioni.
- [ ] Il cameriere non cambia il prezzo del coperto né chiude il tavolo.
- [ ] HTTPS in loco: `https://gestionale.enotechiasantalucia.it` con il lucchetto (vedi CLAUDE.md, Da fare n. 1).

Annota qui sotto ciò che non va (pagina, cosa hai fatto, cosa è successo) e mandalo con uno screenshot.

## Codici personali e postazioni

- [ ] Impostazioni → Codici personali: codice per ogni cameriere, caposala e responsabile; il tablet di sala segnato come «postazione condivisa».
- [ ] Dal tablet senza codice: «Apri tavolo» mostra il tastierino (nome + codice); con il codice giusto il tavolo si apre e risulta «Segue il tavolo: <nome>».
- [ ] Dopo il tempo scelto (o «🔒 Blocca») la postazione chiede di nuovo il codice; la schermata lasciata aperta non modifica nulla.
- [ ] Con «solo il cameriere che lo segue» attivo: un altro cameriere non modifica il tavolo; il caposala sì e può «Prendi il tavolo».
- [ ] Storno dal tablet: il cameriere non può, il caposala inserisce il suo codice e annulla l'ordine.
- [ ] 5 codici sbagliati: la postazione si blocca 5 minuti.
- [ ] Account cucina: vede solo lo schermo delle comande.
- [ ] Anche dal proprio account (titolare compreso) l'apertura di un tavolo chiede nome + codice; il bot Telegram approva senza codice.
- [ ] Account postazione: nel menu solo Sala e Cucina; un indirizzo come /catalogo riporta alla Sala.

## Verifica firma degli aggiornamenti

- [ ] Dopo l'installazione: `cosign version` sul server mostra `v3.1.4`.
- [ ] Dopo una pipeline verde: `sudo /opt/gestionale/aggiorna.sh --forza` scrive «Firma verificata (ghcr.io/pocho1124/gestionale-migrator@sha256:…)» e prosegue.
- [ ] Prova di rifiuto (fuori orario di servizio): in `/opt/gestionale/aggiorna.sh` cambiare temporaneamente `pocho1124` in `IDENTITA` con un nome errato e lanciarlo con `--forza`: deve fermarsi con «ERRORE SICUREZZA: firma … non verificata», uscita diversa da 0, nessuna migrazione applicata. Poi ripristinare rilanciando `installa-pi.sh`.
- [ ] Il log (Cockpit → Registri → `gestionale-aggiorna`) mostra l'errore di firma.
