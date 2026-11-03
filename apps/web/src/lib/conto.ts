import { centesimi, formatta } from "@gest/core";
import { sb } from "./supabase";

const euro = (c: number) => formatta(centesimi(c));

// Stile fisso della ricevuta: nessun dato dinamico qui dentro
const STILE = `
  @page { size: 80mm auto; margin: 4mm; }
  body { font: 13px/1.35 ui-monospace, "Courier New", monospace; color: #000; width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; } p { margin: 0; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; } td { padding: 2px 0; vertical-align: top; }
  td.n { text-align: right; white-space: nowrap; padding-left: 6px; }
  .linea { border-top: 1px dashed #000; margin: 6px 0; } .tot td { font-weight: 700; font-size: 15px; padding-top: 4px; }
  .piede { margin-top: 10px; font-size: 11px; }`;

/**
 * Preconto del tavolo (non fiscale), su carta da 80 mm o A4: righe uguali raggruppate, totale.
 * La pagina di stampa è costruita solo con nodi DOM e textContent (mai HTML da stringhe con dati)
 * e ha una CSP che vieta qualsiasi script: anche un nome di piatto malevolo resta testo.
 */
export async function stampaConto(sessioneId: string, localeNome: string): Promise<string | null> {
  // La finestra si apre subito (nel clic), altrimenti il browser la blocca come popup
  const finestra = window.open("", "_blank", "width=420,height=640");
  if (!finestra) return "Il browser ha bloccato la finestra di stampa: consenti i popup per questo indirizzo.";
  const [s, o] = await Promise.all([
    sb().from("sessioni_tavolo").select("coperti, aperta_at, tavoli(nome)").eq("id", sessioneId).single(),
    sb().from("ordini").select("stato, righe_ordine(nome, quantita, prezzo_cent)").eq("sessione_id", sessioneId).neq("stato", "rifiutato"),
  ]);
  if (s.error || o.error) { finestra.close(); return (s.error ?? o.error)!.message; }

  const righe = new Map<string, { nome: string; quantita: number; prezzo_cent: number }>();
  for (const ord of o.data as unknown as { righe_ordine: { nome: string; quantita: number; prezzo_cent: number }[] }[]) {
    for (const r of ord.righe_ordine) {
      const k = `${r.nome}|${r.prezzo_cent}`;
      const v = righe.get(k) ?? { nome: String(r.nome), quantita: 0, prezzo_cent: Number(r.prezzo_cent) };
      v.quantita += Number(r.quantita); righe.set(k, v);
    }
  }
  const lista = [...righe.values()];
  const totale = lista.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0);
  const sess = s.data as unknown as { coperti: number; tavoli: { nome: string } | null };
  const tavolo = String(sess.tavoli?.nome ?? "");

  const d = finestra.document;
  d.open(); d.write("<!doctype html><html lang=\"it\"><head></head><body></body></html>"); d.close();   // solo struttura vuota, fissa
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, testo?: string, classe?: string) => {
    const e = d.createElement(tag);
    if (testo !== undefined) e.textContent = testo;
    if (classe) e.className = classe;
    return e;
  };
  const csp = el("meta"); csp.httpEquiv = "Content-Security-Policy"; csp.content = "default-src 'none'; style-src 'unsafe-inline'";
  const charset = el("meta"); charset.setAttribute("charset", "utf-8");
  const stile = el("style", STILE);
  d.head.append(charset, csp, stile);
  d.title = `Conto tavolo ${tavolo}`;

  const tabella = el("table");
  for (const r of lista) {
    const tr = el("tr");
    tr.append(el("td", `${r.quantita} × ${r.nome}`), el("td", euro(r.quantita * r.prezzo_cent), "n"));
    tabella.append(tr);
  }
  const separatore = el("tr"); const cella = el("td"); cella.colSpan = 2; cella.append(el("div", undefined, "linea")); separatore.append(cella);
  const tot = el("tr", undefined, "tot"); tot.append(el("td", "TOTALE"), el("td", euro(totale), "n"));
  tabella.append(separatore, tot);

  d.body.append(
    el("h1", localeNome),
    el("p", `Tavolo ${tavolo} · ${Number(sess.coperti)} coperti`),
    el("p", new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })),
    el("div", undefined, "linea"),
    tabella,
    el("p", "Preconto — documento non fiscale", "piede"),
  );
  // Stampa avviata da qui: nella pagina di stampa non c'è nessuno script
  finestra.focus();
  finestra.print();
  finestra.close();
  return null;
}
