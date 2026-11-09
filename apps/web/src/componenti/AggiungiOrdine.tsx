import { useEffect, useMemo, useRef, useState } from "react";
import { centesimi, daEuro, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import type { GruppoScelte, Scelta } from "../lib/tipi";
import { Componi, chiaveRiga, conAggiunte, prezzoComposto } from "./Componi";
import type { CategoriaBreve, ProdottoBreve } from "./ServizioSala";

const euro = (c: number) => formatta(centesimi(c));
/** Riga della comanda: stesso piatto con scelte o note diverse = righe distinte (in cucina arrivano separate). */
interface Riga { id: string; prodotto: ProdottoBreve; scelte: Scelta[]; q: number; nota: string; supplemento: string }
/** Supplemento della nota in centesimi (null se scritto male); il database accetta da 0 a 100 €. */
const centSupplemento = (t: string) => { try { return t.trim() ? daEuro(t) : 0; } catch { return null; } };
const prezzoRiga = (r: Riga) => prezzoComposto(r.prodotto.prezzo_cent, r.scelte) + (centSupplemento(r.supplemento) ?? 0);
const NOTE_RAPIDE = ["Senza glutine", "Ben cotta", "Senza cipolla", "Poco sale", "A parte", "Subito", "Dopo"];

/**
 * Comanda dal tablet in un popup: piatti divisi per categoria (schede e ricerca), aggiunte e composizioni,
 * nota per ogni riga e nota generale; in basso il riepilogo con il totale. I prezzi li ricalcola il database.
 */
export function AggiungiOrdine(props: {
  tavolo: { id: string; nome: string }; prodotti: ProdottoBreve[]; categorie: CategoriaBreve[];
  onChiudi: () => void; onInviata: () => Promise<void>;
}) {
  const avvisa = useAvviso();
  const [righe, setRighe] = useState<Riga[]>([]);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [componendo, setComponendo] = useState<{ p: ProdottoBreve; gruppi: GruppoScelte[]; nota: boolean } | null>(null);
  const [notaGenerale, setNotaGenerale] = useState("");
  const [notaAperta, setNotaAperta] = useState<string | null>(null);
  const [riepilogoAperto, setRiepilogoAperto] = useState(true);
  const [invio, setInvio] = useState(false);
  const contatore = useRef(0);
  const campoNota = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !componendo) props.onChiudi(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [componendo, props]);
  useEffect(() => { if (notaAperta) campoNota.current?.focus(); }, [notaAperta]);

  const disponibili = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    return props.prodotti.filter((p) => p.visibile && p.disponibile && (!t || p.nome.toLowerCase().includes(t)));
  }, [props.prodotti, cerca]);
  const categorieConPiatti = props.categorie.filter((c) => disponibili.some((p) => p.categoria_id === c.id));
  const mostrate = cerca.trim() || !categoria ? categorieConPiatti : categorieConPiatti.filter((c) => c.id === categoria);

  /** Aggiunge (o toglie) un pezzo: le righe senza nota con le stesse scelte si sommano. */
  function cambia(p: ProdottoBreve, scelte: Scelta[], delta: number, conNota = false) {
    const chiave = chiaveRiga(p.id, scelte);
    const nuovo = `r${++contatore.current}`;   // usato solo se nasce una riga nuova
    setRighe((rs) => {
      const i = conNota ? -1 : rs.findIndex((r) => chiaveRiga(r.prodotto.id, r.scelte) === chiave && !r.nota && !r.supplemento.trim());
      if (i < 0) return delta < 0 ? rs : [...rs, { id: nuovo, prodotto: p, scelte, q: 1, nota: "", supplemento: "" }];
      const q = Math.min(20, rs[i]!.q + delta);
      return q <= 0 ? rs.filter((_, j) => j !== i) : rs.map((r, j) => (j === i ? { ...r, q } : r));
    });
    if (conNota && delta > 0) { setNotaAperta(nuovo); setRiepilogoAperto(true); }
  }
  const aggiornaRiga = (id: string, patch: Partial<Riga>) =>
    setRighe((rs) => rs.flatMap((r) => (r.id !== id ? [r] : (patch.q ?? r.q) <= 0 ? [] : [{ ...r, ...patch, q: Math.min(20, patch.q ?? r.q) }])));
  const semplici = (p: ProdottoBreve) => righe.filter((r) => r.prodotto.id === p.id && !r.scelte.length && !r.nota && !r.supplemento.trim()).reduce((n, r) => n + r.q, 0);
  const nelCarrello = (p: ProdottoBreve) => righe.filter((r) => r.prodotto.id === p.id).reduce((n, r) => n + r.q, 0);
  const pezzi = righe.reduce((n, r) => n + r.q, 0);
  const totale = righe.reduce((n, r) => n + r.q * prezzoRiga(r), 0);

  async function invia() {
    if (!righe.length) return;
    const errata = righe.find((r) => { const c = centSupplemento(r.supplemento); return c === null || c < 0 || c > 10000; });
    if (errata) { avvisa(`Supplemento non valido per «${errata.prodotto.nome}» (da 0 a 100 €, es. 2,50)`, "errore"); setNotaAperta(errata.id); return; }
    setInvio(true);
    const { error } = await sb().rpc("ordine_sala", {
      p_tavolo: props.tavolo.id, p_nota: notaGenerale.trim(),
      p_righe: righe.map((r) => ({ prodotto_id: r.prodotto.id, quantita: r.q, nota: r.nota.trim(), opzioni: r.scelte.map((c) => c.id),
        ...(centSupplemento(r.supplemento) ? { supplemento_cent: centSupplemento(r.supplemento) } : {}) })),
    });
    setInvio(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(`Comanda inviata · tavolo ${props.tavolo.nome} · ${pezzi} ${pezzi === 1 ? "pezzo" : "pezzi"}`);
    await props.onInviata();
    props.onChiudi();
  }
  const chiudi = () => { if (!righe.length || confirm("Chiudere senza inviare la comanda?")) props.onChiudi(); };

  return (
    <div className="popup-sfondo" onClick={chiudi}>
      <div className="popup comanda-popup" role="dialog" aria-modal="true" aria-label={`Aggiungi all'ordine del tavolo ${props.tavolo.nome}`} onClick={(e) => e.stopPropagation()}>
        <header className="comanda-testa">
          <h2>Aggiungi all'ordine · Tavolo {props.tavolo.nome}</h2>
          <button className="btn btn-icona" onClick={chiudi} aria-label="Chiudi">×</button>
        </header>
        <input className="comanda-cerca" type="search" placeholder="🔎 Cerca un piatto o un vino" value={cerca} onChange={(e) => setCerca(e.target.value)} />
        {!cerca.trim() && (
          <nav className="comanda-categorie" aria-label="Categorie">
            <button className={`chip${categoria === null ? " attivo" : ""}`} onClick={() => setCategoria(null)}>Tutte</button>
            {categorieConPiatti.map((c) => (
              <button key={c.id} className={`chip${categoria === c.id ? " attivo" : ""}`} onClick={() => setCategoria(c.id)}>{c.nome}</button>
            ))}
          </nav>
        )}

        <div className="comanda-piatti">
          {mostrate.length === 0 && <p className="muto">Nessun piatto trovato.</p>}
          {mostrate.map((c) => (
            <section key={c.id}>
              <h3 className="comanda-categoria">{c.nome}</h3>
              <div className="comanda-griglia">
                {disponibili.filter((p) => p.categoria_id === c.id).map((p) => {
                  const componibile = p.gruppi.length > 0;
                  const n = nelCarrello(p);
                  return (
                    <article key={p.id} className={`comanda-piatto${n ? " scelto" : ""}`}>
                      <button className="comanda-piatto-nome" onClick={() => (componibile ? setComponendo({ p, gruppi: conAggiunte(p.gruppi, p.aggiunte), nota: false }) : cambia(p, [], 1))}
                        aria-label={componibile ? `Componi ${p.nome}` : `Aggiungi ${p.nome}`}>
                        <span>{p.nome}</span>
                        <span className="muto">{componibile ? "da " : ""}{euro(p.prezzo_cent)}</span>
                        {n > 0 && <span className="comanda-badge" aria-label={`${n} nella comanda`}>{n}</span>}
                      </button>
                      <div className="comanda-azioni">
                        {componibile ? <button className="btn btn-piccolo" onClick={() => setComponendo({ p, gruppi: conAggiunte(p.gruppi, p.aggiunte), nota: false })}>Componi</button> : <>
                          <button className="btn btn-icona" disabled={!semplici(p)} onClick={() => cambia(p, [], -1)} aria-label={`Togli ${p.nome}`}>−</button>
                          <button className="btn btn-icona" onClick={() => cambia(p, [], 1)} aria-label={`Uno in più: ${p.nome}`}>+</button>
                          {p.aggiunte.length > 0 && (
                            <button className="btn btn-piccolo btn-aggiunte" onClick={() => setComponendo({ p, gruppi: conAggiunte([], p.aggiunte), nota: false })}>＋ Aggiunte</button>
                          )}
                        </>}
                        <button className="btn btn-piccolo" onClick={() => (componibile || p.aggiunte.length
                          ? setComponendo({ p, gruppi: componibile ? conAggiunte(p.gruppi, p.aggiunte) : conAggiunte([], p.aggiunte), nota: true })
                          : cambia(p, [], 1, true))} aria-label={`${p.nome} con nota`}>📝 Nota</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="comanda-riepilogo">
          <button className="comanda-riepilogo-testa" onClick={() => setRiepilogoAperto((v) => !v)} aria-expanded={riepilogoAperto}>
            <strong>Riepilogo comanda</strong>
            <span>{pezzi ? `${pezzi} ${pezzi === 1 ? "pezzo" : "pezzi"} · ${euro(totale)}` : "vuota"} {riepilogoAperto ? "▾" : "▴"}</span>
          </button>
          {riepilogoAperto && (
            <>
              {righe.length === 0 ? <p className="muto piccolo">Tocca un piatto per aggiungerlo. Con «📝 Nota» lo aggiungi come riga a parte, con la sua nota per la cucina ed eventualmente un costo.</p> : (
                <ul className="comanda-righe">
                  {righe.map((r) => (
                    <li key={r.id}>
                      <div className="comanda-riga">
                        <span className="riga-form">
                          <button className="btn btn-icona" onClick={() => aggiornaRiga(r.id, { q: r.q - 1 })} aria-label="Meno">−</button>
                          <strong>{r.q}</strong>
                          <button className="btn btn-icona" onClick={() => aggiornaRiga(r.id, { q: r.q + 1 })} aria-label="Più">+</button>
                        </span>
                        <span className="comanda-riga-nome">{r.prodotto.nome}
                          {r.scelte.length > 0 && <span className="scelte-riga">{r.scelte.map((c) => c.nome).join(", ")}</span>}
                          {(r.nota || r.supplemento.trim()) && notaAperta !== r.id && (
                            <span className="comanda-nota">📝 {r.nota}{centSupplemento(r.supplemento) ? ` · + ${euro(centSupplemento(r.supplemento)!)}` : ""}</span>
                          )}
                        </span>
                        <span className="comanda-riga-prezzo">{euro(r.q * prezzoRiga(r))}</span>
                        <button className="btn btn-testo btn-piccolo" onClick={() => setNotaAperta(notaAperta === r.id ? null : r.id)}>{r.nota || r.supplemento.trim() ? "Modifica nota" : "📝"}</button>
                      </div>
                      {notaAperta === r.id && (
                        <div className="comanda-nota-campo">
                          <div className="comanda-nota-riga">
                            <input ref={campoNota} maxLength={120} placeholder="Nota per la cucina (es. doppia mozzarella)" value={r.nota}
                              onChange={(e) => aggiornaRiga(r.id, { nota: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") setNotaAperta(null); }} aria-label={`Nota per ${r.prodotto.nome}`} />
                            <label className="comanda-supplemento">+ €
                              <input inputMode="decimal" placeholder="0,00" value={r.supplemento} maxLength={6}
                                className={centSupplemento(r.supplemento) === null ? "errato" : undefined}
                                onChange={(e) => aggiornaRiga(r.id, { supplemento: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") setNotaAperta(null); }}
                                aria-label={`Costo della nota per ${r.prodotto.nome}`} />
                            </label>
                          </div>
                          <div className="scelte">
                            {NOTE_RAPIDE.map((t) => (
                              <button key={t} className="chip" onClick={() => aggiornaRiga(r.id, { nota: (r.nota ? `${r.nota}, ${t.toLowerCase()}` : t).slice(0, 120) })}>{t}</button>
                            ))}
                            <button className="btn btn-piccolo" onClick={() => setNotaAperta(null)}>Fatto</button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <input maxLength={200} placeholder="Nota per tutta la comanda (facoltativa)" value={notaGenerale} onChange={(e) => setNotaGenerale(e.target.value)} aria-label="Nota della comanda" />
            </>
          )}
          <div className="riga-form comanda-invio">
            <button className="btn" onClick={chiudi}>Annulla</button>
            <button className="btn btn-pieno" disabled={!righe.length || invio} onClick={() => void invia()}>
              {invio ? "Invio…" : `Invia comanda${pezzi ? ` (${pezzi}) · ${euro(totale)}` : ""}`}
            </button>
          </div>
        </footer>

        {componendo && (
          <Componi nome={componendo.p.nome} base={componendo.p.prezzo_cent} gruppi={componendo.gruppi} variante="gestionale"
            onChiudi={() => setComponendo(null)} onConferma={(sc) => { cambia(componendo.p, sc, 1, componendo.nota); setComponendo(null); }} />
        )}
      </div>
    </div>
  );
}
