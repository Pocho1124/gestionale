import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useSessione } from "../lib/sessione";
import { sb } from "../lib/supabase";

/** Numero di ordini da confermare, aggiornato in tempo reale. */
function useDaConfermare(localeId?: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!localeId) return;
    const conta = async () => {
      const { count } = await sb().from("ordini").select("id", { count: "exact", head: true }).eq("locale_id", localeId).eq("stato", "da_confermare");
      setN(count ?? 0);
    };
    void conta();
    const canale = sb().channel(`contatore-${localeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ordini", filter: `locale_id=eq.${localeId}` }, () => void conta()).subscribe();
    const t = setInterval(() => void conta(), 30_000);
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [localeId]);
  return n;
}

const NOMI_RUOLO = { owner: "Titolare", manager: "Responsabile", cameriere: "Sala", cucina: "Cucina" } as const;

export function Guscio() {
  const { locale, locali, ruolo, puoModificare, scegliLocale, esci, sessione } = useSessione();
  const daConfermare = useDaConfermare(locale?.id);
  if (!locale) return null;
  return (
    <div className="guscio">
      <header className="barra nascondi-stampa">
        <div className="barra-locale">
          {locali.length > 1 ? (
            <select value={locale.id} onChange={(e) => scegliLocale(e.target.value)} aria-label="Locale">
              {locali.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          ) : <strong>{locale.nome}</strong>}
          {ruolo && <span className="pill">{NOMI_RUOLO[ruolo]}</span>}
        </div>
        <nav className="barra-nav">
          <NavLink to="/ordini">Ordini{daConfermare > 0 && <span className="contatore">{daConfermare}</span>}</NavLink>
          <NavLink to="/sala">Sala</NavLink>
          <NavLink to="/catalogo">Catalogo</NavLink>
          {puoModificare && <NavLink to="/aspetto">Aspetto</NavLink>}
          <a href={`/m/${locale.slug}`} target="_blank" rel="noreferrer">Menu clienti ↗</a>
        </nav>
        <div className="barra-utente">
          <span className="muto">{sessione?.user.email}</span>
          <button className="btn btn-piccolo" onClick={() => void esci()}>Esci</button>
        </div>
      </header>
      <main className="contenuto"><Outlet /></main>
    </div>
  );
}
