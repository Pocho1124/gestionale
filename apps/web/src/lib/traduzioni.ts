/** Traduzioni della pagina del tavolo (senza React: si possono provare con i test). */
export type Lingua = "it" | "en";

const ALLERGENI_EN: Record<string, string> = {
  Glutine: "Gluten", Crostacei: "Crustaceans", Uova: "Eggs", Pesce: "Fish", Arachidi: "Peanuts", Soia: "Soy", Latte: "Milk",
  "Frutta a guscio": "Tree nuts", Sedano: "Celery", Senape: "Mustard", Sesamo: "Sesame", Solfiti: "Sulphites", Lupini: "Lupin", Molluschi: "Molluscs",
};

/** Nome e descrizione nella lingua scelta. */
export const nomeIn = (l: Lingua, x: { nome: string; nome_en?: string }) => (l === "en" && x.nome_en ? x.nome_en : x.nome);
export const descrizioneIn = (l: Lingua, x: { descrizione: string; descrizione_en?: string }) => (l === "en" && x.descrizione_en ? x.descrizione_en : x.descrizione);
export const allergeniIn = (l: Lingua, a: string[]) => (l === "en" ? a.map((x) => ALLERGENI_EN[x] ?? x) : a);

/** Testi fissi della pagina del tavolo. */
export const TESTI_TAVOLO = {
  it: {
    altraLingua: "🇬🇧 English", caricamento: "Caricamento…", qrNonValido: "QR non valido: inquadra il codice sul tuo tavolo o chiedi al personale.",
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
    altraLingua: "🇮🇹 Italiano", caricamento: "Loading…", qrNonValido: "Invalid QR code: scan the code on your table or ask our staff.",
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
} satisfies Record<Lingua, Record<string, unknown>>;
