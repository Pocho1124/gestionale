import { useCallback, useEffect, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { puo } from "../lib/permessi";

interface Resoconto {
  numero?: number; dal: string | null; al: string; conti: number; coperti: number; totale_cent: number;
  per_pagamento: Record<string, number>; sconti_cent?: number; per_reparto: { reparto: string; totale_cent: number }[];
  piu_venduti: { nome: string; quantita: number; totale_cent: number }[]; annullati: { ordini: number; totale_cent: number }; tavoli_aperti: number;
}
interface Chiusura { id: string; numero: number; dal: string; al: string; riepilogo: Resoconto }
const euro = (c: number) => formatta(centesimi(c ?? 0));
const METODI: Record<string, string> = { contanti: "Contanti", carta: "Carta / POS", altro: "Altro", misto: "Misto (conti precedenti)", "non indicato": "Non indicato" };
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "inizio attività");

/** Resoconto delle vendite e chiusura di cassa: solo amministratore. Documento gestionale, non fiscale. */
export function Cassa() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [resoconto, setResoconto] = useState<Resoconto | null>(null);
  const [storico, setStorico] = useState<Chiusura[]>([]);

  const carica = useCallback(async () => {
    if (!locale) return;
    const [r, s] = await Promise.all([
      sb().rpc("resoconto_cassa", { p_locale: locale.id }),
      sb().from("chiusure_cassa").select("id, numero, dal, al, riepilogo").eq("locale_id", locale.id).order("numero", { ascending: false }).limit(30),
    ]);
    if (r.error) { avvisa(messaggioErrore(r.error), "errore"); return; }
    setResoconto(r.data as Resoconto); setStorico((s.data as Chiusura[]) ?? []);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);

  if (!locale) return null;
  if (!puo(ruolo, "cassa")) return <div className="pagina"><h1>Cassa</h1><p className="muto">Il resoconto e la chiusura di cassa sono riservati all'amministratore.</p></div>;

  async function chiudi() {
    if (!resoconto) return;
    if (!confirm(`Chiudere la cassa con un incasso di ${euro(resoconto.totale_cent)}? L'operazione non si annulla.`)) return;
    const { data: r, error } = await sb().rpc("chiudi_cassa", { p_locale: locale!.id });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(`Chiusura n. ${(r as Resoconto).numero} registrata`);
    stampaResoconto(r as Resoconto, locale!.nome);
    await carica();
  }

  return (
    <div className="pagina">
      <div className="pagina-testa riga-form" style={{ justifyContent: "space-between" }}>
        <h1>Cassa</h1>
        <span className="riga-form">
          <button className="btn" disabled={!resoconto} onClick={() => resoconto && stampaResoconto(resoconto, locale.nome)}>🖨️ Stampa resoconto</button>
          <button className="btn btn-pericolo" disabled={!resoconto || resoconto.tavoli_aperti > 0} onClick={() => void chiudi()}>Chiudi cassa</button>
        </span>
      </div>
      {resoconto && <VistaResoconto r={resoconto} />}
      {resoconto && resoconto.tavoli_aperti > 0 && <p className="ordina-avviso errore">Ci sono {resoconto.tavoli_aperti} tavoli aperti: incassali e chiudili prima di chiudere la cassa.</p>}
      <p className="muto piccolo">Resoconto gestionale delle vendite, non sostituisce la chiusura fiscale del registratore telematico.</p>

      {storico.length > 0 && (
        <section className="gruppo">
          <legend>Chiusure precedenti</legend>
          <table className="tabella">
            <thead><tr><th>N.</th><th>Periodo</th><th>Conti</th><th>Incasso</th><th /></tr></thead>
            <tbody>{storico.map((c) => (
              <tr key={c.id}><td>{c.numero}</td><td>{data(c.dal)} → {data(c.al)}</td><td>{c.riepilogo.conti}</td><td className="numero">{euro(c.riepilogo.totale_cent)}</td>
                <td><button className="btn btn-piccolo" onClick={() => stampaResoconto(c.riepilogo, locale.nome)}>Ristampa</button></td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function VistaResoconto({ r }: { r: Resoconto }) {
  return (
    <div className="cassa-griglia">
      <div className="cassa-totale"><span className="muto">Incasso dal {data(r.dal)}</span><strong>{euro(r.totale_cent)}</strong>
        <span className="muto">{r.conti} conti · {r.coperti} coperti · scontrino medio {euro(r.conti ? Math.round(r.totale_cent / r.conti) : 0)}</span></div>
      <section className="gruppo"><legend>Per pagamento</legend>
        {Object.entries(r.per_pagamento).length === 0 ? <p className="muto">Nessun incasso.</p> :
          Object.entries(r.per_pagamento).map(([k, v]) => <p key={k} className="riga-cassa"><span>{METODI[k] ?? k}</span><b>{euro(v)}</b></p>)}
        {(r.sconti_cent ?? 0) > 0 && <p className="riga-cassa muto"><span>Sconti concessi</span><b>{euro(r.sconti_cent!)}</b></p>}</section>
      <section className="gruppo"><legend>Per reparto</legend>
        {r.per_reparto.map((x) => <p key={x.reparto} className="riga-cassa"><span>{x.reparto}</span><b>{euro(x.totale_cent)}</b></p>)}</section>
      <section className="gruppo"><legend>Più venduti</legend>
        {r.piu_venduti.map((x) => <p key={x.nome} className="riga-cassa"><span>{x.quantita} × {x.nome}</span><b>{euro(x.totale_cent)}</b></p>)}</section>
      <section className="gruppo"><legend>Annullati</legend>
        <p className="riga-cassa"><span>{r.annullati.ordini} ordini</span><b>{euro(r.annullati.totale_cent)}</b></p></section>
    </div>
  );
}

/** Stampa del resoconto: pagina costruita con nodi DOM e testo, senza script, con CSP restrittiva. */
function stampaResoconto(r: Resoconto, localeNome: string) {
  const f = window.open("", "_blank", "width=420,height=700");
  if (!f) return;
  const d = f.document;
  d.open(); d.write("<!doctype html><html lang=\"it\"><head></head><body></body></html>"); d.close();
  const el = (tag: string, testo?: string, stile?: string) => { const e = d.createElement(tag); if (testo !== undefined) e.textContent = testo; if (stile) e.setAttribute("style", stile); return e; };
  const csp = d.createElement("meta"); csp.httpEquiv = "Content-Security-Policy"; csp.content = "default-src 'none'; style-src 'unsafe-inline'";
  const st = el("style", "@page{size:80mm auto;margin:4mm}body{font:13px/1.4 ui-monospace,monospace;width:72mm;margin:0 auto}h1{font-size:16px;text-align:center;margin:0}p{margin:0;display:flex;justify-content:space-between;gap:8px}.c{justify-content:center}hr{border:0;border-top:1px dashed #000}");
  d.head.append(csp, st); d.title = "Resoconto di cassa";
  const riga = (a: string, b: string) => { const p = el("p"); p.append(el("span", a), el("b", b)); return p; };
  d.body.append(el("h1", localeNome), el("p", r.numero ? `Chiusura di cassa n. ${r.numero}` : "Resoconto (cassa non chiusa)"), el("p", `${data(r.dal)} → ${data(r.al)}`), el("hr"),
    riga("Conti", String(r.conti)), riga("Coperti", String(r.coperti)), riga("TOTALE", euro(r.totale_cent)), el("hr"),
    ...Object.entries(r.per_pagamento).map(([k, v]) => riga(METODI[k] ?? k, euro(v))),
    ...((r.sconti_cent ?? 0) > 0 ? [riga("Sconti concessi", euro(r.sconti_cent!))] : []), el("hr"),
    ...r.per_reparto.map((x) => riga(x.reparto, euro(x.totale_cent))), el("hr"),
    riga(`Annullati (${r.annullati.ordini})`, euro(r.annullati.totale_cent)), el("hr"),
    el("p", "Documento gestionale non fiscale"));
  f.focus(); f.print(); f.close();
}
