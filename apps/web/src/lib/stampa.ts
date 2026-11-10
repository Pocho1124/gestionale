/**
 * Finestra di stampa sicura, unica per preconto, fatture e resoconto di cassa.
 * La pagina è costruita solo con nodi DOM e textContent (mai HTML da stringhe con dati) e ha una CSP che vieta
 * qualsiasi script: anche un nome di piatto o di cliente malevolo resta testo.
 */
export const POPUP_BLOCCATO = "Il browser ha bloccato la finestra di stampa: consenti i popup per questo indirizzo.";

export interface PaginaStampa {
  d: Document;
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, testo?: string, classe?: string) => HTMLElementTagNameMap[K];
  /** Avvia la stampa e chiude la finestra. */
  stampa: () => void;
  /** Chiude la finestra senza stampare (es. dati non caricati). */
  chiudi: () => void;
}

/** Apre la finestra (va chiamata dentro il clic, altrimenti il browser la blocca) con stile e titolo fissi. */
export function apriStampa(opzioni: { larghezza: number; altezza: number; titolo: string; stile: string }): PaginaStampa | null {
  const finestra = window.open("", "_blank", `width=${opzioni.larghezza},height=${opzioni.altezza}`);
  if (!finestra) return null;
  const d = finestra.document;
  d.open(); d.write("<!doctype html><html lang=\"it\"><head></head><body></body></html>"); d.close();   // solo struttura vuota, fissa
  const el: PaginaStampa["el"] = (tag, testo, classe) => {
    const e = d.createElement(tag);
    if (testo !== undefined) e.textContent = testo;
    if (classe) e.className = classe;
    return e;
  };
  const charset = el("meta"); charset.setAttribute("charset", "utf-8");
  const csp = el("meta"); csp.httpEquiv = "Content-Security-Policy"; csp.content = "default-src 'none'; style-src 'unsafe-inline'";
  d.head.append(charset, csp, el("style", opzioni.stile));
  d.title = opzioni.titolo;
  return { d, el, stampa: () => { finestra.focus(); finestra.print(); finestra.close(); }, chiudi: () => finestra.close() };
}
