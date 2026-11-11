import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useSessione } from "../lib/sessione";
import { sb } from "../lib/supabase";
import { NotificheSala } from "./NotificheSala";

/** Numero di ordini da confermare, aggiornato in tempo reale. */
function useDaConfermare(localeId?: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!localeId) return;
    const conta = async () => {
      const [o, r] = await Promise.all([
        sb().from("ordini").select("id", { count: "exact", head: true }).eq("locale_id", localeId).eq("stato", "da_confermare"),
        sb().from("richieste_tavolo").select("id", { count: "exact", head: true }).eq("locale_id", localeId).eq("stato", "in_attesa")
          .gte("creato_at", new Date(Date.now() - 15 * 60_000).toISOString()),
      ]);
      setN((o.count ?? 0) + (r.count ?? 0));
    };
    void conta();
    const canale = sb().channel(`contatore-${localeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ordini", filter: `locale_id=eq.${localeId}` }, () => void conta())
      .on("postgres_changes", { event: "*", schema: "public", table: "richieste_tavolo", filter: `locale_id=eq.${localeId}` }, () => void conta()).subscribe();
    const t = setInterval(() => void conta(), 30_000);
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [localeId]);
  return n;
}

import { NOMI_RUOLO, puo, puoSala } from "../lib/permessi";
import { BarraOperatore, CambiaCodice, useCodice } from "../lib/codice";

/** Articoli di magazzino sotto la scorta minima (solo quelli con una scorta impostata), ricontati ogni due minuti. */
function useSottoScorta(localeId: string | undefined, attivo: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!localeId || !attivo) return;
    const conta = async () => {
      const { data } = await sb().from("articoli").select("giacenza, scorta_minima").eq("locale_id", localeId).gt("scorta_minima", 0);
      setN(((data ?? []) as { giacenza: number; scorta_minima: number }[]).filter((a) => Number(a.giacenza) <= Number(a.scorta_minima)).length);
    };
    void conta();
    const t = setInterval(() => void conta(), 120_000);
    return () => clearInterval(t);
  }, [localeId, attivo]);
  return n;
}

export function Guscio() {
  const { locale, locali, ruolo, puoModificare, scegliLocale, esci, sessione } = useSessione();
  const { chiedeCodice, personale, ricarica } = useCodice();
  const [mioCodice, setMioCodice] = useState(false);
  const daConfermare = useDaConfermare(locale?.id);
  const sottoScorta = useSottoScorta(locale?.id, puo(ruolo, "magazzino"));
  if (!locale) return null;
  const cucina = ruolo === "cucina";
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
          {!cucina && <NavLink to="/sala">Sala{daConfermare > 0 && <span className="contatore">{daConfermare}</span>}</NavLink>}
          {puo(ruolo, "cucina.avanza") && <NavLink to="/cucina">Cucina</NavLink>}
          {!cucina && <NavLink to="/catalogo">Catalogo</NavLink>}
          {puoModificare && <NavLink to="/aspetto">Aspetto</NavLink>}
          {puo(ruolo, "catalogo") && <NavLink to="/enciclopedia">Vini</NavLink>}
          {puo(ruolo, "magazzino") && <NavLink to="/magazzino" title={sottoScorta ? `${sottoScorta} articoli sotto la scorta minima` : undefined}>
            Magazzino{sottoScorta > 0 && <span className="contatore contatore-scorta" aria-label={`${sottoScorta} sotto scorta`}>{sottoScorta}</span>}</NavLink>}
          {puo(ruolo, "cassa") && <NavLink to="/cassa">Cassa</NavLink>}
          {puo(ruolo, "cassa") && <NavLink to="/fatture">Fatture</NavLink>}
          {puo(ruolo, "utenti") && <NavLink to="/impostazioni">Impostazioni</NavLink>}
          {!cucina && <a href={`/m/${locale.slug}`} target="_blank" rel="noreferrer">Menu clienti ↗</a>}
        </nav>
        <BarraOperatore />
        <div className="barra-utente">
          <span className="muto">{sessione?.user.email}</span>
          {!cucina && !chiedeCodice && <button className="btn btn-piccolo" onClick={() => setMioCodice(true)}>🔑 Il mio codice</button>}
          <button className="btn btn-piccolo" onClick={() => void esci()}>Esci</button>
        </div>
      </header>
      <main className="contenuto"><Outlet /></main>
      {mioCodice && sessione && <CambiaCodice localeId={locale.id} utente={sessione.user.id} nome="" proprio
        haCodice={!!personale.find((p) => p.id === sessione.user.id)?.ha_codice} onChiudi={(fatto) => { setMioCodice(false); if (fatto) void ricarica(); }} />}
      {ruolo && ruolo !== "cucina" && <NotificheSala localeId={locale.id} localeNome={locale.nome} gestisceConto={puoSala(ruolo, "sala.chiudi", chiedeCodice)} />}
    </div>
  );
}
