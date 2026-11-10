import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as PE } from "react";
import QRCode from "qrcode";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import type { Aspetto } from "../lib/tipi";
import { preparaImmagine } from "../lib/immagini";
import { caricaImmagine, eliminaImmagine, sorgenteImmagine } from "../lib/archivio";
import { CodaRichieste, PannelloTavolo, suona, type CategoriaBreve, type ComandaStampa, type OrdineSala, type ProdottoBreve, type RichiestaSala } from "../componenti/ServizioSala";

interface Sala { id: string; locale_id: string; nome: string; posizione: number; larghezza_m: number; profondita_m: number; sfondo_dati: string | null; sfondo_path: string | null; sfondo_opacita: number; pavimento: Pavimento }
type Pavimento = "parquet" | "cotto" | "marmo" | "cemento" | "nessuno";
interface Tavolo { id: string; locale_id: string; sala_id: string; nome: string; posti: number; forma: "tondo" | "quadrato" | "rettangolo"; x: number; y: number; rotazione: number; qr_token: string; attivo: boolean }
type TipoElemento = "muro" | "bancone" | "porta" | "finestra" | "colonna" | "pianta" | "zona" | "testo" | "cassa" | "bagni"
  | "botte" | "scaffale" | "divano" | "poltrona" | "sgabello" | "tappeto" | "camino" | "scala" | "cucina" | "vetrina" | "fioriera";
/** Lato trascinato per ridimensionare: il lato opposto resta fermo. */
type Lato = "sinistra" | "destra" | "sopra" | "sotto";
interface Elemento { id: string; locale_id: string; sala_id: string; tipo: TipoElemento; x: number; y: number; w: number; h: number; rotazione: number; etichetta: string }
type Selezione = { tipo: "tavolo" | "elemento"; id: string } | null;
interface SessioneT { id: string; tavolo_id: string; coperti: number; codice: string; aperta_at: string; codice_errati?: number; coperto_cent?: number; nomi_clienti?: { nome: string }[] }
interface Wifi { locale_id?: string; ssid: string; sicurezza: "WPA" | "WEP" | "nopass"; password: string; nascosta: boolean; url_ordini: string }

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

const W = 1000;
/** Altezza della piantina in punti, proporzionale alle misure reali della sala. */
const altezza = (s?: Sala) => Math.round(Math.min(2000, Math.max(300, W * ((s?.profondita_m ?? 8) / (s?.larghezza_m ?? 12)))));
const scatto = (v: number) => Math.round(v / 10) * 10;

/** Elementi d'arredo: etichetta nella barra, misure iniziali, testo predefinito. */
const ARREDI: Record<TipoElemento, { nome: string; w: number; h: number; etichetta?: string }> = {
  muro: { nome: "Muro", w: 300, h: 12 }, bancone: { nome: "Bancone", w: 260, h: 60, etichetta: "Bancone" },
  porta: { nome: "Porta", w: 80, h: 12 }, finestra: { nome: "Finestra", w: 120, h: 10 },
  colonna: { nome: "Colonna", w: 40, h: 40 }, pianta: { nome: "Pianta", w: 40, h: 40 },
  zona: { nome: "Zona", w: 300, h: 200, etichetta: "Dehors" }, testo: { nome: "Scritta", w: 160, h: 40, etichetta: "Ingresso" },
  cassa: { nome: "Cassa", w: 90, h: 50, etichetta: "Cassa" }, bagni: { nome: "Bagni", w: 90, h: 70, etichetta: "WC" },
  botte: { nome: "Botte", w: 54, h: 54 }, scaffale: { nome: "Bottigliera", w: 220, h: 32, etichetta: "" },
  divano: { nome: "Divano", w: 170, h: 64 }, poltrona: { nome: "Poltrona", w: 62, h: 62 }, sgabello: { nome: "Sgabello", w: 26, h: 26 },
  tappeto: { nome: "Tappeto", w: 240, h: 150 }, camino: { nome: "Camino", w: 130, h: 42 }, scala: { nome: "Scala", w: 90, h: 170 },
  cucina: { nome: "Cucina", w: 240, h: 120, etichetta: "Cucina" }, vetrina: { nome: "Vetrina", w: 150, h: 50, etichetta: "" },
  fioriera: { nome: "Fioriera", w: 170, h: 30 },
};
/** Elementi sottili (muri, porte, finestre): si allungano dai due capi, lo spessore si cambia dal pannello. */
const SOTTILI = new Set<TipoElemento>(["muro", "porta", "finestra"]);
/** Elementi a terra, disegnati sotto tutto il resto. */
const A_TERRA = new Set<TipoElemento>(["zona", "tappeto"]);
const LATI: Lato[] = ["sinistra", "destra", "sopra", "sotto"];
/** Distanza in più delle maniglie dal bordo quando l'elemento è sottile: così le due maniglie opposte non si sovrappongono. */
const stacco = (meta: number) => Math.max(0, 18 - meta);
const dimensioni = (t: Tavolo) => {
  const base = 34 + Math.min(t.posti, 12) * 3;
  return t.forma === "rettangolo" ? { w: base * 1.8, h: base } : { w: base, h: base };
};
/** Posizioni delle sedie attorno al tavolo (coordinate rispetto al centro, già ruotate con il tavolo). */
function sedie(t: Tavolo, w: number, h: number): { x: number; y: number; a: number }[] {
  const n = Math.min(t.posti, 16), dist = 13, out: { x: number; y: number; a: number }[] = [];
  if (t.forma === "tondo") {
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI - Math.PI / 2; out.push({ x: Math.cos(a) * (w / 2 + dist), y: Math.sin(a) * (w / 2 + dist), a: (a * 180) / Math.PI + 90 }); }
    return out;
  }
  // Prima i lati lunghi, poi le testate se i posti avanzano
  const testate = t.forma === "rettangolo" ? (n > 6 ? 2 : 0) : (n > 4 ? 2 : 0);
  const lati = n - testate, sopra = Math.ceil(lati / 2), sotto = lati - sopra;
  const fila = (k: number, y: number, a: number) => { for (let i = 0; i < k; i++) out.push({ x: -w / 2 + (w * (i + 0.5)) / k, y, a }); };
  fila(sopra, -h / 2 - dist, 0); fila(sotto, h / 2 + dist, 180);
  if (testate) { out.push({ x: -w / 2 - dist, y: 0, a: 270 }, { x: w / 2 + dist, y: 0, a: 90 }); }
  return out;
}
/** Colore dello stato: libero, aperto da poco, da più di un'ora, da più di due. */
const stato = (s?: SessioneT) => !s ? "libero" : minuti(s.aperta_at) >= 120 ? "lungo" : minuti(s.aperta_at) >= 60 ? "medio" : "aperto";

const minuti = (da: string) => Math.max(0, Math.round((Date.now() - new Date(da).getTime()) / 60000));
const durata = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
/** Versione corta per i tavoli piccoli: «25'», «1h15». */
const durataBreve = (m: number) => (m < 60 ? `${m}'` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);

export function Sala() {
  const { locale, puoModificare } = useSessione();
  const avvisa = useAvviso();
  const [vista, setVista] = useState<"servizio" | "piantina" | "cartoncini">("servizio");
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

      {vista !== "cartoncini" && (
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
                </span>
              )}
            </div>
            <div className={`sala-layout${vista === "piantina" ? " modifica" : ""}`}>
              <Piantina sala={salaCorrente} tavoli={tavoliSala} elementi={elementi.filter((x) => x.sala_id === salaId)}
                inAttesa={new Set([...richieste.map((r) => r.tavolo_id), ...ordini.filter((o) => o.stato === "da_confermare").map((o) => o.tavolo_id)])}
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
                      tavoli={tavoli.filter((t) => t.attivo)} aperti={new Set(sessioni.map((z) => z.tavolo_id))} />
                  : <PannelloPiantina locale={locale.id} sala={salaCorrente!} tavolo={tavoloSel} elemento={elementoSel} tavoli={tavoli}
                      onFatto={carica} onSeleziona={setSelezione} />}
              </aside>
            </div>
          </>
        )
      )}

      </div>

      {vista === "cartoncini" && <Cartoncini locale={locale} tavoli={tavoli.filter((t) => t.attivo)} sale={sale} />}
    </div>
  );
}

/** Cruscotto della sala: occupazione, coperti, incasso in corso, cucina. Si aggiorna con il tempo reale. */
function Cruscotto(props: { tavoli: Tavolo[]; sessioni: SessioneT[]; ordini: OrdineSala[]; conto: (s: string) => number; monitor: boolean; onEsci: () => void }) {
  const aperti = new Set(props.sessioni.map((s) => s.tavolo_id));
  const occupati = props.tavoli.filter((t) => aperti.has(t.id)).length;
  const coperti = props.sessioni.reduce((n, s) => n + s.coperti, 0);
  const inSala = props.sessioni.reduce((n, s) => n + props.conto(s.id), 0);
  const permanenza = props.sessioni.length ? Math.round(props.sessioni.reduce((n, s) => n + minuti(s.aperta_at), 0) / props.sessioni.length) : 0;
  const sessioniAperte = new Set(props.sessioni.map((s) => s.id));
  const delServizio = props.ordini.filter((o) => sessioniAperte.has(o.sessione_id));
  const inCucina = delServizio.filter((o) => o.stato === "confermato" || o.stato === "in_preparazione").length;
  const pronti = delServizio.filter((o) => o.stato === "pronto").length;
  const percentuale = props.tavoli.length ? Math.round((occupati / props.tavoli.length) * 100) : 0;
  const euro = (c: number) => `${(c / 100).toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`;
  return (
    <div className="cruscotto" aria-label="Riepilogo della sala">
      <div className="cruscotto-voce">
        <span>Tavoli occupati</span><strong>{occupati}<small> / {props.tavoli.length}</small></strong>
        <div className="cruscotto-barra" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentuale} aria-label="Occupazione"><i style={{ width: `${percentuale}%` }} /></div>
      </div>
      <div className="cruscotto-voce"><span>Coperti</span><strong>{coperti}</strong><small>{permanenza ? `permanenza media ${durata(permanenza)}` : "sala vuota"}</small></div>
      <div className="cruscotto-voce"><span>In sala</span><strong>{euro(inSala)}</strong><small>{coperti ? `${euro(inSala / coperti)} a coperto` : "nessun conto aperto"}</small></div>
      <div className="cruscotto-voce"><span>In cucina</span><strong>{inCucina}</strong><small>{inCucina === 1 ? "ordine in lavorazione" : "ordini in lavorazione"}</small></div>
      <div className={`cruscotto-voce${pronti ? " evidenza" : ""}`}><span>Pronti da servire</span><strong>{pronti ? `🛎️ ${pronti}` : "0"}</strong><small>{pronti ? "portali al tavolo" : "tutto servito"}</small></div>
      {props.monitor && (
        <div className="cruscotto-voce cruscotto-ora">
          <span>{new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</span>
          <strong>{new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</strong>
          <button className="link" onClick={props.onEsci}>Esci dal monitor</button>
        </div>
      )}
    </div>
  );
}

export function Piantina(props: {
  sala?: Sala; inAttesa?: Set<string>; conto?: (sessione: string) => number; tavoli: Tavolo[]; elementi: Elemento[]; sessionePer: (id: string) => SessioneT | undefined; modificabile: boolean;
  selezione: Selezione; onSeleziona: (s: Selezione) => void;
  onTavolo: (t: Tavolo, patch: Partial<Tavolo>) => void; onElemento: (e: Elemento, patch: Partial<Elemento>) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const H = altezza(props.sala);
  // Trascinamento o ridimensionamento in corso: posizione/misure provvisorie, salvate al rilascio
  const [azione, setAzione] = useState<{ modo: "sposta" | "ridimensiona"; lato?: Lato; tipo: "tavolo" | "elemento"; id: string; x: number; y: number; w?: number; h?: number } | null>(null);
  const punto = (e: PE) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) };
  };
  const selez = (tipo: "tavolo" | "elemento", id: string) => props.selezione?.tipo === tipo && props.selezione.id === id;

  function muovi(e: PE) {
    if (!azione) return;
    const p = punto(e);
    if (azione.modo === "sposta") { setAzione({ ...azione, x: scatto(p.x), y: scatto(p.y) }); return; }
    const el = props.elementi.find((z) => z.id === azione.id); if (!el) return;
    // Ridimensiona nel sistema dell'elemento (tiene conto della rotazione): si sposta solo il lato trascinato
    const a = (el.rotazione * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), dx = p.x - el.x, dy = p.y - el.y;
    // La maniglia di un lato sottile è staccata dal bordo: si toglie lo stacco, così l'elemento non salta alla presa
    const ox = stacco(el.w / 2), oy = stacco(el.h / 2);
    const lx0 = dx * cos + dy * sin, ly0 = -dx * sin + dy * cos;
    const lx = lx0 > 0 ? lx0 - ox : lx0 + ox, ly = ly0 > 0 ? ly0 - oy : ly0 + oy;
    let w = el.w, h = el.h, sx = 0, sy = 0;   // nuove misure e spostamento del centro (coordinate dell'elemento)
    if (azione.lato === "destra") { w = Math.min(1000, Math.max(10, scatto(lx + el.w / 2))); sx = (w - el.w) / 2; }
    if (azione.lato === "sinistra") { w = Math.min(1000, Math.max(10, scatto(el.w / 2 - lx))); sx = -(w - el.w) / 2; }
    if (azione.lato === "sotto") { h = Math.min(2000, Math.max(4, scatto(ly + el.h / 2))); sy = (h - el.h) / 2; }
    if (azione.lato === "sopra") { h = Math.min(2000, Math.max(4, scatto(el.h / 2 - ly))); sy = -(h - el.h) / 2; }
    const x = Math.round(Math.min(W, Math.max(0, el.x + sx * cos - sy * sin)));
    const y = Math.round(Math.min(H, Math.max(0, el.y + sx * sin + sy * cos)));
    setAzione({ ...azione, x, y, w, h });
  }
  function rilascia() {
    if (!azione) return;
    if (azione.tipo === "tavolo") {
      const t = props.tavoli.find((z) => z.id === azione.id);
      if (t && (t.x !== azione.x || t.y !== azione.y)) props.onTavolo(t, { x: azione.x, y: azione.y });
    } else {
      const el = props.elementi.find((z) => z.id === azione.id);
      if (el && azione.modo === "sposta" && (el.x !== azione.x || el.y !== azione.y)) props.onElemento(el, { x: azione.x, y: azione.y });
      if (el && azione.modo === "ridimensiona" && azione.w && azione.h && (azione.w !== el.w || azione.h !== el.h))
        props.onElemento(el, { x: azione.x, y: azione.y, w: azione.w, h: azione.h });
    }
    setAzione(null);
  }
  const inizia = (e: PE, modo: "sposta" | "ridimensiona", tipo: "tavolo" | "elemento", z: { id: string; x: number; y: number }, lato?: Lato) => {
    if (!props.modificabile) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    props.onSeleziona({ tipo, id: z.id });
    setAzione({ modo, lato, tipo, id: z.id, x: z.x, y: z.y });
  };

  return (
    <svg ref={svg} className="piantina" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Piantina della sala" style={{ "--rapporto": W / H } as CSSProperties}
      onPointerMove={muovi} onPointerUp={rilascia} onPointerCancel={() => setAzione(null)}
      onPointerDown={() => { if (props.modificabile) props.onSeleziona(null); }}>
      <defs>
        <pattern id="griglia" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" className="griglia" /></pattern>
        {/* Parquet a listoni sfalsati con venature e fughe */}
        <pattern id="pav-parquet" width="240" height="40" patternUnits="userSpaceOnUse">
          <rect width="240" height="20" fill="#C99A62" /><rect y="20" width="240" height="20" fill="#BF8F58" />
          <rect width="90" height="20" fill="#D0A36C" /><rect x="150" width="90" height="20" fill="#C4955D" />
          <rect x="40" y="20" width="110" height="20" fill="#CA9C65" /><rect x="200" y="20" width="40" height="20" fill="#C69860" />
          <path d="M0 5C50 3 110 8 240 4M0 13C70 15 150 11 240 14M0 26C60 24 140 29 240 25M0 34C90 37 170 32 240 35" stroke="#9E6F3E" strokeWidth=".7" fill="none" opacity=".35" />
          <path d="M18 9c6-2 10 2 16 0M120 30c5-2 9 1 14-1" stroke="#8A5E31" strokeWidth=".8" fill="none" opacity=".4" />
          <path d="M0 20H240M0 40H240M90 0V20M150 0V20M40 20V40M150 20V40M200 20V40" stroke="#7E5630" strokeWidth="1" opacity=".55" />
          <path d="M0 .6H240M0 20.6H240" stroke="#F0D2A2" strokeWidth=".8" opacity=".45" />
        </pattern>
        <pattern id="pav-cotto" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect width="44" height="44" fill="#D9C7B0" /><rect x="1.5" y="1.5" width="41" height="41" rx="2" fill="#C2734D" />
          <rect x="1.5" y="1.5" width="41" height="41" rx="2" fill="url(#cotto-sfumato)" /><circle cx="12" cy="30" r="1.2" fill="#A85E3C" opacity=".6" />
        </pattern>
        <radialGradient id="cotto-sfumato" cx=".3" cy=".25" r=".9"><stop offset="0" stopColor="#D88C64" stopOpacity=".7" /><stop offset="1" stopColor="#A85A38" stopOpacity=".5" /></radialGradient>
        <pattern id="pav-marmo" width="200" height="200" patternUnits="userSpaceOnUse">
          <rect width="200" height="200" fill="#F2EFEA" /><path d="M0 60C50 40 80 90 140 70S200 90 200 90M30 200C60 150 120 170 170 120M110 0C100 30 130 50 120 80" stroke="#CFC7BB" strokeWidth="1.6" fill="none" opacity=".8" />
          <path d="M0 62C50 44 80 92 140 72" stroke="#B9B0A2" strokeWidth=".6" fill="none" /><path d="M100 0V200M0 100H200" stroke="#E0DAD1" strokeWidth="1.5" />
        </pattern>
        <pattern id="pav-cemento" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#C9C6C0" /><circle cx="12" cy="18" r="1.2" fill="#B3AFA8" /><circle cx="44" cy="40" r="1" fill="#B3AFA8" /><circle cx="30" cy="8" r=".8" fill="#DEDCD8" /><circle cx="50" cy="12" r="1.4" fill="#BDB9B2" />
        </pattern>
        <pattern id="piastrelle" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#B9D3DE" /><rect x=".7" y=".7" width="14.6" height="14.6" rx="1" fill="#D3E5EC" />
        </pattern>
        {/* Luce: vignettatura ai bordi, luce calda dall'alto a sinistra, lampade sopra i tavoli */}
        <radialGradient id="vignetta" cx=".5" cy=".45" r=".78"><stop offset=".55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#1A0E04" stopOpacity=".38" /></radialGradient>
        <linearGradient id="luce-ambiente" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF1D0" stopOpacity=".28" /><stop offset=".55" stopColor="#FFF1D0" stopOpacity="0" /></linearGradient>
        <radialGradient id="lampada"><stop offset="0" stopColor="#FFE6B0" stopOpacity=".9" /><stop offset=".45" stopColor="#FFD488" stopOpacity=".38" /><stop offset="1" stopColor="#FFD488" stopOpacity="0" /></radialGradient>
        <radialGradient id="tovaglia" cx=".38" cy=".3" r=".95"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".7" stopColor="#F7F2E9" /><stop offset="1" stopColor="#E6DCCB" /></radialGradient>
        <radialGradient id="seduta" cx=".4" cy=".35" r=".8"><stop offset="0" stopColor="#9B7350" /><stop offset="1" stopColor="#5E3F27" /></radialGradient>
        <linearGradient id="legno" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9A6533" /><stop offset=".5" stopColor="#7A4A22" /><stop offset="1" stopColor="#5C3516" /></linearGradient>
        <linearGradient id="granito" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4B4643" /><stop offset=".45" stopColor="#2F2B29" /><stop offset=".5" stopColor="#5A5552" /><stop offset=".55" stopColor="#2F2B29" /><stop offset="1" stopColor="#1F1C1A" /></linearGradient>
        <linearGradient id="muro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#56504A" /><stop offset="1" stopColor="#2A2622" /></linearGradient>
        <linearGradient id="vetro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#DFF2FB" /><stop offset=".5" stopColor="#A9D4EA" /><stop offset="1" stopColor="#CFEAF6" /></linearGradient>
        <linearGradient id="luce-finestra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF6D8" stopOpacity=".55" /><stop offset="1" stopColor="#FFF6D8" stopOpacity="0" /></linearGradient>
        <linearGradient id="marmo-colonna" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F4F1EC" /><stop offset=".6" stopColor="#D8D2C8" /><stop offset="1" stopColor="#BDB5A9" /></linearGradient>
        <radialGradient id="terracotta" cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#D27A4A" /><stop offset="1" stopColor="#8A4322" /></radialGradient>
        <radialGradient id="foglia" cx=".5" cy=".2" r=".9"><stop offset="0" stopColor="#7FC46F" /><stop offset="1" stopColor="#2E6E2A" /></radialGradient>
        <linearGradient id="metallo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4A4D52" /><stop offset="1" stopColor="#222427" /></linearGradient>
        <linearGradient id="schermo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5FD0FF" /><stop offset="1" stopColor="#1C6E9C" /></linearGradient>
        <radialGradient id="botte" cx=".4" cy=".35" r=".8"><stop offset="0" stopColor="#B07A45" /><stop offset="1" stopColor="#6E4120" /></radialGradient>
        <linearGradient id="tessuto" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#97A884" /><stop offset="1" stopColor="#6E7F5E" /></linearGradient>
        <pattern id="trama" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#8E2E3A" /><path d="M7 1L13 7L7 13L1 7Z" fill="none" stroke="#D9B45A" strokeWidth=".8" opacity=".7" /></pattern>
        <linearGradient id="pietra" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#B4ACA0" /><stop offset="1" stopColor="#7E766B" /></linearGradient>
        <radialGradient id="fuoco" cx=".5" cy=".8" r=".8"><stop offset="0" stopColor="#FFF1A8" /><stop offset=".35" stopColor="#FFB43C" /><stop offset=".75" stopColor="#E8501C" stopOpacity=".9" /><stop offset="1" stopColor="#8A1E0A" stopOpacity="0" /></radialGradient>
        <linearGradient id="acciaio" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E6E9EC" /><stop offset=".5" stopColor="#B9BFC5" /><stop offset="1" stopColor="#D5D9DD" /></linearGradient>
        <filter id="ombra" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="6" stdDeviation="5" floodColor="#2A1606" floodOpacity=".38" /></filter>
        <filter id="ombra-lieve" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="1" dy="2" stdDeviation="1.6" floodColor="#2A1606" floodOpacity=".4" /></filter>
        <filter id="ombra-muro" x="-10%" y="-60%" width="120%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="3.5" floodColor="#000" floodOpacity=".45" /></filter>
        <filter id="sfoca" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <rect width={W} height={H} fill={props.sala && props.sala.pavimento !== "nessuno" ? `url(#pav-${props.sala.pavimento})` : "transparent"} />
      {props.sala && sorgenteImmagine(props.sala.sfondo_path, props.sala.sfondo_dati) && <image href={sorgenteImmagine(props.sala.sfondo_path, props.sala.sfondo_dati)!} width={W} height={H} preserveAspectRatio="xMidYMid meet" opacity={props.sala.sfondo_opacita / 100} />}
      <rect width={W} height={H} fill="url(#luce-ambiente)" pointerEvents="none" />
      {props.modificabile && <rect width={W} height={H} fill="url(#griglia)" pointerEvents="none" />}

      {[...props.elementi].sort((a, b) => Number(A_TERRA.has(b.tipo)) - Number(A_TERRA.has(a.tipo))).map((el) => {
        const pos = azione?.tipo === "elemento" && azione.id === el.id ? { ...el, x: azione.x, y: azione.y, w: azione.w ?? el.w, h: azione.h ?? el.h } : el;
        return (
          <g key={el.id} transform={`translate(${pos.x} ${pos.y}) rotate(${el.rotazione})`}
            className={`arredo arredo-${el.tipo}${selez("elemento", el.id) ? " selezionato" : ""}${props.modificabile ? "" : " fisso"}`}
            onPointerDown={(e) => inizia(e, "sposta", "elemento", el)}>
            <Arredo tipo={el.tipo} w={pos.w} h={pos.h} etichetta={el.etichetta} />
            {/* Una maniglia per lato: trascinandola si allunga solo da quella parte */}
            {props.modificabile && selez("elemento", el.id) && LATI.map((l) => {
              const mx = pos.w / 2 + stacco(pos.w / 2), my = pos.h / 2 + stacco(pos.h / 2);
              const cx = l === "sinistra" ? -mx : l === "destra" ? mx : 0, cy = l === "sopra" ? -my : l === "sotto" ? my : 0;
              return (
                <g key={l} className={`maniglia maniglia-${l === "sinistra" || l === "destra" ? "orizzontale" : "verticale"}`}
                  onPointerDown={(e) => inizia(e, "ridimensiona", "elemento", el, l)}>
                  <circle cx={cx} cy={cy} r={14} className="maniglia-presa" />
                  <circle cx={cx} cy={cy} r={8} className="maniglia-punto" />
                </g>
              );
            })}
          </g>
        );
      })}

      {props.tavoli.map((t) => {
        const s = props.sessionePer(t.id);
        const { w, h } = dimensioni(t);
        const pos = azione?.tipo === "tavolo" && azione.id === t.id ? azione : t;
        return (
          <g key={t.id} transform={`translate(${pos.x} ${pos.y})`} className={`tavolo${s ? " aperto" : ""}${selez("tavolo", t.id) ? " selezionato" : ""}${t.attivo ? "" : " spento"}`}
            tabIndex={0} role="button" aria-label={`Tavolo ${t.nome}${s ? ", aperto" : ", libero"}`}
            onClick={(e) => { e.stopPropagation(); props.onSeleziona({ tipo: "tavolo", id: t.id }); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onSeleziona({ tipo: "tavolo", id: t.id }); }}
            onPointerDown={(e) => { if (props.modificabile) inizia(e, "sposta", "tavolo", t); else e.stopPropagation(); }}>
            <circle r={Math.max(w, h) * 0.95} fill="url(#lampada)" className="luce-tavolo" />
            <g transform={`rotate(${t.rotazione})`} className={`tavolo-corpo stato-${stato(s)}`}>
              {s && (t.forma === "tondo"
                ? <circle r={w / 2 + 7} className="tavolo-alone" filter="url(#sfoca)" />
                : <rect x={-w / 2 - 7} y={-h / 2 - 7} width={w + 14} height={h + 14} rx={16} className="tavolo-alone" filter="url(#sfoca)" />)}
              {sedie(t, w, h).map((c, i) => (
                <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.a})`} filter="url(#ombra-lieve)">
                  <rect x={-9} y={-7} width={18} height={14} rx={5} className="sedia-seduta" />
                  <rect x={-9} y={-9.5} width={18} height={4.5} rx={2.2} className="sedia-schienale" />
                </g>
              ))}
              <g filter="url(#ombra)">
                {t.forma === "tondo"
                  ? <circle r={w / 2} className="tavolo-forma" />
                  : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={10} className="tavolo-forma" />}
              </g>
              {t.forma === "tondo"
                ? <circle r={w / 2 - 3.5} className="tovaglia-orlo" />
                : <rect x={-w / 2 + 3.5} y={-h / 2 + 3.5} width={w - 7} height={h - 7} rx={7} className="tovaglia-orlo" />}
              {/* Tavolo libero: apparecchiato (piatto, bicchiere e posate per ogni sedia) */}
              {!s && sedie(t, w, h).map((c, i) => <Coperto key={`c${i}`} {...c} />)}
            </g>
            {(() => {
              // Tavolo aperto: segnaposto colorato con nome, tempo e conto
              const euro = s && props.conto && h >= 44 ? props.conto(s.id) : 0;
              const pw = Math.min(w - 6, 72), ph = euro ? 44 : 34;
              return <>
                {s && <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph} rx={10} className={`segnaposto stato-${stato(s)}`} />}
                <text className="tavolo-nome" dy={s ? (euro ? -6 : -1) : 7}>{t.nome}</text>
                {s && <text className="tavolo-info" dy={euro ? 7 : 12}>{w < 70 ? durataBreve(minuti(s.aperta_at)) : durata(minuti(s.aperta_at))}</text>}
                {euro > 0 && <text className="tavolo-info tavolo-conto" dy={18}>{Math.round(euro / 100)} €</text>}
              </>;
            })()}
            {s && <g transform={`translate(${w / 2 + 6} ${-h / 2 - 6})`} className="tavolo-badge"><circle r={11} /><text dy={4}>{s.coperti}</text></g>}
            {props.inAttesa?.has(t.id) && <g transform={`translate(${-w / 2 - 6} ${-h / 2 - 6})`} className="tavolo-allerta"><circle r={13} /><text dy={5}>!</text></g>}
          </g>
        );
      })}
      {/* Vignettatura e cornice dentro il disegno: la sala resta sempre nei bordi */}
      <rect width={W} height={H} fill="url(#vignetta)" pointerEvents="none" />
      <rect x={6} y={6} width={W - 12} height={H - 12} rx={12} className="cornice-sala" />
      <rect x={12.5} y={12.5} width={W - 25} height={H - 25} rx={8} className="cornice-luce" />
    </svg>
  );
}

/** Coperto davanti a una sedia: piatto, bicchiere a destra e posate ai lati, verso il centro del tavolo. */
function Coperto({ x, y, a }: { x: number; y: number; a: number }) {
  const rad = (a * Math.PI) / 180, fuori = { x: Math.sin(rad), y: -Math.cos(rad) }, lato = { x: Math.cos(rad), y: Math.sin(rad) };
  const px = x - fuori.x * 23, py = y - fuori.y * 23;
  const punto = (l: number, f: number) => ({ x: px + lato.x * l - fuori.x * f, y: py + lato.y * l - fuori.y * f });
  const b = punto(8, 5), f1 = punto(-8.5, -3), f2 = punto(-8.5, 3), c1 = punto(8.5, -3), c2 = punto(8.5, 1);
  return (
    <g className="coperto" pointerEvents="none">
      <circle cx={px} cy={py} r={5.8} className="piatto" /><circle cx={px} cy={py} r={3.4} className="piatto-fondo" />
      <line x1={f1.x} y1={f1.y} x2={f2.x} y2={f2.y} className="posata" /><line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} className="posata" />
      <circle cx={b.x} cy={b.y} r={2.3} className="bicchiere" />
    </g>
  );
}

/** Disegno di un elemento d'arredo, centrato sull'origine. */
function Arredo({ tipo, w, h, etichetta }: { tipo: TipoElemento; w: number; h: number; etichetta: string }) {
  const r = { x: -w / 2, y: -h / 2, width: w, height: h };
  const scritta = etichetta ? <text className="arredo-testo" dy={5}>{etichetta}</text> : null;
  switch (tipo) {
    case "muro": return <g filter="url(#ombra-muro)"><rect {...r} rx={1.5} className="muro" /><rect x={-w / 2} y={-h / 2} width={w} height={Math.min(2.5, h / 3)} className="muro-luce" /></g>;
    case "porta": return <><rect {...r} className="porta-vano" /><path d={`M${-w / 2} ${-h / 2 - w} A ${w} ${w} 0 0 1 ${w / 2} ${-h / 2}`} className="porta-arco" /><line x1={-w / 2} y1={-h / 2} x2={-w / 2} y2={-h / 2 - w} className="porta-anta" /></>;
    case "finestra": return <>
      <path d={`M${-w / 2} ${h / 2} L${w / 2} ${h / 2} L${w / 2 + w * 0.25} ${h / 2 + w * 0.7} L${-w / 2 - w * 0.25} ${h / 2 + w * 0.7} Z`} className="luce-finestra" />
      <rect {...r} className="vetro" /><line x1={-w / 2 + 4} y1={-h / 6} x2={w / 2 - 4} y2={-h / 6} className="vetro-riflesso" />
    </>;
    case "colonna": return <rect {...r} rx={4} className="colonna" filter="url(#ombra)" />;
    case "pianta": {
      const r0 = Math.min(w, h) / 2;
      return <g filter="url(#ombra-lieve)"><circle r={r0 * 0.55} className="vaso" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
        <ellipse key={a} rx={r0 * 0.26} ry={r0 * (i % 2 ? 0.5 : 0.66)} transform={`rotate(${a}) translate(0 ${-r0 * 0.42})`} className="foglia" />
      ))}<circle r={r0 * 0.16} className="pianta-centro" /></g>;
    }
    case "bancone": {
      const m = Math.min(8, Math.min(w, h) / 5);
      return <g filter="url(#ombra)"><rect {...r} rx={8} className="bancone-piano" />
        <rect x={-w / 2 + m} y={-h / 2 + m} width={Math.max(0, w - 2 * m)} height={Math.max(0, h - 2 * m)} rx={4} className="bancone-top" />{scritta}</g>;
    }
    case "cassa": return <g filter="url(#ombra)"><rect {...r} rx={6} className="cassa-corpo" />
      <rect x={-w / 2 + 5} y={-h / 2 + 5} width={Math.max(0, w - 10)} height={Math.max(6, h * 0.32)} rx={3} className="cassa-schermo" />
      {etichetta && <text className="arredo-testo" y={h / 2 - 7}>{etichetta}</text>}</g>;
    case "bagni": return <><rect {...r} rx={6} className="bagni" />{scritta}</>;
    case "botte": return (
      <g filter="url(#ombra)">
        <ellipse rx={w / 2} ry={h / 2} className="botte" />
        {[0.82, 0.55].map((k) => <ellipse key={k} rx={(w / 2) * k} ry={(h / 2) * k} className="botte-cerchio" />)}
        {[-0.5, -0.25, 0, 0.25, 0.5].map((k) => <line key={k} x1={(w / 2) * k} y1={-(h / 2) * Math.sqrt(1 - k * k) * 0.95} x2={(w / 2) * k} y2={(h / 2) * Math.sqrt(1 - k * k) * 0.95} className="botte-doga" />)}
        <ellipse rx={w * 0.08} ry={h * 0.08} className="botte-tappo" />
      </g>
    );
    case "scaffale": {
      // Bottigliera vista dall'alto: fondi delle bottiglie in file, colori da vino rosso, bianco e rosato
      const col = Math.max(1, Math.min(60, Math.floor((w - 8) / 10))), righe = Math.max(1, Math.min(10, Math.floor((h - 6) / 10)));
      const colori = ["#4A1020", "#2F4A22", "#6B1A2A", "#C9B458", "#3B0F1A", "#B85C6E"];
      return <g filter="url(#ombra)"><rect {...r} rx={3} className="scaffale" />
        {Array.from({ length: col * righe }, (_, i) => (
          <circle key={i} cx={-w / 2 + 4 + ((w - 8) / col) * ((i % col) + 0.5)} cy={-h / 2 + 3 + ((h - 6) / righe) * (Math.floor(i / col) + 0.5)} r={3.6}
            fill={colori[(i * 7 + Math.floor(i / col) * 3) % colori.length]} className="bottiglia" />
        ))}{scritta}</g>;
    }
    case "divano": case "poltrona": {
      const sch = Math.min(16, h * 0.28), bracc = Math.min(14, w * 0.12), posti = tipo === "poltrona" ? 1 : Math.max(1, Math.round((w - 2 * bracc) / 55));
      return <g filter="url(#ombra)">
        <rect {...r} rx={10} className="divano" />
        <rect x={-w / 2} y={-h / 2} width={w} height={sch} rx={8} className="divano-schienale" />
        <rect x={-w / 2} y={-h / 2} width={bracc} height={h} rx={7} className="divano-schienale" /><rect x={w / 2 - bracc} y={-h / 2} width={bracc} height={h} rx={7} className="divano-schienale" />
        {Array.from({ length: posti }, (_, i) => {
          const lw = (w - 2 * bracc) / posti;
          return <rect key={i} x={-w / 2 + bracc + lw * i + 2} y={-h / 2 + sch + 2} width={lw - 4} height={h - sch - 6} rx={6} className="divano-cuscino" />;
        })}
      </g>;
    }
    case "sgabello": return <g filter="url(#ombra-lieve)"><circle r={Math.min(w, h) / 2} className="sgabello" /><circle r={Math.min(w, h) / 2 - 3} className="sgabello-seduta" /></g>;
    case "tappeto": return <g>
      <rect {...r} rx={4} className="tappeto" /><rect x={-w / 2 + 8} y={-h / 2 + 8} width={Math.max(0, w - 16)} height={Math.max(0, h - 16)} rx={3} className="tappeto-bordo" />
      <rect x={-w / 2 + 18} y={-h / 2 + 18} width={Math.max(0, w - 36)} height={Math.max(0, h - 36)} rx={2} className="tappeto-centro" />
      <path d={Array.from({ length: Math.max(0, Math.floor(h / 6)) }, (_, i) => { const y = -h / 2 + 3 + i * 6; return `M${-w / 2} ${y}h-5M${w / 2} ${y}h5`; }).join("")} className="tappeto-frange" />
    </g>;
    case "camino": return <g filter="url(#ombra)">
      <rect {...r} rx={3} className="camino-pietra" />
      <rect x={-w * 0.3} y={-h / 2 + 4} width={w * 0.6} height={h - 8} rx={4} className="camino-bocca" />
      <ellipse cx={0} cy={h * 0.08} rx={w * 0.24} ry={h * 0.32} className="camino-fuoco" />
      <ellipse cx={0} cy={h * 0.1} rx={w * 0.12} ry={h * 0.18} className="camino-brace" />
    </g>;
    case "scala": {
      const gradini = Math.max(3, Math.min(30, Math.floor(h / 14)));
      return <g filter="url(#ombra-lieve)"><rect {...r} rx={2} className="scala" />
        {Array.from({ length: gradini - 1 }, (_, i) => <line key={i} x1={-w / 2} x2={w / 2} y1={-h / 2 + (h / gradini) * (i + 1)} y2={-h / 2 + (h / gradini) * (i + 1)} className="scala-gradino" />)}
        <path d={`M0 ${h / 2 - 10}V${-h / 2 + 12}M-7 ${-h / 2 + 22}L0 ${-h / 2 + 12}L7 ${-h / 2 + 22}`} className="scala-freccia" /></g>;
    }
    case "cucina": {
      const fuochi = Math.max(1, Math.min(8, Math.floor(w / 50)));
      return <g filter="url(#ombra)"><rect {...r} rx={4} className="cucina" />
        <rect x={-w / 2 + 6} y={-h / 2 + 6} width={Math.max(0, w - 12)} height={Math.min(40, h * 0.4)} rx={3} className="cucina-piano" />
        {Array.from({ length: fuochi }, (_, i) => <circle key={i} cx={-w / 2 + 6 + ((w - 12) / fuochi) * (i + 0.5)} cy={-h / 2 + 6 + Math.min(40, h * 0.4) / 2} r={Math.min(11, h * 0.12)} className="fuoco" />)}
        {etichetta && <text className="arredo-testo" y={h / 4 + 8}>{etichetta}</text>}</g>;
    }
    case "vetrina": return <g filter="url(#ombra)">
      <rect {...r} rx={4} className="vetrina" /><rect x={-w / 2 + 4} y={-h / 2 + 4} width={Math.max(0, w - 8)} height={Math.max(0, h - 8)} rx={2} className="vetrina-vetro" />
      <line x1={-w / 2 + 10} y1={-h / 2 + 8} x2={-w / 2 + 30} y2={h / 2 - 8} className="vetro-riflesso" />{scritta}</g>;
    case "fioriera": {
      const n = Math.max(2, Math.min(20, Math.floor(w / 22)));
      return <g filter="url(#ombra-lieve)"><rect {...r} rx={4} className="fioriera" />
        {Array.from({ length: n }, (_, i) => <circle key={i} cx={-w / 2 + (w / n) * (i + 0.5)} cy={(i % 2 ? -1 : 1) * h * 0.12} r={Math.min(h * 0.42, w / n / 1.6)} className="foglia" />)}</g>;
    }
    case "zona": return <><rect {...r} rx={12} /><text className="arredo-testo zona-testo" y={-h / 2 + 22}>{etichetta}</text></>;
    case "testo": return <><rect {...r} className="testo-area" />{scritta}</>;
    default: return <><rect {...r} rx={4} />{scritta}</>;
  }
}

/** Misure dell'elemento in metri: lunghezza e spessore (muri) o larghezza e profondità; il centro resta fermo. */
function MisureElemento({ elemento, metri, onCambia }: { elemento: Elemento; metri: number; onCambia: (p: Partial<Elemento>) => void }) {
  const inMetri = (v: number) => (v * metri).toFixed(2);
  const daMetri = (t: string, max: number) => { const v = Number(t.replace(",", ".")); return v > 0 ? Math.min(max, Math.max(4, Math.round(v / metri))) : null; };
  const sottile = SOTTILI.has(elemento.tipo);
  // Muro verticale (più alto che largo): la lunghezza è l'altezza
  const [lungo, corto] = (sottile && elemento.h > elemento.w ? ["h", "w"] : ["w", "h"]) as ["w" | "h", "w" | "h"];
  const campo = (k: "w" | "h", etichetta: string) => (
    <label className="campo" style={{ flex: 1 }}>{etichetta}
      <input inputMode="decimal" defaultValue={inMetri(elemento[k])}
        onBlur={(e) => { const v = daMetri(e.target.value, k === "w" ? 1000 : 2000); if (v && v !== elemento[k]) onCambia({ [k]: v }); }} />
    </label>
  );
  return (
    <div className="riga-form" key={`${elemento.id}-${elemento.w}-${elemento.h}`}>
      {campo(lungo, sottile ? "Lunghezza (m)" : "Larghezza (m)")}
      {campo(corto, sottile ? "Spessore (m)" : "Profondità (m)")}
    </div>
  );
}

function NuovaSala({ locale, onFatto }: { locale: string; onFatto: () => Promise<void> }) {
  const avvisa = useAvviso();
  const [nome, setNome] = useState("");
  async function crea(e: FormEvent) {
    e.preventDefault();
    const { error } = await sb().from("sale").insert({ locale_id: locale, nome: nome.trim() });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setNome(""); avvisa("Sala creata"); await onFatto();
  }
  return (
    <form className="riga-form" onSubmit={crea}>
      <input placeholder="Nuova sala (es. Interno, Dehors)" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
      <button className="btn btn-pieno" disabled={!nome.trim()}>Crea sala</button>
    </form>
  );
}

function PannelloPiantina(props: {
  locale: string; sala: Sala; tavolo: Tavolo | null; elemento: Elemento | null; tavoli: Tavolo[];
  onFatto: () => Promise<void>; onSeleziona: (s: Selezione) => void;
}) {
  const avvisa = useAvviso();
  const { tavolo, elemento, sala } = props;
  const H = altezza(sala);

  const esito = async (r: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await r;
    if (error) { avvisa(messaggioErrore(error), "errore"); return false; }
    avvisa(ok); await props.onFatto(); return true;
  };

  async function aggiungiTavolo() {
    const usati = new Set(props.tavoli.map((t) => t.nome));
    let n = 1; while (usati.has(String(n))) n++;
    const quanti = props.tavoli.filter((t) => t.sala_id === sala.id).length;
    const { data, error } = await sb().from("tavoli").insert({
      locale_id: props.locale, sala_id: sala.id, nome: String(n), posti: 4, forma: "quadrato",
      x: Math.min(W - 60, 100 + (quanti % 8) * 110), y: Math.min(H - 60, 100 + Math.floor(quanti / 8) * 120),
    }).select().single();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(`Tavolo ${n} aggiunto: trascinalo nella posizione giusta`); await props.onFatto(); props.onSeleziona({ tipo: "tavolo", id: (data as Tavolo).id });
  }
  async function aggiungiElemento(tipo: TipoElemento, base?: Elemento) {
    const d = ARREDI[tipo];
    const { data, error } = await sb().from("elementi_sala").insert(base
      ? { locale_id: base.locale_id, sala_id: base.sala_id, tipo: base.tipo, x: Math.min(W, base.x + 30), y: Math.min(H, base.y + 30), w: base.w, h: base.h, rotazione: base.rotazione, etichetta: base.etichetta }
      : { locale_id: props.locale, sala_id: sala.id, tipo, x: W / 2, y: Math.round(H / 2), w: d.w, h: d.h, etichetta: d.etichetta ?? "" }).select().single();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    await props.onFatto(); props.onSeleziona({ tipo: "elemento", id: (data as Elemento).id });
  }
  const aggiornaTavolo = (patch: Partial<Tavolo>) => tavolo && void esito(sb().from("tavoli").update(patch).eq("id", tavolo.id), "Salvato");
  const aggiornaElemento = (patch: Partial<Elemento>) => elemento && void esito(sb().from("elementi_sala").update(patch).eq("id", elemento.id), "Salvato");
  const aggiornaSala = (patch: Partial<Sala>) => void esito(sb().from("sale").update(patch).eq("id", sala.id), "Sala aggiornata");
  const ruota = (attuale: number, delta: number) => ((attuale + delta) % 360 + 360) % 360;

  async function caricaPlanimetria(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await preparaImmagine(file, { lato: 1600, limite: 1_000_000 });
      const percorso = await caricaImmagine(props.locale, "sale", blob);
      const precedente = sala.sfondo_path;
      aggiornaSala({ sfondo_path: percorso, sfondo_dati: null });
      void eliminaImmagine(precedente);
    } catch (e) { avvisa(e instanceof Error ? e.message : "Immagine non valida", "errore"); }
  }

  return (
    <div className="pannello-tavolo">
      <div className="barra-arredi">
        <button className="btn btn-pieno btn-piccolo" onClick={() => void aggiungiTavolo()}>+ Tavolo</button>
        {(Object.keys(ARREDI) as TipoElemento[]).map((t) => (
          <button key={t} className="btn btn-piccolo" onClick={() => void aggiungiElemento(t)}>+ {ARREDI[t].nome}</button>
        ))}
      </div>

      {tavolo && (
        <div className="campi-tavolo" key={tavolo.id}>
          <h2>Tavolo {tavolo.nome}</h2>
          <label className="campo">Nome / numero
            <input defaultValue={tavolo.nome} maxLength={20} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tavolo.nome) aggiornaTavolo({ nome: v }); }} />
          </label>
          <label className="campo">Posti
            <input type="number" min={1} max={30} defaultValue={tavolo.posti} onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 30 && v !== tavolo.posti) aggiornaTavolo({ posti: v }); }} />
          </label>
          <div className="scelte">
            {(["quadrato", "tondo", "rettangolo"] as const).map((f) => (
              <button key={f} className={`chip${tavolo.forma === f ? " attivo" : ""}`} onClick={() => aggiornaTavolo({ forma: f })}>{f[0]!.toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
          {tavolo.forma === "rettangolo" && (
            <div className="riga-form"><span>Rotazione {tavolo.rotazione}°</span>
              <button className="btn btn-icona" onClick={() => aggiornaTavolo({ rotazione: ruota(tavolo.rotazione, 90) })} aria-label="Ruota di 90 gradi">↻ 90°</button></div>
          )}
          <label className="interruttore"><input type="checkbox" checked={tavolo.attivo} onChange={(e) => aggiornaTavolo({ attivo: e.target.checked })} />In uso</label>
          <div className="riga-form">
            <button className="btn btn-piccolo" onClick={async () => {
              if (!confirm(`Rigenerare il QR del tavolo ${tavolo.nome}? Il cartoncino attuale smetterà di funzionare e andrà ristampato.`)) return;
              await esito(sb().rpc("rigenera_qr_tavolo", { p_tavolo: tavolo.id }), "Nuovo QR generato: ristampa il cartoncino");
            }}>Rigenera QR</button>
            <button className="btn btn-pericolo" onClick={async () => {
              if (!confirm(`Eliminare il tavolo ${tavolo.nome}? Il suo cartoncino QR smetterà di funzionare.`)) return;
              if (await esito(sb().from("tavoli").delete().eq("id", tavolo.id), "Tavolo eliminato")) props.onSeleziona(null);
            }}>Elimina</button>
          </div>
        </div>
      )}

      {elemento && (
        <div className="campi-tavolo" key={elemento.id}>
          <h2>{ARREDI[elemento.tipo].nome}</h2>
          {["bancone", "zona", "testo", "cassa", "bagni", "cucina", "vetrina", "scaffale"].includes(elemento.tipo) && (
            <label className="campo">Scritta
              <input defaultValue={elemento.etichetta} maxLength={40} onBlur={(e) => { if (e.target.value !== elemento.etichetta) aggiornaElemento({ etichetta: e.target.value.trim() }); }} />
            </label>
          )}
          <div className="riga-form"><span>Rotazione {elemento.rotazione}°</span>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, -15) })} aria-label="Ruota a sinistra">↺</button>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, 15) })} aria-label="Ruota a destra">↻</button>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, 90) })}>90°</button>
          </div>
          <MisureElemento elemento={elemento} metri={Number(sala.larghezza_m) / W} onCambia={aggiornaElemento} />
          <p className="muto piccolo">Trascina per spostare. Tira i pallini sui quattro lati per allungare, accorciare o ispessire solo da quella parte.</p>
          <div className="riga-form">
            <button className="btn btn-piccolo" onClick={() => void aggiungiElemento(elemento.tipo, elemento)}>Duplica</button>
            <button className="btn btn-pericolo" onClick={async () => {
              if (await esito(sb().from("elementi_sala").delete().eq("id", elemento.id), "Elemento eliminato")) props.onSeleziona(null);
            }}>Elimina</button>
          </div>
        </div>
      )}

      {!tavolo && !elemento && (
        <div className="campi-tavolo" key={sala.id}>
          <h2>Sala «{sala.nome}»</h2>
          <label className="campo">Nome
            <input defaultValue={sala.nome} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sala.nome) aggiornaSala({ nome: v }); }} />
          </label>
          <div className="riga-form">
            <label className="campo" style={{ flex: 1 }}>Larghezza (m)
              <input type="number" min={2} max={200} step={0.5} defaultValue={sala.larghezza_m} onBlur={(e) => { const v = Number(e.target.value); if (v >= 2 && v <= 200 && v !== Number(sala.larghezza_m)) aggiornaSala({ larghezza_m: v }); }} />
            </label>
            <label className="campo" style={{ flex: 1 }}>Profondità (m)
              <input type="number" min={2} max={200} step={0.5} defaultValue={sala.profondita_m} onBlur={(e) => { const v = Number(e.target.value); if (v >= 2 && v <= 200 && v !== Number(sala.profondita_m)) aggiornaSala({ profondita_m: v }); }} />
            </label>
          </div>
          <fieldset className="gruppo"><legend>Pavimento</legend>
            <div className="scelte">
              {([["parquet", "Parquet"], ["cotto", "Cotto"], ["marmo", "Marmo"], ["cemento", "Cemento"], ["nessuno", "Nessuno"]] as const).map(([v, n]) => (
                <button key={v} className={`chip pavimento-chip pav-${v}${sala.pavimento === v ? " attivo" : ""}`} onClick={() => aggiornaSala({ pavimento: v })}>{n}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="gruppo"><legend>Planimetria di sfondo</legend>
            <p className="muto piccolo">Carica una foto o una piantina del locale e ricalca sopra muri e tavoli.</p>
            <div className="riga-form">
              <label className="btn btn-piccolo">{sala.sfondo_path || sala.sfondo_dati ? "Sostituisci" : "Carica immagine"}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void caricaPlanimetria(e.target.files?.[0])} />
              </label>
              {(sala.sfondo_path || sala.sfondo_dati) && <button className="btn btn-pericolo" onClick={() => { const v = sala.sfondo_path; aggiornaSala({ sfondo_path: null, sfondo_dati: null }); void eliminaImmagine(v); }}>Rimuovi</button>}
            </div>
            {(sala.sfondo_path || sala.sfondo_dati) && (
              <label className="campo">Visibilità: {sala.sfondo_opacita}%
                <input type="range" min={5} max={100} defaultValue={sala.sfondo_opacita} onPointerUp={(e) => aggiornaSala({ sfondo_opacita: Number((e.target as HTMLInputElement).value) })} />
              </label>
            )}
          </fieldset>
          <button className="btn btn-pericolo" onClick={async () => {
            if (!confirm(`Eliminare la sala «${sala.nome}» con tutti i suoi tavoli e arredi?`)) return;
            await esito(sb().from("sale").delete().eq("id", sala.id), "Sala eliminata");
          }}>Elimina sala</button>
          <p className="muto piccolo">Tocca un tavolo o un elemento per modificarlo.</p>
        </div>
      )}
      <hr />
      <NuovaSala locale={props.locale} onFatto={props.onFatto} />
    </div>
  );
}

/** Testo del QR Wi-Fi standard (riconosciuto da Android e iPhone): i caratteri speciali vanno protetti. */
const qrWifi = (w: Wifi) => {
  const p = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:${w.sicurezza};S:${p(w.ssid)};${w.sicurezza === "nopass" ? "" : `P:${p(w.password)};`}${w.nascosta ? "H:true;" : ""};`;
};

function Cartoncini({ locale, tavoli, sale }: { locale: { id: string; nome: string; slug: string }; tavoli: Tavolo[]; sale: Sala[] }) {
  const avvisa = useAvviso();
  const [wifi, setWifi] = useState<Wifi | null>(null);
  const [salvato, setSalvato] = useState<Wifi | null>(null);
  const [aspetto, setAspetto] = useState<Aspetto | null>(null);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [mostraPw, setMostraPw] = useState(false);

  useEffect(() => {
    void (async () => {
      const [w, a] = await Promise.all([
        sb().from("wifi_ospiti").select("*").eq("locale_id", locale.id).maybeSingle(),
        sb().from("aspetto").select("*").eq("locale_id", locale.id).maybeSingle(),
      ]);
      const valore = (w.data as Wifi | null) ?? { ssid: "", sicurezza: "WPA", password: "", nascosta: false, url_ordini: "" };
      setWifi(valore); setSalvato(valore); setAspetto(a.data as Aspetto | null);
    })();
  }, [locale.id]);

  // Senza indirizzo degli ordini si usa il server del locale in HTTP: i telefoni dei clienti non hanno
  // il certificato interno, e la pagina del tavolo resta apposta raggiungibile anche in HTTP
  const base = (salvato?.url_ordini || `http://${window.location.hostname}`).replace(/\/?$/, "/");
  const urlTavolo = useCallback((t: Tavolo) => `${base}t/${encodeURIComponent(t.qr_token)}`, [base]);

  // QR generati sul dispositivo: nessun servizio esterno
  useEffect(() => {
    if (!salvato) return;
    void (async () => {
      const opz = { margin: 1, width: 320, errorCorrectionLevel: "M" as const };
      const voci: Record<string, string> = {};
      if (salvato.ssid) voci.wifi = await QRCode.toDataURL(qrWifi(salvato), opz);
      for (const t of tavoli) voci[t.id] = await QRCode.toDataURL(urlTavolo(t), opz);
      setQr(voci);
    })();
  }, [salvato, tavoli, urlTavolo]);

  const tavoliOrdinati = useMemo(() => [...tavoli].sort((a, b) =>
    (sale.findIndex((s) => s.id === a.sala_id) - sale.findIndex((s) => s.id === b.sala_id)) || a.nome.localeCompare(b.nome, "it", { numeric: true })), [tavoli, sale]);

  if (!wifi) return <p className="muto">Caricamento…</p>;

  async function salva(e: FormEvent) {
    e.preventDefault();
    if (!wifi) return;
    const { locale_id: _l, ...campi } = wifi;
    const { error } = await sb().from("wifi_ospiti").upsert({ ...campi, ssid: campi.ssid.trim(), url_ordini: campi.url_ordini.trim(), locale_id: locale.id });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setSalvato(wifi); avvisa("Impostazioni salvate");
  }

  const stile = aspetto ? { ["--c-primario" as string]: aspetto.colore_primario, ["--c-sfondo" as string]: aspetto.colore_sfondo, ["--c-testo" as string]: aspetto.colore_testo } : {};
  const logo = sorgenteImmagine(aspetto?.logo_path, aspetto?.logo_dati, aspetto?.logo_url);

  return (
    <div className="pagina">
      <form className="gruppo nascondi-stampa" onSubmit={salva}>
        <legend>Wi-Fi ospiti e indirizzo degli ordini</legend>
        <label className="campo">Nome della rete (SSID)<input value={wifi.ssid} maxLength={32} required onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} /></label>
        <label className="campo">Protezione
          <select value={wifi.sicurezza} onChange={(e) => setWifi({ ...wifi, sicurezza: e.target.value as Wifi["sicurezza"] })}>
            <option value="WPA">WPA/WPA2/WPA3 (consigliata)</option><option value="WEP">WEP</option><option value="nopass">Rete aperta</option>
          </select>
        </label>
        {wifi.sicurezza !== "nopass" && (
          <label className="campo">Password
            <span className="riga-form"><input type={mostraPw ? "text" : "password"} value={wifi.password} maxLength={63} autoComplete="off"
              onChange={(e) => setWifi({ ...wifi, password: e.target.value })} />
              <button type="button" className="btn btn-piccolo" onClick={() => setMostraPw((m) => !m)}>{mostraPw ? "Nascondi" : "Mostra"}</button></span>
          </label>
        )}
        <label className="interruttore"><input type="checkbox" checked={wifi.nascosta} onChange={(e) => setWifi({ ...wifi, nascosta: e.target.checked })} />Rete nascosta</label>
        <label className="campo">Indirizzo per gli ordini (https://…)
          <input value={wifi.url_ordini} placeholder="Es. https://ordini.tuodominio.it — vuoto: menu interno" onChange={(e) => setWifi({ ...wifi, url_ordini: e.target.value })} />
        </label>
        <p className="muto piccolo">
          {salvato?.url_ordini ? "I QR dei tavoli puntano all'indirizzo impostato." : "⚠️ Senza indirizzo, il QR del tavolo apre la pagina per ordinare sul server del locale: funziona solo nella stessa rete. Va bene per le prove; stampa i cartoncini definitivi quando avrete il dominio."}
        </p>
        <div className="riga-form">
          <button className="btn btn-pieno" disabled={JSON.stringify(wifi) === JSON.stringify(salvato)}>Salva</button>
          <button type="button" className="btn" disabled={!tavoli.length || !salvato?.ssid} onClick={() => window.print()}>Stampa / salva PDF</button>
          {!salvato?.ssid && <span className="muto piccolo">Imposta e salva il Wi-Fi per stampare.</span>}
        </div>
      </form>

      {tavoli.length === 0 ? <p className="muto">Crea prima i tavoli nella piantina.</p> : (
        <div className="cartoncini" style={stile}>
          {tavoliOrdinati.map((t) => (
            <article key={t.id} className="cartoncino">
              <header>
                {logo ? <img src={logo} alt={locale.nome} /> : <strong className="cartoncino-nome">{locale.nome}</strong>}
                <p className="cartoncino-tavolo">Tavolo {t.nome}</p>
              </header>
              <div className="cartoncino-qr">
                <figure>
                  {qr.wifi ? <img src={qr.wifi} alt="QR Wi-Fi" /> : <div className="qr-vuoto" />}
                  <figcaption><b>1</b> Collegati al Wi-Fi</figcaption>
                </figure>
                <figure>
                  {qr[t.id] ? <img src={qr[t.id]} alt={`QR tavolo ${t.nome}`} /> : <div className="qr-vuoto" />}
                  <figcaption><b>2</b> Apri il menu e ordina</figcaption>
                </figure>
              </div>
              <a className="nascondi-stampa piccolo" href={urlTavolo(t)} target="_blank" rel="noreferrer">Apri la pagina del tavolo ↗</a>
              {salvato?.ssid && (
                <footer>Rete «{salvato.ssid}»{salvato.sicurezza !== "nopass" && salvato.password ? ` · password ${salvato.password}` : ""}</footer>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
