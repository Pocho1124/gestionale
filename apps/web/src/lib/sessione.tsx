import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { sb } from "./supabase";
import type { Locale, Ruolo } from "./tipi";

interface StatoSessione {
  pronta: boolean;
  sessione: Session | null;
  locali: Locale[];
  locale: Locale | null;
  ruolo: Ruolo | null;
  puoModificare: boolean;
  scegliLocale: (id: string) => void;
  ricarica: () => Promise<void>;
  esci: () => Promise<void>;
}

const Ctx = createContext<StatoSessione | null>(null);
const CHIAVE_LOCALE = "gestionale.locale";

export function ProviderSessione({ children }: { children: ReactNode }) {
  const [pronta, setPronta] = useState(false);
  const [sessione, setSessione] = useState<Session | null>(null);
  const [locali, setLocali] = useState<Locale[]>([]);
  const [ruoli, setRuoli] = useState<Record<string, Ruolo>>({});
  const [localeId, setLocaleId] = useState<string | null>(() => {
    try { return localStorage.getItem(CHIAVE_LOCALE); } catch { return null; }
  });

  const caricaLocali = useCallback(async (s: Session | null) => {
    if (!s) { setLocali([]); setRuoli({}); return; }
    const [l, m] = await Promise.all([
      sb().from("locali").select("id, nome, slug, organizzazione_id").eq("attivo", true).order("nome"),
      sb().from("membri").select("organizzazione_id, ruolo, locale_id").eq("user_id", s.user.id),
    ]);
    const elenco = (l.data ?? []) as Locale[];
    const r: Record<string, Ruolo> = {};
    for (const loc of elenco) {
      const mem = (m.data ?? []).find((x) => x.organizzazione_id === loc.organizzazione_id && (!x.locale_id || x.locale_id === loc.id));
      if (mem) r[loc.id] = mem.ruolo as Ruolo;
    }
    setLocali(elenco);
    setRuoli(r);
  }, []);

  useEffect(() => {
    let attivo = true;
    sb().auth.getSession().then(async ({ data }) => {
      if (!attivo) return;
      setSessione(data.session);
      await caricaLocali(data.session);
      setPronta(true);
    });
    const { data: sub } = sb().auth.onAuthStateChange((_evento, s) => {
      setSessione(s);
      // Fuori dal callback: evita blocchi interni del client di autenticazione
      setTimeout(() => { void caricaLocali(s); }, 0);
    });
    return () => { attivo = false; sub.subscription.unsubscribe(); };
  }, [caricaLocali]);

  const locale = locali.find((l) => l.id === localeId) ?? locali[0] ?? null;
  const ruolo = locale ? ruoli[locale.id] ?? null : null;

  const valore: StatoSessione = {
    pronta, sessione, locali, locale, ruolo,
    puoModificare: ruolo === "owner" || ruolo === "manager",
    scegliLocale: (id) => { setLocaleId(id); try { localStorage.setItem(CHIAVE_LOCALE, id); } catch { /* memoria non disponibile */ } },
    ricarica: () => caricaLocali(sessione),
    esci: async () => { await sb().auth.signOut(); },
  };
  return <Ctx.Provider value={valore}>{children}</Ctx.Provider>;
}

export function useSessione(): StatoSessione {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSessione fuori dal provider");
  return v;
}
