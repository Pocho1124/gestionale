import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { puo } from "../lib/permessi";
import { suona } from "../componenti/ServizioSala";

interface RigaCucina { nome: string; quantita: number; nota: string; opzioni: { nome: string }[] | null; reparto_id: string | null }
interface OrdineCucina { id: string; tavolo_id: string; stato: "confermato" | "in_preparazione" | "pronto"; nota: string; creato_at: string; aggiornato_at: string; righe_ordine: RigaCucina[] }
interface Reparto { id: string; nome: string }

const COLONNE = [
  { stato: "confermato", titolo: "Da preparare", azione: "Inizia", prossimo: "in_preparazione" },
  { stato: "in_preparazione", titolo: "In preparazione", azione: "Pronto ✓", prossimo: "pronto" },
  { stato: "pronto", titolo: "Pronti da servire", azione: "Servito", prossimo: "servito" },
] as const;
const CHIAVE_REPARTO = "gestionale.cucina.reparto";
const minuti = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

/**
 * Schermo della cucina (o del bar): comande per reparto in tre colonne, tempo d'attesa colorato,
 * «Inizia» → «Pronto» → «Servito». La sala vede subito i piatti pronti. Il passaggio di stato lo controlla il database.
 */
export function Cucina() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [ordini, setOrdini] = useState<OrdineCucina[]>([]);
  const [tavoli, setTavoli] = useState<Map<string, string>>(new Map());
  const [reparti, setReparti] = useState<Reparto[]>([]);
  const [reparto, setReparto] = useState<string>(() => { try { return localStorage.getItem(CHIAVE_REPARTO) ?? ""; } catch { return ""; } });
  const [, setOra] = useState(0);
  const [attesa, setAttesa] = useState<string | null>(null);
  const visti = useRef<Set<string> | null>(null);
  const schermo = useRef<HTMLDivElement>(null);

  const carica = useCallback(async () => {
    if (!locale) return;
    const da = new Date(Date.now() - 12 * 3600_000).toISOString();
    const [o, t, r] = await Promise.all([
      sb().from("ordini").select("id, tavolo_id, stato, nota, creato_at, aggiornato_at, righe_ordine(nome, quantita, nota, opzioni, reparto_id)")
        .eq("locale_id", locale.id).in("stato", ["confermato", "in_preparazione", "pronto"]).gte("creato_at", da).order("creato_at"),
      sb().from("tavoli").select("id, nome").eq("locale_id", locale.id),
      sb().from("reparti").select("id, nome").eq("locale_id", locale.id).order("posizione").order("nome"),
    ]);
    const errore = o.error ?? t.error ?? r.error;
    if (errore) { avvisa(messaggioErrore(errore), "errore"); return; }
    const lista = o.data as unknown as OrdineCucina[];
    // Suono per le comande nuove arrivate dopo il primo caricamento
    const nuove = lista.filter((x) => x.stato === "confermato").map((x) => x.id);
    if (visti.current && nuove.some((id) => !visti.current!.has(id))) suona();
    visti.current = new Set([...(visti.current ?? []), ...nuove]);
    setOrdini(lista);
    setTavoli(new Map((t.data as { id: string; nome: string }[]).map((x) => [x.id, x.nome])));
    setReparti(r.data as Reparto[]);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);
  useEffect(() => {
    if (!locale) return;
    const canale = sb().channel(`cucina-${locale.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ordini", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .subscribe();
    const t = setInterval(() => { setOra((n) => n + 1); void carica(); }, 30_000);   // orologio e rete di sicurezza
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [locale, carica]);

  const filtrati = useMemo(() => ordini
    .map((o) => ({ ...o, righe_ordine: o.righe_ordine.filter((r) => !reparto || r.reparto_id === reparto) }))
    .filter((o) => o.righe_ordine.length > 0)
    // I pronti restano in vista mezz'ora, poi si considerano serviti dalla sala
    .filter((o) => o.stato !== "pronto" || minuti(o.aggiornato_at) <= 30), [ordini, reparto]);

  if (!locale) return null;
  if (!puo(ruolo, "cucina.avanza")) return <div className="pagina"><h1>Cucina</h1><p className="muto">Lo schermo della cucina non è disponibile per il tuo ruolo.</p></div>;

  async function avanza(o: OrdineCucina, stato: string) {
    setAttesa(o.id);
    const { error } = await sb().rpc("avanza_ordine", { p_ordine: o.id, p_stato: stato });
    setAttesa(null);
    if (error) avvisa(messaggioErrore(error), "errore");
    await carica();
  }
  const scegliReparto = (id: string) => { setReparto(id); try { localStorage.setItem(CHIAVE_REPARTO, id); } catch { /* memoria non disponibile */ } };

  return (
    <div ref={schermo} className="pagina cucina">
      <div className="pagina-testa riga-form" style={{ justifyContent: "space-between" }}>
        <h1>Cucina</h1>
        <div className="scelte" role="group" aria-label="Reparto">
          <button className={`chip${reparto === "" ? " attivo" : ""}`} onClick={() => scegliReparto("")}>Tutti i reparti</button>
          {reparti.map((r) => <button key={r.id} className={`chip${reparto === r.id ? " attivo" : ""}`} onClick={() => scegliReparto(r.id)}>{r.nome}</button>)}
        </div>
        {document.fullscreenEnabled && (
          <button className="btn btn-piccolo" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : schermo.current?.requestFullscreen())}>⛶ Schermo intero</button>
        )}
      </div>
      <div className="cucina-colonne">
        {COLONNE.map((c) => {
          const lista = filtrati.filter((o) => o.stato === c.stato);
          return (
            <section key={c.stato} className={`cucina-colonna colonna-${c.stato}`}>
              <h2>{c.titolo} <span className="contatore">{lista.length}</span></h2>
              {lista.length === 0 && <p className="muto">Niente qui.</p>}
              {lista.map((o) => {
                const m = minuti(o.creato_at);
                return (
                  <article key={o.id} className={`comanda-cucina${c.stato !== "pronto" && m >= 25 ? " ritardo" : c.stato !== "pronto" && m >= 15 ? " attenzione" : ""}`}>
                    <header>
                      <strong>Tavolo {tavoli.get(o.tavolo_id) ?? "?"}</strong>
                      <span className="comanda-tempo">{m < 1 ? "adesso" : `${m} min`}</span>
                    </header>
                    <ul>
                      {o.righe_ordine.map((r, i) => (
                        <li key={i}>
                          <b>{r.quantita}×</b> {r.nome}
                          {(r.opzioni ?? []).length > 0 && <span className="comanda-scelte">{(r.opzioni ?? []).map((x) => x.nome).join(", ")}</span>}
                          {r.nota && <span className="comanda-nota-cucina">📝 {r.nota}</span>}
                        </li>
                      ))}
                    </ul>
                    {o.nota && <p className="comanda-nota-cucina">📝 {o.nota}</p>}
                    <button className="btn btn-pieno" disabled={attesa === o.id} onClick={() => void avanza(o, c.prossimo)}>{c.azione}</button>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
