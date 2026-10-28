import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { FONT_TESTO, FONT_TITOLI, type Aspetto as TAspetto, type MenuPubblico } from "../lib/tipi";
import { MenuVista } from "../componenti/MenuVista";
import { ASPETTO_PREDEFINITO } from "./MenuPubblico";

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
async function preparaLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Formato non supportato: usa PNG, JPG o WebP.");
  const img = await createImageBitmap(file);
  const scala = Math.min(1, 800 / Math.max(img.width, img.height));
  const tela = document.createElement("canvas");
  tela.width = Math.max(1, Math.round(img.width * scala));
  tela.height = Math.max(1, Math.round(img.height * scala));
  tela.getContext("2d")!.drawImage(img, 0, 0, tela.width, tela.height);
  let dati = tela.toDataURL("image/png");
  if (dati.length > 680_000) dati = tela.toDataURL("image/webp", 0.9);
  if (!/^data:image\/(png|webp);base64,/.test(dati) || dati.length > 680_000)
    throw new Error("Logo troppo pesante anche dopo la riduzione: usa un'immagine più semplice.");
  return dati;
}

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
  const logoAttuale = bozza.logo_dati || bozza.logo_url || null;

  async function caricaLogo(file: File | undefined) {
    if (!file || !bozza) return;
    try {
      const dati = await preparaLogo(file);
      setBozza({ ...bozza, logo_dati: dati, logo_url: null, mostra_nome: false });
      avvisa("Logo caricato: controlla l'anteprima e poi pubblica");
    } catch (e) { avvisa(e instanceof Error ? e.message : "Logo non valido", "errore"); }
  }
  const imposta = <K extends keyof TAspetto>(campo: K, valore: TAspetto[K]) => setBozza({ ...bozza, [campo]: valore });

  async function salva() {
    if (!bozza || !locale) return;
    setAttesa(true);
    const { locale_id: _ignora, ...campi } = bozza;
    const { error } = await sb().from("aspetto").update({ ...campi, logo_url: campi.logo_url?.trim() || null, logo_dati: campi.logo_dati || null }).eq("locale_id", locale.id);
    setAttesa(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
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
            {logoAttuale && <button type="button" className="btn btn-pericolo" onClick={() => setBozza({ ...bozza, logo_dati: null, logo_url: null })}>Rimuovi</button>}
          </div>
          <label className="interruttore"><input type="checkbox" checked={bozza.mostra_nome} disabled={!logoAttuale}
            onChange={(e) => imposta("mostra_nome", e.target.checked)} />Mostra anche il nome sotto il logo</label>
          <p className="muto piccolo">Meglio un PNG con sfondo trasparente: si adatta sia ai temi chiari sia a quelli scuri.</p>
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
          <MenuVista menu={anteprima} aspetto={bozza} />
        </div>
      </div>
    </div>
  );
}
