import { useEffect, useRef, useState } from "react";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import type { MenuPubblico } from "../lib/tipi";

type Piatto = MenuPubblico["categorie"][number]["prodotti"][number];

/** Scheda aperta toccando un piatto: foto (scaricata solo ora), descrizione, allergeni. */
export function SchedaPiatto({ piatto, onChiudi }: { piatto: Piatto; onChiudi: () => void }) {
  const [foto, setFoto] = useState<string | null>(null);
  const chiudi = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let attivo = true;
    if (piatto.foto) {
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
          <div className="menu-riga"><h3>{piatto.nome}</h3><span className="menu-prezzo">{formatta(centesimi(piatto.prezzo_cent))}</span></div>
          {!piatto.disponibile && <p><span className="menu-badge">Esaurito</span></p>}
          {piatto.descrizione && <p className="menu-desc">{piatto.descrizione}</p>}
          {piatto.etichette.length > 0 && <ul className="menu-etichette">{piatto.etichette.map((e) => <li key={e}>{e}</li>)}</ul>}
          {piatto.allergeni.length > 0 && <p className="menu-allergeni">Allergeni: {piatto.allergeni.join(", ")}</p>}
        </div>
      </div>
    </div>
  );
}
