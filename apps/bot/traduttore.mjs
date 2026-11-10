// Traduzione automatica del menu in inglese e spagnolo con l'IA locale del server (nessun servizio esterno).
// Ogni lingua ha le sue colonne (nome_en / nome_es …) e il suo stato (traduzione_da / traduzione_es_da).
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

/** Impronta dei testi italiani da cui nasce la traduzione: cambia se cambia uno qualsiasi dei testi. */
export const impronta = (...testi) => createHash("sha256").update(testi.map((t) => t ?? "").join("\u0000")).digest("hex").slice(0, 16);

const numeri = (t) => (String(t ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")).sort();

/** Una traduzione è buona se ha gli stessi numeri dell'originale, niente HTML, lunghezza ragionevole e non è vuota. */
export function traduzioneValida(originale, tradotto, massimo) {
  const o = String(originale ?? "").trim(), t = String(tradotto ?? "").trim();
  if (!o) return t === "";
  if (!t || t.length > massimo || /[<>]/.test(t)) return false;
  return JSON.stringify(numeri(o)) === JSON.stringify(numeri(t));
}

// Solo parole che non esistono in inglese né in spagnolo (niente «la», «con», «del», «una», …)
const PAROLE_ITALIANE = new Set(["il", "gli", "di", "della", "dello", "dei", "delle", "degli", "e", "alla", "ai", "alle", "per", "dalla",
  "nel", "nella", "nei", "sul", "sulla", "che", "è", "più", "fra", "anche"]);
/** Testo rimasto in italiano: uguale all'originale o pieno di articoli e preposizioni italiane. */
export function sembraItaliano(originale, tradotto) {
  const t = String(tradotto ?? "").trim().toLowerCase();
  if (!t) return false;
  if (t === String(originale ?? "").trim().toLowerCase()) return true;
  const parole = t.split(/[^a-zàèéìòù']+/).filter(Boolean);
  const italiane = parole.filter((p) => PAROLE_ITALIANE.has(p)).length;
  return italiane >= 2 && italiane / parole.length >= 0.2;
}
/** I nomi dei piatti possono restare uguali (Bruschetta, Burrata); categorie, descrizioni e note devono essere tradotti. */
const descrittivo = (tabella, campo) => campo !== "nome" || tabella === "categorie";

/** Lingue di arrivo: suffisso delle colonne, colonna dello stato, nome per il modello e per i campi della risposta. */
export const LINGUE = {
  en: { suffisso: "_en", stato: "traduzione_da", nome: "inglese", NOME: "INGLESE" },
  es: { suffisso: "_es", stato: "traduzione_es_da", nome: "spagnolo", NOME: "SPAGNOLO" },
};

const sistema = (L) => [
  `Traduci in ${L.nome}, per il menu di un'enoteca italiana, ogni campo che ricevi e restituisci gli stessi campi tradotti.`,
  "Regole:",
  "- lascia invariati i nomi propri: vini, denominazioni (DOC, DOCG, IGT), vitigni, cantine, località;",
  "- lascia in italiano i prodotti tipici che non hanno traduzione (es. pinsa, burrata, 'nduja, speck, bruschetta);",
  "- non aggiungere e non togliere informazioni, ingredienti o numeri; nessun prezzo;",
  "- testo naturale, iniziale maiuscola; traduci tutto il testo, anche le descrizioni lunghe;",
  `- ogni campo della risposta (es. descrizione_${L.nome}) deve essere in ${L.NOME}: mai ricopiare il testo italiano.`,
].join("\n");

/** Tabelle e campi da tradurre: campo italiano e lunghezza massima (la colonna tradotta è campo + suffisso della lingua). */
const TABELLE = [
  { tabella: "categorie", chiave: "id", tipo: "categoria", campi: [["nome", 80], ["descrizione", 500]], extra: "" },
  { tabella: "prodotti", chiave: "id", tipo: "piatto", campi: [["nome", 120], ["descrizione", 1000]], extra: ",vini(prodotto_id)" },
  { tabella: "vini", chiave: "prodotto_id", tipo: "note del vino", campi: [["note", 600]], extra: "" },
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
    const daTradurre = campi.filter(([it]) => String(x[it] ?? "").trim());
    let risposta = {};
    if (daTradurre.length) {
      try {
        risposta = await chiediModello({
          sistema: sistema(L),
          utente: JSON.stringify({ tipo: t.tipo, ...Object.fromEntries(daTradurre.map(([it]) => [it, x[it]])) }),
          // Campi della risposta con il nome della lingua («descrizione_inglese»): il modello piccolo tende meno a ricopiare l'italiano
          schema: { type: "object", properties: Object.fromEntries(daTradurre.map(([it]) => [`${it}_${L.nome}`, { type: "string" }])),
            required: daTradurre.map(([it]) => `${it}_${L.nome}`) },
        }) ?? {};
      } catch (e) {
        log(`Traduzione non disponibile: ${e.message}`);
        return { salvate, fermo: true };
      }
    }
    tentati.add(v.chiave);
    const corpo = {};
    let buoni = 0, scartati = 0;
    for (const [it, en, massimo] of campi) {
      const originale = String(x[it] ?? "").trim();
      if (!originale) { if (!manuale) corpo[en] = ""; continue; }
      const tradotto = String(risposta[`${it}_${L.nome}`] ?? "").trim();
      if (traduzioneValida(originale, tradotto, massimo) && !(descrittivo(t.tabella, it) && sembraItaliano(originale, tradotto))) { corpo[en] = tradotto; buoni++; }
      else { scartati++; if (!manuale) corpo[en] = ""; log(`Traduzione ${L.nome} scartata (${t.tabella}.${it} «${originale.slice(0, 40)}»): rimasta in italiano, numeri o lunghezza non corrispondono`); }
    }
    if (!manuale) corpo[L.stato] = buoni || !scartati ? im : im + SCARTATA;
    if (!Object.keys(corpo).length) continue;
    await db(`${t.tabella}?${t.chiave}=eq.${x[t.chiave]}${manuale ? "" : `&${L.stato}=neq.manuale`}`, { metodo: "PATCH", corpo });
    if (buoni) salvate++;
  }
  return { salvate };
}
