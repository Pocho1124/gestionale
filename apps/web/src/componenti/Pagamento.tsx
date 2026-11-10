import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { centesimi, daEuro, dividiAllaRomana, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { stampaConto } from "../lib/conto";
import { useSessione } from "../lib/sessione";
import { puo } from "../lib/permessi";

type Metodo = "contanti" | "carta" | "altro";
interface PagamentoConto {
  id: string; metodo: Metodo; importo_cent: number; ricevuto_cent: number | null; quota: string;
  stato: "in_attesa" | "approvato" | "rifiutato" | "annullato"; riferimento: string; terminale: string | null; creato_at: string;
}
interface StatoConto {
  sessione: string; chiuso: boolean; coperti: number; lordo_cent: number; sconto_cent: number; totale_cent: number;
  pagato_cent: number; in_attesa_cent: number; residuo_cent: number; pagamenti: PagamentoConto[];
  righe?: RigaConto[];
}
/** Riga del conto con i pezzi già pagati (o in attesa del POS). */
interface RigaConto { id: string; nome: string; quantita: number; prezzo_cent: number; nota: string; opzioni: string[]; pagate: number }
interface Terminale { id: string; nome: string }
type Modo = "tutto" | "piatti" | "romana" | "parte";

const euro = (c: number) => formatta(centesimi(c));
const NOMI_METODO: Record<Metodo, string> = { contanti: "💶 Contanti", carta: "💳 POS", altro: "🎟️ Altro" };
const NOMI_STATO: Record<PagamentoConto["stato"], string> = { in_attesa: "in attesa del POS", approvato: "incassato", rifiutato: "rifiutato", annullato: "annullato" };
const euroOZero = (t: string) => { try { return t.trim() ? daEuro(t) : 0; } catch { return null; } };
const numero = (t: string) => Number(t.replace(",", "."));

/**
 * Incasso del tavolo in un popup: tutto in una volta, alla romana (diviso N) o a parti (importo o percentuale);
 * ogni parte in contanti (con resto), con il POS (attende l'esito) o altro. Sconto in € o %.
 * Il database ricalcola importi e residuo e chiude il tavolo solo se il conto torna al centesimo.
 */
export function Pagamento(props: { sessioneId: string; tavolo: { id: string; nome: string }; onChiudi: () => void; onFatto: () => Promise<void> }) {
  const avvisa = useAvviso();
  const naviga = useNavigate();
  const { locale, ruolo } = useSessione();
  const [conto, setConto] = useState<StatoConto | null>(null);
  const [terminali, setTerminali] = useState<Terminale[]>([]);
  const [modo, setModo] = useState<Modo>("tutto");
  const [parti, setParti] = useState(2);
  const [quota, setQuota] = useState<number | null>(null);
  const [valore, setValore] = useState("");
  const [inPercentuale, setInPercentuale] = useState(false);
  const [metodo, setMetodo] = useState<Metodo>("contanti");
  const [ricevuto, setRicevuto] = useState("");
  const [terminale, setTerminale] = useState("");
  const [sconto, setSconto] = useState("");
  const [scontoPct, setScontoPct] = useState(true);
  const [codici, setCodici] = useState<Record<string, string>>({});
  const [attesa, setAttesa] = useState(false);
  const [chiuso, setChiuso] = useState<number | null>(null);
  const [scelti, setScelti] = useState<Record<string, number>>({});   // pezzi scelti per riga (modo «Per piatti»)
  const [chi, setChi] = useState("");

  const carica = useCallback(async () => {
    const { data, error } = await sb().rpc("stato_conto", { p_sessione: props.sessioneId });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setConto(data as StatoConto);
  }, [props.sessioneId, avvisa]);
  useEffect(() => { void carica(); }, [carica]);
  useEffect(() => {
    if (!locale) return;
    void sb().from("terminali_pos").select("id, nome").eq("locale_id", locale.id).eq("attivo", true).order("posizione").order("nome")
      .then(({ data }) => { const t = (data ?? []) as Terminale[]; setTerminali(t); setTerminale((x) => x || t[0]?.id || ""); });
  }, [locale]);
  // Esiti del POS registrati da un altro tablet (o, in futuro, dal servizio di collegamento) arrivano subito
  useEffect(() => {
    const canale = sb().channel(`conto-${props.sessioneId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pagamenti", filter: `sessione_id=eq.${props.sessioneId}` }, () => void carica())
      .subscribe();
    return () => { void sb().removeChannel(canale); };
  }, [props.sessioneId, carica]);
  const chiudiPopup = useCallback(() => { void props.onFatto(); props.onChiudi(); }, [props]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") chiudiPopup(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [chiudiPopup]);

  const quote = useMemo(() => (conto && conto.totale_cent > 0 ? dividiAllaRomana(centesimi(conto.totale_cent), parti) : []), [conto, parti]);
  const quotaPagata = (i: number) => !!conto?.pagamenti.some((p) => p.quota === `Romana ${i + 1}/${parti}` && (p.stato === "approvato" || p.stato === "in_attesa"));
  const importo = useMemo(() => {
    if (!conto) return 0;
    if (modo === "tutto") return Math.max(0, conto.residuo_cent);
    if (modo === "romana") return quota === null ? 0 : Math.min(quote[quota] ?? 0, conto.residuo_cent);
    if (modo === "piatti") {
      // Anteprima: stessa regola del database (sconto in proporzione, saldo esatto con l'ultimo pezzo)
      const righe = conto.righe ?? [];
      const lordo = righe.reduce((n, x) => n + Math.min(scelti[x.id] ?? 0, x.quantita - x.pagate) * x.prezzo_cent, 0);
      if (!lordo) return 0;
      if (righe.every((x) => x.quantita - x.pagate - (scelti[x.id] ?? 0) <= 0)) return conto.residuo_cent;
      return Math.min(conto.lordo_cent ? Math.round((lordo * conto.totale_cent) / conto.lordo_cent) : 0, conto.residuo_cent);
    }
    if (inPercentuale) { const p = numero(valore); return p > 0 && p <= 100 ? Math.min(Math.round((conto.totale_cent * p) / 100), conto.residuo_cent) : 0; }
    return euroOZero(valore) ?? 0;
  }, [conto, modo, quota, quote, inPercentuale, valore, scelti]);
  const ricevutoCent = metodo === "contanti" ? euroOZero(ricevuto) : 0;
  const restoCent = ricevutoCent && ricevutoCent >= importo ? ricevutoCent - importo : 0;

  async function rpc(nome: string, parametri: Record<string, unknown>, ok?: string) {
    setAttesa(true);
    const { data, error } = await sb().rpc(nome, parametri);
    setAttesa(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); return null; }
    if (ok) avvisa(ok);
    return data;
  }

  async function registra() {
    if (!conto || importo <= 0) return;
    if (metodo === "contanti" && ricevutoCent === null) { avvisa("Contante ricevuto non valido (es. 50 o 20,50)", "errore"); return; }
    if (metodo === "contanti" && ricevutoCent && ricevutoCent < importo) { avvisa("Il contante ricevuto è inferiore all'importo", "errore"); return; }
    const percentuale = modo === "parte" && inPercentuale;
    const etichetta = modo === "piatti" ? (chi.trim() || "Piatti") : modo === "tutto" ? (conto.pagato_cent || conto.in_attesa_cent ? "Saldo" : "Unico")
      : modo === "romana" ? `Romana ${(quota ?? 0) + 1}/${parti}` : percentuale ? `${valore.trim()}%` : "Parte";
    const data = await rpc("registra_pagamento", {
      p_sessione: props.sessioneId, p_metodo: metodo,
      p_importo_cent: percentuale || modo === "piatti" ? null : importo, p_percentuale: percentuale ? numero(valore) : null,
      p_righe: modo === "piatti" ? Object.entries(scelti).filter(([, q]) => q > 0).map(([riga_id, quantita]) => ({ riga_id, quantita })) : null,
      p_ricevuto_cent: metodo === "contanti" && ricevutoCent ? ricevutoCent : null,
      p_quota: etichetta, p_terminale: metodo === "carta" && terminale ? terminale : null,
    });
    if (!data) return;
    const r = data as StatoConto & { resto_cent: number };
    setConto(r); setRicevuto(""); setValore(""); setQuota(null); setScelti({}); setChi("");
    avvisa(metodo === "carta" ? `Batti ${euro(importo)} sul POS e conferma l'esito` : r.resto_cent ? `Incassati ${euro(importo)} · resto ${euro(r.resto_cent)}` : `Incassati ${euro(importo)}`);
  }

  async function applicaSconto(togli = false) {
    let parametri: Record<string, unknown> = { p_sessione: props.sessioneId, p_cent: 0, p_percentuale: null };
    if (!togli) {
      if (scontoPct) {
        const p = numero(sconto);
        if (!(p >= 0 && p <= 100)) { avvisa("Percentuale tra 0 e 100", "errore"); return; }
        parametri = { ...parametri, p_cent: null, p_percentuale: p };
      } else {
        const c = euroOZero(sconto);
        if (c === null) { avvisa("Sconto non valido (es. 5 o 2,50)", "errore"); return; }
        parametri = { ...parametri, p_cent: c };
      }
    }
    const data = await rpc("imposta_sconto", parametri, togli ? "Sconto tolto" : "Sconto applicato");
    if (data) { setConto(data as StatoConto); setSconto(""); }
  }

  async function chiudiTavolo() {
    const data = await rpc("chiudi_tavolo", { p_tavolo: props.tavolo.id, p_pagamento: "contanti" });
    if (data === null) return;
    setChiuso(Number(data));
    await props.onFatto();
  }

  if (!conto) return null;
  const pagamentiValidi = conto.pagamenti.filter((p) => p.stato !== "annullato");
  const restoTotale = conto.pagamenti.filter((p) => p.stato === "approvato" && p.ricevuto_cent).reduce((n, p) => n + (p.ricevuto_cent! - p.importo_cent), 0);
  const banconote = [importo, 1000, 2000, 5000, 10000].filter((v, i, a) => v >= importo && v > 0 && a.indexOf(v) === i).slice(0, 4);

  return (
    <div className="popup-sfondo" onClick={chiudiPopup}>
      <div className="popup pagamento-popup" role="dialog" aria-modal="true" aria-label={`Conto del tavolo ${props.tavolo.nome}`} onClick={(e) => e.stopPropagation()}>
        <header className="pagamento-testa">
          <h2>Conto · Tavolo {props.tavolo.nome}</h2>
          <button className="btn btn-icona" onClick={chiudiPopup} aria-label="Chiudi">×</button>
        </header>

        {chiuso !== null ? (
          <div className="pagamento-fatto">
            <p className="popup-icona">✅</p>
            <h3>Tavolo {props.tavolo.nome} chiuso · {euro(chiuso)}</h3>
            <ul className="pagamenti-lista">
              {pagamentiValidi.filter((p) => p.stato === "approvato").map((p) => (
                <li key={p.id}><span>{NOMI_METODO[p.metodo]} {p.quota && <span className="muto piccolo">{p.quota}</span>}</span><b>{euro(p.importo_cent)}</b></li>
              ))}
            </ul>
            {restoTotale > 0 && <p className="muto">Resto dato in contanti: {euro(restoTotale)}</p>}
            <div className="riga-form" style={{ justifyContent: "center" }}>
              {puo(ruolo, "cassa") && <button className="btn" onClick={() => naviga(`/fatture?sessione=${props.sessioneId}`)}>🧾 Emetti fattura</button>}
              <button className="btn btn-pieno" onClick={chiudiPopup}>Fine</button>
            </div>
          </div>
        ) : (
          <>
            <div className="conto-cifre">
              <div><span>Totale</span><strong>{euro(conto.totale_cent)}</strong>
                {conto.sconto_cent > 0 && <small>{euro(conto.lordo_cent)} − sconto {euro(conto.sconto_cent)}</small>}</div>
              <div><span>Pagato</span><strong>{euro(conto.pagato_cent)}</strong>{conto.in_attesa_cent > 0 && <small>+ {euro(conto.in_attesa_cent)} al POS</small>}</div>
              <div className={`da-pagare${conto.residuo_cent === 0 ? " saldato" : ""}`}><span>Da pagare</span><strong>{euro(conto.residuo_cent)}</strong>
                <small>{conto.coperti} coperti · {euro(Math.round(conto.totale_cent / Math.max(1, conto.coperti)))} a testa</small></div>
            </div>

            <details className="pagamento-sconto">
              <summary>Sconto {conto.sconto_cent > 0 ? `(${euro(conto.sconto_cent)})` : ""}</summary>
              <div className="riga-form">
                <input inputMode="decimal" placeholder={scontoPct ? "10" : "5,00"} value={sconto} onChange={(e) => setSconto(e.target.value)} aria-label="Sconto" style={{ width: 90 }} />
                <div className="scelte">
                  <button className={`chip${scontoPct ? " attivo" : ""}`} onClick={() => setScontoPct(true)}>%</button>
                  <button className={`chip${!scontoPct ? " attivo" : ""}`} onClick={() => setScontoPct(false)}>€</button>
                </div>
                <button className="btn" disabled={attesa || !sconto.trim()} onClick={() => void applicaSconto()}>Applica</button>
                {conto.sconto_cent > 0 && <button className="btn btn-testo" disabled={attesa} onClick={() => void applicaSconto(true)}>Togli sconto</button>}
              </div>
            </details>

            {conto.residuo_cent > 0 && (
              <>
                <div className="schede-modo" role="tablist" aria-label="Come dividere">
                  <button role="tab" aria-selected={modo === "tutto"} onClick={() => setModo("tutto")}>Tutto</button>
                  <button role="tab" aria-selected={modo === "piatti"} onClick={() => setModo("piatti")}>Per piatti</button>
                  <button role="tab" aria-selected={modo === "romana"} onClick={() => { setModo("romana"); setQuota(null); if (parti === 2 && conto.coperti > 2) setParti(Math.min(60, conto.coperti)); }}>Alla romana</button>
                  <button role="tab" aria-selected={modo === "parte"} onClick={() => setModo("parte")}>Importo o %</button>
                </div>

                {modo === "piatti" && (
                  <div className="pagamento-piatti">
                    <ul className="piatti-conto">
                      {(conto.righe ?? []).map((x) => {
                        const restano = x.quantita - x.pagate, q = scelti[x.id] ?? 0;
                        const imposta = (v: number) => setScelti((c) => ({ ...c, [x.id]: Math.max(0, Math.min(restano, v)) }));
                        return (
                          <li key={x.id} className={`${restano <= 0 ? "pagata" : ""}${q ? " scelta" : ""}`}>
                            <button className="piatti-nome" disabled={restano <= 0} onClick={() => imposta(q < restano ? q + 1 : 0)}>
                              <span>{x.nome}{x.opzioni.length > 0 && <span className="scelte-riga">{x.opzioni.join(", ")}</span>}</span>
                              <span className="muto piccolo">{restano <= 0 ? "✓ pagato" : `${restano} di ${x.quantita} da pagare`} · {euro(x.prezzo_cent)} cad.</span>
                            </button>
                            {restano > 0 && (
                              <span className="riga-form">
                                <button className="btn btn-icona" disabled={!q} onClick={() => imposta(q - 1)} aria-label={`Un ${x.nome} in meno`}>−</button>
                                <strong className="piatti-q">{q}</strong>
                                <button className="btn btn-icona" disabled={q >= restano} onClick={() => imposta(q + 1)} aria-label={`Un ${x.nome} in più`}>+</button>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="riga-form">
                      <input maxLength={40} placeholder="Chi paga (facoltativo, es. sedia 2)" value={chi} onChange={(e) => setChi(e.target.value)} aria-label="Etichetta del pagamento" />
                      <button className="btn btn-testo" onClick={() => setScelti(Object.fromEntries((conto.righe ?? []).map((x) => [x.id, x.quantita - x.pagate])))}>Seleziona tutto</button>
                      {Object.values(scelti).some(Boolean) && <button className="btn btn-testo" onClick={() => setScelti({})}>Azzera</button>}
                      {importo > 0 && <span className="muto">= {euro(importo)}{conto.sconto_cent > 0 ? " con lo sconto" : ""}</span>}
                    </div>
                  </div>
                )}

                {modo === "romana" && (
                  <div className="pagamento-romana">
                    <div className="riga-form">
                      <span>Diviso</span>
                      <button className="btn btn-icona" onClick={() => { setParti((n) => Math.max(2, n - 1)); setQuota(null); }} aria-label="Meno quote">−</button>
                      <strong className="numero-grande">{parti}</strong>
                      <button className="btn btn-icona" onClick={() => { setParti((n) => Math.min(60, n + 1)); setQuota(null); }} aria-label="Più quote">+</button>
                      <span className="muto">quote da {euro(quote[quote.length - 1] ?? 0)}{quote[0] !== quote[quote.length - 1] ? ` / ${euro(quote[0] ?? 0)}` : ""}</span>
                    </div>
                    <div className="quote">
                      {quote.map((q, i) => (
                        <button key={i} className={`quota${quota === i ? " scelta" : ""}${quotaPagata(i) ? " pagata" : ""}`} disabled={quotaPagata(i)}
                          onClick={() => setQuota(i)} aria-pressed={quota === i}>
                          <span>{quotaPagata(i) ? "✓ " : ""}Quota {i + 1}</span><b>{euro(q)}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {modo === "parte" && (
                  <div className="riga-form">
                    <input inputMode="decimal" autoFocus placeholder={inPercentuale ? "50" : "20,00"} value={valore} onChange={(e) => setValore(e.target.value)}
                      aria-label={inPercentuale ? "Percentuale del totale" : "Importo"} style={{ width: 110 }} />
                    <div className="scelte">
                      <button className={`chip${!inPercentuale ? " attivo" : ""}`} onClick={() => setInPercentuale(false)}>€</button>
                      <button className={`chip${inPercentuale ? " attivo" : ""}`} onClick={() => setInPercentuale(true)}>% del totale</button>
                    </div>
                    {inPercentuale && [25, 33.33, 50].map((p) => <button key={p} className="chip" onClick={() => setValore(String(p).replace(".", ","))}>{String(p).replace(".", ",")}%</button>)}
                    {inPercentuale && importo > 0 && <span className="muto">= {euro(importo)}</span>}
                  </div>
                )}

                <div className="metodi" role="radiogroup" aria-label="Metodo di pagamento">
                  {(Object.keys(NOMI_METODO) as Metodo[]).map((m) => (
                    <button key={m} role="radio" aria-checked={metodo === m} className={`metodo${metodo === m ? " attivo" : ""}`} onClick={() => setMetodo(m)}>{NOMI_METODO[m]}</button>
                  ))}
                </div>
                {metodo === "contanti" && importo > 0 && (
                  <div className="riga-form">
                    <span>Ricevuti</span>
                    <input inputMode="decimal" placeholder={euro(importo)} value={ricevuto} onChange={(e) => setRicevuto(e.target.value)} aria-label="Contante ricevuto" style={{ width: 100 }} />
                    {banconote.map((b) => <button key={b} className="chip" onClick={() => setRicevuto((b / 100).toFixed(2).replace(".", ","))}>{b === importo ? "Giusti" : euro(b)}</button>)}
                    {restoCent > 0 && <strong className="resto">Resto {euro(restoCent)}</strong>}
                  </div>
                )}
                {metodo === "carta" && terminali.length > 1 && (
                  <div className="riga-form"><span>POS</span>
                    <select value={terminale} onChange={(e) => setTerminale(e.target.value)} aria-label="Terminale POS">
                      {terminali.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                    </select>
                  </div>
                )}
                <button className="btn btn-pieno pagamento-registra" disabled={attesa || importo <= 0} onClick={() => void registra()}>
                  {metodo === "carta" ? `Invia al POS · ${euro(importo)}` : `Incassa ${euro(importo)} in ${metodo === "contanti" ? "contanti" : "altro modo"}`}
                </button>
              </>
            )}

            {pagamentiValidi.length > 0 && (
              <ul className="pagamenti-lista" aria-label="Pagamenti registrati">
                {pagamentiValidi.map((p) => (
                  <li key={p.id} className={`pagamento-${p.stato}`}>
                    <span>{NOMI_METODO[p.metodo]}{p.terminale ? ` ${p.terminale}` : ""} {p.quota && <span className="muto piccolo">{p.quota}</span>}
                      <span className="muto piccolo"> · {NOMI_STATO[p.stato]}{p.riferimento ? ` · aut. ${p.riferimento}` : ""}{p.ricevuto_cent ? ` · resto ${euro(p.ricevuto_cent - p.importo_cent)}` : ""}</span></span>
                    <b>{euro(p.importo_cent)}</b>
                    {p.stato === "in_attesa" ? (
                      <span className="riga-form esito-pos">
                        <input placeholder="Cod. aut. (facolt.)" maxLength={40} value={codici[p.id] ?? ""} onChange={(e) => setCodici((c) => ({ ...c, [p.id]: e.target.value }))} aria-label="Codice di autorizzazione" />
                        <button className="btn btn-pieno btn-piccolo" disabled={attesa} onClick={async () => {
                          const d = await rpc("esito_pos", { p_pagamento: p.id, p_approvato: true, p_riferimento: codici[p.id] ?? "" }, "Pagamento POS approvato");
                          if (d) setConto(d as StatoConto);
                        }}>✓ Approvato</button>
                        <button className="btn btn-pericolo btn-piccolo" disabled={attesa} onClick={async () => {
                          const d = await rpc("esito_pos", { p_pagamento: p.id, p_approvato: false, p_riferimento: "" }, "Pagamento POS rifiutato");
                          if (d) setConto(d as StatoConto);
                        }}>✗ Rifiutato</button>
                      </span>
                    ) : p.stato === "approvato" && (
                      <button className="btn btn-testo btn-piccolo" disabled={attesa} onClick={async () => {
                        if (!confirm(`Annullare il pagamento di ${euro(p.importo_cent)}?`)) return;
                        const d = await rpc("annulla_pagamento", { p_pagamento: p.id }, "Pagamento annullato");
                        if (d) setConto(d as StatoConto);
                      }}>Annulla</button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <footer className="pagamento-piede">
              <button className="btn" onClick={async () => { const e = await stampaConto(props.sessioneId, locale?.nome ?? ""); if (e) avvisa(e, "errore"); }}>🖨️ Preconto</button>
              <button className="btn btn-pericolo" disabled={attesa || conto.residuo_cent !== 0 || conto.in_attesa_cent > 0} onClick={() => void chiudiTavolo()}>
                {conto.in_attesa_cent > 0 ? "POS in attesa di esito" : conto.residuo_cent < 0 ? `Pagati ${euro(-conto.residuo_cent)} in più` : conto.residuo_cent > 0 ? `Mancano ${euro(conto.residuo_cent)}` : `Chiudi tavolo · ${euro(conto.totale_cent)}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
