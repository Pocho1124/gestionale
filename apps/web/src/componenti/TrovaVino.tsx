import { useMemo, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { CORPI_VINO, TIPI_VINO, type MenuPubblico, type PiattoMenu } from "../lib/tipi";

type Tipo = keyof typeof TIPI_VINO | "sorpresa";
type Corpo = keyof typeof CORPI_VINO | "indifferente";
const ORDINE_CORPO = ["leggero", "medio", "strutturato"];

/** Tre domande, poi 2-3 vini della carta con il perché. Tutto calcolato sul telefono del cliente. */
export function TrovaVino({ menu, onApri, onChiudi }: { menu: MenuPubblico; onApri: (p: PiattoMenu) => void; onChiudi: () => void }) {
  const tutti = useMemo(() => menu.categorie.flatMap((c) => c.prodotti.map((p) => ({ ...p, categoria: c.id }))), [menu]);
  const vini = tutti.filter((p) => p.vino && p.disponibile);
  const perId = new Map(tutti.map((p) => [p.id, p]));
  const categorieCibo = menu.categorie.filter((c) => c.prodotti.some((p) => !p.vino));
  const tipiPresenti = [...new Set(vini.map((v) => v.vino!.tipo))];

  const [passo, setPasso] = useState(0);
  const [tipo, setTipo] = useState<Tipo>("sorpresa");
  const [corpo, setCorpo] = useState<Corpo>("indifferente");
  const [cibo, setCibo] = useState<string | null>(null);

  const risultati = useMemo(() => {
    if (passo < 3) return [];
    return vini.map((v) => {
      let punti = 0;
      const perche: string[] = [];
      if (tipo !== "sorpresa" && v.vino!.tipo === tipo) { punti += 3; perche.push(`${TIPI_VINO[v.vino!.tipo]}, come preferisci`); }
      if (corpo !== "indifferente") {
        const distanza = Math.abs(ORDINE_CORPO.indexOf(v.vino!.corpo) - ORDINE_CORPO.indexOf(corpo));
        if (distanza === 0) { punti += 2; perche.push(CORPI_VINO[v.vino!.corpo]); } else if (distanza === 1) punti += 1;
      }
      const piatti = (v.abbinamenti ?? []).map((a) => perId.get(a.id)).filter((p) => p && (!cibo || p.categoria === cibo));
      if (piatti.length) { punti += Math.min(4, piatti.length * 2); perche.push(`Si abbina a ${piatti.slice(0, 2).map((p) => p!.nome).join(" e ")}`); }
      return { v, punti, perche };
    }).filter((r) => r.punti > 0 || tipo === "sorpresa").sort((a, b) => b.punti - a.punti).slice(0, 3);
  }, [passo, vini, tipo, corpo, cibo, perId]);

  const scelta = (etichetta: string, attiva: boolean, azione: () => void) => (
    <button key={etichetta} className={`quiz-scelta${attiva ? " attiva" : ""}`} onClick={azione}>{etichetta}</button>
  );

  return (
    <div className="scheda-sfondo" onClick={onChiudi}>
      <div className="scheda-piatto quiz" role="dialog" aria-modal="true" aria-label="Trova il tuo vino" onClick={(e) => e.stopPropagation()}>
        <button className="scheda-chiudi" onClick={onChiudi} aria-label="Chiudi">×</button>
        <div className="scheda-corpo">
          <p className="quiz-passo">{passo < 3 ? `Domanda ${passo + 1} di 3` : "Il sommelier consiglia"}</p>
          {passo === 0 && <>
            <h3>Che vino preferisci?</h3>
            <div className="quiz-scelte">
              {tipiPresenti.map((t) => scelta(TIPI_VINO[t], false, () => { setTipo(t); setPasso(1); }))}
              {scelta("Sorprendimi", false, () => { setTipo("sorpresa"); setPasso(1); })}
            </div>
          </>}
          {passo === 1 && <>
            <h3>Come lo vorresti?</h3>
            <div className="quiz-scelte">
              {scelta("Leggero e fresco", false, () => { setCorpo("leggero"); setPasso(2); })}
              {scelta("Equilibrato", false, () => { setCorpo("medio"); setPasso(2); })}
              {scelta("Strutturato e intenso", false, () => { setCorpo("strutturato"); setPasso(2); })}
              {scelta("Indifferente", false, () => { setCorpo("indifferente"); setPasso(2); })}
            </div>
          </>}
          {passo === 2 && <>
            <h3>Cosa mangerai?</h3>
            <div className="quiz-scelte">
              {categorieCibo.map((c) => scelta(c.nome, false, () => { setCibo(c.id); setPasso(3); }))}
              {scelta("Solo vino", false, () => { setCibo(null); setPasso(3); })}
            </div>
          </>}
          {passo === 3 && <>
            {risultati.length === 0 && <p>Nessun vino corrisponde esattamente: chiedi al personale, saprà consigliarti.</p>}
            <div className="quiz-risultati">
              {risultati.map(({ v, perche }, i) => (
                <button key={v.id} className="quiz-vino" onClick={() => onApri(v)}>
                  <span className="quiz-posizione">{i + 1}</span>
                  <span className="quiz-dati">
                    <strong>{v.nome}</strong>
                    <span className="quiz-info">{[TIPI_VINO[v.vino!.tipo], v.vino!.regione, v.vino!.vitigno].filter(Boolean).join(" · ")}</span>
                    {perche.length > 0 && <span className="quiz-perche">{perche.join(" · ")}</span>}
                  </span>
                  <span className="menu-prezzo">{formatta(centesimi(v.prezzo_cent))}</span>
                </button>
              ))}
            </div>
            <button className="quiz-scelta" onClick={() => setPasso(0)}>Ricomincia</button>
          </>}
        </div>
      </div>
    </div>
  );
}
