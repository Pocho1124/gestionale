/** Traduzioni del menu e della pagina del tavolo (senza React: si possono provare con i test). */
export type Lingua = "it" | "en" | "es" | "de";
/** Lingue con bandierina e nome nella propria lingua (in fondo al menu e alla pagina del tavolo). */
export const LINGUE: [Lingua, string, string][] = [["it", "🇮🇹", "Italiano"], ["en", "🇬🇧", "English"], ["es", "🇪🇸", "Español"], ["de", "🇩🇪", "Deutsch"]];

const ALLERGENI_EN: Record<string, string> = {
  Glutine: "Gluten", Crostacei: "Crustaceans", Uova: "Eggs", Pesce: "Fish", Arachidi: "Peanuts", Soia: "Soy", Latte: "Milk",
  "Frutta a guscio": "Tree nuts", Sedano: "Celery", Senape: "Mustard", Sesamo: "Sesame", Solfiti: "Sulphites", Lupini: "Lupin", Molluschi: "Molluscs",
};

const ALLERGENI_ES: Record<string, string> = {
  Glutine: "Gluten", Crostacei: "Crustáceos", Uova: "Huevos", Pesce: "Pescado", Arachidi: "Cacahuetes", Soia: "Soja", Latte: "Leche",
  "Frutta a guscio": "Frutos de cáscara", Sedano: "Apio", Senape: "Mostaza", Sesamo: "Sésamo", Solfiti: "Sulfitos", Lupini: "Altramuces", Molluschi: "Moluscos",
};
const ALLERGENI_DE: Record<string, string> = {
  Glutine: "Gluten", Crostacei: "Krebstiere", Uova: "Eier", Pesce: "Fisch", Arachidi: "Erdnüsse", Soia: "Soja", Latte: "Milch",
  "Frutta a guscio": "Schalenfrüchte", Sedano: "Sellerie", Senape: "Senf", Sesamo: "Sesam", Solfiti: "Sulfite", Lupini: "Lupinen", Molluschi: "Weichtiere",
};
const ALLERGENI: Record<Lingua, Record<string, string>> = { it: {}, en: ALLERGENI_EN, es: ALLERGENI_ES, de: ALLERGENI_DE };

/** Testo nella lingua scelta (colonna <campo>_en / <campo>_es / <campo>_de), altrimenti l'italiano. */
const tradotto = (l: Lingua, x: Record<string, unknown>, campo: string) =>
  (l !== "it" && typeof x[`${campo}_${l}`] === "string" && x[`${campo}_${l}`] ? x[`${campo}_${l}`] : x[campo]) as string;

/** Nome e descrizione nella lingua scelta. */
export const nomeIn = (l: Lingua, x: { nome: string; nome_en?: string; nome_es?: string; nome_de?: string }) => tradotto(l, x, "nome");
export const descrizioneIn = (l: Lingua, x: { descrizione: string; descrizione_en?: string; descrizione_es?: string; descrizione_de?: string }) => tradotto(l, x, "descrizione");
export const allergeniIn = (l: Lingua, a: string[]) => a.map((x) => ALLERGENI[l][x] ?? x);

type SceltaLingua = { nome: string; gruppo?: string; gruppo_nome?: string };
/** Voci a scelta e aggiunte nella lingua scelta; il gruppo dell'aggiunta resta in italiano (raggruppa), quello tradotto va in gruppo_nome. */
export const scelteIn = <S extends SceltaLingua>(l: Lingua, scelte: S[]): S[] => (l === "it" ? scelte
  : scelte.map((c) => ({ ...c, nome: tradotto(l, c, "nome"), ...(c.gruppo ? { gruppo_nome: tradotto(l, c, "gruppo") } : {}) })));
/** Gruppi di scelte di un piatto (es. «Formato») con le loro voci nella lingua scelta. */
export const gruppiIn = <G extends { nome: string; scelte: SceltaLingua[] }>(l: Lingua, gruppi: G[]): G[] => (l === "it" ? gruppi
  : gruppi.map((g) => ({ ...g, nome: tradotto(l, g, "nome"), scelte: scelteIn(l, g.scelte) })));

/** Testi della composizione del piatto (Componi), anche per le aggiunte divise per gruppo. */
export const TESTI_COMPONI = {
  it: { base: "Base", scegli: "scegli", da: "da", a: "a", finoA: "fino a", scelti: "scelti", nessuna: "Nessuna voce disponibile: chiedi al personale.",
    gratis: "gratis", incluso: "incluso", annulla: "Annulla", aggiungi: "Aggiungi", componi: "Componi", chiudi: "Chiudi", aggiunte: "Aggiunte", altreAggiunte: "Altre aggiunte" },
  en: { base: "Base", scegli: "choose", da: "from", a: "to", finoA: "up to", scelti: "selected", nessuna: "Nothing available: please ask our staff.",
    gratis: "free", incluso: "included", annulla: "Cancel", aggiungi: "Add", componi: "Choose", chiudi: "Close", aggiunte: "Extras", altreAggiunte: "Other extras" },
  es: { base: "Base", scegli: "elige", da: "de", a: "a", finoA: "hasta", scelti: "elegidos", nessuna: "Nada disponible: pregunta a nuestro personal.",
    gratis: "gratis", incluso: "incluido", annulla: "Cancelar", aggiungi: "Añadir", componi: "Elegir", chiudi: "Cerrar", aggiunte: "Extras", altreAggiunte: "Otros extras" },
  de: { base: "Grundpreis", scegli: "wähle", da: "von", a: "bis", finoA: "bis zu", scelti: "gewählt", nessuna: "Nichts verfügbar: Bitte frag unser Personal.",
    gratis: "gratis", incluso: "inklusive", annulla: "Abbrechen", aggiungi: "Hinzufügen", componi: "Wählen", chiudi: "Schließen", aggiunte: "Extras", altreAggiunte: "Weitere Extras" },
} satisfies Record<Lingua, Record<string, string>>;
export type TestiComponi = (typeof TESTI_COMPONI)["it"];

/** Testi fissi della pagina del tavolo. */
export const TESTI_TAVOLO = {
  it: {
    caricamento: "Caricamento…", qrNonValido: "QR non valido: inquadra il codice sul tuo tavolo o chiedi al personale.",
    tavolo: "Tavolo", richiestaInviata: "⏳ Richiesta inviata: il personale sta arrivando a confermare il tuo ordine…", sezioni: "Sezioni",
    menu: "Menu", ilTuoOrdine: "Il tuo ordine", ordiniConto: "Ordini e conto", da: "da ", componiPiacere: "Componi a piacere: ",
    conAggiunte: "con aggiunte nel tuo ordine", allergeni: "Allergeni: ", nelTuoOrdine: "nel tuo ordine", componi: "Componi", togli: "Togli",
    aggiungi: "Aggiungi", aggiunte: "＋ Aggiunte", aggiuntePer: "Aggiunte per", esaurito: "Esaurito", vuoto: "Non hai ancora aggiunto nulla.",
    meno: "Meno", piu: "Più", notaRiga: "Nota (es. senza cipolla)", notaPersonale: "Nota per il personale", facoltativa: "Facoltativa",
    tuoNome: "Il tuo nome", facoltativo: " (facoltativo)", chiCercare: "Così il personale sa chi cercare",
    infoNome: "Il nome serve solo al personale per riconoscerti e viene cancellato quando il tavolo si chiude.",
    codiceTavolo: "Codice del tavolo (facoltativo)", quattroCifre: "4 cifre", haiCodice: "Hai già il codice del tavolo? Inseriscilo",
    invio: "Invio…", inviaOrdine: "Invia ordine", direttoCucina: "L'ordine va diretto in cucina.",
    spiegazione: "Il personale riceve la tua richiesta, apre il tavolo e da lì gli ordini vanno diretti in cucina.",
    ordiniInviati: "Ordini inviati", codice: "Codice del tavolo:", condividi: "condividilo con chi è con te",
    contoRichiesto: "🧾 Conto richiesto: il personale sta arrivando.", notaConto: "Nota per il conto (es. pago con carta, conti separati)",
    chiediConto: "🧾 Chiedi il conto", comprendeCoperto: "Comprende il coperto:", attesaConferma: "In attesa della conferma del personale…",
    quiVedrai: "Qui vedrai gli ordini dopo la conferma del personale.", nessunOrdine: "Nessun ordine inviato da questo tavolo.",
    motivo: "Motivo:", inviatoAlle: "Inviato alle", aggiuntoAlTuo: "aggiunto al tuo ordine", vedi: "Vedi il tuo ordine",
    piatto: "piatto", piatti: "piatti", scriviNome: "Scrivi il tuo nome per chiedere l'apertura del tavolo", invioFallito: "Invio non riuscito",
    richiestaOk: "Richiesta inviata! Il personale sta arrivando a confermare il tuo ordine.", ordineOk: "Ordine inviato in cucina! 🍽️",
    richiestaFallita: "Richiesta non riuscita", contoOk: "Conto richiesto: il personale sta arrivando. 🧾",
    aperto: (c: string) => `Tavolo aperto e ordine inviato in cucina! Codice del tavolo: ${c} — d'ora in poi gli ordini vanno diretti in cucina; condividilo con chi è con te.`,
    scaduta: "Nessuno ha ancora risposto: chiama il personale al tavolo.", rifiutata: "Il personale non ha accettato la richiesta",
    stati: { da_confermare: "In attesa di conferma", confermato: "Inviato in cucina", in_preparazione: "In preparazione", pronto: "Pronto, sta arrivando", servito: "Servito", rifiutato: "Non accettato" } as Record<string, string>,
  },
  en: {
    caricamento: "Loading…", qrNonValido: "Invalid QR code: scan the code on your table or ask our staff.",
    tavolo: "Table", richiestaInviata: "⏳ Request sent: our staff is coming to confirm your order…", sezioni: "Sections",
    menu: "Menu", ilTuoOrdine: "Your order", ordiniConto: "Orders and bill", da: "from ", componiPiacere: "Make your own: ",
    conAggiunte: "with extras in your order", allergeni: "Allergens: ", nelTuoOrdine: "in your order", componi: "Choose", togli: "Remove",
    aggiungi: "Add", aggiunte: "＋ Extras", aggiuntePer: "Extras for", esaurito: "Sold out", vuoto: "You haven't added anything yet.",
    meno: "Less", piu: "More", notaRiga: "Note (e.g. no onion)", notaPersonale: "Note for the staff", facoltativa: "Optional",
    tuoNome: "Your name", facoltativo: " (optional)", chiCercare: "So our staff knows who to look for",
    infoNome: "Your name is only used by our staff to recognise you and is deleted when the table is closed.",
    codiceTavolo: "Table code (optional)", quattroCifre: "4 digits", haiCodice: "Already have the table code? Enter it",
    invio: "Sending…", inviaOrdine: "Send order", direttoCucina: "Your order goes straight to the kitchen.",
    spiegazione: "Our staff receives your request, opens the table and from then on orders go straight to the kitchen.",
    ordiniInviati: "Orders sent", codice: "Table code:", condividi: "share it with the people at your table",
    contoRichiesto: "🧾 Bill requested: our staff is on the way.", notaConto: "Note for the bill (e.g. paying by card, split bill)",
    chiediConto: "🧾 Ask for the bill", comprendeCoperto: "Includes cover charge:", attesaConferma: "Waiting for staff confirmation…",
    quiVedrai: "Your orders will appear here once our staff confirms them.", nessunOrdine: "No orders sent from this table yet.",
    motivo: "Reason:", inviatoAlle: "Sent at", aggiuntoAlTuo: "added to your order", vedi: "View your order",
    piatto: "item", piatti: "items", scriviNome: "Please enter your name to ask for the table", invioFallito: "Could not send",
    richiestaOk: "Request sent! Our staff is coming to confirm your order.", ordineOk: "Order sent to the kitchen! 🍽️",
    richiestaFallita: "Request failed", contoOk: "Bill requested: our staff is on the way. 🧾",
    aperto: (c: string) => `Table opened and order sent to the kitchen! Table code: ${c} — from now on orders go straight to the kitchen; share it with the people at your table.`,
    scaduta: "Nobody has answered yet: please call our staff.", rifiutata: "Our staff did not accept the request",
    stati: { da_confermare: "Waiting for confirmation", confermato: "Sent to the kitchen", in_preparazione: "Being prepared", pronto: "Ready, on its way", servito: "Served", rifiutato: "Not accepted" } as Record<string, string>,
  },
  es: {
    caricamento: "Cargando…", qrNonValido: "QR no válido: escanea el código de tu mesa o pregunta a nuestro personal.",
    tavolo: "Mesa", richiestaInviata: "⏳ Solicitud enviada: nuestro personal viene a confirmar tu pedido…", sezioni: "Secciones",
    menu: "Menú", ilTuoOrdine: "Tu pedido", ordiniConto: "Pedidos y cuenta", da: "desde ", componiPiacere: "Elige a tu gusto: ",
    conAggiunte: "con extras en tu pedido", allergeni: "Alérgenos: ", nelTuoOrdine: "en tu pedido", componi: "Elegir", togli: "Quitar",
    aggiungi: "Añadir", aggiunte: "＋ Extras", aggiuntePer: "Extras para", esaurito: "Agotado", vuoto: "Todavía no has añadido nada.",
    meno: "Menos", piu: "Más", notaRiga: "Nota (p. ej. sin cebolla)", notaPersonale: "Nota para el personal", facoltativa: "Opcional",
    tuoNome: "Tu nombre", facoltativo: " (opcional)", chiCercare: "Así nuestro personal sabe a quién buscar",
    infoNome: "El nombre solo sirve a nuestro personal para reconocerte y se borra cuando se cierra la mesa.",
    codiceTavolo: "Código de la mesa (opcional)", quattroCifre: "4 cifras", haiCodice: "¿Ya tienes el código de la mesa? Introdúcelo",
    invio: "Enviando…", inviaOrdine: "Enviar pedido", direttoCucina: "El pedido va directo a la cocina.",
    spiegazione: "Nuestro personal recibe tu solicitud, abre la mesa y desde entonces los pedidos van directos a la cocina.",
    ordiniInviati: "Pedidos enviados", codice: "Código de la mesa:", condividi: "compártelo con quien está contigo",
    contoRichiesto: "🧾 Cuenta solicitada: nuestro personal está llegando.", notaConto: "Nota para la cuenta (p. ej. pago con tarjeta, cuentas separadas)",
    chiediConto: "🧾 Pedir la cuenta", comprendeCoperto: "Incluye el cubierto:", attesaConferma: "Esperando la confirmación del personal…",
    quiVedrai: "Aquí verás los pedidos cuando el personal los confirme.", nessunOrdine: "Todavía no se ha enviado ningún pedido desde esta mesa.",
    motivo: "Motivo:", inviatoAlle: "Enviado a las", aggiuntoAlTuo: "añadido a tu pedido", vedi: "Ver tu pedido",
    piatto: "plato", piatti: "platos", scriviNome: "Escribe tu nombre para pedir la apertura de la mesa", invioFallito: "No se ha podido enviar",
    richiestaOk: "¡Solicitud enviada! Nuestro personal viene a confirmar tu pedido.", ordineOk: "¡Pedido enviado a la cocina! 🍽️",
    richiestaFallita: "Solicitud fallida", contoOk: "Cuenta solicitada: nuestro personal está llegando. 🧾",
    aperto: (c: string) => `¡Mesa abierta y pedido enviado a la cocina! Código de la mesa: ${c}. A partir de ahora los pedidos van directos a la cocina; compártelo con quien está contigo.`,
    scaduta: "Nadie ha respondido todavía: llama a nuestro personal.", rifiutata: "Nuestro personal no ha aceptado la solicitud",
    stati: { da_confermare: "Esperando confirmación", confermato: "Enviado a la cocina", in_preparazione: "En preparación", pronto: "Listo, está llegando", servito: "Servido", rifiutato: "No aceptado" } as Record<string, string>,
  },
  de: {
    caricamento: "Wird geladen…", qrNonValido: "Ungültiger QR-Code: Scanne den Code auf deinem Tisch oder frag unser Personal.",
    tavolo: "Tisch", richiestaInviata: "⏳ Anfrage gesendet: Unser Personal kommt, um deine Bestellung zu bestätigen…", sezioni: "Bereiche",
    menu: "Speisekarte", ilTuoOrdine: "Deine Bestellung", ordiniConto: "Bestellungen und Rechnung", da: "ab ", componiPiacere: "Nach Wahl: ",
    conAggiunte: "mit Extras in deiner Bestellung", allergeni: "Allergene: ", nelTuoOrdine: "in deiner Bestellung", componi: "Wählen", togli: "Entfernen",
    aggiungi: "Hinzufügen", aggiunte: "＋ Extras", aggiuntePer: "Extras für", esaurito: "Ausverkauft", vuoto: "Du hast noch nichts hinzugefügt.",
    meno: "Weniger", piu: "Mehr", notaRiga: "Notiz (z. B. ohne Zwiebeln)", notaPersonale: "Notiz für das Personal", facoltativa: "Optional",
    tuoNome: "Dein Name", facoltativo: " (optional)", chiCercare: "Damit unser Personal weiß, wen es suchen soll",
    infoNome: "Der Name dient nur unserem Personal, um dich zu erkennen, und wird gelöscht, wenn der Tisch geschlossen wird.",
    codiceTavolo: "Tischcode (optional)", quattroCifre: "4 Ziffern", haiCodice: "Hast du schon den Tischcode? Gib ihn ein",
    invio: "Wird gesendet…", inviaOrdine: "Bestellung senden", direttoCucina: "Die Bestellung geht direkt in die Küche.",
    spiegazione: "Unser Personal erhält deine Anfrage, öffnet den Tisch und ab dann gehen die Bestellungen direkt in die Küche.",
    ordiniInviati: "Gesendete Bestellungen", codice: "Tischcode:", condividi: "teile ihn mit deinen Begleitern",
    contoRichiesto: "🧾 Rechnung angefordert: Unser Personal kommt gleich.", notaConto: "Notiz zur Rechnung (z. B. Kartenzahlung, getrennte Rechnungen)",
    chiediConto: "🧾 Rechnung anfordern", comprendeCoperto: "Inklusive Gedeck:", attesaConferma: "Warten auf die Bestätigung des Personals…",
    quiVedrai: "Hier siehst du die Bestellungen, sobald das Personal sie bestätigt hat.", nessunOrdine: "Von diesem Tisch wurde noch keine Bestellung gesendet.",
    motivo: "Grund:", inviatoAlle: "Gesendet um", aggiuntoAlTuo: "zu deiner Bestellung hinzugefügt", vedi: "Deine Bestellung ansehen",
    piatto: "Gericht", piatti: "Gerichte", scriviNome: "Gib deinen Namen ein, um die Öffnung des Tisches anzufragen", invioFallito: "Senden fehlgeschlagen",
    richiestaOk: "Anfrage gesendet! Unser Personal kommt, um deine Bestellung zu bestätigen.", ordineOk: "Bestellung an die Küche gesendet! 🍽️",
    richiestaFallita: "Anfrage fehlgeschlagen", contoOk: "Rechnung angefordert: Unser Personal kommt gleich. 🧾",
    aperto: (c: string) => `Tisch geöffnet und Bestellung an die Küche gesendet! Tischcode: ${c}. Ab jetzt gehen die Bestellungen direkt in die Küche; teile ihn mit deinen Begleitern.`,
    scaduta: "Noch hat niemand geantwortet: Bitte ruf unser Personal.", rifiutata: "Unser Personal hat die Anfrage nicht angenommen",
    stati: { da_confermare: "Warten auf Bestätigung", confermato: "An die Küche gesendet", in_preparazione: "In Zubereitung", pronto: "Fertig, kommt gleich", servito: "Serviert", rifiutato: "Nicht angenommen" } as Record<string, string>,
  },
} satisfies Record<Lingua, Record<string, unknown>>;

const ETICHETTE_EN: Record<string, string> = {
  Vegetariano: "Vegetarian", Vegano: "Vegan", Piccante: "Spicy", "Senza glutine": "Gluten free", "Novità": "New", Consigliato: "Recommended", Surgelato: "Frozen",
};
const ETICHETTE: Record<Lingua, Record<string, string>> = {
  it: {}, en: ETICHETTE_EN,
  es: { Vegetariano: "Vegetariano", Vegano: "Vegano", Piccante: "Picante", "Senza glutine": "Sin gluten", "Novità": "Novedad", Consigliato: "Recomendado", Surgelato: "Congelado" },
  de: { Vegetariano: "Vegetarisch", Vegano: "Vegan", Piccante: "Scharf", "Senza glutine": "Glutenfrei", "Novità": "Neu", Consigliato: "Empfohlen", Surgelato: "Tiefgekühlt" },
};

/** Menu con i testi del locale nella lingua scelta: nomi, descrizioni, note dei vini, allergeni ed etichette (dove manca resta l'italiano). */
export function menuInLingua<M extends { categorie: { nome: string; descrizione: string; aggiunte?: SceltaLingua[];
  prodotti: { nome: string; descrizione: string; allergeni: string[]; etichette: string[];
    vino?: { note: string } | null; opzioni?: { nome: string; scelte: SceltaLingua[] }[] }[] }[] }>(menu: M, l: Lingua): M {
  if (l === "it") return menu;
  return {
    ...menu,
    categorie: menu.categorie.map((c) => ({
      ...c, nome: tradotto(l, c, "nome"), descrizione: tradotto(l, c, "descrizione"), aggiunte: c.aggiunte && scelteIn(l, c.aggiunte),
      prodotti: c.prodotti.map((p) => ({
        ...p, nome: tradotto(l, p, "nome"), descrizione: tradotto(l, p, "descrizione"), allergeni: allergeniIn(l, p.allergeni),
        etichette: p.etichette.map((e) => ETICHETTE[l][e] ?? e),
        vino: p.vino ? { ...p.vino, note: tradotto(l, p.vino, "note") } : p.vino,
        opzioni: p.opzioni && gruppiIn(l, p.opzioni),
      })),
    })),
  };
}

/** Testi fissi del menu (pagina, scheda del piatto, quiz «Trova il tuo vino», mappa). */
export const TESTI_MENU = {
  it: {
    indeciso: "Sei indeciso?", trova: "Trova il tuo vino in 3 domande", viniPerRegione: "Vini per regione", mappa: "🗺️ Scegli dalla mappa", tutte: "Tutte", altreZone: "Altre zone",
    categorie: "Categorie", vuoto: "Il menu sarà disponibile a breve.", apriScheda: "apri la scheda", esaurito: "Esaurito", da: "da ",
    siAbbinaCon: "🍷 Si abbina con ", o: " o ", allergeni: "Allergeni: ", infoAllergeni: "Per informazioni sugli allergeni rivolgersi al personale.",
    chiudi: "Chiudi", torna: "← Torna a ", calice: "Calice ", bottiglia: " · Bottiglia ", idealeCon: "Ideale con", sommelier: "Il sommelier consiglia",
    scegli: "scegli ", a: " a ", finoA: "fino a ", incluso: "incluso", domanda: (n: number) => `Domanda ${n} di 3`, qVino: "Che vino preferisci?",
    sorprendimi: "Sorprendimi", qCorpo: "Come lo vorresti?", leggero: "Leggero e fresco", equilibrato: "Equilibrato", strutturato: "Strutturato e intenso",
    indifferente: "Indifferente", qCibo: "Cosa mangerai?", soloVino: "Solo vino", comePreferisci: ", come preferisci", siAbbinaA: "Si abbina a ", e: " e ",
    nessuno: (tipo: string | null) => `${tipo ? `In questo momento non abbiamo un ${tipo.toLowerCase()} disponibile in carta` : "Nessun vino disponibile in carta"}: chiedi al personale, saprà consigliarti.`,
    ricomincia: "Ricomincia", trovaTitolo: "Trova il tuo vino", mappaTitolo: "Scegli la regione dalla mappa", scegliRegione: "Scegli una regione",
    tocca: "Tocca una regione illuminata", vino: "vino", vini: "vini", regioniItalia: "Regioni d'Italia", fonteMappa: "Confini: ISTAT (CC BY 4.0)",
    tipi: { rosso: "Rosso", bianco: "Bianco", rosato: "Rosato", bollicine: "Bollicine", dolce: "Dolce" } as Record<string, string>,
    corpi: { leggero: "Leggero", medio: "Equilibrato", strutturato: "Strutturato" } as Record<string, string>,
  },
  en: {
    indeciso: "Can't decide?", trova: "Find your wine in 3 questions", viniPerRegione: "Wines by region", mappa: "🗺️ Choose on the map", tutte: "All", altreZone: "Other areas",
    categorie: "Categories", vuoto: "The menu will be available soon.", apriScheda: "open details", esaurito: "Sold out", da: "from ",
    siAbbinaCon: "🍷 Pairs with ", o: " or ", allergeni: "Allergens: ", infoAllergeni: "For allergen information, please ask our staff.",
    chiudi: "Close", torna: "← Back to ", calice: "Glass ", bottiglia: " · Bottle ", idealeCon: "Ideal with", sommelier: "Our sommelier suggests",
    scegli: "choose ", a: " to ", finoA: "up to ", incluso: "included", domanda: (n: number) => `Question ${n} of 3`, qVino: "Which wine do you prefer?",
    sorprendimi: "Surprise me", qCorpo: "How would you like it?", leggero: "Light and fresh", equilibrato: "Balanced", strutturato: "Full-bodied and intense",
    indifferente: "No preference", qCibo: "What will you eat?", soloVino: "Just wine", comePreferisci: ", as you like", siAbbinaA: "Pairs with ", e: " and ",
    nessuno: (tipo: string | null) => `${tipo ? `Right now we have no ${tipo.toLowerCase()} wine available` : "No wine available right now"}: please ask our staff, they will be happy to help.`,
    ricomincia: "Start again", trovaTitolo: "Find your wine", mappaTitolo: "Choose the region on the map", scegliRegione: "Choose a region",
    tocca: "Tap a highlighted region", vino: "wine", vini: "wines", regioniItalia: "Regions of Italy", fonteMappa: "Borders: ISTAT (CC BY 4.0)",
    tipi: { rosso: "Red", bianco: "White", rosato: "Rosé", bollicine: "Sparkling", dolce: "Dessert" } as Record<string, string>,
    corpi: { leggero: "Light", medio: "Balanced", strutturato: "Full-bodied" } as Record<string, string>,
  },
  es: {
    indeciso: "¿Indeciso?", trova: "Encuentra tu vino en 3 preguntas", viniPerRegione: "Vinos por región", mappa: "🗺️ Elige en el mapa", tutte: "Todas", altreZone: "Otras zonas",
    categorie: "Categorías", vuoto: "El menú estará disponible en breve.", apriScheda: "abrir la ficha", esaurito: "Agotado", da: "desde ",
    siAbbinaCon: "🍷 Marida con ", o: " o ", allergeni: "Alérgenos: ", infoAllergeni: "Para información sobre alérgenos, consulte a nuestro personal.",
    chiudi: "Cerrar", torna: "← Volver a ", calice: "Copa ", bottiglia: " · Botella ", idealeCon: "Ideal con", sommelier: "Nuestro sumiller recomienda",
    scegli: "elige ", a: " a ", finoA: "hasta ", incluso: "incluido", domanda: (n: number) => `Pregunta ${n} de 3`, qVino: "¿Qué vino prefieres?",
    sorprendimi: "Sorpréndeme", qCorpo: "¿Cómo lo quieres?", leggero: "Ligero y fresco", equilibrato: "Equilibrado", strutturato: "Con cuerpo e intenso",
    indifferente: "Me da igual", qCibo: "¿Qué vas a comer?", soloVino: "Solo vino", comePreferisci: ", como prefieras", siAbbinaA: "Marida con ", e: " y ",
    nessuno: (tipo: string | null) => `${tipo ? `En este momento no tenemos un ${tipo.toLowerCase()} disponible en carta` : "Ningún vino disponible en carta"}: pregunta a nuestro personal, te aconsejará encantado.`,
    ricomincia: "Empezar de nuevo", trovaTitolo: "Encuentra tu vino", mappaTitolo: "Elige la región en el mapa", scegliRegione: "Elige una región",
    tocca: "Toca una región iluminada", vino: "vino", vini: "vinos", regioniItalia: "Regiones de Italia", fonteMappa: "Límites: ISTAT (CC BY 4.0)",
    tipi: { rosso: "Tinto", bianco: "Blanco", rosato: "Rosado", bollicine: "Espumoso", dolce: "Dulce" } as Record<string, string>,
    corpi: { leggero: "Ligero", medio: "Equilibrado", strutturato: "Con cuerpo" } as Record<string, string>,
  },
  de: {
    indeciso: "Unentschlossen?", trova: "Finde deinen Wein in 3 Fragen", viniPerRegione: "Weine nach Region", mappa: "🗺️ Auf der Karte wählen", tutte: "Alle", altreZone: "Andere Gebiete",
    categorie: "Kategorien", vuoto: "Die Speisekarte ist bald verfügbar.", apriScheda: "Details öffnen", esaurito: "Ausverkauft", da: "ab ",
    siAbbinaCon: "🍷 Passt zu ", o: " oder ", allergeni: "Allergene: ", infoAllergeni: "Informationen zu Allergenen erhalten Sie bei unserem Personal.",
    chiudi: "Schließen", torna: "← Zurück zu ", calice: "Glas ", bottiglia: " · Flasche ", idealeCon: "Ideal zu", sommelier: "Unser Sommelier empfiehlt",
    scegli: "wähle ", a: " bis ", finoA: "bis zu ", incluso: "inklusive", domanda: (n: number) => `Frage ${n} von 3`, qVino: "Welchen Wein bevorzugst du?",
    sorprendimi: "Überrasch mich", qCorpo: "Wie hättest du ihn gern?", leggero: "Leicht und frisch", equilibrato: "Ausgewogen", strutturato: "Kräftig und intensiv",
    indifferente: "Egal", qCibo: "Was isst du dazu?", soloVino: "Nur Wein", comePreferisci: ", wie du magst", siAbbinaA: "Passt zu ", e: " und ",
    nessuno: (tipo: string | null) => `${tipo ? `Im Moment haben wir keinen ${tipo} auf der Karte` : "Derzeit kein Wein auf der Karte"}: frag unser Personal, wir beraten dich gern.`,
    ricomincia: "Neu starten", trovaTitolo: "Finde deinen Wein", mappaTitolo: "Region auf der Karte wählen", scegliRegione: "Region wählen",
    tocca: "Tippe auf eine hervorgehobene Region", vino: "Wein", vini: "Weine", regioniItalia: "Regionen Italiens", fonteMappa: "Grenzen: ISTAT (CC BY 4.0)",
    tipi: { rosso: "Rotwein", bianco: "Weißwein", rosato: "Roséwein", bollicine: "Schaumwein", dolce: "Dessertwein" } as Record<string, string>,
    corpi: { leggero: "Leicht", medio: "Ausgewogen", strutturato: "Kräftig" } as Record<string, string>,
  },
} satisfies Record<Lingua, Record<string, unknown>>;
export type TestiMenu = (typeof TESTI_MENU)["it"];
