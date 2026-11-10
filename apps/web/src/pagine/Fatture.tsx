import { useCallback, useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { daEuro } from "@gest/core";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { puo } from "../lib/permessi";
import { nomeCliente, scaricaXml, stampaFattura, type Fattura } from "../lib/fatture";
import { euro } from "../lib/formato";

interface DatiFiscali { denominazione: string; partita_iva: string; codice_fiscale: string; regime_fiscale: string; indirizzo: string; cap: string; comune: string; provincia: string }
const DATI_VUOTI: DatiFiscali = { denominazione: "", partita_iva: "", codice_fiscale: "", regime_fiscale: "RF01", indirizzo: "", cap: "", comune: "", provincia: "" };
const REGIMI: Record<string, string> = { RF01: "Ordinario", RF02: "Contribuenti minimi", RF19: "Forfettario" };
interface ContoChiuso { id: string; chiusa_at: string; totale_cent: number; tavoli: { nome: string } | null }
interface Cliente {
  tipo: "azienda" | "privato"; denominazione: string; nome: string; cognome: string; partita_iva: string; codice_fiscale: string;
  indirizzo: string; cap: string; comune: string; provincia: string; codice_destinatario: string; pec: string;
}
const CLIENTE_VUOTO: Cliente = { tipo: "azienda", denominazione: "", nome: "", cognome: "", partita_iva: "", codice_fiscale: "", indirizzo: "", cap: "", comune: "", provincia: "", codice_destinatario: "", pec: "" };
interface RigaLibera { descrizione: string; quantita: string; prezzo: string; aliquota: string }
const RIGA_VUOTA: RigaLibera = { descrizione: "", quantita: "1", prezzo: "", aliquota: "10" };

/**
 * Fatture elettroniche (solo amministratore): dati fiscali del locale, emissione da un conto chiuso o a righe libere,
 * elenco con copia di cortesia e XML FatturaPA. Numeri, scorporo IVA e controlli li fa il database.
 * Il gestionale NON trasmette allo SDI: l'XML si carica su «Fatture e Corrispettivi» o lo invia l'intermediario.
 */
export function Fatture() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [parametri, setParametri] = useSearchParams();
  const [dati, setDati] = useState<DatiFiscali | null | undefined>(undefined);   // undefined = in caricamento, null = da compilare
  const [fatture, setFatture] = useState<Fattura[]>([]);
  const [conti, setConti] = useState<ContoChiuso[]>([]);
  const [anno, setAnno] = useState(new Date().getFullYear());
  const [nuova, setNuova] = useState(!!parametri.get("sessione"));

  const carica = useCallback(async () => {
    if (!locale) return;
    const da = new Date(Date.now() - 31 * 24 * 3600_000).toISOString();
    const [d, f, c] = await Promise.all([
      sb().from("dati_fiscali").select("denominazione, partita_iva, codice_fiscale, regime_fiscale, indirizzo, cap, comune, provincia").eq("locale_id", locale.id).maybeSingle(),
      sb().from("fatture").select("*").eq("locale_id", locale.id).order("anno", { ascending: false }).order("numero", { ascending: false }),
      sb().from("sessioni_tavolo").select("id, chiusa_at, totale_cent, tavoli(nome)").eq("locale_id", locale.id).not("chiusa_at", "is", null)
        .gte("chiusa_at", da).gt("totale_cent", 0).order("chiusa_at", { ascending: false }).limit(60),
    ]);
    const errore = d.error ?? f.error ?? c.error;
    if (errore) { avvisa(messaggioErrore(errore), "errore"); return; }
    setDati(d.data as DatiFiscali | null);
    setFatture(f.data as Fattura[]);
    setConti(c.data as unknown as ContoChiuso[]);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);

  const fatturati = useMemo(() => new Set(fatture.map((f) => f.sessione_id).filter(Boolean)), [fatture]);
  const anni = useMemo(() => [...new Set([new Date().getFullYear(), ...fatture.map((f) => f.anno)])].sort((a, b) => b - a), [fatture]);
  if (!locale) return null;
  if (!puo(ruolo, "cassa")) return <div className="pagina"><h1>Fatture</h1><p className="muto">Le fatture le gestisce il titolare.</p></div>;
  if (dati === undefined) return <p className="muto">Caricamento…</p>;

  return (
    <div className="pagina">
      <div className="pagina-testa riga-form" style={{ justifyContent: "space-between" }}>
        <h1>Fatture</h1>
        {dati && !nuova && <button className="btn btn-pieno" onClick={() => setNuova(true)}>+ Nuova fattura</button>}
      </div>
      <p className="muto piccolo">
        Il gestionale prepara il file XML (FatturaPA) e la copia di cortesia, ma non lo trasmette allo SDI:
        caricalo sul portale «Fatture e Corrispettivi» dell'Agenzia delle Entrate o consegnalo al tuo intermediario.
      </p>

      <SezioneDatiFiscali locale={locale.id} dati={dati} onFatto={carica} />

      {dati && nuova && (
        <NuovaFattura locale={locale.id} conti={conti.filter((c) => !fatturati.has(c.id))} sessione={parametri.get("sessione")}
          onChiudi={() => { setNuova(false); if (parametri.get("sessione")) setParametri({}, { replace: true }); }}
          onEmessa={async (f) => { avvisa(`Fattura n. ${f.numero}/${f.anno} emessa · ${euro(f.totale_cent)}`); setNuova(false); setParametri({}, { replace: true }); await carica(); }} />
      )}

      <section className="blocco">
        <div className="blocco-testa">
          <h2>Fatture emesse</h2>
          <select value={anno} onChange={(e) => setAnno(Number(e.target.value))} aria-label="Anno">{anni.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </div>
        {fatture.filter((f) => f.anno === anno).length === 0 ? <p className="muto">Nessuna fattura nel {anno}.</p> : (
          <table className="tabella">
            <thead><tr><th>N.</th><th>Data</th><th>Cliente</th><th className="n">Imponibile</th><th className="n">Totale</th><th /></tr></thead>
            <tbody>
              {fatture.filter((f) => f.anno === anno).map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.numero}</strong></td>
                  <td>{new Date(`${f.data}T12:00:00`).toLocaleDateString("it-IT")}</td>
                  <td>{nomeCliente(f)}<span className="muto piccolo"> · {f.cliente.partita_iva ? `P. IVA ${f.cliente.partita_iva}` : `C.F. ${f.cliente.codice_fiscale}`}</span></td>
                  <td className="n">{euro(f.imponibile_cent)}</td>
                  <td className="n"><strong>{euro(f.totale_cent)}</strong></td>
                  <td className="n">
                    <span className="riga-form" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-piccolo" onClick={() => { const e = stampaFattura(f); if (e) avvisa(e, "errore"); }}>🖨️ Stampa</button>
                      <button className="btn btn-piccolo" onClick={() => scaricaXml(f)}>⬇️ XML</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Totale {anno}</td><td className="n"><strong>{euro(fatture.filter((f) => f.anno === anno).reduce((n, f) => n + f.totale_cent, 0))}</strong></td><td /></tr></tfoot>
          </table>
        )}
      </section>
    </div>
  );
}

/** Dati del locale come emittente: servono prima della prima fattura. */
function SezioneDatiFiscali(props: { locale: string; dati: DatiFiscali | null; onFatto: () => Promise<void> }) {
  const avvisa = useAvviso();
  const [aperta, setAperta] = useState(!props.dati);
  const [d, setD] = useState<DatiFiscali>(props.dati ?? DATI_VUOTI);
  useEffect(() => { setD(props.dati ?? DATI_VUOTI); }, [props.dati]);
  const campo = (k: keyof DatiFiscali, etichetta: string, extra: ComponentProps<"input"> = {}) => (
    <label>{etichetta}<input value={d[k]} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} {...extra} /></label>
  );
  async function salva(e: FormEvent) {
    e.preventDefault();
    const riga = { ...d, locale_id: props.locale, partita_iva: d.partita_iva.replace(/\s/g, ""), codice_fiscale: d.codice_fiscale.replace(/\s/g, "").toUpperCase(),
      provincia: d.provincia.trim().toUpperCase(), denominazione: d.denominazione.trim(), indirizzo: d.indirizzo.trim(), comune: d.comune.trim(), cap: d.cap.trim() };
    const { error } = await sb().from("dati_fiscali").upsert(riga, { onConflict: "locale_id" });
    if (error) { avvisa(error.code === "23514" ? "Controlla partita IVA (11 cifre valide), CAP (5 cifre) e provincia (2 lettere)." : messaggioErrore(error), "errore"); return; }
    avvisa("Dati fiscali salvati"); setAperta(false); await props.onFatto();
  }
  return (
    <section className="blocco">
      <div className="blocco-testa">
        <h2>Dati fiscali del locale {props.dati ? <span className="muto piccolo">{props.dati.denominazione} · P. IVA {props.dati.partita_iva}</span> : null}</h2>
        {props.dati && <button className="btn" onClick={() => setAperta((v) => !v)}>{aperta ? "Chiudi" : "Modifica"}</button>}
      </div>
      {!props.dati && <p className="muto">Compila i dati dell'attività: compariranno come emittente su tutte le fatture.</p>}
      {aperta && (
        <form className="campi-fattura" onSubmit={salva}>
          {campo("denominazione", "Ragione sociale", { required: true, maxLength: 80 })}
          {campo("partita_iva", "Partita IVA", { required: true, inputMode: "numeric", pattern: "[0-9 ]{11,13}" })}
          {campo("codice_fiscale", "Codice fiscale (se diverso)", { maxLength: 16 })}
          <label>Regime fiscale
            <select value={d.regime_fiscale} onChange={(e) => setD((x) => ({ ...x, regime_fiscale: e.target.value }))}>
              {Object.entries(REGIMI).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </select>
          </label>
          {campo("indirizzo", "Indirizzo e civico", { required: true, maxLength: 60 })}
          {campo("cap", "CAP", { required: true, inputMode: "numeric", pattern: "[0-9]{5}" })}
          {campo("comune", "Comune", { required: true, maxLength: 60 })}
          {campo("provincia", "Provincia (sigla)", { maxLength: 2 })}
          <div className="campi-fattura-azioni"><button className="btn btn-pieno">Salva dati fiscali</button></div>
        </form>
      )}
    </section>
  );
}

function NuovaFattura(props: { locale: string; conti: ContoChiuso[]; sessione: string | null; onChiudi: () => void; onEmessa: (f: Fattura) => Promise<void> }) {
  const avvisa = useAvviso();
  const [fonte, setFonte] = useState<"conto" | "righe">("conto");
  const [sessione, setSessione] = useState(props.sessione ?? props.conti[0]?.id ?? "");
  const [cliente, setCliente] = useState<Cliente>(CLIENTE_VUOTO);
  const [righe, setRighe] = useState<RigaLibera[]>([{ ...RIGA_VUOTA }]);
  const [attesa, setAttesa] = useState(false);
  const imposta = (k: keyof Cliente, v: string) => setCliente((c) => ({ ...c, [k]: v }));
  const campo = (k: keyof Cliente, etichetta: string, extra: ComponentProps<"input"> = {}) => (
    <label>{etichetta}<input value={cliente[k]} onChange={(e) => imposta(k, e.target.value)} {...extra} /></label>
  );
  const totaleRighe = righe.reduce((n, r) => { try { return n + Number(r.quantita || 0) * (r.prezzo.trim() ? daEuro(r.prezzo) : 0); } catch { return n; } }, 0);

  async function emetti(e: FormEvent) {
    e.preventDefault();
    let righeDb: { descrizione: string; quantita: number; prezzo_cent: number; aliquota: number }[] | null = null;
    if (fonte === "righe") {
      try {
        righeDb = righe.filter((r) => r.descrizione.trim()).map((r) => ({ descrizione: r.descrizione.trim(), quantita: Number(r.quantita), prezzo_cent: daEuro(r.prezzo), aliquota: Number(r.aliquota) }));
      } catch { avvisa("Prezzo non valido in una riga (es. 25,00)", "errore"); return; }
      if (!righeDb.length) { avvisa("Aggiungi almeno una riga", "errore"); return; }
    } else if (!sessione) { avvisa("Scegli il conto da fatturare", "errore"); return; }
    const { tipo, ...dati } = cliente;
    const p_cliente = tipo === "azienda" ? { ...dati, nome: "", cognome: "" } : { ...dati, denominazione: "" };
    setAttesa(true);
    const { data, error } = await sb().rpc("emetti_fattura", { p_locale: props.locale, p_cliente, p_sessione: fonte === "conto" ? sessione : null, p_righe: righeDb });
    setAttesa(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    await props.onEmessa(data as Fattura);
  }

  return (
    <form className="blocco nuova-fattura" onSubmit={emetti}>
      <div className="blocco-testa"><h2>Nuova fattura</h2><button type="button" className="btn" onClick={props.onChiudi}>Annulla</button></div>
      <div className="schede-modo" role="tablist" style={{ maxWidth: 420 }}>
        <button type="button" role="tab" aria-selected={fonte === "conto"} onClick={() => setFonte("conto")}>Da un conto chiuso</button>
        <button type="button" role="tab" aria-selected={fonte === "righe"} onClick={() => setFonte("righe")}>Righe libere</button>
      </div>
      {fonte === "conto" ? (
        props.conti.length === 0 && !props.sessione ? <p className="muto">Nessun conto chiuso negli ultimi 30 giorni ancora da fatturare.</p> : (
          <label className="campo-largo">Conto
            <select value={sessione} onChange={(e) => setSessione(e.target.value)}>
              {props.sessione && !props.conti.some((c) => c.id === props.sessione) && <option value={props.sessione}>Conto appena chiuso</option>}
              {props.conti.map((c) => (
                <option key={c.id} value={c.id}>Tavolo {c.tavoli?.nome ?? "?"} · {new Date(c.chiusa_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })} · {euro(c.totale_cent)}</option>
              ))}
            </select>
          </label>
        )
      ) : (
        <div className="righe-fattura">
          {righe.map((r, i) => (
            <div key={i} className="riga-form">
              <input placeholder="Descrizione (es. Cena aziendale)" maxLength={200} value={r.descrizione} style={{ flex: 1, minWidth: 180 }}
                onChange={(e) => setRighe((x) => x.map((y, j) => (j === i ? { ...y, descrizione: e.target.value } : y)))} aria-label="Descrizione" />
              <input inputMode="numeric" value={r.quantita} style={{ width: 60 }} aria-label="Quantità"
                onChange={(e) => setRighe((x) => x.map((y, j) => (j === i ? { ...y, quantita: e.target.value.replace(/\D/g, "").slice(0, 3) } : y)))} />
              <input inputMode="decimal" placeholder="€ IVA incl." value={r.prezzo} style={{ width: 110 }} aria-label="Prezzo IVA inclusa"
                onChange={(e) => setRighe((x) => x.map((y, j) => (j === i ? { ...y, prezzo: e.target.value } : y)))} />
              <select value={r.aliquota} aria-label="Aliquota IVA" onChange={(e) => setRighe((x) => x.map((y, j) => (j === i ? { ...y, aliquota: e.target.value } : y)))}>
                {["4", "5", "10", "22"].map((a) => <option key={a} value={a}>IVA {a}%</option>)}
              </select>
              {righe.length > 1 && <button type="button" className="btn btn-icona" aria-label="Togli riga" onClick={() => setRighe((x) => x.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
          <div className="riga-form">
            <button type="button" className="btn btn-testo" onClick={() => setRighe((x) => [...x, { ...RIGA_VUOTA }])}>+ Aggiungi riga</button>
            <span className="muto">Totale IVA inclusa: <strong>{euro(totaleRighe)}</strong></span>
          </div>
        </div>
      )}

      <fieldset className="gruppo">
        <legend>Cliente</legend>
        <div className="scelte">
          <button type="button" className={`chip${cliente.tipo === "azienda" ? " attivo" : ""}`} onClick={() => imposta("tipo", "azienda")}>Azienda / professionista</button>
          <button type="button" className={`chip${cliente.tipo === "privato" ? " attivo" : ""}`} onClick={() => imposta("tipo", "privato")}>Privato</button>
        </div>
        <div className="campi-fattura">
          {cliente.tipo === "azienda" ? campo("denominazione", "Ragione sociale", { required: true, maxLength: 80 }) : <>
            {campo("nome", "Nome", { required: true, maxLength: 80 })}
            {campo("cognome", "Cognome", { required: true, maxLength: 80 })}
          </>}
          {campo("partita_iva", "Partita IVA", { inputMode: "numeric", required: cliente.tipo === "azienda" && !cliente.codice_fiscale, maxLength: 13 })}
          {campo("codice_fiscale", "Codice fiscale", { required: cliente.tipo === "privato", maxLength: 16 })}
          {campo("indirizzo", "Indirizzo e civico", { required: true, maxLength: 80 })}
          {campo("cap", "CAP", { required: true, inputMode: "numeric", pattern: "[0-9]{5}" })}
          {campo("comune", "Comune", { required: true, maxLength: 80 })}
          {campo("provincia", "Provincia (sigla)", { maxLength: 2 })}
          {campo("codice_destinatario", "Codice destinatario (SDI)", { maxLength: 7, placeholder: "0000000" })}
          {campo("pec", "PEC (se non c'è il codice)", { type: "email", maxLength: 100 })}
        </div>
        <p className="muto piccolo">I dati del cliente restano solo nella fattura, visibile al titolare: non vengono salvati altrove né sul dispositivo.</p>
      </fieldset>
      <div className="riga-form"><button className="btn btn-pieno" disabled={attesa}>{attesa ? "Emissione…" : "Emetti fattura"}</button></div>
    </form>
  );
}
