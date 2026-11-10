import { sb } from "./supabase";
import { euro } from "./formato";
import { POPUP_BLOCCATO, apriStampa } from "./stampa";

// Stile fisso della ricevuta: nessun dato dinamico qui dentro
const STILE = `
  @page { size: 80mm auto; margin: 4mm; }
  body { font: 13px/1.35 ui-monospace, "Courier New", monospace; color: #000; width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; } p { margin: 0; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; } td { padding: 2px 0; vertical-align: top; }
  td.n { text-align: right; white-space: nowrap; padding-left: 6px; }
  .linea { border-top: 1px dashed #000; margin: 6px 0; } .tot td { font-weight: 700; font-size: 15px; padding-top: 4px; }
  .piede { margin-top: 10px; font-size: 11px; }`;

/** Preconto del tavolo (non fiscale), su carta da 80 mm o A4: righe uguali raggruppate, sconto, totale. */
export async function stampaConto(sessioneId: string, localeNome: string): Promise<string | null> {
  // La finestra si apre subito (nel clic), altrimenti il browser la blocca come popup
  const pagina = apriStampa({ larghezza: 420, altezza: 640, titolo: "Preconto", stile: STILE });
  if (!pagina) return POPUP_BLOCCATO;
  const [s, o] = await Promise.all([
    sb().from("sessioni_tavolo").select("coperti, aperta_at, sconto_cent, coperto_cent, tavoli(nome)").eq("id", sessioneId).single(),
    sb().from("ordini").select("stato, righe_ordine(nome, quantita, prezzo_cent, opzioni)").eq("sessione_id", sessioneId).not("stato", "in", "(rifiutato,annullato)"),
  ]);
  if (s.error || o.error) { pagina.chiudi(); return (s.error ?? o.error)!.message; }

  const righe = new Map<string, { nome: string; quantita: number; prezzo_cent: number }>();
  for (const ord of o.data as unknown as { righe_ordine: { nome: string; quantita: number; prezzo_cent: number; opzioni?: { nome: string }[] }[] }[]) {
    for (const r of ord.righe_ordine) {
      const scelte = (r.opzioni ?? []).map((x) => String(x.nome));
      const nome = `${String(r.nome)}${scelte.length ? ` (${scelte.join(", ")})` : ""}`;
      const k = `${nome}|${r.prezzo_cent}`;
      const v = righe.get(k) ?? { nome, quantita: 0, prezzo_cent: Number(r.prezzo_cent) };
      v.quantita += Number(r.quantita); righe.set(k, v);
    }
  }
  const lista = [...righe.values()];
  const sessCoperto = s.data as unknown as { coperti: number; coperto_cent?: number };
  if ((sessCoperto.coperto_cent ?? 0) > 0) lista.push({ nome: "Coperto", quantita: Number(sessCoperto.coperti), prezzo_cent: Number(sessCoperto.coperto_cent) });
  const totale = lista.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0);
  const sess = s.data as unknown as { coperti: number; sconto_cent?: number; tavoli: { nome: string } | null };
  const sconto = Math.min(Number(sess.sconto_cent ?? 0), totale);
  const tavolo = String(sess.tavoli?.nome ?? "");

  const { d, el } = pagina;
  d.title = `Conto tavolo ${tavolo}`;

  const tabella = el("table");
  for (const r of lista) {
    const tr = el("tr");
    tr.append(el("td", `${r.quantita} × ${r.nome}`), el("td", euro(r.quantita * r.prezzo_cent), "n"));
    tabella.append(tr);
  }
  const separatore = el("tr"); const cella = el("td"); cella.colSpan = 2; cella.append(el("div", undefined, "linea")); separatore.append(cella);
  tabella.append(separatore);
  if (sconto > 0) {
    const sub = el("tr"); sub.append(el("td", "Subtotale"), el("td", euro(totale), "n"));
    const sc = el("tr"); sc.append(el("td", "Sconto"), el("td", `− ${euro(sconto)}`, "n"));
    tabella.append(sub, sc);
  }
  const tot = el("tr", undefined, "tot"); tot.append(el("td", "TOTALE"), el("td", euro(totale - sconto), "n"));
  tabella.append(tot);

  d.body.append(
    el("h1", localeNome),
    el("p", `Tavolo ${tavolo} · ${Number(sess.coperti)} coperti`),
    el("p", new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })),
    el("div", undefined, "linea"),
    tabella,
    el("p", "Preconto — documento non fiscale", "piede"),
  );
  pagina.stampa();
  return null;
}
