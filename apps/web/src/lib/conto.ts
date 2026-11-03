import { centesimi, formatta } from "@gest/core";
import { sb } from "./supabase";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const euro = (c: number) => formatta(centesimi(c));

/** Preconto del tavolo (non fiscale), stampato su carta da 80 mm o A4: righe uguali raggruppate, totale. */
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
      const v = righe.get(k) ?? { nome: r.nome, quantita: 0, prezzo_cent: r.prezzo_cent };
      v.quantita += r.quantita; righe.set(k, v);
    }
  }
  const lista = [...righe.values()];
  const totale = lista.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0);
  const sess = s.data as unknown as { coperti: number; aperta_at: string; tavoli: { nome: string } | null };
  const ora = new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  finestra.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Conto tavolo ${esc(sess.tavoli?.nome ?? "")}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font: 13px/1.35 ui-monospace, "Courier New", monospace; color: #000; width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; } p { margin: 0; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; } td { padding: 2px 0; vertical-align: top; }
  td.n { text-align: right; white-space: nowrap; padding-left: 6px; }
  .linea { border-top: 1px dashed #000; margin: 6px 0; } .tot td { font-weight: 700; font-size: 15px; padding-top: 4px; }
  .piede { margin-top: 10px; font-size: 11px; }
</style></head><body>
<h1>${esc(localeNome)}</h1>
<p>Tavolo ${esc(sess.tavoli?.nome ?? "")} · ${sess.coperti} coperti</p><p>${esc(ora)}</p>
<div class="linea"></div>
<table>${lista.map((r) => `<tr><td>${r.quantita} × ${esc(r.nome)}</td><td class="n">${esc(euro(r.quantita * r.prezzo_cent))}</td></tr>`).join("")}
<tr><td colspan="2"><div class="linea"></div></td></tr>
<tr class="tot"><td>TOTALE</td><td class="n">${esc(euro(totale))}</td></tr></table>
<p class="piede">Preconto — documento non fiscale</p>
<script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
</body></html>`);
  finestra.document.close();
  return null;
}
