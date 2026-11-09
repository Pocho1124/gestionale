// Strumenti comuni ai test: fetch simulato (nessuna chiamata di rete reale) e dati sintetici.
// Nessun dato personale reale: nomi, ID e token sono inventati.

/** Rete simulata: ogni chiamata viene registrata; le risposte arrivano dalle regole in ordine (la prima che corrisponde). */
export function reteSimulata() {
  const chiamate = [];
  const regole = [];
  const rete = {
    chiamate,
    /** metodo: "GET"/"POST"/… oppure "*"; percorso: stringa contenuta nell'URL o RegExp; risposta: oggetto o funzione(chiamata). */
    quando(metodo, percorso, risposta) { regole.unshift({ metodo, percorso, risposta }); return rete; },
    azzera() { chiamate.length = 0; },
    trova(metodo, percorso) {
      return chiamate.filter((c) => (metodo === "*" || c.metodo === metodo) && corrisponde(c.url, percorso));
    },
    async fetch(url, opz = {}) {
      const metodo = (opz.method ?? "GET").toUpperCase();
      let corpo = opz.body;
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { /* testo semplice */ } }
      const chiamata = { url: String(url), metodo, corpo, intestazioni: opz.headers ?? {} };
      chiamate.push(chiamata);
      const r = regole.find((x) => (x.metodo === "*" || x.metodo === metodo) && corrisponde(chiamata.url, x.percorso));
      if (!r) return risposta({ errore: `nessuna regola per ${metodo} ${url}` }, 599);
      const valore = typeof r.risposta === "function" ? await r.risposta(chiamata) : r.risposta;
      return valore instanceof Response ? valore : risposta(valore);
    },
  };
  return rete;
}

const corrisponde = (url, p) => (p instanceof RegExp ? p.test(url) : url.includes(p));

export const risposta = (dati, stato = 200) =>
  new Response(dati === null ? "" : JSON.stringify(dati), { status: stato, headers: { "Content-Type": "application/json" } });

/** UUID sintetici leggibili: id(1) → 00000000-0000-4000-8000-000000000001 */
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
