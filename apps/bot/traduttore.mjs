// Traduzione automatica del menu in inglese con l'IA locale del server (nessun servizio esterno).
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

const PAROLE_ITALIANE = new Set(["il", "lo", "la", "gli", "le", "di", "del", "della", "dello", "dei", "delle", "degli", "con", "e", "al", "alla",
  "ai", "alle", "per", "un", "una", "uno", "da", "dal", "dalla", "nel", "nella", "sul", "sulla", "che", "è", "più", "tra", "fra"]);
/** Testo rimasto in italiano: uguale all'originale o pieno di articoli e preposizioni italiane. */
export function sembraItaliano(originale, tradotto) {
  const t = String(tradotto ?? "").trim().toLowerCase();
  if (!t) return false;
  if (t === String(originale ?? "").trim().toLowerCase()) return true;
  const parole = t.split(/[^a-zàèéìòù']+/).filter(Boolean);
  const italiane = parole.filter((p) => PAROLE_ITALIANE.has(p)).length;
  return italiane >= 2 && italiane / parole.length >= 0.2;
}
/** I nomi possono restare uguali (Bruschetta, Burrata); descrizioni e note devono essere in inglese. */
const descrittivo = (campo) => campo !== "nome";

const SISTEMA = [
  "Traduci in inglese, per il menu di un'enoteca italiana, ogni campo che ricevi e restituisci gli stessi campi tradotti.",
  "Regole:",
  "- lascia invariati i nomi propri: vini, denominazioni (DOC, DOCG, IGT), vitigni, cantine, località;",
  "- lascia in italiano i prodotti tipici che non hanno traduzione (es. pinsa, burrata, 'nduja, speck, bruschetta);",
  "- non aggiungere e non togliere informazioni, ingredienti o numeri; nessun prezzo;",
  "- testo naturale, iniziale maiuscola; traduci tutto il testo, anche le descrizioni lunghe;",
  "- ogni campo della risposta (es. descrizione_inglese) deve essere in INGLESE: mai ricopiare il testo italiano.",
].join("\n");

/** Tabelle e campi da tradurre: nome del campo italiano, colonna inglese, lunghezza massima. */
const TABELLE = [
  { tabella: "categorie", chiave: "id", tipo: "categoria", campi: [["nome", "nome_en", 80], ["descrizione", "descrizione_en", 500]],
    lettura: "categorie?select=id,nome,descrizione,nome_en,descrizione_en,traduzione_da" },
  { tabella: "prodotti", chiave: "id", tipo: "piatto", campi: [["nome", "nome_en", 120], ["descrizione", "descrizione_en", 1000]],
    lettura: "prodotti?select=id,nome,descrizione,nome_en,descrizione_en,traduzione_da,vini(prodotto_id)" },
  { tabella: "vini", chiave: "prodotto_id", tipo: "note del vino", campi: [["note", "note_en", 600]],
    lettura: "vini?select=prodotto_id,note,note_en,traduzione_da" },
];

/**
 * Traduce al massimo «limite» voci da aggiornare del locale e le salva.
 * Dipendenze passate dall'esterno (database e modello), così si prova senza rete. Restituisce quante voci ha salvato.
 */
export async function traduciMenu({ db, chiediModello, locale, log = () => {}, limite = 15 }) {
  if (!UUID.test(String(locale))) throw new Error("Locale non valido");
  const righe = await Promise.all(TABELLE.map((t) => db(`${t.lettura}&locale_id=eq.${locale}`)));
  const voci = [];
  TABELLE.forEach((t, i) => {
    for (const x of righe[i]) {
      const vino = t.tabella === "prodotti" && !!(Array.isArray(x.vini) ? x.vini.length : x.vini);
      const campi = t.campi.filter(([it]) => !(vino && it === "nome"));   // il nome del vino resta l'originale
      const im = impronta(...t.campi.map(([it]) => x[it]));
      const da = x.traduzione_da ?? "";
      const manuale = da === "manuale";
      // A mano: solo i campi inglesi vuoti. Altrimenti tutto se l'italiano è cambiato; una traduzione scartata si
      // ritenta una volta per avvio del bot (il registro dei tentativi evita richieste ripetute ogni minuto)
      // Traduzioni già salvate ma rimaste in italiano (modello che ricopia il testo): si rifanno
      const daFare = manuale ? campi.filter(([it, en]) => String(x[it] ?? "").trim() && !String(x[en] ?? "").trim())
        : da !== im ? campi : campi.some(([it, en]) => descrittivo(it) && sembraItaliano(x[it], x[en])) ? campi : [];
      const chiave = `${t.tabella}:${x[t.chiave]}:${im}:${daFare.map(([it]) => it).join(",")}`;
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
          sistema: SISTEMA,
          utente: JSON.stringify({ tipo: t.tipo, ...Object.fromEntries(daTradurre.map(([it]) => [it, x[it]])) }),
          // Campi della risposta con nomi inglesi («descrizione_inglese»): il modello piccolo tende meno a ricopiare l'italiano
          schema: { type: "object", properties: Object.fromEntries(daTradurre.map(([it]) => [`${it}_inglese`, { type: "string" }])),
            required: daTradurre.map(([it]) => `${it}_inglese`) },
        }) ?? {};
      } catch (e) {
        log(`Traduzione non disponibile: ${e.message}`);
        return salvate;   // modello spento o occupato: si riprova al giro successivo
      }
    }
    tentati.add(v.chiave);
    const corpo = {};
    let buoni = 0, scartati = 0;
    for (const [it, en, massimo] of campi) {
      const originale = String(x[it] ?? "").trim();
      if (!originale) { if (!manuale) corpo[en] = ""; continue; }
      const tradotto = String(risposta[`${it}_inglese`] ?? "").trim();
      if (traduzioneValida(originale, tradotto, massimo) && !(descrittivo(it) && sembraItaliano(originale, tradotto))) { corpo[en] = tradotto; buoni++; }
      else { scartati++; if (!manuale) corpo[en] = ""; log(`Traduzione scartata (${t.tabella}.${it} «${originale.slice(0, 40)}»): rimasta in italiano, numeri o lunghezza non corrispondono`); }
    }
    if (!manuale) corpo.traduzione_da = buoni || !scartati ? im : im + SCARTATA;
    if (!Object.keys(corpo).length) continue;
    await db(`${t.tabella}?${t.chiave}=eq.${x[t.chiave]}${manuale ? "" : "&traduzione_da=neq.manuale"}`, { metodo: "PATCH", corpo });
    if (buoni) salvate++;
  }
  return salvate;
}
