import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { FONT_TESTO, FONT_TITOLI, type Aspetto as TAspetto, type MenuPubblico } from "../lib/tipi";
import { MenuVista } from "../componenti/MenuVista";
import { ASPETTO_PREDEFINITO } from "./MenuPubblico";

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
  const imposta = <K extends keyof TAspetto>(campo: K, valore: TAspetto[K]) => setBozza({ ...bozza, [campo]: valore });

  async function salva() {
    if (!bozza || !locale) return;
    setAttesa(true);
    const { locale_id: _ignora, ...campi } = bozza;
    const { error } = await sb().from("aspetto").update({ ...campi, logo_url: campi.logo_url?.trim() || null }).eq("locale_id", locale.id);
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
            {(["lista", "griglia", "compatto"] as const).map((l) => (
              <label key={l} className={`chip${bozza.layout === l ? " attivo" : ""}`}>
                <input type="radio" name="layout" checked={bozza.layout === l} onChange={() => imposta("layout", l)} />
                {l === "lista" ? "Lista" : l === "griglia" ? "Griglia" : "Compatto"}
              </label>
            ))}
          </div>
          <label className="interruttore"><input type="checkbox" checked={bozza.mostra_descrizioni}
            onChange={(e) => imposta("mostra_descrizioni", e.target.checked)} />Mostra le descrizioni</label>
          <label className="interruttore"><input type="checkbox" checked={bozza.mostra_allergeni}
            onChange={(e) => imposta("mostra_allergeni", e.target.checked)} />Mostra gli allergeni</label>
        </fieldset>

        <fieldset className="gruppo"><legend>Testi e logo</legend>
          <label className="campo">Indirizzo del logo (https://… o /…)
            <input value={bozza.logo_url ?? ""} onChange={(e) => imposta("logo_url", e.target.value)} placeholder="Lascia vuoto per nessun logo" />
          </label>
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
