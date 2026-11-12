// Traduzione automatica del menu in inglese, spagnolo e tedesco con l'IA locale del server (nessun servizio esterno).
// Ogni lingua ha le sue colonne (nome_en / nome_es / nome_de …) e il suo stato (traduzione_da / traduzione_es_da / traduzione_de_da).
// Traduce nome e descrizione di categorie e piatti e le note delle schede dei vini quando il testo italiano cambia.
// Ogni campo vale da solo: una descrizione buona si salva anche se il nome non supera il controllo.
// Traduzioni scritte a mano («manuale»): non si toccano mai; si completano solo i campi inglesi rimasti vuoti.
// I nomi dei vini restano quelli originali (sono nomi propri).
// Regole del progetto: il modello non inventa dati. Un campo che cambia i numeri del testo, contiene HTML o è troppo
// lungo, oppure una descrizione rimasta in italiano, si scarta (resta l'italiano); prezzi e dati delle schede dei vini non passano mai dal modello.
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCARTATA = ":scartata";
/** Tentativi già fatti in questo avvio (tabella:id:impronta): niente richieste ripetute al modello ogni minuto. */
const tentati = new Set();
export const dimenticaTentativi = () => tentati.clear();

/** Versione delle regole di traduzione: se cambia, le traduzioni automatiche si rifanno (quelle a mano restano). */
const VERSIONE = "3";
/** Impronta dei testi italiani da cui nasce la traduzione: cambia se cambia uno qualsiasi dei testi. */
export const impronta = (...testi) => createHash("sha256").update([VERSIONE, ...testi.map((t) => t ?? "")].join("\u0000")).digest("hex").slice(0, 16);

const numeri = (t) => (String(t ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")).sort();

/** Una traduzione è buona se ha gli stessi numeri dell'originale, niente HTML, lunghezza ragionevole e non è vuota. */
export function traduzioneValida(originale, tradotto, massimo) {
  const o = String(originale ?? "").trim(), t = String(tradotto ?? "").trim();
  if (!o) return t === "";
  if (!t || t.length > massimo || /[<>]/.test(t)) return false;
  return JSON.stringify(numeri(o)) === JSON.stringify(numeri(t));
}

// Solo parole che non esistono in inglese, spagnolo o tedesco (niente «la», «con», «del», «una», «die», …)
const PAROLE_ITALIANE = new Set(["il", "gli", "di", "della", "dello", "dei", "delle", "degli", "e", "alla", "ai", "alle", "per", "dalla",
  "nel", "nella", "nei", "sul", "sulla", "che", "è", "più", "fra", "anche"]);
/** Testo rimasto in italiano: uguale all'originale o pieno di articoli e preposizioni italiane. */
export function sembraItaliano(originale, tradotto) {
  const t = String(tradotto ?? "").trim().toLowerCase();
  if (!t) return false;
  if (t === String(originale ?? "").trim().toLowerCase()) return true;
  const parole = t.split(/[^a-zàèéìòùäöüß']+/).filter(Boolean);
  const italiane = parole.filter((p) => PAROLE_ITALIANE.has(p)).length;
  return italiane >= 2 && italiane / parole.length >= 0.2;
}
/** I nomi dei piatti e delle voci possono restare uguali (Bruschetta, Burrata); categorie, gruppi di scelte, descrizioni e note no. */
const descrittivo = (tabella, campo) => campo !== "nome" || tabella === "categorie" || tabella === "gruppi_opzioni";

/** Lingue di arrivo: suffisso delle colonne, colonna dello stato, nome per il modello e per i campi della risposta. */
export const LINGUE = {
  en: { suffisso: "_en", stato: "traduzione_da", nome: "inglese", NOME: "INGLESE" },
  es: { suffisso: "_es", stato: "traduzione_es_da", nome: "spagnolo", NOME: "SPAGNOLO" },
  de: { suffisso: "_de", stato: "traduzione_de_da", nome: "tedesco", NOME: "TEDESCO" },
};

/** Nomi ricorrenti delle categorie: esempi per il modello piccolo, che altrimenti li traduce alla lettera. */
const ESEMPI = {
  inglese: "Carta dei vini = Wine list; Vini al calice = Wines by the glass; Taglieri = Platters; Birre = Beers; Bollicine = Sparkling wines",
  spagnolo: "Carta dei vini = Carta de vinos; Vini al calice = Vinos por copas; Taglieri = Tablas; Birre = Cervezas; Bollicine = Espumosos",
  tedesco: "Carta dei vini = Weinkarte; Vini al calice = Offene Weine; Taglieri = Platten; Birre = Biere; Bollicine = Schaumweine",
};

const sistema = (L, fonte = "italiano") => [
  `Traduci dall'${fonte} in ${L.nome}, per il menu di un'enoteca italiana, ogni campo che ricevi e restituisci gli stessi campi tradotti.`,
  `Esempi di categorie: ${ESEMPI[L.nome]}.`,
  "Regole:",
  "- lascia invariati i nomi propri: vini, denominazioni (DOC, DOCG, IGT), vitigni, cantine, località;",
  "- lascia in italiano i prodotti tipici che non hanno traduzione (es. pinsa, burrata, 'nduja, speck, bruschetta);",
  "- non aggiungere e non togliere informazioni, ingredienti o numeri; nessun prezzo;",
  "- testo naturale, iniziale maiuscola; traduci tutto il testo, anche le descrizioni lunghe;",
  `- ogni campo della risposta (es. descrizione_${L.nome}) deve essere in ${L.NOME}: mai ricopiare il testo ricevuto;`,
  `- traduci anche tipo e colore dei vini (rosso, bianco, rosato) e le parole comuni: in ${L.nome} non resta nessuna parola italiana comune.`,
].join("\n");

/** Tabelle e campi da tradurre: campo italiano e lunghezza massima (la colonna tradotta è campo + suffisso della lingua). */
const TABELLE = [
  { tabella: "categorie", chiave: "id", tipo: "categoria", campi: [["nome", 80], ["descrizione", 500]], extra: "" },
  { tabella: "prodotti", chiave: "id", tipo: "piatto", campi: [["nome", 120], ["descrizione", 1000]], extra: ",vini(prodotto_id)" },
  { tabella: "vini", chiave: "prodotto_id", tipo: "note del vino", campi: [["note", 600]], extra: "" },
  // Scelte dei piatti: gruppo (es. «Formato»), voce (es. «Calice»), aggiunta con il suo gruppo (es. «Miele», «Dolci»)
  { tabella: "gruppi_opzioni", chiave: "id", tipo: "gruppo di scelte di un piatto", campi: [["nome", 80]], extra: "" },
  { tabella: "opzioni", chiave: "id", tipo: "voce a scelta di un piatto", campi: [["nome", 80]], extra: "" },
  { tabella: "aggiunte", chiave: "id", tipo: "aggiunta a un piatto e suo gruppo", campi: [["nome", 60], ["gruppo", 40]], extra: "" },
];
const lettura = (t, lingue) => `${t.tabella}?select=${[t.chiave, ...t.campi.map(([it]) => it),
  ...lingue.flatMap((l) => [...t.campi.map(([it]) => it + LINGUE[l].suffisso), LINGUE[l].stato])].join(",")}${t.extra}`;

/**
 * Traduce al massimo «limite» voci da aggiornare del locale e le salva.
 * Dipendenze passate dall'esterno (database e modello), così si prova senza rete. Restituisce quante voci ha salvato.
 */
export async function traduciMenu({ db, chiediModello, locale, log = () => {}, limite = 15, lingue = Object.keys(LINGUE) }) {
  if (!UUID.test(String(locale))) throw new Error("Locale non valido");
  const righe = await Promise.all(TABELLE.map((t) => db(`${lettura(t, lingue)}&locale_id=eq.${locale}`)));
  let salvate = 0;
  for (const lingua of lingue) {
    const esito = await traduciLingua({ L: LINGUE[lingua], lingua, righe, db, chiediModello, log, limite });
    salvate += esito.salvate;
    if (esito.fermo) break;   // modello spento o occupato: si riprova al giro successivo
  }
  return salvate;
}

/** Nomi ricorrenti delle categorie: traduzione fissa, senza modello (sempre uguale, anche quando resta uguale all'italiano). */
const CATEGORIE_FISSE = {
  "carta dei vini": ["Wine list", "Carta de vinos", "Weinkarte"], "vini": ["Wines", "Vinos", "Weine"], "vini al calice": ["Wines by the glass", "Vinos por copas", "Offene Weine"],
  "vini rossi": ["Red wines", "Vinos tintos", "Rotweine"], "vini bianchi": ["White wines", "Vinos blancos", "Weißweine"], "vini rosati": ["Rosé wines", "Vinos rosados", "Roséweine"],
  "bollicine": ["Sparkling wines", "Espumosos", "Schaumweine"], "vini dolci": ["Dessert wines", "Vinos dulces", "Dessertweine"], "taglieri": ["Platters", "Tablas", "Platten"],
  "tagliere": ["Platter", "Tabla", "Platte"], "pinse": ["Pinsa", "Pinsas", "Pinsa"], "pinsa": ["Pinsa", "Pinsa", "Pinsa"], "birre": ["Beers", "Cervezas", "Biere"],
  "birre artigianali": ["Craft beers", "Cervezas artesanales", "Craft-Biere"], "antipasti": ["Starters", "Entrantes", "Vorspeisen"], "primi": ["First courses", "Primeros platos", "Erste Gänge"],
  "secondi": ["Main courses", "Segundos platos", "Hauptgerichte"], "contorni": ["Side dishes", "Guarniciones", "Beilagen"], "dolci": ["Desserts", "Postres", "Desserts"],
  "formaggi": ["Cheeses", "Quesos", "Käse"], "salumi": ["Cured meats", "Embutidos", "Wurstwaren"], "bevande": ["Drinks", "Bebidas", "Getränke"], "bibite": ["Soft drinks", "Refrescos", "Erfrischungsgetränke"],
  "analcolici": ["Non-alcoholic drinks", "Bebidas sin alcohol", "Alkoholfreie Getränke"], "caffetteria": ["Coffee", "Cafetería", "Kaffee"], "amari": ["Digestifs", "Digestivos", "Digestifs"],
  "distillati": ["Spirits", "Destilados", "Spirituosen"], "cocktail": ["Cocktails", "Cócteles", "Cocktails"], "aperitivi": ["Aperitifs", "Aperitivos", "Aperitifs"],
};
export const categoriaFissa = (lingua, nome) => CATEGORIE_FISSE[String(nome ?? "").trim().toLowerCase()]?.[{ en: 0, es: 1, de: 2 }[lingua] ?? -1] ?? "";

/** Colori dei vini: sempre la stessa parola (in spagnolo il vino rosso è «tinto», mai «rojo»; in tedesco «Rotwein»), mai l'italiano rimasto. */
const COLORI = {
  en: [[/\brosso\b/gi, "red"], [/\bbianco\b/gi, "white"], [/\brosato\b/gi, "rosé"]],
  es: [[/\bvino rojo\b/gi, "vino tinto"], [/\brojo\b/gi, "tinto"], [/\brosso\b/gi, "tinto"], [/\bbianco\b/gi, "blanco"], [/\brosato\b/gi, "rosado"]],
  de: [[/\bvino rosso\b/gi, "Rotwein"], [/\bvino bianco\b/gi, "Weißwein"], [/\bvino rosato\b/gi, "Roséwein"], [/\brosso\b/gi, "rot"], [/\bbianco\b/gi, "weiß"], [/\brosato\b/gi, "rosé"]],
};
/** Sostituisce le parole dei colori, ma non dentro i nomi propri (Rosso di Montalcino, Bianco di Custoza, nome del vino). */
export function coloriVino(lingua, testo, nome = "") {
  let t = String(testo ?? "");
  for (const [re, al] of COLORI[lingua] ?? []) {
    t = t.replace(re, (parola, pos) => {
      const dopo = t.slice(pos + parola.length);
      if (/^ (?:di |del |dei |della )?[A-ZÀ-Ý]/.test(dopo) || new RegExp(`\\b${parola}\\b`, "i").test(nome)) return parola;   // nome proprio
      const maiuscola = parola[0] === parola[0].toUpperCase();
      return maiuscola ? al[0].toUpperCase() + al.slice(1) : al;
    });
  }
  return t;
}

/**
 * Spagnolo e tedesco si traducono dall'inglese già controllato quando c'è (il modello piccolo traduce molto meglio dall'inglese);
 * numeri e italiano rimasto si controllano sempre sul testo italiano.
 */
const ponte = (lingua, t, x, it, im) => {
  if (lingua === "en") return "";
  const en = String(x[`${it}_en`] ?? "").trim();
  const attuale = x.traduzione_da === im || x.traduzione_da === "manuale";
  return en && attuale && traduzioneValida(x[it], en, 10_000) && !(descrittivo(t.tabella, it) && sembraItaliano(x[it], en)) ? en : "";
};

async function traduciLingua({ L, lingua, righe, db, chiediModello, log, limite }) {
  const voci = [];
  TABELLE.forEach((t0, i) => {
    const t = { ...t0, campi: t0.campi.map(([it, massimo]) => [it, it + L.suffisso, massimo]) };
    for (const x of righe[i]) {
      const vino = t.tabella === "prodotti" && !!(Array.isArray(x.vini) ? x.vini.length : x.vini);
      const campi = t.campi.filter(([it]) => !(vino && it === "nome"));   // il nome del vino resta l'originale
      const im = impronta(...t.campi.map(([it]) => x[it]));
      const da = x[L.stato] ?? "";
      const manuale = da === "manuale";
      // A mano: solo i campi inglesi vuoti. Altrimenti tutto se l'italiano è cambiato; una traduzione scartata si
      // ritenta una volta per avvio del bot (il registro dei tentativi evita richieste ripetute ogni minuto)
      // Traduzioni già salvate ma rimaste in italiano (modello che ricopia il testo): si rifanno
      const daFare = manuale ? campi.filter(([it, en]) => String(x[it] ?? "").trim() && !String(x[en] ?? "").trim())
        : da !== im ? campi : campi.some(([it, en]) => descrittivo(t.tabella, it) && sembraItaliano(x[it], x[en])) ? campi : [];
      const chiave = `${lingua}:${t.tabella}:${x[t.chiave]}:${im}:${daFare.map(([it]) => it).join(",")}`;
      if (daFare.length && !tentati.has(chiave) && UUID.test(String(x[t.chiave]))) voci.push({ t, x, campi: daFare, im, manuale, chiave });
    }
  });

  let salvate = 0;
  for (const v of voci.slice(0, limite)) {
    const { t, x, campi, im, manuale } = v;
    const fisse = Object.fromEntries(campi.filter(([it]) => t.tabella === "categorie" && it === "nome" && categoriaFissa(lingua, x[it]))
      .map(([it]) => [it, categoriaFissa(lingua, x[it])]));
    const daTradurre = campi.filter(([it]) => String(x[it] ?? "").trim() && !fisse[it]);
    const fonti = Object.fromEntries(daTradurre.map(([it]) => [it, ponte(lingua, t, x, it, im)]));
    const dallInglese = daTradurre.length > 0 && daTradurre.every(([it]) => fonti[it]);
    let risposta = {};
    if (daTradurre.length) {
      try {
        risposta = await chiediModello({
          sistema: sistema(L, dallInglese ? "inglese" : "italiano"),
          utente: JSON.stringify({ tipo: t.tipo, ...Object.fromEntries(daTradurre.map(([it]) => [it, dallInglese ? fonti[it] : x[it]])) }),
          // Campi della risposta con il nome della lingua («descrizione_inglese»): il modello piccolo tende meno a ricopiare l'italiano
          schema: { type: "object", properties: Object.fromEntries(daTradurre.map(([it]) => [`${it}_${L.nome}`, { type: "string" }])),
            required: daTradurre.map(([it]) => `${it}_${L.nome}`) },
        }) ?? {};
      } catch (e) {
        // Una voce troppo lunga per il tempo concesso si salta per questo avvio: non blocca le altre né le altre lingue
        if (e?.name === "TimeoutError") { tentati.add(v.chiave); log(`Traduzione ${L.nome} troppo lenta, saltata (${t.tabella} «${String(x[campi[0][0]] ?? "").slice(0, 40)}»)`); continue; }
        log(`Traduzione non disponibile: ${e.message}`);
        return { salvate, fermo: true };   // modello spento o occupato: si riprova al giro successivo
      }
    }
    tentati.add(v.chiave);
    const corpo = {};
    let buoni = 0, scartati = 0;
    for (const [it, en, massimo] of campi) {
      const originale = String(x[it] ?? "").trim();
      if (!originale) { if (!manuale) corpo[en] = ""; continue; }
      if (fisse[it]) { corpo[en] = fisse[it]; buoni++; continue; }
      const grezzo = String(risposta[`${it}_${L.nome}`] ?? "").trim();
      const tradotto = it === "nome" ? grezzo : coloriVino(lingua, grezzo, t.tabella === "prodotti" ? x.nome : "");
      const copiaInglese = dallInglese && descrittivo(t.tabella, it) && tradotto.toLowerCase() === fonti[it].toLowerCase();
      if (traduzioneValida(originale, tradotto, massimo) && !copiaInglese && !(descrittivo(t.tabella, it) && sembraItaliano(originale, tradotto))) { corpo[en] = tradotto; buoni++; }
      else { scartati++; if (!manuale) corpo[en] = ""; log(`Traduzione ${L.nome} scartata (${t.tabella}.${it} «${originale.slice(0, 40)}»): rimasta in italiano, numeri o lunghezza non corrispondono`); }
    }
    if (!manuale) corpo[L.stato] = buoni || !scartati ? im : im + SCARTATA;
    if (!Object.keys(corpo).length) continue;
    await db(`${t.tabella}?${t.chiave}=eq.${x[t.chiave]}${manuale ? "" : `&${L.stato}=neq.manuale`}`, { metodo: "PATCH", corpo });
    Object.assign(x, corpo);   // la lingua successiva vede la traduzione appena salvata
    if (buoni) salvate++;
  }
  return { salvate };
}
