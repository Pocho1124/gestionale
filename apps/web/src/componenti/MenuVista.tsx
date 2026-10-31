import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { centesimi, formatta } from "@gest/core";
import type { Aspetto, MenuPubblico } from "../lib/tipi";
import { caricaFont, pilaFont } from "../lib/font";
import { SchedaPiatto } from "./SchedaPiatto";
import { TrovaVino } from "./TrovaVino";
import { TIPI_VINO } from "../lib/tipi";

const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);

/** Il menu come lo vedono i clienti: usato sia dalla pagina pubblica sia dall'anteprima di Aspetto. */
export function MenuVista({ menu, aspetto }: { menu: MenuPubblico; aspetto: Aspetto }) {
  type Piatto = MenuPubblico["categorie"][number]["prodotti"][number];
  const [aperto, setAperto] = useState<Piatto | null>(null);
  const chiudi = useCallback(() => setAperto(null), []);
  const [quiz, setQuiz] = useState(false);
  const perId = new Map(menu.categorie.flatMap((c) => c.prodotti.map((p) => [p.id, p] as const)));
  const numeroVini = menu.categorie.reduce((n, c) => n + c.prodotti.filter((p) => p.vino && p.disponibile).length, 0);
  useEffect(() => { caricaFont(aspetto.font_titoli); caricaFont(aspetto.font_testo); },
    [aspetto.font_titoli, aspetto.font_testo]);

  const logo = aspetto.logo_dati || aspetto.logo_url || null;
  const stile = {
    "--m-primario": aspetto.colore_primario,
    "--m-accento": aspetto.colore_accento,
    "--m-sfondo": aspetto.colore_sfondo,
    "--m-testo": aspetto.colore_testo,
    "--m-font-titoli": pilaFont(aspetto.font_titoli, SERIF.has(aspetto.font_titoli)),
    "--m-font-testo": pilaFont(aspetto.font_testo, SERIF.has(aspetto.font_testo)),
  } as CSSProperties;

  const foto = aspetto.sfondo_dati ? (
    <div className="menu-foto" aria-hidden="true" style={{
      backgroundImage: `url("${aspetto.sfondo_dati}")`,
      opacity: Math.min(100, Math.max(0, aspetto.sfondo_opacita)) / 100,
      filter: `blur(${aspetto.sfondo_sfocatura}px)${aspetto.sfondo_bn ? " grayscale(1)" : ""}`,
    }} />
  ) : null;

  return (
    <div className={`menu menu-${aspetto.layout}${foto ? " con-foto" : ""}`} style={stile}>
      {foto}
      <header className="menu-testata">
        {logo && <img className="menu-logo" src={logo} alt={aspetto.mostra_nome ? "" : menu.locale.nome} />}
        {(!logo || aspetto.mostra_nome) && <h1>{menu.locale.nome}</h1>}
        {menu.locale.indirizzo && <p>{menu.locale.indirizzo}</p>}
      </header>

      {numeroVini >= 2 && (
        <button className="menu-trova-vino" onClick={() => setQuiz(true)}>🍷 Trova il tuo vino</button>
      )}

      {menu.categorie.length > 0 && (
        <nav className="menu-nav" aria-label="Categorie">
          {menu.categorie.map((c) => <a key={c.id} href={`#cat-${c.id}`}>{c.nome}</a>)}
        </nav>
      )}

      {menu.categorie.length === 0 && <p className="menu-vuoto">Il menu sarà disponibile a breve.</p>}

      {menu.categorie.map((c) => (
        <section key={c.id} id={`cat-${c.id}`} className="menu-categoria">
          <h2>{c.nome}</h2>
          {aspetto.mostra_descrizioni && c.descrizione && <p className="menu-cat-desc">{c.descrizione}</p>}
          <div className="menu-prodotti">
            {c.prodotti.map((p) => (
              <article key={p.id} className={`menu-piatto${p.disponibile ? "" : " esaurito"}${p.foto || p.descrizione || p.vino || p.abbinamenti?.length ? " apribile" : ""}`}
                {...(p.foto || p.descrizione || p.vino || p.abbinamenti?.length ? {
                  role: "button", tabIndex: 0, "aria-label": `${p.nome}: apri la scheda`,
                  onClick: () => setAperto(p),
                  onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAperto(p); } },
                } : {})}>
                {p.immagine_url && aspetto.layout === "griglia" && <img src={p.immagine_url} alt="" className="menu-foto" />}
                <div className="menu-riga">
                  <h3>{p.nome}{p.foto ? <span className="menu-icona-foto" aria-hidden="true"> ◉</span> : null}</h3>
                  {!p.disponibile && <span className="menu-badge">Esaurito</span>}
                  {aspetto.layout !== "elegante" && <span className="menu-puntini" aria-hidden="true" />}
                  <span className="menu-prezzo">{formatta(centesimi(p.prezzo_cent))}</span>
                </div>
                {p.vino && <p className="menu-vino-info">{[TIPI_VINO[p.vino.tipo], p.vino.regione, p.vino.vitigno].filter(Boolean).join(" · ")}</p>}
                {aspetto.mostra_descrizioni && p.descrizione && <p className="menu-desc">{p.descrizione}</p>}
                {!p.vino && (p.abbinamenti?.length ?? 0) > 0 && (
                  <p className="menu-abbinamento">🍷 Si abbina con {p.abbinamenti!.slice(0, 2).map((a) => perId.get(a.id)?.nome).filter(Boolean).join(" o ")}</p>
                )}
                {p.etichette.length > 0 && (
                  <ul className="menu-etichette">{p.etichette.map((e) => <li key={e}>{e}</li>)}</ul>
                )}
                {aspetto.mostra_allergeni && p.allergeni.length > 0 && (
                  <p className="menu-allergeni">Allergeni: {p.allergeni.join(", ")}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      {aperto && <SchedaPiatto key={aperto.id} piatto={aperto} onChiudi={chiudi} perId={perId} onApri={(p) => { setQuiz(false); setAperto(p); }} />}
      {quiz && !aperto && <TrovaVino menu={menu} onApri={(p) => setAperto(p)} onChiudi={() => setQuiz(false)} />}

      <footer className="menu-piede">
        {aspetto.testo_piede && <p>{aspetto.testo_piede}</p>}
        <p>Per informazioni sugli allergeni rivolgersi al personale.</p>
      </footer>
    </div>
  );
}
