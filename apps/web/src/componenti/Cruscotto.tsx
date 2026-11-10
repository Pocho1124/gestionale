import type { OrdineSala } from "./ServizioSala";
import { type SessioneT, type Tavolo, durata, minuti } from "../lib/piantina";

/** Cruscotto della sala: occupazione, coperti, incasso in corso, cucina. Si aggiorna con il tempo reale. */
export function Cruscotto(props: { tavoli: Tavolo[]; sessioni: SessioneT[]; ordini: OrdineSala[]; conto: (s: string) => number; monitor: boolean; onEsci: () => void }) {
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
