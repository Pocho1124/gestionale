import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { FONT_TESTO, FONT_TITOLI, type Aspetto as TAspetto, type MenuPubblico } from "../lib/tipi";
import { MenuVista } from "../componenti/MenuVista";
import { ASPETTO_PREDEFINITO } from "./MenuPubblico";
import { preparaImmagine } from "../lib/immagini";
import { caricaImmagine, eliminaImmagine, sorgenteImmagine } from "../lib/archivio";

type Tema = Pick<TAspetto, "colore_primario" | "colore_accento" | "colore_sfondo" | "colore_testo" | "font_titoli" | "font_testo" | "layout">;

/** Temi pronti: applicano colori, caratteri e impaginazione (logo e testi restano invariati). */
const TEMI: { nome: string; descrizione: string; tema: Tema }[] = [
  { nome: "Enoteca notte", descrizione: "Scuro, oro e bordeaux",
    tema: { colore_sfondo: "#12100E", colore_testo: "#EDE6DA", colore_primario: "#C9A45C", colore_accento: "#8C2F39",
            font_titoli: "Cormorant Garamond", font_testo: "Lora", layout: "elegante" } },
  { nome: "Bordeaux", descrizione: "Vinaccia profondo, crema",
    tema: { colore_sfondo: "#2A0E14", colore_testo: "#F3E9DC", colore_primario: "#E2C08D", colore_accento: "#B85C38",
            font_titoli: "Playfair Display", font_testo: "Lora", layout: "elegante" } },
  { nome: "Bistrot", descrizione: "Chiaro, verde bottiglia",
    tema: { colore_sfondo: "#F7F3EA", colore_testo: "#1F1A14", colore_primario: "#2F4F3E", colore_accento: "#C46A2D",
            font_titoli: "Playfair Display", font_testo: "Figtree", layout: "lista" } },
  { nome: "Minimal", descrizione: "Bianco e nero, compatto",
    tema: { colore_sfondo: "#FFFFFF", colore_testo: "#111111", colore_primario: "#111111", colore_accento: "#E5E5E5",
            font_titoli: "Inter", font_testo: "Inter", layout: "compatto" } },
  { nome: "Classico", descrizione: "Il tema iniziale",
    tema: { colore_sfondo: "#F2F5F8", colore_testo: "#13233A", colore_primario: "#1F4FA8", colore_accento: "#F2C230",
            font_titoli: "Young Serif", font_testo: "Figtree", layout: "lista" } },
];

/** Riduce il logo a max 800 px e lo incorpora (PNG, o WebP se troppo pesante): nessun file esterno da gestire. */

const COLORI: { campo: keyof TAspetto; etichetta: string }[] = [
  { campo: "colore_primario", etichetta: "Colore principale" },
  { campo: "colore_accento", etichetta: "Colore di accento" },
  { campo: "colore_sfondo", etichetta: "Sfondo" },
  { campo: "colore_testo", etichetta: "Testo" },
];

/** Modifica grafica del menu con anteprima dal vivo: nulla viene pubblicato finché non si salva. */
export function Aspetto() {
  const { locale } = useSessione();
  const avvisa = useAvviso();
  const [salvato, setSalvato] = useState<TAspetto | null>(null);
  const [bozza, setBozza] = useState<TAspetto | null>(null);
  const [menu, setMenu] = useState<MenuPubblico | null>(null);
  const [attesa, setAttesa] = useState(false);

  useEffect(() => {
    if (!locale) return;
    void (async () => {
      const [a, m] = await Promise.all([
        sb().from("aspetto").select("*").eq("locale_id", locale.id).maybeSingle(),
        sb().rpc("menu_pubblico", { p_slug: locale.slug }),
      ]);
      if (a.error) { avvisa(messaggioErrore(a.error), "errore"); return; }
      const valore = (a.data as TAspetto | null) ?? ASPETTO_PREDEFINITO;
      setSalvato(valore); setBozza(valore);
      if (!m.error && m.data) setMenu(m.data as MenuPubblico);
    })();
  }, [locale, avvisa]);

  if (!bozza || !salvato || !locale) return <p className="muto">Caricamento…</p>;

  const modificato = JSON.stringify(bozza) !== JSON.stringify(salvato);
  const logoAttuale = sorgenteImmagine(bozza.logo_path, bozza.logo_dati, bozza.logo_url);
  const sfondoAttuale = sorgenteImmagine(bozza.sfondo_path, bozza.sfondo_dati);

  async function caricaSfondo(file: File | undefined) {
    if (!file || !bozza) return;
    try {
      const blob = await preparaImmagine(file, { lato: 1600, limite: 1_000_000 });
      const percorso = await caricaImmagine(locale!.id, "sfondo", blob);
      setBozza({ ...bozza, sfondo_path: percorso, sfondo_dati: null });
      avvisa("Foto caricata: regola visibilità e sfocatura, poi pubblica");
    } catch (e) { avvisa(e instanceof Error ? e.message : "Foto non valida", "errore"); }
  }

  /** Carosello: altre foto dello sfondo, caricate anche più insieme (al massimo 5 oltre alla principale). */
  const carosello = bozza.sfondo_carosello ?? [];
  async function caricaCarosello(files: FileList | null) {
    if (!files?.length || !bozza) return;
    const posto = Math.max(0, 5 - carosello.length);
    const scelti = [...files].slice(0, posto);
    if (!scelti.length) { avvisa("Al massimo 5 foto oltre alla principale", "errore"); return; }
    const nuovi: string[] = [];
    for (const file of scelti) {
      try { nuovi.push(await caricaImmagine(locale!.id, "sfondo", await preparaImmagine(file, { lato: 1600, limite: 1_000_000 }))); }
      catch (e) { avvisa(e instanceof Error ? e.message : "Foto non valida", "errore"); }
    }
    if (nuovi.length) {
      setBozza((b) => (b ? { ...b, sfondo_carosello: [...(b.sfondo_carosello ?? []), ...nuovi] } : b));
      avvisa(`${nuovi.length} foto aggiunte al carosello: controlla l'anteprima e poi pubblica`);
    }
    if (files.length > posto) avvisa("Al massimo 5 foto oltre alla principale: le altre non sono state caricate", "errore");
  }
  const spostaFoto = (i: number, verso: -1 | 1) => {
    const l = [...carosello], j = i + verso;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j]!, l[i]!];
    setBozza({ ...bozza, sfondo_carosello: l });
  };

  async function caricaLogo(file: File | undefined) {
    if (!file || !bozza) return;
    try {
      const blob = await preparaImmagine(file, { lato: 800, limite: 500_000, trasparenza: true });
      const percorso = await caricaImmagine(locale!.id, "logo", blob);
      setBozza({ ...bozza, logo_path: percorso, logo_dati: null, logo_url: null, mostra_nome: false });
      avvisa("Logo caricato: controlla l'anteprima e poi pubblica");
    } catch (e) { avvisa(e instanceof Error ? e.message : "Logo non valido", "errore"); }
  }
  const imposta = <K extends keyof TAspetto>(campo: K, valore: TAspetto[K]) => setBozza({ ...bozza, [campo]: valore });

  async function salva() {
    if (!bozza || !locale) return;
    setAttesa(true);
    const { locale_id: _ignora, ...campi } = bozza;
    const { error } = await sb().from("aspetto").update({
      ...campi, logo_url: campi.logo_url?.trim() || null,
      logo_path: campi.logo_path || null, logo_dati: campi.logo_path ? null : campi.logo_dati || null,
      sfondo_path: campi.sfondo_path || null, sfondo_dati: campi.sfondo_path ? null : campi.sfondo_dati || null,
    }).eq("locale_id", locale.id);
    setAttesa(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    // Le immagini sostituite o tolte escono dall'archivio
    if (salvato?.logo_path && salvato.logo_path !== bozza.logo_path) void eliminaImmagine(salvato.logo_path);
    if (salvato?.sfondo_path && salvato.sfondo_path !== bozza.sfondo_path && !(bozza.sfondo_carosello ?? []).includes(salvato.sfondo_path)) void eliminaImmagine(salvato.sfondo_path);
    for (const p of salvato?.sfondo_carosello ?? []) if (p !== bozza.sfondo_path && !(bozza.sfondo_carosello ?? []).includes(p)) void eliminaImmagine(p);
    setSalvato(bozza); avvisa("Aspetto pubblicato: il menu dei clienti è aggiornato");
  }

  const anteprima: MenuPubblico = menu ?? {
    locale: { nome: locale.nome, indirizzo: "" },
    aspetto: null,
    categorie: [{ id: "esempio", nome: "Esempio", descrizione: "", prodotti: [
      { id: "1", nome: "Margherita", descrizione: "Pomodoro, fior di latte, basilico", prezzo_cent: 650, disponibile: true,
        allergeni: ["Glutine", "Latte"], etichette: ["Vegetariano"], immagine_url: null, opzioni: [] },
    ] }],
  };

  return (
    <div className="pagina pagina-divisa">
      <div className="pannello">
        <div className="pagina-testa"><h1>Aspetto del menu</h1></div>

        <fieldset className="gruppo"><legend>Temi pronti</legend>
          <div className="temi">
            {TEMI.map((t) => (
              <button key={t.nome} type="button" className="tema" onClick={() => setBozza({ ...bozza, ...t.tema })}
                      style={{ background: t.tema.colore_sfondo, color: t.tema.colore_testo, borderColor: t.tema.colore_primario }}>
                <strong style={{ color: t.tema.colore_primario }}>{t.nome}</strong>
                <span>{t.descrizione}</span>
              </button>
            ))}
          </div>
          <p className="muto piccolo">Il tema cambia colori, caratteri e impaginazione: poi puoi ritoccare tutto qui sotto.</p>
        </fieldset>

        <fieldset className="gruppo"><legend>Logo</legend>
          {logoAttuale ? (
            <div className="logo-anteprima" style={{ background: bozza.colore_sfondo }}>
              <img src={logoAttuale} alt="Logo attuale" />
            </div>
          ) : <p className="muto piccolo">Nessun logo: in testa al menu compare il nome del locale.</p>}
          <div className="riga-form">
            <label className="btn">
              {logoAttuale ? "Sostituisci logo" : "Carica logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void caricaLogo(e.target.files?.[0])} />
            </label>
            {logoAttuale && <button type="button" className="btn btn-pericolo" onClick={() => setBozza({ ...bozza, logo_path: null, logo_dati: null, logo_url: null })}>Rimuovi</button>}
          </div>
          <label className="interruttore"><input type="checkbox" checked={bozza.mostra_nome} disabled={!logoAttuale}
            onChange={(e) => imposta("mostra_nome", e.target.checked)} />Mostra anche il nome sotto il logo</label>
          <p className="muto piccolo">Meglio un PNG con sfondo trasparente: si adatta sia ai temi chiari sia a quelli scuri.</p>
        </fieldset>

        <fieldset className="gruppo"><legend>Foto di sfondo</legend>
          {sfondoAttuale ? (
            <>
              <div className="riga-form">
                <label className="btn">Sostituisci foto
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void caricaSfondo(e.target.files?.[0])} />
                </label>
                {/* Togliendo la principale, la prima del carosello prende il suo posto */}
                <button type="button" className="btn btn-pericolo" onClick={() => setBozza({ ...bozza, sfondo_path: carosello[0] ?? null, sfondo_dati: null, sfondo_carosello: carosello.slice(1) })}>Rimuovi</button>
              </div>
              <label className="campo">Visibilità della foto: {bozza.sfondo_opacita}%
                <input type="range" min={5} max={70} value={bozza.sfondo_opacita} onChange={(e) => imposta("sfondo_opacita", Number(e.target.value))} />
              </label>
              <label className="campo">Sfocatura: {bozza.sfondo_sfocatura === 0 ? "nessuna" : `${bozza.sfondo_sfocatura} px`}
                <input type="range" min={0} max={12} value={bozza.sfondo_sfocatura} onChange={(e) => imposta("sfondo_sfocatura", Number(e.target.value))} />
              </label>
              <div className="scelte" role="radiogroup" aria-label="Dove mostrare la foto">
                {([["pagina", "Su tutto il menu"], ["testata", "Solo dietro il nome"]] as const).map(([v, t]) => (
                  <button key={v} type="button" className={`chip${(bozza.sfondo_modo ?? "pagina") === v ? " attivo" : ""}`} onClick={() => imposta("sfondo_modo", v)}>{t}</button>
                ))}
              </div>
              <label className="interruttore"><input type="checkbox" checked={bozza.sfondo_bn}
                onChange={(e) => imposta("sfondo_bn", e.target.checked)} />Bianco e nero</label>
              <p className="muto piccolo">Per l'effetto «vedo non vedo»: visibilità 15-30% e un po' di sfocatura. Controlla che i prezzi restino ben leggibili.</p>
              <div className="gruppo-interno">
                <strong>Carosello</strong>
                <p className="muto piccolo">Fino a 5 foto in più che si sfumano dolcemente una nell'altra, dopo la foto principale. Sul telefono si caricano dopo il menu.</p>
                {carosello.length > 0 && (
                  <div className="carosello-foto">
                    {carosello.map((p, i) => (
                      <figure key={p}>
                        <img src={sorgenteImmagine(p) ?? ""} alt={`Foto ${i + 2} del carosello`} />
                        <figcaption>
                          <button type="button" className="btn btn-piccolo" disabled={i === 0} onClick={() => spostaFoto(i, -1)} aria-label="Sposta prima">←</button>
                          <button type="button" className="btn btn-piccolo" disabled={i === carosello.length - 1} onClick={() => spostaFoto(i, 1)} aria-label="Sposta dopo">→</button>
                          <button type="button" className="btn btn-piccolo btn-pericolo" onClick={() => setBozza({ ...bozza, sfondo_carosello: carosello.filter((x) => x !== p) })} aria-label="Togli dal carosello">✕</button>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {carosello.length < 5 && (
                  <label className="btn" style={{ justifySelf: "start" }}>+ Aggiungi foto al carosello
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void caricaCarosello(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
                {carosello.length > 0 && (
                  <>
                    <div className="scelte" role="radiogroup" aria-label="Ogni quanto cambia la foto">
                      {[6, 8, 12].map((s) => (
                        <button key={s} type="button" className={`chip${(bozza.sfondo_intervallo ?? 8) === s ? " attivo" : ""}`} onClick={() => imposta("sfondo_intervallo", s)}>ogni {s} s</button>
                      ))}
                    </div>
                    <label className="interruttore"><input type="checkbox" checked={bozza.sfondo_zoom !== false}
                      onChange={(e) => imposta("sfondo_zoom", e.target.checked)} />Zoom lento sulle foto</label>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="muto piccolo">Una foto del locale, di un vigneto o dei piatti, appena visibile dietro al menu.</p>
              <label className="btn" style={{ justifySelf: "start" }}>Carica foto
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void caricaSfondo(e.target.files?.[0])} />
              </label>
            </>
          )}
        </fieldset>

        <fieldset className="gruppo"><legend>Colori</legend>
          {COLORI.map(({ campo, etichetta }) => (
            <label key={campo} className="campo-colore">
              <input type="color" value={bozza[campo] as string} onChange={(e) => imposta(campo, e.target.value as never)} />
              {etichetta}<code>{bozza[campo] as string}</code>
            </label>
          ))}
        </fieldset>

        <fieldset className="gruppo"><legend>Caratteri</legend>
          <label className="campo">Titoli
            <select value={bozza.font_titoli} onChange={(e) => imposta("font_titoli", e.target.value)}>
              {FONT_TITOLI.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="campo">Testo
            <select value={bozza.font_testo} onChange={(e) => imposta("font_testo", e.target.value)}>
              {FONT_TESTO.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
        </fieldset>

        <fieldset className="gruppo"><legend>Impaginazione</legend>
          <div className="scelte">
            {(["elegante", "lista", "griglia", "compatto"] as const).map((l) => (
              <label key={l} className={`chip${bozza.layout === l ? " attivo" : ""}`}>
                <input type="radio" name="layout" checked={bozza.layout === l} onChange={() => imposta("layout", l)} />
                {l === "elegante" ? "Elegante" : l === "lista" ? "Lista" : l === "griglia" ? "Griglia" : "Compatto"}
              </label>
            ))}
          </div>
          <label className="interruttore"><input type="checkbox" checked={bozza.mostra_descrizioni}
            onChange={(e) => imposta("mostra_descrizioni", e.target.checked)} />Mostra le descrizioni</label>
          <label className="interruttore"><input type="checkbox" checked={bozza.mostra_allergeni}
            onChange={(e) => imposta("mostra_allergeni", e.target.checked)} />Mostra gli allergeni</label>
        </fieldset>

        <fieldset className="gruppo"><legend>Testi</legend>
          <label className="campo">Testo a piè di pagina
            <input value={bozza.testo_piede} maxLength={300} onChange={(e) => imposta("testo_piede", e.target.value)}
                   placeholder="Es. Coperto 2 € · Aperti dalle 19:30" />
          </label>
        </fieldset>

        <div className="riga-form fissa">
          <button className="btn btn-pieno" disabled={!modificato || attesa} onClick={() => void salva()}>
            {attesa ? "Pubblico…" : "Pubblica le modifiche"}
          </button>
          <button className="btn" disabled={!modificato || attesa} onClick={() => setBozza(salvato)}>Annulla</button>
          {modificato && <span className="muto piccolo">Modifiche non ancora pubblicate</span>}
        </div>
      </div>

      <div className="anteprima" aria-label="Anteprima del menu">
        <div className="anteprima-telefono">
          <div className="anteprima-scorri"><MenuVista menu={anteprima} aspetto={bozza} /></div>
        </div>
      </div>
    </div>
  );
}
