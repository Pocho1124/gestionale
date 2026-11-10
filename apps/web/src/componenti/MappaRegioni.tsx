import { useEffect, useState } from "react";
import { MAPPA_ITALIA } from "../lib/mappaItalia";
import { TESTI_MENU, type TestiMenu } from "../lib/traduzioni";

/** Mappa d'Italia: le regioni con vini in carta si illuminano; toccandone una si filtra il menu su quella regione. */
export function MappaRegioni({ viniPerRegione, onScegli, onChiudi, testi: T = TESTI_MENU.it }: {
  viniPerRegione: Map<string, number>; onScegli: (regione: string) => void; onChiudi: () => void; testi?: TestiMenu;
}) {
  const [accesa, setAccesa] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onChiudi(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onChiudi]);
  const quanti = accesa ? viniPerRegione.get(accesa) ?? 0 : 0;
  return (
    <div className="scheda-sfondo mappa-centro" onClick={onChiudi}>
      <div className="scheda-piatto menu-mappa" role="dialog" aria-modal="true" aria-label={T.mappaTitolo} onClick={(e) => e.stopPropagation()}>
        <button className="scheda-chiudi" onClick={onChiudi} aria-label={T.chiudi}>×</button>
        <div className="scheda-corpo">
          <p className="quiz-passo">{T.scegliRegione}</p>
          <p className="menu-mappa-nome" aria-live="polite">{accesa ? `${accesa} · ${quanti} ${quanti === 1 ? T.vino : T.vini}` : T.tocca}</p>
          <svg viewBox={`0 0 ${MAPPA_ITALIA.larghezza} ${MAPPA_ITALIA.altezza}`} role="group" aria-label={T.regioniItalia}>
            {Object.entries(MAPPA_ITALIA.regioni).map(([r, d]) => viniPerRegione.has(r) ? (
              <path key={r} d={d} className={`con-vini${accesa === r ? " acceso" : ""}`} tabIndex={0} role="button"
                aria-label={`${r}: ${viniPerRegione.get(r)} ${T.vini}`}
                onMouseEnter={() => setAccesa(r)} onFocus={() => setAccesa(r)} onClick={() => onScegli(r)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onScegli(r); } }}>
                <title>{r}</title>
              </path>
            ) : <path key={r} d={d}><title>{r}</title></path>)}
          </svg>
          <p className="menu-mappa-fonte">{T.fonteMappa}</p>
        </div>
      </div>
    </div>
  );
}
