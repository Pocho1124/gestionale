import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { Prenotazioni, type Prenotazione } from "../componenti/Prenotazioni";
import { CodaRichieste, PannelloTavolo, suona, type CategoriaBreve, type ComandaStampa, type OrdineSala, type ProdottoBreve, type RichiestaSala } from "../componenti/ServizioSala";
import { Cruscotto } from "../componenti/Cruscotto";
import { Piantina } from "../componenti/Piantina";
import { NuovaSala, PannelloPiantina } from "../componenti/PannelloPiantina";
import { Cartoncini } from "../componenti/Cartoncini";
import { type Elemento, type Sala, type Selezione, type SessioneT, type Tavolo } from "../lib/piantina";

/** Prodotto letto dal database con gruppi e voci, nel formato usato dalla composizione. */
type GrezzoProdotto = Omit<ProdottoBreve, "gruppi" | "aggiunte"> & { gruppi_opzioni: { id: string; nome: string; min_scelte: number; max_scelte: number; posizione: number;
  opzioni: { id: string; nome: string; sovrapprezzo_cent: number; disponibile: boolean; posizione: number }[] }[] };
/** Aggiunte del locale con le categorie su cui sono attive (nessuna categoria = tutte). */
interface GrezzaAggiunta { id: string; nome: string; prezzo_cent: number; disponibile: boolean; posizione: number; aggiunte_categorie: { categoria_id: string }[] }
const daGrezzo = (aggiunte: GrezzaAggiunta[]) => ({ gruppi_opzioni, ...p }: GrezzoProdotto): ProdottoBreve => ({
  ...p,
  aggiunte: aggiunte.filter((a) => a.disponibile && (!a.aggiunte_categorie.length || a.aggiunte_categorie.some((c) => c.categoria_id === p.categoria_id)))
    .sort((a, b) => a.posizione - b.posizione || a.nome.localeCompare(b.nome)).map((a) => ({ id: a.id, nome: a.nome, sovrapprezzo_cent: a.prezzo_cent })),
  gruppi: [...(gruppi_opzioni ?? [])].sort((a, b) => a.posizione - b.posizione).map((g) => ({
    id: g.id, nome: g.nome, min: g.min_scelte, max: g.max_scelte,
    scelte: g.opzioni.filter((o) => o.disponibile).sort((a, b) => a.posizione - b.posizione || a.nome.localeCompare(b.nome))
      .map((o) => ({ id: o.id, nome: o.nome, sovrapprezzo_cent: o.sovrapprezzo_cent })),
  })),
});

export function Sala() {
  const { locale, puoModificare } = useSessione();
  const avvisa = useAvviso();
  const [vista, setVista] = useState<"servizio" | "prenotazioni" | "piantina" | "cartoncini">("servizio");
  const [sale, setSale] = useState<Sala[]>([]);
  const [tavoli, setTavoli] = useState<Tavolo[]>([]);
  const [elementi, setElementi] = useState<Elemento[]>([]);
  const [sessioni, setSessioni] = useState<SessioneT[]>([]);
  const [salaId, setSalaId] = useState<string | null>(null);
  const [selezione, setSelezione] = useState<Selezione>(null);
  const [, setOra] = useState(0);
  const [ordini, setOrdini] = useState<OrdineSala[]>([]);
  const [richieste, setRichieste] = useState<RichiestaSala[]>([]);
  const [prodotti, setProdotti] = useState<ProdottoBreve[]>([]);
  const [categorie, setCategorie] = useState<CategoriaBreve[]>([]);
  const [comande, setComande] = useState<ComandaStampa[]>([]);
  const [prenotati, setPrenotati] = useState<Prenotazione[]>([]);
  const [suoni, setSuoni] = useState(() => { try { return localStorage.getItem("gestionale.suoni") === "1"; } catch { return false; } });
  const noti = useRef<Set<string> | null>(null);

  const carica = useCallback(async () => {
    if (!locale) return;
    const quindiciMinuti = new Date(Date.now() - 15 * 60_000).toISOString();
    const [s, t, x, e, o, r, p, c] = await Promise.all([
      sb().from("sale").select("*").eq("locale_id", locale.id).order("posizione").order("nome"),
      sb().from("tavoli").select("*").eq("locale_id", locale.id).order("nome"),
      sb().from("sessioni_tavolo").select("id, tavolo_id, coperti, codice, aperta_at, codice_errati, coperto_cent, nomi_clienti(nome)").eq("locale_id", locale.id).is("chiusa_at", null),
      sb().from("elementi_sala").select("*").eq("locale_id", locale.id),
      sb().from("ordini").select("id, tavolo_id, sessione_id, stato, origine, nota, motivo, creato_at, righe_ordine(nome, quantita, prezzo_cent, nota, opzioni)")
        .eq("locale_id", locale.id).gte("creato_at", new Date(Date.now() - 24 * 3600_000).toISOString()).order("creato_at", { ascending: false }),
      sb().from("richieste_tavolo").select("id, tavolo_id, righe, nota, creato_at, nomi_clienti(nome)").eq("locale_id", locale.id).eq("stato", "in_attesa").gte("creato_at", quindiciMinuti).order("creato_at"),
      sb().from("prodotti").select("id, nome, prezzo_cent, disponibile, visibile, categoria_id, gruppi_opzioni(id, nome, min_scelte, max_scelte, posizione, opzioni(id, nome, sovrapprezzo_cent, disponibile, posizione))")
        .eq("locale_id", locale.id).order("posizione").order("nome"),
      sb().from("categorie").select("id, nome").eq("locale_id", locale.id).order("posizione").order("nome"),
    ]);
    // Stato di stampa delle comande delle ultime 24 ore (tabella assente prima dell'aggiornamento: si ignora)
    const k = await sb().from("comande_stampa").select("id, ordine_id, stato, tipo, errore, reparti(nome)").eq("locale_id", locale.id)
      .gte("creata_at", new Date(Date.now() - 24 * 3600_000).toISOString());
    if (!k.error) setComande(k.data as unknown as ComandaStampa[]);
    // Prenotazioni di oggi ancora in attesa con il tavolo assegnato (da 3 ore fa a fine giornata)
    const fine = new Date(); fine.setHours(24, 0, 0, 0);
    const pr = await sb().from("prenotazioni").select("id, tavolo_id, nome, telefono, persone, data_ora, durata_min, note, stato").eq("locale_id", locale.id)
      .eq("stato", "attiva").not("tavolo_id", "is", null).gte("data_ora", new Date(Date.now() - 3 * 3600_000).toISOString()).lt("data_ora", fine.toISOString()).order("data_ora");
    if (!pr.error) setPrenotati(pr.data as Prenotazione[]);
    // Aggiunte (tabella assente prima dell'aggiornamento del database: si ignora)
    const ag = await sb().from("aggiunte").select("id, nome, prezzo_cent, disponibile, posizione, aggiunte_categorie(categoria_id)").eq("locale_id", locale.id);
    const aggiunte = ag.error ? [] : (ag.data as unknown as GrezzaAggiunta[]);
    const errore = s.error ?? t.error ?? x.error ?? e.error ?? o.error ?? r.error ?? p.error ?? c.error;
    if (errore) { avvisa(messaggioErrore(errore), "errore"); return; }
    setSale(s.data as Sala[]); setTavoli(t.data as Tavolo[]); setSessioni(x.data as SessioneT[]); setElementi(e.data as Elemento[]);
    setOrdini(o.data as unknown as OrdineSala[]); setProdotti((p.data as unknown as GrezzoProdotto[]).map(daGrezzo(aggiunte))); setCategorie(c.data as CategoriaBreve[]);
    const nuoveRichieste = r.data as unknown as RichiestaSala[];
    setRichieste(nuoveRichieste);
    // Suono per richieste e ordini da confermare arrivati dopo il primo caricamento
    const inAttesa = [...nuoveRichieste.map((z) => z.id), ...(o.data as unknown as OrdineSala[]).filter((z) => z.stato === "da_confermare").map((z) => z.id)];
    if (noti.current && inAttesa.some((id) => !noti.current!.has(id)) && localStorage.getItem("gestionale.suoni") === "1") suona();
    noti.current = new Set(inAttesa);
    setSalaId((cur) => cur && (s.data as Sala[]).some((z) => z.id === cur) ? cur : (s.data as Sala[])[0]?.id ?? null);
  }, [locale, avvisa]);

  useEffect(() => { void carica(); }, [carica]);

  // Tempo reale: aperture e chiusure fatte da altri tablet compaiono subito
  useEffect(() => {
    if (!locale) return;
    const canale = sb().channel(`sala-${locale.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessioni_tavolo", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .on("postgres_changes", { event: "*", schema: "public", table: "prenotazioni", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .on("postgres_changes", { event: "*", schema: "public", table: "tavoli", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .on("postgres_changes", { event: "*", schema: "public", table: "ordini", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .on("postgres_changes", { event: "*", schema: "public", table: "richieste_tavolo", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .on("postgres_changes", { event: "*", schema: "public", table: "comande_stampa", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .subscribe();
    // Orologio dei tavoli e rete di sicurezza se il tempo reale si interrompe
    const t = setInterval(() => { setOra((n) => n + 1); void carica(); }, 20_000);
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [locale, carica]);

  const tavoliSala = tavoli.filter((t) => t.sala_id === salaId && (vista !== "servizio" || t.attivo));
  const sessionePer = (id: string) => sessioni.find((s) => s.tavolo_id === id);
  const primaPrenotazione = useMemo(() => {
    const m = new Map<string, Prenotazione>();
    for (const p of prenotati) if (p.tavolo_id && !m.has(p.tavolo_id)) m.set(p.tavolo_id, p);
    return m;
  }, [prenotati]);
  const tavoloSel = selezione?.tipo === "tavolo" ? tavoli.find((t) => t.id === selezione.id) ?? null : null;
  const elementoSel = selezione?.tipo === "elemento" ? elementi.find((x) => x.id === selezione.id) ?? null : null;
  const salaCorrente = sale.find((s) => s.id === salaId);
  const conto = useCallback((sessione: string) => ordini.filter((o) => o.sessione_id === sessione && !["rifiutato", "annullato"].includes(o.stato))
    .reduce((n, o) => n + o.righe_ordine.reduce((m, r) => m + r.quantita * r.prezzo_cent, 0), 0)
    + ((s) => (s ? s.coperti * (s.coperto_cent ?? 0) : 0))(sessioni.find((z) => z.id === sessione)), [ordini, sessioni]);

  // Modalità monitor: sala a schermo intero (Esc per uscire)
  const monitor = useRef<HTMLDivElement>(null);
  const [schermoIntero, setSchermoIntero] = useState(false);
  useEffect(() => {
    const cambia = () => setSchermoIntero(document.fullscreenElement === monitor.current && !!monitor.current);
    document.addEventListener("fullscreenchange", cambia);
    return () => document.removeEventListener("fullscreenchange", cambia);
  }, []);

  if (!locale) return null;
  return (
    <div className="pagina pagina-sala">
      <div className="pagina-testa riga-form" style={{ justifyContent: "space-between" }}>
        <h1>Sala</h1>
        <button className={`btn btn-piccolo${suoni ? " btn-pieno" : ""}`} onClick={() => {
          const v = !suoni; setSuoni(v); try { localStorage.setItem("gestionale.suoni", v ? "1" : "0"); } catch { /* memoria non disponibile */ }
          if (v) suona();
        }}>{suoni ? "🔔 Avvisi sonori attivi" : "🔕 Attiva avvisi sonori"}</button>
        {vista === "servizio" && document.fullscreenEnabled && (
          <button className="btn btn-piccolo" onClick={() => void monitor.current?.requestFullscreen().catch(() => avvisa("Schermo intero non disponibile", "errore"))}>
            ⛶ Modalità monitor
          </button>
        )}
        <div className="schede-modo" role="tablist" style={{ maxWidth: 460 }}>
          <button role="tab" aria-selected={vista === "servizio"} onClick={() => setVista("servizio")}>Servizio</button>
          <button role="tab" aria-selected={vista === "prenotazioni"} onClick={() => setVista("prenotazioni")}>Prenotazioni{prenotati.length ? ` (${prenotati.length})` : ""}</button>
          {puoModificare && <button role="tab" aria-selected={vista === "piantina"} onClick={() => setVista("piantina")}>Piantina</button>}
          {puoModificare && <button role="tab" aria-selected={vista === "cartoncini"} onClick={() => setVista("cartoncini")}>Cartoncini QR</button>}
        </div>
      </div>

      <div ref={monitor} className={`sala-monitor${schermoIntero ? " attivo" : ""}`}>
      {vista === "servizio" && (
        <Cruscotto tavoli={tavoli.filter((t) => t.attivo)} sessioni={sessioni} ordini={ordini} conto={conto} monitor={schermoIntero}
          onEsci={() => void document.exitFullscreen()} />
      )}
      {vista === "servizio" && (
        <CodaRichieste richieste={richieste} ordini={ordini} tavoli={tavoli} prodotti={new Map(prodotti.map((p) => [p.id, p]))}
          aperto={(id) => !!sessionePer(id)} onFatto={carica}
          onCodice={(tavolo) => { setSelezione({ tipo: "tavolo", id: tavolo }); const t = tavoli.find((z) => z.id === tavolo); if (t) setSalaId(t.sala_id); }} />
      )}

      {vista !== "cartoncini" && vista !== "prenotazioni" && (
        sale.length === 0 ? (
          <div className="vuoto">
            <p>Non ci sono ancora sale.</p>
            {puoModificare ? <p className="muto">Vai su «Piantina» e crea la prima sala, ad esempio «Interno».</p> : <p className="muto">Chiedi al titolare di disegnare la piantina.</p>}
            {puoModificare && vista === "piantina" && <NuovaSala locale={locale.id} onFatto={carica} />}
          </div>
        ) : (
          <>
            <div className="riga-form">
              {sale.map((s) => <button key={s.id} className={`chip${s.id === salaId ? " attivo" : ""}`} onClick={() => { setSalaId(s.id); setSelezione(null); }}>{s.nome}</button>)}
              {vista === "servizio" && <span className="muto piccolo">Aperti: {sessioni.length} · Coperti: {sessioni.reduce((n, s) => n + s.coperti, 0)}</span>}
              {vista === "servizio" && (
                <span className="legenda">
                  <span><i className="pallino stato-libero" />Libero</span><span><i className="pallino stato-aperto" />Aperto</span>
                  <span><i className="pallino stato-medio" />Oltre 1 h</span><span><i className="pallino stato-lungo" />Oltre 2 h</span>
                  <span><i className="pallino stato-prenotato" />Prenotato</span>
                </span>
              )}
            </div>
            <div className={`sala-layout${vista === "piantina" ? " modifica" : ""}`}>
              <Piantina sala={salaCorrente} tavoli={tavoliSala} elementi={elementi.filter((x) => x.sala_id === salaId)}
                inAttesa={new Set([...richieste.map((r) => r.tavolo_id), ...ordini.filter((o) => o.stato === "da_confermare").map((o) => o.tavolo_id)])}
                prenotate={vista === "servizio" ? primaPrenotazione : undefined}
                sessionePer={sessionePer} conto={vista === "servizio" ? conto : undefined} modificabile={vista === "piantina"} selezione={selezione} onSeleziona={setSelezione}
                onTavolo={async (t, patch) => {
                  setTavoli((ts) => ts.map((z) => (z.id === t.id ? { ...z, ...patch } : z)));
                  const { error } = await sb().from("tavoli").update(patch).eq("id", t.id);
                  if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); }
                }}
                onElemento={async (x, patch) => {
                  setElementi((es) => es.map((z) => (z.id === x.id ? { ...z, ...patch } : z)));
                  const { error } = await sb().from("elementi_sala").update(patch).eq("id", x.id);
                  if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); }
                }} />
              <aside className="sala-pannello">
                {vista === "servizio"
                  ? <PannelloTavolo tavolo={tavoloSel} sessione={tavoloSel ? sessionePer(tavoloSel.id) : undefined} ordini={ordini}
                      prodotti={prodotti} categorie={categorie} comande={comande} onFatto={carica}
                      tavoli={tavoli.filter((t) => t.attivo)} aperti={new Set(sessioni.map((z) => z.tavolo_id))}
                      prenotazione={tavoloSel ? primaPrenotazione.get(tavoloSel.id) : undefined} />
                  : <PannelloPiantina locale={locale.id} sala={salaCorrente!} tavolo={tavoloSel} elemento={elementoSel} tavoli={tavoli}
                      onFatto={carica} onSeleziona={setSelezione} />}
              </aside>
            </div>
          </>
        )
      )}

      </div>

      {vista === "prenotazioni" && <Prenotazioni locale={locale.id} tavoli={tavoli.filter((t) => t.attivo)} onFatto={carica} />}
      {vista === "cartoncini" && <Cartoncini locale={locale} tavoli={tavoli.filter((t) => t.attivo)} sale={sale} />}
    </div>
  );
}
