import { useMemo, useState } from "react";
import type { GruppoScelte, Scelta } from "../lib/tipi";
import { euro } from "../lib/formato";
import { conAggiunte, eAggiunte } from "../lib/aggiunte";
import { TESTI_COMPONI, type TestiComponi } from "../lib/traduzioni";

export { conAggiunte };

export const prezzoComposto = (base: number, scelte: Scelta[]) => base + scelte.reduce((n, s) => n + s.sovrapprezzo_cent, 0);
export const chiaveRiga = (prodotto: string, scelte: Scelta[]) => `${prodotto}|${scelte.map((s) => s.id).sort().join(",")}`;
export const descriviScelte = (scelte: { nome: string }[]) => (scelte.length ? ` (${scelte.map((s) => s.nome).join(", ")})` : "");

/**
 * Composizione di un piatto (es. tagliere personalizzato): per ogni gruppo si scelgono da «min» a «max» voci,
 * il totale si aggiorna dal vivo. Il prezzo definitivo lo ricalcola comunque il database.
 */
export function Componi(props: {
  nome: string; base: number; gruppi: GruppoScelte[]; variante: "menu" | "gestionale";
  onConferma: (scelte: Scelta[]) => void; onChiudi: () => void;
  /** Testi nella lingua del cliente (pagina del tavolo); in sala resta l'italiano. */
  testi?: TestiComponi;
}) {
  const t = props.testi ?? TESTI_COMPONI.it;
  const [scelte, setScelte] = useState<Record<string, Scelta[]>>({});
  const tutte = useMemo(() => Object.values(scelte).flat(), [scelte]);
  const nAggiunte = Object.entries(scelte).reduce((n, [id, l]) => n + (eAggiunte(id) ? l.length : 0), 0);
  const valido = nAggiunte <= 10 && props.gruppi.every((g) => { const n = scelte[g.id]?.length ?? 0; return n >= g.min && n <= g.max; });
  const totale = prezzoComposto(props.base, tutte);

  const alterna = (g: GruppoScelte, s: Scelta) => setScelte((cur) => {
    const lista = cur[g.id] ?? [];
    if (lista.some((x) => x.id === s.id)) return { ...cur, [g.id]: lista.filter((x) => x.id !== s.id) };
    if (g.max === 1) return { ...cur, [g.id]: [s] };   // scelta singola: si sostituisce
    if (lista.length >= g.max) return cur;
    return { ...cur, [g.id]: [...lista, s] };
  });
  const regola = (g: GruppoScelte) => g.min === g.max ? `${t.scegli} ${g.max}` : g.min > 0 ? `${t.da} ${g.min} ${t.a} ${g.max}` : `${t.finoA} ${g.max}`;

  const corpo = (
    <div className="componi">
      <h3>{props.nome}</h3>
      {props.base > 0 && <p className="componi-base">{t.base} {euro(props.base)}</p>}
      {props.gruppi.map((g) => {
        const lista = scelte[g.id] ?? [];
        return (
          <fieldset key={g.id} className={`componi-gruppo${eAggiunte(g.id) ? " componi-aggiunte" : ""}`}>
            <legend>{g.nome} <span className="componi-regola">{regola(g)} · {lista.length} {t.scelti}</span></legend>
            {g.scelte.length === 0 && <p className="componi-vuoto">{t.nessuna}</p>}
            {g.scelte.map((s) => {
              const scelta = lista.some((x) => x.id === s.id);
              const pieno = !scelta && g.max > 1 && lista.length >= g.max;
              return (
                <label key={s.id} className={`componi-voce${scelta ? " scelta" : ""}${pieno ? " piena" : ""}`}>
                  <input type={g.max === 1 ? "radio" : "checkbox"} name={g.id} checked={scelta} disabled={pieno} onChange={() => alterna(g, s)} />
                  <span>{s.nome}</span>
                  <span className="componi-prezzo">{s.sovrapprezzo_cent ? `+ ${euro(s.sovrapprezzo_cent)}` : eAggiunte(g.id) ? t.gratis : t.incluso}</span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <div className="componi-azioni">
        <button className="componi-annulla" onClick={props.onChiudi}>{t.annulla}</button>
        <button className="componi-conferma" disabled={!valido} onClick={() => props.onConferma(tutte)}>{t.aggiungi} · {euro(totale)}</button>
      </div>
    </div>
  );
  return props.variante === "menu" ? (
    <div className="scheda-sfondo" onClick={props.onChiudi}>
      <div className="scheda-piatto" role="dialog" aria-modal="true" aria-label={`${t.componi} ${props.nome}`} onClick={(e) => e.stopPropagation()}>
        <button className="scheda-chiudi" onClick={props.onChiudi} aria-label={t.chiudi}>×</button>
        <div className="scheda-corpo">{corpo}</div>
      </div>
    </div>
  ) : (
    <div className="popup-sfondo" onClick={props.onChiudi}>
      <div className="popup componi-popup" role="dialog" aria-modal="true" aria-label={`${t.componi} ${props.nome}`} onClick={(e) => e.stopPropagation()}>{corpo}</div>
    </div>
  );
}
