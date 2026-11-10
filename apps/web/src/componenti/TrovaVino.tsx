import { useMemo, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { CORPI_VINO, TIPI_VINO, type MenuPubblico, type PiattoMenu } from "../lib/tipi";
import { TESTI_MENU, type TestiMenu } from "../lib/traduzioni";

type Tipo = keyof typeof TIPI_VINO | "sorpresa";
type Corpo = keyof typeof CORPI_VINO | "indifferente";
const ORDINE_CORPO = ["leggero", "medio", "strutturato"];

/** Tre domande, poi 2-3 vini della carta con il perché. Tutto calcolato sul telefono del cliente. */
export function TrovaVino({ menu, onApri, onChiudi, testi: T = TESTI_MENU.it }: { menu: MenuPubblico; onApri: (p: PiattoMenu) => void; onChiudi: () => void; testi?: TestiMenu }) {
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
    // Il colore scelto è vincolante: un cliente che chiede un rosso non riceve mai un bianco
    const candidati = vini.filter((v) => tipo === "sorpresa" || v.vino!.tipo === tipo);
    const valutati = candidati.map((v) => {
      let punti = 0;
      const perche: string[] = [];
      if (tipo !== "sorpresa") perche.push(`${T.tipi[v.vino!.tipo]}${T.comePreferisci}`);
      let distanza = 0;
      if (corpo !== "indifferente") {
        distanza = Math.abs(ORDINE_CORPO.indexOf(v.vino!.corpo) - ORDINE_CORPO.indexOf(corpo));
        if (distanza === 0) { punti += 3; perche.push(T.corpi[v.vino!.corpo] ?? ""); } else if (distanza === 1) punti += 1;
      }
      const piatti = (v.abbinamenti ?? []).map((a) => perId.get(a.id)).filter((p) => p && (!cibo || p.categoria === cibo));
      if (piatti.length) { punti += Math.min(4, piatti.length * 2); perche.push(`${T.siAbbinaA}${piatti.slice(0, 2).map((p) => p!.nome).join(T.e)}`); }
      return { v, punti, perche, distanza };
    });
    // Corpo opposto (leggero ↔ strutturato) solo se non c'è nient'altro del colore scelto
    const vicini = valutati.filter((r) => r.distanza < 2);
    return (vicini.length ? vicini : valutati).sort((a, b) => b.punti - a.punti || a.v.prezzo_cent - b.v.prezzo_cent).slice(0, 3);
  }, [passo, vini, tipo, corpo, cibo, perId, T]);

  const scelta = (etichetta: string, attiva: boolean, azione: () => void) => (
    <button key={etichetta} className={`quiz-scelta${attiva ? " attiva" : ""}`} onClick={azione}>{etichetta}</button>
  );

  return (
    <div className="scheda-sfondo" onClick={onChiudi}>
      <div className="scheda-piatto quiz" role="dialog" aria-modal="true" aria-label={T.trovaTitolo} onClick={(e) => e.stopPropagation()}>
        <button className="scheda-chiudi" onClick={onChiudi} aria-label={T.chiudi}>×</button>
        <div className="scheda-corpo">
          <p className="quiz-passo">{passo < 3 ? T.domanda(passo + 1) : T.sommelier}</p>
          {passo === 0 && <>
            <h3>{T.qVino}</h3>
            <div className="quiz-scelte">
              {tipiPresenti.map((t) => scelta(T.tipi[t] ?? TIPI_VINO[t], false, () => { setTipo(t); setPasso(1); }))}
              {scelta(T.sorprendimi, false, () => { setTipo("sorpresa"); setPasso(1); })}
            </div>
          </>}
          {passo === 1 && <>
            <h3>{T.qCorpo}</h3>
            <div className="quiz-scelte">
              {scelta(T.leggero, false, () => { setCorpo("leggero"); setPasso(2); })}
              {scelta(T.equilibrato, false, () => { setCorpo("medio"); setPasso(2); })}
              {scelta(T.strutturato, false, () => { setCorpo("strutturato"); setPasso(2); })}
              {scelta(T.indifferente, false, () => { setCorpo("indifferente"); setPasso(2); })}
            </div>
          </>}
          {passo === 2 && <>
            <h3>{T.qCibo}</h3>
            <div className="quiz-scelte">
              {categorieCibo.map((c) => scelta(c.nome, false, () => { setCibo(c.id); setPasso(3); }))}
              {scelta(T.soloVino, false, () => { setCibo(null); setPasso(3); })}
            </div>
          </>}
          {passo === 3 && <>
            {risultati.length === 0 && <p>{T.nessuno(tipo !== "sorpresa" ? T.tipi[tipo] ?? TIPI_VINO[tipo] : null)}</p>}
            <div className="quiz-risultati">
              {risultati.map(({ v, perche }, i) => (
                <button key={v.id} className="quiz-vino" onClick={() => onApri(v)}>
                  <span className="quiz-posizione">{i + 1}</span>
                  <span className="quiz-dati">
                    <strong>{v.nome}</strong>
                    <span className="quiz-info">{[T.tipi[v.vino!.tipo], v.vino!.regione, v.vino!.vitigno].filter(Boolean).join(" · ")}</span>
                    {perche.length > 0 && <span className="quiz-perche">{perche.join(" · ")}</span>}
                  </span>
                  <span className="menu-prezzo">{formatta(centesimi(v.prezzo_cent))}</span>
                </button>
              ))}
            </div>
            <button className="quiz-scelta" onClick={() => setPasso(0)}>{T.ricomincia}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
