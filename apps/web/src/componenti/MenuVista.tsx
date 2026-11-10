import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { centesimi, formatta } from "@gest/core";
import type { Aspetto, MenuPubblico } from "../lib/tipi";
import { caricaFont, pilaFont } from "../lib/font";
import { SchedaPiatto } from "./SchedaPiatto";
import { sorgenteImmagine } from "../lib/archivio";
import { regioneDi } from "../lib/regioni";
import { MappaRegioni } from "./MappaRegioni";
import { MAPPA_ITALIA } from "../lib/mappaItalia";
import { TrovaVino } from "./TrovaVino";
import type { PiattoMenu } from "../lib/tipi";
import { LINGUE, TESTI_MENU, menuInLingua, type Lingua } from "../lib/traduzioni";
import { prezzoMinimo } from "../lib/aggiunte";

const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);

/** Il menu come lo vedono i clienti: usato sia dalla pagina pubblica sia dall'anteprima di Aspetto. */
export function MenuVista({ menu: menuOriginale, aspetto, lingua = "it", onLingua }: {
  menu: MenuPubblico; aspetto: Aspetto;
  /** Lingua dei testi; con onLingua in fondo compaiono le bandierine per cambiarla (non nell'anteprima di Aspetto). */
  lingua?: Lingua; onLingua?: (l: Lingua) => void;
}) {
  const menu = menuInLingua(menuOriginale, lingua);
  const T = TESTI_MENU[lingua];
  type Piatto = MenuPubblico["categorie"][number]["prodotti"][number];
  const [aperto, setAperto] = useState<Piatto | null>(null);
  const [storia, setStoria] = useState<PiattoMenu[]>([]);
  const chiudi = useCallback(() => { setAperto(null); setStoria([]); }, []);
  const [quiz, setQuiz] = useState(false);
  const perId = new Map(menu.categorie.flatMap((c) => c.prodotti.map((p) => [p.id, p] as const)));
  const [regione, setRegione] = useState("");
  const regioneVino = (p: PiattoMenu) => (p.vino ? regioneDi(p.vino.regione) || T.altreZone : "");
  const ordina = (x: string, y: string) => Number(x === T.altreZone) - Number(y === T.altreZone) || x.localeCompare(y, "it");
  const [mappa, setMappa] = useState(false);
  const viniPerRegione = new Map<string, number>();
  for (const c of menu.categorie) for (const p of c.prodotti) if (p.vino) viniPerRegione.set(regioneVino(p), (viniPerRegione.get(regioneVino(p)) ?? 0) + 1);
  const conMappa = [...viniPerRegione.keys()].some((r) => MAPPA_ITALIA.regioni[r]);
  const tutteLeRegioni = [...new Set(menu.categorie.flatMap((c) => c.prodotti.filter((p) => p.vino).map(regioneVino)))].sort(ordina);
  const numeroVini = menu.categorie.reduce((n, c) => n + c.prodotti.filter((p) => p.vino && p.disponibile).length, 0);
  useEffect(() => { caricaFont(aspetto.font_titoli); caricaFont(aspetto.font_testo); },
    [aspetto.font_titoli, aspetto.font_testo]);

  const logo = sorgenteImmagine(aspetto.logo_path, aspetto.logo_dati, aspetto.logo_url);
  const sfondo = sorgenteImmagine(aspetto.sfondo_path, aspetto.sfondo_dati);
  const stile = {
    "--m-primario": aspetto.colore_primario,
    "--m-accento": aspetto.colore_accento,
    "--m-sfondo": aspetto.colore_sfondo,
    "--m-testo": aspetto.colore_testo,
    "--m-font-titoli": pilaFont(aspetto.font_titoli, SERIF.has(aspetto.font_titoli)),
    "--m-font-testo": pilaFont(aspetto.font_testo, SERIF.has(aspetto.font_testo)),
  } as CSSProperties;

  const modo = aspetto.sfondo_modo === "testata" ? "testata" : "pagina";
  const visibile = Math.min(100, Math.max(0, aspetto.sfondo_opacita)) / 100;
  const foto = sfondo ? (
    <div className={`menu-sfondo menu-sfondo-${modo}`} aria-hidden="true">
      <div className="menu-sfondo-immagine" style={{
        backgroundImage: `url("${sfondo}")`,
        filter: `blur(${aspetto.sfondo_sfocatura}px)${aspetto.sfondo_bn ? " grayscale(1)" : ""}`,
      }} />
      {/* Velo del colore di sfondo: più la foto è «visibile», più il velo è trasparente */}
      <div className="menu-sfondo-velo" style={{ opacity: 1 - visibile }} />
    </div>
  ) : null;

  return (
    <div className={`menu menu-${aspetto.layout}${foto ? ` con-foto con-foto-${modo}` : ""}`} style={stile}>
      {modo === "pagina" && foto}
      <header className="menu-testata">
        {modo === "testata" && foto}
        {logo && <img className="menu-logo" src={logo} alt={aspetto.mostra_nome ? "" : menu.locale.nome} />}
        {(!logo || aspetto.mostra_nome) && <h1>{menu.locale.nome}</h1>}
        {menu.locale.indirizzo && <p>{menu.locale.indirizzo}</p>}
      </header>

      {/* Scelta della lingua in alto, sopra «Trova il tuo vino» */}
      {onLingua && (
        <div className="menu-lingue" role="navigation" aria-label="Lingua / Language">
          {LINGUE.map(([l, bandiera, nome]) => (
            <button key={l} lang={l} aria-pressed={lingua === l} className={lingua === l ? "attiva" : ""} onClick={() => onLingua(l)}>{bandiera} {nome}</button>
          ))}
        </div>
      )}

      {numeroVini >= 2 && (
        <button className="menu-trova-vino" onClick={() => setQuiz(true)}>{T.trova}</button>
      )}

      {tutteLeRegioni.length >= 2 && (
        <div className="menu-filtro-regioni" role="group" aria-label={T.viniPerRegione}>
          <p className="menu-filtro-titolo">{T.viniPerRegione}</p>
          {conMappa && <button type="button" className="apri-mappa" onClick={() => setMappa(true)}>{T.mappa}</button>}
          <div className="menu-filtro-scelte">
            {["", ...tutteLeRegioni].map((r) => (
              <button key={r || "tutte"} type="button" className={regione === r ? "attiva" : ""} aria-pressed={regione === r} onClick={() => setRegione(r)}>{r || T.tutte}</button>
            ))}
          </div>
        </div>
      )}

      {menu.categorie.length > 0 && (
        <nav className="menu-nav" aria-label={T.categorie}>
          {menu.categorie.map((c) => <a key={c.id} href={`#cat-${c.id}`}>{c.nome}</a>)}
        </nav>
      )}

      {menu.categorie.length === 0 && <p className="menu-vuoto">{T.vuoto}</p>}

      {menu.categorie.map((c) => {
        // Vini della regione scelta (gli altri piatti restano); categorie di soli vini raggruppate per regione
        const prodotti = c.prodotti.filter((p) => !regione || !p.vino || regioneVino(p) === regione);
        const soloVini = prodotti.length > 0 && prodotti.every((p) => p.vino);
        if (regione && c.prodotti.some((p) => p.vino) && !prodotti.some((p) => p.vino)) return null;
        const regioniCat = soloVini ? [...new Set(prodotti.map(regioneVino))].sort(ordina) : [];
        const gruppi: [string, PiattoMenu[]][] = regioniCat.length >= 2 ? regioniCat.map((r) => [r, prodotti.filter((p) => regioneVino(p) === r)]) : [["", prodotti]];
        return (
        <section key={c.id} id={`cat-${c.id}`} className="menu-categoria">
          <h2>{c.nome}</h2>
          {aspetto.mostra_descrizioni && c.descrizione && <p className="menu-cat-desc">{c.descrizione}</p>}
          {gruppi.map(([nomeRegione, lista]) => (
          <div className="menu-prodotti" key={nomeRegione || "tutti"}>
            {nomeRegione && <h3 className="menu-regione-titolo">{nomeRegione}</h3>}
            {lista.map((p) => (
              <article key={p.id} className={`menu-piatto${p.disponibile ? "" : " esaurito"}${p.foto || p.descrizione || p.vino || p.abbinamenti?.length || p.opzioni?.length ? " apribile" : ""}`}
                {...(p.foto || p.descrizione || p.vino || p.abbinamenti?.length || p.opzioni?.length ? {
                  role: "button", tabIndex: 0, "aria-label": `${p.nome}: ${T.apriScheda}`,
                  onClick: () => setAperto(p),
                  onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAperto(p); } },
                } : {})}>
                {p.immagine_url && aspetto.layout === "griglia" && <img src={p.immagine_url} alt="" className="menu-foto" />}
                <div className="menu-riga">
                  <h3>{p.nome}{p.foto ? <span className="menu-icona-foto" aria-hidden="true"> ◉</span> : null}</h3>
                  {!p.disponibile && <span className="menu-badge">{T.esaurito}</span>}
                  {aspetto.layout !== "elegante" && <span className="menu-puntini" aria-hidden="true" />}
                  <span className="menu-prezzo">{p.opzioni?.length ? T.da : ""}{formatta(centesimi(prezzoMinimo(p.prezzo_cent, p.opzioni)))}</span>
                </div>
                {p.vino && <p className="menu-vino-info">{[T.tipi[p.vino.tipo], p.vino.regione, p.vino.vitigno].filter(Boolean).join(" · ")}</p>}
                {aspetto.mostra_descrizioni && p.descrizione && <p className="menu-desc">{p.descrizione}</p>}
                {!p.vino && (p.abbinamenti?.length ?? 0) > 0 && (
                  <p className="menu-abbinamento">{T.siAbbinaCon}{p.abbinamenti!.slice(0, 2).map((a) => perId.get(a.id)?.nome).filter(Boolean).join(T.o)}</p>
                )}
                {p.etichette.length > 0 && (
                  <ul className="menu-etichette">{p.etichette.map((e) => <li key={e}>{e}</li>)}</ul>
                )}
                {aspetto.mostra_allergeni && p.allergeni.length > 0 && (
                  <p className="menu-allergeni">{T.allergeni}{p.allergeni.join(", ")}</p>
                )}
              </article>
            ))}
          </div>
          ))}
        </section>
        );
      })}

      {aperto && <SchedaPiatto key={aperto.id} testi={T} piatto={perId.get(aperto.id) ?? aperto} onChiudi={chiudi} perId={perId} storia={storia}
        onApri={(p) => { setQuiz(false); setStoria((s) => [...s, aperto]); setAperto(p); }}
        onIndietro={() => { setAperto(storia[storia.length - 1] ?? null); setStoria((s) => s.slice(0, -1)); }} />}
      {mappa && <MappaRegioni testi={T} viniPerRegione={viniPerRegione} onChiudi={() => setMappa(false)} onScegli={(r) => { setRegione(r); setMappa(false); }} />}
      {quiz && !aperto && <TrovaVino testi={T} menu={menu} onApri={(p) => setAperto(p)} onChiudi={() => setQuiz(false)} />}

      <footer className="menu-piede">
        {aspetto.testo_piede && <p>{aspetto.testo_piede}</p>}
        <p>{T.infoAllergeni}</p>
      </footer>
    </div>
  );
}
