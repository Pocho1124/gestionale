import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as PE } from "react";
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
type TipoElemento = "muro" | "bancone" | "porta" | "finestra" | "colonna" | "pianta" | "zona" | "testo" | "cassa" | "bagni";
interface Elemento { id: string; locale_id: string; sala_id: string; tipo: TipoElemento; x: number; y: number; w: number; h: number; rotazione: number; etichetta: string }
type Selezione = { tipo: "tavolo" | "elemento"; id: string } | null;
interface SessioneT { id: string; tavolo_id: string; coperti: number; codice: string; aperta_at: string; nomi_clienti?: { nome: string }[] }
interface Wifi { locale_id?: string; ssid: string; sicurezza: "WPA" | "WEP" | "nopass"; password: string; nascosta: boolean; url_ordini: string }

/** Prodotto letto dal database con gruppi e voci, nel formato usato dalla composizione. */
type GrezzoProdotto = Omit<ProdottoBreve, "gruppi" | "aggiunte"> & { gruppi_opzioni: { id: string; nome: string; min_scelte: number; max_scelte: number; posizione: number;
  opzioni: { id: string; nome: string; sovrapprezzo_cent: number; disponibile: boolean; posizione: number }[] }[] };
/** Aggiunte del locale con le categorie su cui sono attive. */
interface GrezzaAggiunta { id: string; nome: string; prezzo_cent: number; disponibile: boolean; posizione: number; aggiunte_categorie: { categoria_id: string }[] }
const daGrezzo = (aggiunte: GrezzaAggiunta[]) => ({ gruppi_opzioni, ...p }: GrezzoProdotto): ProdottoBreve => ({
  ...p,
  aggiunte: aggiunte.filter((a) => a.disponibile && a.aggiunte_categorie.some((c) => c.categoria_id === p.categoria_id))
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
};
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
      sb().from("sessioni_tavolo").select("id, tavolo_id, coperti, codice, aperta_at, nomi_clienti(nome)").eq("locale_id", locale.id).is("chiusa_at", null),
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
    .reduce((n, o) => n + o.righe_ordine.reduce((m, r) => m + r.quantita * r.prezzo_cent, 0), 0), [ordini]);

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
                      prodotti={prodotti} categorie={categorie} comande={comande} onFatto={carica} />
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
  const [azione, setAzione] = useState<{ modo: "sposta" | "ridimensiona"; tipo: "tavolo" | "elemento"; id: string; x: number; y: number; w?: number; h?: number } | null>(null);
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
    // Ridimensiona nel sistema dell'elemento (tiene conto della rotazione)
    const r = (-el.rotazione * Math.PI) / 180, dx = p.x - el.x, dy = p.y - el.y;
    const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    setAzione({ ...azione, w: Math.max(10, scatto(Math.abs(lx) * 2)), h: Math.max(4, scatto(Math.abs(ly) * 2)) });
  }
  function rilascia() {
    if (!azione) return;
    if (azione.tipo === "tavolo") {
      const t = props.tavoli.find((z) => z.id === azione.id);
      if (t && (t.x !== azione.x || t.y !== azione.y)) props.onTavolo(t, { x: azione.x, y: azione.y });
    } else {
      const el = props.elementi.find((z) => z.id === azione.id);
      if (el && azione.modo === "sposta" && (el.x !== azione.x || el.y !== azione.y)) props.onElemento(el, { x: azione.x, y: azione.y });
      if (el && azione.modo === "ridimensiona" && azione.w && azione.h) props.onElemento(el, { w: Math.min(1000, azione.w), h: Math.min(2000, azione.h) });
    }
    setAzione(null);
  }
  const inizia = (e: PE, modo: "sposta" | "ridimensiona", tipo: "tavolo" | "elemento", z: { id: string; x: number; y: number }) => {
    if (!props.modificabile) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    props.onSeleziona({ tipo, id: z.id });
    setAzione({ modo, tipo, id: z.id, x: z.x, y: z.y });
  };

  return (
    <svg ref={svg} className="piantina" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Piantina della sala"
      onPointerMove={muovi} onPointerUp={rilascia} onPointerCancel={() => setAzione(null)}
      onPointerDown={() => { if (props.modificabile) props.onSeleziona(null); }}>
      <defs>
        <pattern id="griglia" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" className="griglia" /></pattern>
        <pattern id="pav-parquet" width="120" height="24" patternUnits="userSpaceOnUse">
          <rect width="120" height="12" fill="#D8B88A" /><rect y="12" width="120" height="12" fill="#CFAE7E" />
          <path d="M0 12H120M0 24H120M40 0V12M100 0V12M70 12V24M10 12V24" stroke="#B8955F" strokeWidth="1" opacity=".55" />
        </pattern>
        <pattern id="pav-cotto" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect width="44" height="44" fill="#E9DCCB" /><rect x="2" y="2" width="40" height="40" rx="2" fill="#C97B55" /><rect x="2" y="2" width="20" height="20" fill="#C27350" opacity=".6" />
        </pattern>
        <pattern id="pav-marmo" width="200" height="200" patternUnits="userSpaceOnUse">
          <rect width="200" height="200" fill="#F1EEE9" /><path d="M0 60 C50 40 80 90 140 70 S200 90 200 90 M30 200 C60 150 120 170 170 120" stroke="#D5CFC6" strokeWidth="2" fill="none" />
          <path d="M100 0V200M0 100H200" stroke="#E2DDD5" strokeWidth="1.5" />
        </pattern>
        <pattern id="pav-cemento" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#CDCBC6" /><circle cx="12" cy="18" r="1.2" fill="#B9B6B0" /><circle cx="44" cy="40" r="1" fill="#B9B6B0" /><circle cx="30" cy="8" r=".8" fill="#DEDCD8" /><circle cx="50" cy="12" r="1.4" fill="#C2BFB9" />
        </pattern>
        <linearGradient id="legno" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#A8743F" /><stop offset="1" stopColor="#7E5229" /></linearGradient>
        <radialGradient id="ripiano" cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#FFFDF8" /><stop offset="1" stopColor="#EADFCC" /></radialGradient>
        <filter id="ombra" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity=".28" /></filter>
      </defs>
      <rect width={W} height={H} fill={props.sala && props.sala.pavimento !== "nessuno" ? `url(#pav-${props.sala.pavimento})` : "transparent"} />
      {props.sala && sorgenteImmagine(props.sala.sfondo_path, props.sala.sfondo_dati) && <image href={sorgenteImmagine(props.sala.sfondo_path, props.sala.sfondo_dati)!} width={W} height={H} preserveAspectRatio="xMidYMid meet" opacity={props.sala.sfondo_opacita / 100} />}
      {props.modificabile && <rect width={W} height={H} fill="url(#griglia)" pointerEvents="none" />}

      {[...props.elementi].sort((a, b) => Number(b.tipo === "zona") - Number(a.tipo === "zona")).map((el) => {
        const pos = azione?.tipo === "elemento" && azione.id === el.id ? { ...el, x: azione.x, y: azione.y, w: azione.w ?? el.w, h: azione.h ?? el.h } : el;
        return (
          <g key={el.id} transform={`translate(${pos.x} ${pos.y}) rotate(${el.rotazione})`}
            className={`arredo arredo-${el.tipo}${selez("elemento", el.id) ? " selezionato" : ""}${props.modificabile ? "" : " fisso"}`}
            onPointerDown={(e) => inizia(e, "sposta", "elemento", el)}>
            <Arredo tipo={el.tipo} w={pos.w} h={pos.h} etichetta={el.etichetta} />
            {props.modificabile && selez("elemento", el.id) && (
              <rect className="maniglia" x={pos.w / 2 - 8} y={pos.h / 2 - 8} width={16} height={16}
                onPointerDown={(e) => inizia(e, "ridimensiona", "elemento", el)} />
            )}
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
            <g transform={`rotate(${t.rotazione})`} className={`tavolo-corpo stato-${stato(s)}`} filter="url(#ombra)">
              {sedie(t, w, h).map((c, i) => (
                <rect key={i} className="sedia" x={-9} y={-7} width={18} height={14} rx={5} transform={`translate(${c.x} ${c.y}) rotate(${c.a})`} />
              ))}
              {t.forma === "tondo"
                ? <circle r={w / 2} className="tavolo-forma" />
                : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={10} className="tavolo-forma" />}
            </g>
            {(() => {
              // Con il conto (tavoli da 4 posti in su) le tre righe si stringono al centro
              const euro = s && props.conto && h >= 44 ? props.conto(s.id) : 0;
              return <>
                <text className="tavolo-nome" dy={s ? (euro ? -8 : -3) : 7}>{t.nome}</text>
                {s && <text className="tavolo-info" dy={euro ? 7 : 15}>{w < 70 ? durataBreve(minuti(s.aperta_at)) : durata(minuti(s.aperta_at))}</text>}
                {euro > 0 && <text className="tavolo-info tavolo-conto" dy={20}>{Math.round(euro / 100)} €</text>}
              </>;
            })()}
            {s && <g transform={`translate(${w / 2 + 6} ${-h / 2 - 6})`} className="tavolo-badge"><circle r={11} /><text dy={4}>{s.coperti}</text></g>}
            {props.inAttesa?.has(t.id) && <g transform={`translate(${-w / 2 - 6} ${-h / 2 - 6})`} className="tavolo-allerta"><circle r={13} /><text dy={5}>!</text></g>}
          </g>
        );
      })}
    </svg>
  );
}

/** Disegno di un elemento d'arredo, centrato sull'origine. */
function Arredo({ tipo, w, h, etichetta }: { tipo: TipoElemento; w: number; h: number; etichetta: string }) {
  const r = { x: -w / 2, y: -h / 2, width: w, height: h };
  const scritta = etichetta ? <text className="arredo-testo" dy={5}>{etichetta}</text> : null;
  switch (tipo) {
    case "porta": return <><rect {...r} className="porta-vano" /><path d={`M${-w / 2} ${-h / 2 - w} A ${w} ${w} 0 0 1 ${w / 2} ${-h / 2}`} className="porta-arco" /><line x1={-w / 2} y1={-h / 2} x2={-w / 2} y2={-h / 2 - w} className="porta-anta" /></>;
    case "colonna": return <rect {...r} rx={4} filter="url(#ombra)" />;
    case "pianta": {
      const r0 = Math.min(w, h) / 2;
      return <><circle r={r0 * 0.55} className="vaso" />{[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse key={a} rx={r0 * 0.28} ry={r0 * 0.62} transform={`rotate(${a}) translate(0 ${-r0 * 0.45})`} className="foglia" />
      ))}<circle r={r0 * 0.18} className="pianta-centro" /></>;
    }
    case "bancone": return <g filter="url(#ombra)"><rect {...r} rx={8} className="bancone-piano" />{scritta}</g>;
    case "zona": return <><rect {...r} rx={12} /><text className="arredo-testo zona-testo" y={-h / 2 + 22}>{etichetta}</text></>;
    case "testo": return <><rect {...r} className="testo-area" />{scritta}</>;
    default: return <><rect {...r} rx={tipo === "cassa" || tipo === "bagni" ? 6 : 1} />{tipo !== "muro" && tipo !== "finestra" && scritta}</>;
  }
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
          {["bancone", "zona", "testo", "cassa", "bagni"].includes(elemento.tipo) && (
            <label className="campo">Scritta
              <input defaultValue={elemento.etichetta} maxLength={40} onBlur={(e) => { if (e.target.value !== elemento.etichetta) aggiornaElemento({ etichetta: e.target.value.trim() }); }} />
            </label>
          )}
          <div className="riga-form"><span>Rotazione {elemento.rotazione}°</span>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, -15) })} aria-label="Ruota a sinistra">↺</button>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, 15) })} aria-label="Ruota a destra">↻</button>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, 90) })}>90°</button>
          </div>
          <p className="muto piccolo">Trascina per spostare, usa il quadratino nell'angolo per allungare o allargare.</p>
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
