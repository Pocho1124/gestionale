// Traduzione automatica del menu in inglese con l'IA locale del server (nessun servizio esterno).
// Traduce nome e descrizione di categorie e piatti quando il testo italiano cambia; le traduzioni scritte a mano
// («manuale») non si toccano. I nomi dei vini restano quelli originali (sono nomi propri): si traduce la descrizione.
// Regole del progetto: il modello non inventa dati. Una traduzione che cambia i numeri del testo, aggiunge HTML
// o è troppo lunga si scarta; prezzi e schede dei vini non passano mai dal modello.
import { createHash } from "node:crypto";

/** Impronta del testo italiano da cui nasce la traduzione: cambia se cambiano nome o descrizione. */
export const impronta = (nome, descrizione) => createHash("sha256").update(`${nome}\u0000${descrizione}`).digest("hex").slice(0, 16);
const SCARTATA = ":scartata";

const numeri = (t) => (String(t ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")).sort();

/** Una traduzione è buona se ha gli stessi numeri dell'originale, niente HTML, lunghezza ragionevole e non è vuota. */
export function traduzioneValida(originale, tradotto, massimo) {
  const o = String(originale ?? "").trim(), t = String(tradotto ?? "").trim();
  if (!o) return t === "";
  if (!t || t.length > massimo || /[<>]/.test(t)) return false;
  return JSON.stringify(numeri(o)) === JSON.stringify(numeri(t));
}

const SISTEMA = [
  "Traduci in inglese, per il menu di un'enoteca italiana, il nome e la descrizione che ricevi.",
  "Regole:",
  "- lascia invariati i nomi propri: vini, denominazioni (DOC, DOCG, IGT), vitigni, cantine, località;",
  "- lascia in italiano i prodotti tipici che non hanno traduzione (es. pinsa, burrata, 'nduja, speck, bruschetta, tagliere se è il nome del piatto);",
  "- non aggiungere e non togliere informazioni, ingredienti o numeri; nessun prezzo;",
  "- testo breve e naturale, iniziale maiuscola; se la descrizione è vuota restituisci una stringa vuota.",
].join("\n");
const SCHEMA = { type: "object", properties: { nome: { type: "string" }, descrizione: { type: "string" } }, required: ["nome", "descrizione"] };

/**
 * Traduce al massimo «limite» voci da aggiornare del locale e le salva.
 * Dipendenze passate dall'esterno (database e modello), così si prova senza rete. Restituisce quante voci ha salvato.
 */
export async function traduciMenu({ db, chiediModello, locale, log = () => {}, limite = 15 }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(locale))) throw new Error("Locale non valido");
  const [categorie, prodotti] = await Promise.all([
    db(`categorie?select=id,nome,descrizione,nome_en,descrizione_en,traduzione_da&locale_id=eq.${locale}`),
    db(`prodotti?select=id,nome,descrizione,nome_en,descrizione_en,traduzione_da,vini(prodotto_id)&locale_id=eq.${locale}`),
  ]);
  const voci = [
    ...categorie.map((x) => ({ ...x, tabella: "categorie", vino: false, massimoNome: 80, massimoDesc: 500 })),
    ...prodotti.map((x) => ({ ...x, tabella: "prodotti", vino: !!(Array.isArray(x.vini) ? x.vini.length : x.vini), massimoNome: 120, massimoDesc: 1000 })),
  ].filter((x) => {
    const da = x.traduzione_da ?? "";
    const im = impronta(x.nome, x.descrizione ?? "");
    return da !== "manuale" && da !== im && da !== im + SCARTATA;
  }).slice(0, limite);

  let salvate = 0;
  for (const x of voci) {
    const im = impronta(x.nome, x.descrizione ?? "");
    let r;
    try {
      r = await chiediModello({ sistema: SISTEMA, utente: JSON.stringify({ tipo: x.tabella === "categorie" ? "categoria" : x.vino ? "vino" : "piatto", nome: x.nome, descrizione: x.descrizione ?? "" }), schema: SCHEMA });
    } catch (e) {
      log(`Traduzione non disponibile: ${e.message}`);
      return salvate;   // modello spento o occupato: si riprova al giro successivo
    }
    const nome = x.vino ? "" : String(r?.nome ?? "").trim();   // il nome del vino resta l'originale
    const descrizione = String(r?.descrizione ?? "").trim();
    const buona = (x.vino || traduzioneValida(x.nome, nome, x.massimoNome)) && traduzioneValida(x.descrizione ?? "", descrizione, x.massimoDesc);
    // Una traduzione scartata non si ritenta finché l'italiano non cambia (niente giri a vuoto)
    const corpo = buona ? { nome_en: nome, descrizione_en: descrizione, traduzione_da: im } : { traduzione_da: im + SCARTATA };
    await db(`${x.tabella}?id=eq.${x.id}&traduzione_da=neq.manuale`, { metodo: "PATCH", corpo });
    if (buona) salvate++;
    else log(`Traduzione scartata per «${x.nome}»: numeri o lunghezza non corrispondono`);
  }
  return salvate;
}
