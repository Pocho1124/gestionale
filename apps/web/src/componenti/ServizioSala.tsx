import { useMemo, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { stampaConto } from "../lib/conto";
import { useSessione } from "../lib/sessione";
import { puo } from "../lib/permessi";
import type { GruppoScelte, Scelta } from "../lib/tipi";
import { Componi, chiaveRiga, conAggiunte, descriviScelte, prezzoComposto } from "./Componi";
import { Pagamento } from "./Pagamento";

export interface RigaOrdine { nome: string; quantita: number; prezzo_cent: number; nota: string; opzioni?: { nome: string }[] }
export interface OrdineSala { id: string; tavolo_id: string; sessione_id: string; stato: string; origine: string; nota: string; motivo: string; creato_at: string; righe_ordine: RigaOrdine[] }
export interface RichiestaSala { id: string; tavolo_id: string; righe: { prodotto_id: string; quantita: number; nota?: string; opzioni?: string[] }[]; nota: string; creato_at: string; nomi_clienti?: { nome: string } | { nome: string }[] | null }
export interface ProdottoBreve { id: string; nome: string; prezzo_cent: number; disponibile: boolean; visibile: boolean; categoria_id: string; gruppi: GruppoScelte[]; aggiunte: Scelta[] }
export interface CategoriaBreve { id: string; nome: string }
export interface SessioneBreve { id: string; tavolo_id: string; coperti: number; codice: string; aperta_at: string; nomi_clienti?: { nome: string }[] }
export interface ComandaStampa { id: string; ordine_id: string | null; stato: string; tipo: string; errore: string; reparti: { nome: string } | null }
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

/** Nome lasciato dal cliente (relazione uno a uno: oggetto, o elenco con un elemento). */
const nomeCliente = (r: RichiestaSala) => (Array.isArray(r.nomi_clienti) ? r.nomi_clienti[0]?.nome : r.nomi_clienti?.nome) ?? "";

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
        const righe = r.righe.map((x) => {
          const p = props.prodotti.get(x.prodotto_id);
          const scelte = [...(p?.gruppi ?? []).flatMap((g) => g.scelte), ...(p?.aggiunte ?? [])].filter((c) => (x.opzioni ?? []).includes(c.id));
          return { ...x, p, scelte, prezzo: prezzoComposto(p?.prezzo_cent ?? 0, scelte) };
        });
        const chiuso = !props.aperto(r.tavolo_id);
        return (
          <article key={r.id} className="coda-voce coda-richiesta">
            <header><strong>🔔 Tavolo {nomeTavolo(r.tavolo_id)}{nomeCliente(r) ? ` · ${nomeCliente(r)}` : ""}</strong><span className="muto piccolo">{ora(r.creato_at)} · {chiuso ? "chiede di aprire il tavolo" : "nuovo telefono al tavolo"}</span></header>
            <p>{righe.map((x) => `${x.quantita}× ${x.p?.nome ?? "?"}${descriviScelte(x.scelte)}${x.nota ? ` — ${x.nota}` : ""}`).join(" · ")} — {euro(totale(righe.map((x) => ({ quantita: x.quantita, prezzo_cent: x.prezzo }))))}</p>
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
          <p>{o.righe_ordine.map((r) => `${r.quantita}× ${r.nome}${descriviScelte(r.opzioni ?? [])}${r.nota ? ` — ${r.nota}` : ""}`).join(" · ")} — {euro(totale(o.righe_ordine))}</p>
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

/** Conti di cui è già stato stampato il preconto (in questa scheda del browser): compare «Chiudi tavolo». */
const CHIAVE_PRECONTI = "gestionale.preconti";
const precontiStampati = (): string[] => { try { return JSON.parse(sessionStorage.getItem(CHIAVE_PRECONTI) ?? "[]") as string[]; } catch { return []; } };
function segnaPreconto(sessione: string): string[] {
  const lista = [...new Set([...precontiStampati(), sessione])].slice(-50);
  try { sessionStorage.setItem(CHIAVE_PRECONTI, JSON.stringify(lista)); } catch { /* memoria non disponibile */ }
  return lista;
}

/** Pannello del tavolo selezionato: apertura/chiusura, codice, ordini della sessione, aggiunta di una comanda. */
export function PannelloTavolo(props: {
  tavolo: TavoloBreve | null; sessione?: SessioneBreve; ordini: OrdineSala[]; prodotti: ProdottoBreve[]; categorie: CategoriaBreve[];
  comande?: ComandaStampa[]; onFatto: () => Promise<void>;
}) {
  const avvisa = useAvviso();
  const { locale, ruolo } = useSessione();
  const { tavolo, sessione } = props;
  const [cassa, setCassa] = useState<string | null>(null);   // sessione del conto aperto nel popup
  const [preconti, setPreconti] = useState<string[]>(precontiStampati);
  const [coperti, setCoperti] = useState(2);
  const [attesa, setAttesa] = useState(false);
  const [aggiunta, setAggiunta] = useState<Record<string, { prodotto: ProdottoBreve; scelte: Scelta[]; q: number }> | null>(null);
  const [componendo, setComponendo] = useState<{ p: ProdottoBreve; gruppi: GruppoScelte[] } | null>(null);
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
  const conto = ordiniTavolo.filter((o) => o.stato !== "rifiutato" && o.stato !== "annullato").reduce((n, o) => n + totale(o.righe_ordine), 0);
  const stampe = (ordine: string) => (props.comande ?? []).filter((c) => c.ordine_id === ordine);
  const scelti = Object.values(aggiunta ?? {}).filter((x) => x.q > 0);
  const cambiaVoce = (prodotto: ProdottoBreve, scelte: Scelta[], delta: number) => setAggiunta((a) => {
    const k = chiaveRiga(prodotto.id, scelte), q = Math.max(0, Math.min(20, (a?.[k]?.q ?? 0) + delta));
    const nuovo = { ...(a ?? {}) };
    if (q === 0) delete nuovo[k]; else nuovo[k] = { prodotto, scelte, q };
    return nuovo;
  });
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
          {!!sessione.nomi_clienti?.length && <p>👤 {sessione.nomi_clienti.map((n) => n.nome).join(", ")}</p>}
          <div className="codice-tavolo"><span className="muto piccolo">Codice del tavolo</span><strong>{sessione.codice}</strong></div>

          <h3 className="pannello-titolo">Ordini <span className="muto piccolo">totale {euro(conto)}</span></h3>
          {ordiniTavolo.length === 0 ? <p className="muto piccolo">Nessun ordine ancora.</p> : ordiniTavolo.map((o) => (
            <div key={o.id} className={`ordine-mini stato-ordine-${o.stato}`}>
              <div className="riga-form"><b>{ora(o.creato_at)}</b><span className="pill">{NOMI_STATO[o.stato]}</span><span className="muto piccolo">{o.origine === "cliente" ? "dal telefono" : "sala"}</span></div>
              <p>{o.righe_ordine.map((r) => `${r.quantita}× ${r.nome}${descriviScelte(r.opzioni ?? [])}${r.nota ? ` — ${r.nota}` : ""}`).join(" · ")}</p>
              <div className="riga-form">
                {o.stato === "da_confermare" && <>
                  <button className="btn btn-pericolo" onClick={() => void esegui(() => sb().rpc("decidi_ordine", { p_ordine: o.id, p_conferma: false, p_motivo: "Chiedi al personale" }), "Ordine rifiutato")}>Rifiuta</button>
                  <button className="btn btn-pieno btn-piccolo" onClick={() => void esegui(() => sb().rpc("decidi_ordine", { p_ordine: o.id, p_conferma: true, p_motivo: "" }), "Ordine confermato")}>Conferma</button>
                </>}
                {PROSSIMO[o.stato] && <button className="btn btn-piccolo" onClick={() => void esegui(() => sb().rpc("avanza_ordine", { p_ordine: o.id, p_stato: PROSSIMO[o.stato]!.stato }), "Aggiornato")}>→ {PROSSIMO[o.stato]!.etichetta}</button>}
                {puo(ruolo, "ordini.annulla") && !["rifiutato", "annullato"].includes(o.stato) && (
                  <button className="btn btn-pericolo btn-piccolo" onClick={() => {
                    const motivo = prompt("Motivo dell'annullamento (resta nello storico):", "");
                    if (motivo !== null) void esegui(() => sb().rpc("annulla_ordine", { p_ordine: o.id, p_motivo: motivo }), "Ordine annullato: il magazzino è stato ripristinato");
                  }}>Annulla</button>
                )}
              </div>
              {stampe(o.id).length > 0 && (
                <div className="stampe-ordine">
                  {stampe(o.id).map((c) => (
                    <span key={c.id} className={`pill stampa-${c.stato}`} title={c.errore || undefined}>
                      🖨️ {c.reparti?.nome ?? "Reparto"}{c.tipo === "annullo" ? " (annullo)" : ""}: {c.stato === "stampata" ? "stampata" : c.stato === "errore" ? "errore" : "in coda"}
                      {c.stato === "errore" && <button className="link" onClick={() => void esegui(() => sb().rpc("ristampa_comanda", { p_comanda: c.id }), "Rimessa in stampa")}>ristampa</button>}
                    </span>
                  ))}
                </div>
              )}
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
                          <span>{p.nome} <span className="muto piccolo">{p.gruppi.length ? "da " : ""}{euro(p.prezzo_cent)}</span></span>
                          {p.gruppi.length ? (
                            <button className="btn btn-piccolo" onClick={() => setComponendo({ p, gruppi: conAggiunte(p.gruppi, p.aggiunte) })}>Componi</button>
                          ) : (
                            <span className="riga-form">
                              {(aggiunta[chiaveRiga(p.id, [])]?.q ?? 0) > 0 && <button className="btn btn-icona" onClick={() => cambiaVoce(p, [], -1)}>−</button>}
                              {(aggiunta[chiaveRiga(p.id, [])]?.q ?? 0) > 0 && <strong>{aggiunta[chiaveRiga(p.id, [])]!.q}</strong>}
                              <button className="btn btn-icona" onClick={() => cambiaVoce(p, [], 1)}>+</button>
                              {p.aggiunte.length > 0 && (
                                <button className="btn btn-piccolo btn-aggiunte" onClick={() => setComponendo({ p, gruppi: conAggiunte([], p.aggiunte) })}
                                  aria-label={`Aggiunte per ${p.nome}`}>＋ Aggiunte</button>
                              )}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {scelti.filter((x) => x.scelte.length).map((x) => (
                <div key={chiaveRiga(x.prodotto.id, x.scelte)} className="aggiungi-voce">
                  <span>{x.q}× {x.prodotto.nome}<span className="scelte-riga">{x.scelte.map((c) => c.nome).join(", ")} · {euro(prezzoComposto(x.prodotto.prezzo_cent, x.scelte))}</span></span>
                  <button className="btn btn-icona" onClick={() => cambiaVoce(x.prodotto, x.scelte, -1)} aria-label="Togli">−</button>
                </div>
              ))}
              {componendo && (
                <Componi nome={componendo.p.nome} base={componendo.p.prezzo_cent} gruppi={componendo.gruppi} variante="gestionale"
                  onChiudi={() => setComponendo(null)} onConferma={(sc) => { cambiaVoce(componendo.p, sc, 1); setComponendo(null); }} />
              )}
              <div className="riga-form">
                <button className="btn" onClick={() => { setAggiunta(null); setCerca(""); }}>Annulla</button>
                <button className="btn btn-pieno" disabled={!scelti.length || attesa} onClick={async () => {
                  const ok = await esegui(() => sb().rpc("ordine_sala", { p_tavolo: tavolo.id, p_righe: scelti.map((x) => ({ prodotto_id: x.prodotto.id, quantita: x.q, opzioni: x.scelte.map((c) => c.id) })), p_nota: "" }), "Comanda aggiunta");
                  if (ok) { setAggiunta(null); setCerca(""); }
                }}>Invia comanda ({scelti.reduce((n, x) => n + x.q, 0)})</button>
              </div>
            </div>
          )}

          <button className="btn" onClick={async () => {
            const errore = await stampaConto(sessione.id, locale?.nome ?? "");
            if (errore) { avvisa(errore, "errore"); return; }
            setPreconti(segnaPreconto(sessione.id));
          }}>🖨️ Stampa preconto</button>
          {puo(ruolo, "sala.chiudi") ? (
            preconti.includes(sessione.id) ? (
              <button className="btn btn-pericolo btn-chiudi-tavolo" disabled={attesa} onClick={() => setCassa(sessione.id)}>💶 Chiudi tavolo · {euro(conto)}</button>
            ) : <button className="btn btn-testo piccolo" onClick={() => setCassa(sessione.id)}>Incassa senza preconto</button>
          ) : <p className="muto piccolo">Per incassare e chiudere il tavolo chiama il caposala.</p>}
        </>
      )}
      {cassa && <Pagamento sessioneId={cassa} tavolo={tavolo} onChiudi={() => setCassa(null)} onFatto={props.onFatto} />}
    </div>
  );
}
