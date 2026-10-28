import { NavLink, Outlet } from "react-router-dom";
import { useSessione } from "../lib/sessione";

const NOMI_RUOLO = { owner: "Titolare", manager: "Responsabile", cameriere: "Sala", cucina: "Cucina" } as const;

export function Guscio() {
  const { locale, locali, ruolo, puoModificare, scegliLocale, esci, sessione } = useSessione();
  if (!locale) return null;
  return (
    <div className="guscio">
      <header className="barra">
        <div className="barra-locale">
          {locali.length > 1 ? (
            <select value={locale.id} onChange={(e) => scegliLocale(e.target.value)} aria-label="Locale">
              {locali.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          ) : <strong>{locale.nome}</strong>}
          {ruolo && <span className="pill">{NOMI_RUOLO[ruolo]}</span>}
        </div>
        <nav className="barra-nav">
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
