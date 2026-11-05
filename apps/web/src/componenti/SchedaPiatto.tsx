import { useEffect, useRef, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { urlImmagine } from "../lib/archivio";
import { CORPI_VINO, TIPI_VINO, type PiattoMenu } from "../lib/tipi";

type Piatto = PiattoMenu;

/** Scheda aperta toccando un piatto: foto (scaricata solo ora), descrizione, allergeni. */
export function SchedaPiatto({ piatto, onChiudi, perId, onApri, storia = [], onIndietro }: {
  piatto: Piatto; onChiudi: () => void; perId: Map<string, Piatto>; onApri: (p: Piatto) => void;
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
        <button ref={chiudi} className="scheda-chiudi" onClick={onChiudi} aria-label="Chiudi">×</button>
        {piatto.foto && (foto ? <img className="scheda-foto" src={foto} alt={piatto.nome} /> : <div className="scheda-foto scheda-attesa" />)}
        <div className="scheda-corpo">
          {precedente && onIndietro && <button className="scheda-indietro" onClick={onIndietro}>← Torna a {precedente.nome}</button>}
          <div className="menu-riga"><h3>{piatto.nome}</h3><span className="menu-prezzo">{formatta(centesimi(piatto.prezzo_cent))}</span></div>
          {!piatto.disponibile && <p><span className="menu-badge">Esaurito</span></p>}
          {v && <p className="scheda-vino">{[TIPI_VINO[v.tipo], CORPI_VINO[v.corpo], v.regione, v.vitigno].filter(Boolean).join(" · ")}</p>}
          {v && (v.cantina || v.annata) && <p className="menu-desc">{[v.cantina, v.annata].filter(Boolean).join(", ")}</p>}
          {v?.prezzo_bottiglia_cent ? <p className="scheda-bottiglia">Calice {formatta(centesimi(piatto.prezzo_cent))} · Bottiglia {formatta(centesimi(v.prezzo_bottiglia_cent))}</p> : null}
          {piatto.descrizione && <p className="menu-desc">{piatto.descrizione}</p>}
          {v?.note && <p className="menu-desc">{v.note}</p>}
          {abbinati.length > 0 && (
            <div className="scheda-abbinamenti">
              <p className="quiz-passo">{v ? "Ideale con" : "Il sommelier consiglia"}</p>
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
              <p className="quiz-passo">{g.nome} · {g.min === g.max ? `scegli ${g.max}` : g.min > 0 ? `da ${g.min} a ${g.max}` : `fino a ${g.max}`}</p>
              {g.scelte.map((c) => (
                <p key={c.id ?? c.nome} className="riga-cassa"><span>{c.nome}</span><span className="menu-prezzo">{c.sovrapprezzo_cent ? `+ ${formatta(centesimi(c.sovrapprezzo_cent))}` : "incluso"}</span></p>
              ))}
            </div>
          ))}
          {piatto.allergeni.length > 0 && <p className="menu-allergeni">Allergeni: {piatto.allergeni.join(", ")}</p>}
        </div>
      </div>
    </div>
  );
}
