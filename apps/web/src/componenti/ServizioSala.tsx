import { useMemo, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";

export interface RigaOrdine { nome: string; quantita: number; prezzo_cent: number; nota: string }
export interface OrdineSala { id: string; tavolo_id: string; sessione_id: string; stato: string; origine: string; nota: string; motivo: string; creato_at: string; righe_ordine: RigaOrdine[] }
export interface RichiestaSala { id: string; tavolo_id: string; righe: { prodotto_id: string; quantita: number; nota?: string }[]; nota: string; creato_at: string }
export interface ProdottoBreve { id: string; nome: string; prezzo_cent: number; disponibile: boolean; visibile: boolean; categoria_id: string }
export interface CategoriaBreve { id: string; nome: string }
export interface SessioneBreve { id: string; tavolo_id: string; coperti: number; codice: string; aperta_at: string }
interface TavoloBreve { id: string; nome: string; posti: number }

const euro = (c: number) => formatta(centesimi(c));
const ora = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const totale = (righe: { quantita: number; prezzo_cent: number }[]) => righe.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0);
export const NOMI_STATO: Record<string, string> = {
  da_confermare: "Da confermare", confermato: "Confermato", in_preparazione: "In preparazione", pronto: "Pronto", servito: "Servito", rifiutato: "Rifiutato",
};
const PROSSIMO: Record<string, { stato: string; etichetta: string }> = {
  confermato: { stato: "in_preparazione", etichetta: "In preparazione" },
  in_preparazione: { stato: "pronto", etichetta: "Pronto" },
  pronto: { stato: "servito", etichetta: "Servito" },
};

/** Breve suono di avviso generato dal browser. */
export function suona() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* audio non disponibile */ }
}

/** Coda in cima alla sala: richieste di apertura dal telefono e ordini da confermare. */
export function CodaRichieste(props: {
  richieste: RichiestaSala[]; ordini: OrdineSala[]; tavoli: TavoloBreve[]; prodotti: Map<string, ProdottoBreve>;
  aperto: (tavolo: string) => boolean; onFatto: () => Promise<void>; onCodice: (tavolo: string, codice: string) => void;
}) {
  const avvisa = useAvviso();
  const [coperti, setCoperti] = useState<Record<string, number>>({});
  const nomeTavolo = (id: string) => props.tavoli.find((t) => t.id === id)?.nome ?? "?";
  const daConfermare = props.ordini.filter((o) => o.stato === "da_confermare");
  if (!props.richieste.length && !daConfermare.length) return null;

  async function accetta(r: RichiestaSala) {
    const { data, error } = await sb().rpc("accetta_richiesta", { p_richiesta: r.id, p_coperti: coperti[r.id] ?? 2 });
    if (error) { avvisa(messaggioErrore(error), "errore"); await props.onFatto(); return; }
    const codice = (data as { codice: string }).codice;
    props.onCodice(r.tavolo_id, codice);
    avvisa(`Tavolo ${nomeTavolo(r.tavolo_id)} aperto · codice ${codice} · ordine confermato`);
    await props.onFatto();
  }
  async function rifiuta(r: RichiestaSala) {
    const motivo = prompt("Motivo (lo vedrà il cliente):", "Chiedi al personale al tavolo");
    if (motivo === null) return;
    const { error } = await sb().rpc("rifiuta_richiesta", { p_richiesta: r.id, p_motivo: motivo });
    if (error) avvisa(messaggioErrore(error), "errore");
    await props.onFatto();
  }
  async function decidi(o: OrdineSala, conferma: boolean) {
    let motivo = "";
    if (!conferma) { const m = prompt("Motivo del rifiuto (lo vedrà il cliente):", "Piatto non disponibile"); if (m === null) return; motivo = m; }
    const { error } = await sb().rpc("decidi_ordine", { p_ordine: o.id, p_conferma: conferma, p_motivo: motivo });
    if (error) avvisa(messaggioErrore(error), "errore");
    await props.onFatto();
  }

  return (
    <section className="coda" aria-live="polite">
      {props.richieste.map((r) => {
        const righe = r.righe.map((x) => ({ ...x, p: props.prodotti.get(x.prodotto_id) }));
        const chiuso = !props.aperto(r.tavolo_id);
        return (
          <article key={r.id} className="coda-voce coda-richiesta">
            <header><strong>🔔 Tavolo {nomeTavolo(r.tavolo_id)}</strong><span className="muto piccolo">{ora(r.creato_at)} · {chiuso ? "chiede di aprire il tavolo" : "nuovo telefono al tavolo"}</span></header>
            <p>{righe.map((x) => `${x.quantita}× ${x.p?.nome ?? "?"}${x.nota ? ` (${x.nota})` : ""}`).join(" · ")} — {euro(totale(righe.map((x) => ({ quantita: x.quantita, prezzo_cent: x.p?.prezzo_cent ?? 0 }))))}</p>
            {r.nota && <p className="ordine-nota">📝 {r.nota}</p>}
            <footer className="riga-form">
              {chiuso && (
                <span className="riga-form"><span>Coperti</span>
                  <button className="btn btn-icona" onClick={() => setCoperti((c) => ({ ...c, [r.id]: Math.max(1, (c[r.id] ?? 2) - 1) }))}>−</button>
                  <strong>{coperti[r.id] ?? 2}</strong>
                  <button className="btn btn-icona" onClick={() => setCoperti((c) => ({ ...c, [r.id]: Math.min(60, (c[r.id] ?? 2) + 1) }))}>+</button>
                </span>
              )}
              <button className="btn btn-pericolo" onClick={() => void rifiuta(r)}>Rifiuta</button>
              <button className="btn btn-pieno" onClick={() => void accetta(r)}>{chiuso ? "Apri tavolo e conferma" : "Conferma"}</button>
            </footer>
          </article>
        );
      })}
      {daConfermare.map((o) => (
        <article key={o.id} className="coda-voce">
          <header><strong>⏳ Tavolo {nomeTavolo(o.tavolo_id)}</strong><span className="muto piccolo">{ora(o.creato_at)} · ordine da confermare</span></header>
          <p>{o.righe_ordine.map((r) => `${r.quantita}× ${r.nome}${r.nota ? ` (${r.nota})` : ""}`).join(" · ")} — {euro(totale(o.righe_ordine))}</p>
          {o.nota && <p className="ordine-nota">📝 {o.nota}</p>}
          <footer className="riga-form">
            <button className="btn btn-pericolo" onClick={() => void decidi(o, false)}>Rifiuta</button>
            <button className="btn btn-pieno" onClick={() => void decidi(o, true)}>Conferma</button>
          </footer>
        </article>
      ))}
    </section>
  );
}

/** Pannello del tavolo selezionato: apertura/chiusura, codice, ordini della sessione, aggiunta di una comanda. */
export function PannelloTavolo(props: {
  tavolo: TavoloBreve | null; sessione?: SessioneBreve; ordini: OrdineSala[]; prodotti: ProdottoBreve[]; categorie: CategoriaBreve[];
  onFatto: () => Promise<void>;
}) {
  const avvisa = useAvviso();
  const { tavolo, sessione } = props;
  const [coperti, setCoperti] = useState(2);
  const [attesa, setAttesa] = useState(false);
  const [aggiunta, setAggiunta] = useState<Record<string, number> | null>(null);
  const [cerca, setCerca] = useState("");
  const ordiniTavolo = useMemo(() => props.ordini.filter((o) => sessione && o.sessione_id === sessione.id), [props.ordini, sessione]);
  if (!tavolo) return <p className="muto">Tocca un tavolo per aprirlo, vedere i suoi ordini o aggiungere una comanda.</p>;

  async function esegui(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setAttesa(true);
    const { error } = await fn();
    setAttesa(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); return false; }
    avvisa(ok); await props.onFatto(); return true;
  }
  const conto = ordiniTavolo.filter((o) => o.stato !== "rifiutato").reduce((n, o) => n + totale(o.righe_ordine), 0);
  const scelti = Object.entries(aggiunta ?? {}).filter(([, q]) => q > 0);
  const disponibili = props.prodotti.filter((p) => p.visibile && p.disponibile && (!cerca || p.nome.toLowerCase().includes(cerca.toLowerCase())));

  return (
    <div className="pannello-tavolo">
      <h2>Tavolo {tavolo.nome}</h2>
      {!sessione ? (
        <>
          <p className="muto">Libero · {tavolo.posti} posti</p>
          <div className="riga-form">
            <span>Coperti</span>
            <button className="btn btn-icona" onClick={() => setCoperti((c) => Math.max(1, c - 1))} aria-label="Meno">−</button>
            <strong style={{ minWidth: 28, textAlign: "center" }}>{coperti}</strong>
            <button className="btn btn-icona" onClick={() => setCoperti((c) => Math.min(60, c + 1))} aria-label="Più">+</button>
          </div>
          <button className="btn btn-pieno" disabled={attesa}
            onClick={() => void esegui(() => sb().rpc("apri_tavolo", { p_tavolo: tavolo.id, p_coperti: coperti }), `Tavolo ${tavolo.nome} aperto`)}>Apri tavolo</button>
        </>
      ) : (
        <>
          <p>Aperto alle {ora(sessione.aperta_at)} · {sessione.coperti} coperti</p>
          <div className="codice-tavolo"><span className="muto piccolo">Codice del tavolo</span><strong>{sessione.codice}</strong></div>

          <h3 className="pannello-titolo">Ordini <span className="muto piccolo">totale {euro(conto)}</span></h3>
          {ordiniTavolo.length === 0 ? <p className="muto piccolo">Nessun ordine ancora.</p> : ordiniTavolo.map((o) => (
            <div key={o.id} className={`ordine-mini stato-ordine-${o.stato}`}>
              <div className="riga-form"><b>{ora(o.creato_at)}</b><span className="pill">{NOMI_STATO[o.stato]}</span><span className="muto piccolo">{o.origine === "cliente" ? "dal telefono" : "sala"}</span></div>
              <p>{o.righe_ordine.map((r) => `${r.quantita}× ${r.nome}${r.nota ? ` (${r.nota})` : ""}`).join(" · ")}</p>
              <div className="riga-form">
                {o.stato === "da_confermare" && <>
                  <button className="btn btn-pericolo" onClick={() => void esegui(() => sb().rpc("decidi_ordine", { p_ordine: o.id, p_conferma: false, p_motivo: "Chiedi al personale" }), "Ordine rifiutato")}>Rifiuta</button>
                  <button className="btn btn-pieno btn-piccolo" onClick={() => void esegui(() => sb().rpc("decidi_ordine", { p_ordine: o.id, p_conferma: true, p_motivo: "" }), "Ordine confermato")}>Conferma</button>
                </>}
                {PROSSIMO[o.stato] && <button className="btn btn-piccolo" onClick={() => void esegui(() => sb().rpc("avanza_ordine", { p_ordine: o.id, p_stato: PROSSIMO[o.stato]!.stato }), "Aggiornato")}>→ {PROSSIMO[o.stato]!.etichetta}</button>}
              </div>
            </div>
          ))}

          {aggiunta === null ? (
            <button className="btn" onClick={() => setAggiunta({})}>+ Aggiungi all'ordine</button>
          ) : (
            <div className="aggiungi-comanda">
              <input placeholder="Cerca un piatto o un vino" value={cerca} onChange={(e) => setCerca(e.target.value)} />
              <div className="aggiungi-lista">
                {props.categorie.map((c) => {
                  const lista = disponibili.filter((p) => p.categoria_id === c.id);
                  if (!lista.length) return null;
                  return (
                    <div key={c.id}>
                      <p className="muto piccolo">{c.nome}</p>
                      {lista.map((p) => (
                        <div key={p.id} className="aggiungi-voce">
                          <span>{p.nome} <span className="muto piccolo">{euro(p.prezzo_cent)}</span></span>
                          <span className="riga-form">
                            {(aggiunta[p.id] ?? 0) > 0 && <button className="btn btn-icona" onClick={() => setAggiunta((a) => ({ ...a, [p.id]: (a?.[p.id] ?? 0) - 1 }))}>−</button>}
                            {(aggiunta[p.id] ?? 0) > 0 && <strong>{aggiunta[p.id]}</strong>}
                            <button className="btn btn-icona" onClick={() => setAggiunta((a) => ({ ...a, [p.id]: Math.min(20, (a?.[p.id] ?? 0) + 1) }))}>+</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="riga-form">
                <button className="btn" onClick={() => { setAggiunta(null); setCerca(""); }}>Annulla</button>
                <button className="btn btn-pieno" disabled={!scelti.length || attesa} onClick={async () => {
                  const ok = await esegui(() => sb().rpc("ordine_sala", { p_tavolo: tavolo.id, p_righe: scelti.map(([id, q]) => ({ prodotto_id: id, quantita: q })), p_nota: "" }), "Comanda aggiunta");
                  if (ok) { setAggiunta(null); setCerca(""); }
                }}>Invia comanda ({scelti.reduce((n, [, q]) => n + q, 0)})</button>
              </div>
            </div>
          )}

          <button className="btn btn-pericolo" disabled={attesa}
            onClick={() => { if (confirm(`Chiudere il tavolo ${tavolo.nome}? Il codice ${sessione.codice} smetterà di valere.`)) void esegui(() => sb().rpc("chiudi_tavolo", { p_tavolo: tavolo.id }), `Tavolo ${tavolo.nome} chiuso`); }}>
            Chiudi tavolo
          </button>
        </>
      )}
    </div>
  );
}
