import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";

interface Riga { nome: string; quantita: number; prezzo_cent: number; nota: string }
interface Ordine {
  id: string; stato: string; origine: string; nota: string; motivo: string; creato_at: string;
  tavoli: { nome: string } | null; righe_ordine: Riga[];
}
const PROSSIMO: Record<string, { stato: string; etichetta: string }> = {
  confermato: { stato: "in_preparazione", etichetta: "In preparazione" },
  in_preparazione: { stato: "pronto", etichetta: "Pronto" },
  pronto: { stato: "servito", etichetta: "Servito" },
};
const NOMI_STATO: Record<string, string> = {
  da_confermare: "Da confermare", confermato: "Confermato", in_preparazione: "In preparazione", pronto: "Pronto", servito: "Servito", rifiutato: "Rifiutato",
};
const ora = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

/** Breve suono di avviso, generato dal browser (nessun file audio). */
function suona() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* audio non disponibile */ }
}

export function Ordini() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [ordini, setOrdini] = useState<Ordine[]>([]);
  const [suoni, setSuoni] = useState(false);
  const noti = useRef<Set<string> | null>(null);
  const puoDecidere = ruolo === "owner" || ruolo === "manager" || ruolo === "cameriere";

  const carica = useCallback(async () => {
    if (!locale) return;
    const inizio = new Date(); inizio.setHours(0, 0, 0, 0);
    const { data, error } = await sb().from("ordini").select("id, stato, origine, nota, motivo, creato_at, tavoli(nome), righe_ordine(nome, quantita, prezzo_cent, nota)")
      .eq("locale_id", locale.id).gte("creato_at", inizio.toISOString()).order("creato_at", { ascending: false });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    const lista = data as unknown as Ordine[];
    // Suono solo per gli ordini da confermare comparsi dopo il primo caricamento
    const nuovi = lista.filter((o) => o.stato === "da_confermare" && noti.current && !noti.current.has(o.id));
    if (nuovi.length && suoni) suona();
    noti.current = new Set(lista.map((o) => o.id));
    setOrdini(lista);
  }, [locale, avvisa, suoni]);

  useEffect(() => { void carica(); }, [carica]);
  useEffect(() => {
    if (!locale) return;
    const canale = sb().channel(`ordini-${locale.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ordini", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .subscribe();
    const t = setInterval(() => void carica(), 20_000);   // rete di sicurezza se il tempo reale si interrompe
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [locale, carica]);

  async function decidi(o: Ordine, conferma: boolean) {
    let motivo = "";
    if (!conferma) {
      const r = prompt("Motivo del rifiuto (lo vedrà il cliente):", "Piatto non disponibile");
      if (r === null) return;
      motivo = r;
    }
    const { error } = await sb().rpc("decidi_ordine", { p_ordine: o.id, p_conferma: conferma, p_motivo: motivo });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(conferma ? `Ordine del tavolo ${o.tavoli?.nome} confermato` : "Ordine rifiutato"); await carica();
  }
  async function avanza(o: Ordine) {
    const p = PROSSIMO[o.stato]; if (!p) return;
    const { error } = await sb().rpc("avanza_ordine", { p_ordine: o.id, p_stato: p.stato });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    await carica();
  }

  const daConfermare = ordini.filter((o) => o.stato === "da_confermare");
  const inCorso = ordini.filter((o) => ["confermato", "in_preparazione", "pronto"].includes(o.stato));
  const chiusi = ordini.filter((o) => ["servito", "rifiutato"].includes(o.stato));

  const scheda = (o: Ordine, azioni: ReactNode) => (
    <article key={o.id} className={`ordine-scheda stato-ordine-${o.stato}`}>
      <header>
        <strong>Tavolo {o.tavoli?.nome ?? "?"}</strong>
        <span className="muto piccolo">{ora(o.creato_at)} · {o.origine === "cliente" ? "dal QR" : "dalla sala"}</span>
        <span className="pill">{NOMI_STATO[o.stato]}</span>
      </header>
      <ul>
        {o.righe_ordine.map((r, i) => (
          <li key={i}><b>{r.quantita}×</b> {r.nome}{r.nota && <em> — {r.nota}</em>}<span>{formatta(centesimi(r.quantita * r.prezzo_cent))}</span></li>
        ))}
      </ul>
      {o.nota && <p className="ordine-nota">📝 {o.nota}</p>}
      {o.motivo && <p className="ordine-nota">Motivo: {o.motivo}</p>}
      <footer>
        <span>Totale {formatta(centesimi(o.righe_ordine.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0)))}</span>
        {azioni}
      </footer>
    </article>
  );

  return (
    <div className="pagina">
      <div className="pagina-testa riga-form" style={{ justifyContent: "space-between" }}>
        <h1>Ordini</h1>
        <button className={`btn btn-piccolo${suoni ? " btn-pieno" : ""}`} onClick={() => { setSuoni((s) => !s); if (!suoni) suona(); }}>
          {suoni ? "🔔 Avviso sonoro attivo" : "🔕 Attiva avviso sonoro"}
        </button>
      </div>

      <h2>Da confermare {daConfermare.length > 0 && <span className="pill">{daConfermare.length}</span>}</h2>
      {daConfermare.length === 0 ? <p className="muto">Nessun ordine in attesa.</p> : (
        <div className="ordini-griglia">
          {daConfermare.map((o) => scheda(o, puoDecidere ? (
            <span className="riga-form">
              <button className="btn btn-pericolo" onClick={() => void decidi(o, false)}>Rifiuta</button>
              <button className="btn btn-pieno" onClick={() => void decidi(o, true)}>Conferma</button>
            </span>
          ) : <span className="muto piccolo">In attesa della sala</span>))}
        </div>
      )}

      <h2>In corso</h2>
      {inCorso.length === 0 ? <p className="muto">Nessun ordine in corso.</p> : (
        <div className="ordini-griglia">
          {inCorso.map((o) => scheda(o, PROSSIMO[o.stato] && <button className="btn" onClick={() => void avanza(o)}>→ {PROSSIMO[o.stato]!.etichetta}</button>))}
        </div>
      )}

      {chiusi.length > 0 && (
        <details>
          <summary className="muto">Conclusi oggi ({chiusi.length})</summary>
          <div className="ordini-griglia">{chiusi.map((o) => scheda(o, null))}</div>
        </details>
      )}
    </div>
  );
}
