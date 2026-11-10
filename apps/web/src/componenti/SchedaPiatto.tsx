import { useEffect, useRef, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { urlImmagine } from "../lib/archivio";
import type { PiattoMenu } from "../lib/tipi";
import { TESTI_MENU, type TestiMenu } from "../lib/traduzioni";

type Piatto = PiattoMenu;

/** Scheda aperta toccando un piatto: foto (scaricata solo ora), descrizione, allergeni. */
export function SchedaPiatto({ piatto, onChiudi, perId, onApri, storia = [], onIndietro, testi: T = TESTI_MENU.it }: {
  piatto: Piatto; onChiudi: () => void; perId: Map<string, Piatto>; onApri: (p: Piatto) => void; testi?: TestiMenu;
  storia?: Piatto[]; onIndietro?: () => void;   // schede aperte prima di questa (es. pinsa → vino): «Torna a …»
}) {
  const v = piatto.vino;
  // Niente rimandi alle schede già aperte nel percorso: evita il giro infinito piatto → vino → piatto
  const giaVisti = new Set(storia.map((x) => x.id));
  const abbinati = (piatto.abbinamenti ?? []).map((a) => ({ p: perId.get(a.id), motivo: a.motivo })).filter((x) => x.p && !giaVisti.has(x.p.id));
  const precedente = storia[storia.length - 1];
  const [foto, setFoto] = useState<string | null>(null);
  const chiudi = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let attivo = true;
    if (piatto.foto_path) setFoto(urlImmagine(piatto.foto_path));
    else if (piatto.foto) {
      void sb().rpc("foto_prodotto", { p_prodotto: piatto.id }).then(({ data }) => { if (attivo) setFoto((data as string | null) ?? null); });
    }
    chiudi.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onChiudi(); };
    document.addEventListener("keydown", esc);
    return () => { attivo = false; document.removeEventListener("keydown", esc); };
  }, [piatto, onChiudi]);

  return (
    <div className="scheda-sfondo" onClick={onChiudi}>
      <div className="scheda-piatto" role="dialog" aria-modal="true" aria-label={piatto.nome} onClick={(e) => e.stopPropagation()}>
        <button ref={chiudi} className="scheda-chiudi" onClick={onChiudi} aria-label={T.chiudi}>×</button>
        {piatto.foto && (foto ? <img className="scheda-foto" src={foto} alt={piatto.nome} /> : <div className="scheda-foto scheda-attesa" />)}
        <div className="scheda-corpo">
          {precedente && onIndietro && <button className="scheda-indietro" onClick={onIndietro}>{T.torna}{(perId.get(precedente.id) ?? precedente).nome}</button>}
          <div className="menu-riga"><h3>{piatto.nome}</h3><span className="menu-prezzo">{formatta(centesimi(piatto.prezzo_cent))}</span></div>
          {!piatto.disponibile && <p><span className="menu-badge">{T.esaurito}</span></p>}
          {v && <p className="scheda-vino">{[T.tipi[v.tipo], T.corpi[v.corpo], v.regione, v.vitigno].filter(Boolean).join(" · ")}</p>}
          {v && (v.cantina || v.annata) && <p className="menu-desc">{[v.cantina, v.annata].filter(Boolean).join(", ")}</p>}
          {v?.prezzo_bottiglia_cent ? <p className="scheda-bottiglia">{T.calice}{formatta(centesimi(piatto.prezzo_cent))}{T.bottiglia}{formatta(centesimi(v.prezzo_bottiglia_cent))}</p> : null}
          {piatto.descrizione && <p className="menu-desc">{piatto.descrizione}</p>}
          {v?.note && <p className="menu-desc">{v.note}</p>}
          {abbinati.length > 0 && (
            <div className="scheda-abbinamenti">
              <p className="quiz-passo">{v ? T.idealeCon : T.sommelier}</p>
              {abbinati.map(({ p, motivo }) => (
                <button key={p!.id} className="quiz-vino" onClick={() => onApri(p!)}>
                  <span className="quiz-dati"><strong>{p!.nome}</strong>{motivo && <span className="quiz-perche">{motivo}</span>}</span>
                  <span className="menu-prezzo">{formatta(centesimi(p!.prezzo_cent))}</span>
                </button>
              ))}
            </div>
          )}
          {piatto.etichette.length > 0 && <ul className="menu-etichette">{piatto.etichette.map((e) => <li key={e}>{e}</li>)}</ul>}
          {piatto.opzioni?.map((g) => (
            <div key={g.id ?? g.nome} className="scheda-abbinamenti">
              <p className="quiz-passo">{g.nome} · {g.min === g.max ? `${T.scegli}${g.max}` : g.min > 0 ? `${T.da}${g.min}${T.a}${g.max}` : `${T.finoA}${g.max}`}</p>
              {g.scelte.map((c) => (
                <p key={c.id ?? c.nome} className="riga-cassa"><span>{c.nome}</span><span className="menu-prezzo">{c.sovrapprezzo_cent ? `+ ${formatta(centesimi(c.sovrapprezzo_cent))}` : T.incluso}</span></p>
              ))}
            </div>
          ))}
          {piatto.allergeni.length > 0 && <p className="menu-allergeni">{T.allergeni}{piatto.allergeni.join(", ")}</p>}
        </div>
      </div>
    </div>
  );
}
