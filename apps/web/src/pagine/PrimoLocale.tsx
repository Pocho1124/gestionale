import { useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { messaggioErrore } from "../lib/errori";

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function PrimoLocale() {
  const { ricarica, esci } = useSessione();
  const [org, setOrg] = useState("");
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugToccato, setSlugToccato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  async function crea(e: FormEvent) {
    e.preventDefault();
    setErrore(null); setAttesa(true);
    const { error } = await sb().rpc("crea_organizzazione", { p_nome_org: org.trim() || nome.trim(), p_nome_locale: nome.trim(), p_slug: slug });
    setAttesa(false);
    if (error) { setErrore(messaggioErrore(error)); return; }
    await ricarica();
  }

  return (
    <div className="centrato">
      <form className="scheda scheda-stretta" onSubmit={crea}>
        <h1 className="titolo">Crea il tuo locale</h1>
        <p className="muto">Non sei ancora collegato a nessun locale. Creane uno: ne sarai il titolare.</p>
        <label className="campo">Nome del locale
          <input value={nome} maxLength={120} required
                 onChange={(e) => { setNome(e.target.value); if (!slugToccato) setSlug(slugify(e.target.value)); }} />
        </label>
        <label className="campo">Azienda (facoltativo)
          <input value={org} maxLength={120} placeholder="Uguale al nome del locale" onChange={(e) => setOrg(e.target.value)} />
        </label>
        <label className="campo">Indirizzo del menu
          <input value={slug} required minLength={3} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*"
                 onChange={(e) => { setSlugToccato(true); setSlug(slugify(e.target.value)); }} />
        </label>
        {slug && <p className="muto piccolo">I clienti apriranno: {window.location.origin}/m/{slug}</p>}
        {errore && <p className="errore">{errore}</p>}
        <button className="btn btn-pieno" disabled={attesa}>{attesa ? "Creo…" : "Crea locale"}</button>
        <button type="button" className="btn btn-testo" onClick={() => void esci()}>Esci</button>
      </form>
    </div>
  );
}
