import { useEffect, type CSSProperties } from "react";
import { centesimi, formatta } from "@gest/core";
import type { Aspetto, MenuPubblico } from "../lib/tipi";
import { caricaFont, pilaFont } from "../lib/font";

const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);

/** Il menu come lo vedono i clienti: usato sia dalla pagina pubblica sia dall'anteprima di Aspetto. */
export function MenuVista({ menu, aspetto }: { menu: MenuPubblico; aspetto: Aspetto }) {
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

  return (
    <div className={`menu menu-${aspetto.layout}`} style={stile}>
      <header className="menu-testata">
        {logo && <img className="menu-logo" src={logo} alt={aspetto.mostra_nome ? "" : menu.locale.nome} />}
        {(!logo || aspetto.mostra_nome) && <h1>{menu.locale.nome}</h1>}
        {menu.locale.indirizzo && <p>{menu.locale.indirizzo}</p>}
      </header>

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
              <article key={p.id} className={`menu-piatto${p.disponibile ? "" : " esaurito"}`}>
                {p.immagine_url && aspetto.layout === "griglia" && <img src={p.immagine_url} alt="" className="menu-foto" />}
                <div className="menu-riga">
                  <h3>{p.nome}</h3>
                  {!p.disponibile && <span className="menu-badge">Esaurito</span>}
                  {aspetto.layout !== "elegante" && <span className="menu-puntini" aria-hidden="true" />}
                  <span className="menu-prezzo">{formatta(centesimi(p.prezzo_cent))}</span>
                </div>
                {aspetto.mostra_descrizioni && p.descrizione && <p className="menu-desc">{p.descrizione}</p>}
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

      <footer className="menu-piede">
        {aspetto.testo_piede && <p>{aspetto.testo_piede}</p>}
        <p>Per informazioni sugli allergeni rivolgersi al personale.</p>
      </footer>
    </div>
  );
}
