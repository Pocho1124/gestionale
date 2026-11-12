import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { impostaCustode, sb } from "./supabase";
import { useSessione } from "./sessione";
import { NOMI_RUOLO } from "./permessi";
import type { Ruolo } from "./tipi";

/**
 * Codici personali sulle postazioni condivise (tablet di sala, PC): prima di un'azione di sala si tocca il proprio nome
 * e si inserisce il codice; per qualche minuto le azioni sono di quella persona, poi la postazione si blocca da sola.
 * Il controllo vero lo fa il database (puo() con il ruolo di chi ha inserito il codice): qui c'è solo il tastierino.
 */
export interface Persona { id: string; nome: string; ruolo: Ruolo; ha_codice: boolean; postazione: boolean; esente?: boolean }
export interface Operatore { id: string; nome: string; ruolo: Ruolo; scade_at: string }
interface StatoOperatore { chiede_codice: boolean; postazione?: boolean; codice_obbligatorio?: boolean; durata_secondi: number; solo_responsabile: boolean; operatore: Operatore | null; personale: Persona[] }

interface ValoreCodice {
  chiedeCodice: boolean;
  /** Il codice si chiede a ogni azione (nessuna validità a tempo). */
  ogniAzione: boolean;
  /** L'account collegato è una postazione condivisa (non ha un «proprio» codice). */
  postazione: boolean;
  soloResponsabile: boolean;
  operatore: Operatore | null;
  personale: Persona[];
  /** Mostra il tastierino; true se la persona è entrata. */
  richiedi: (motivo?: string) => Promise<boolean>;
  blocca: () => Promise<void>;
  ricarica: () => Promise<void>;
  /** Finestra del conto: il codice inserito vale per tutte le azioni finché non si chiama la funzione restituita. */
  trattieni: () => () => void;
}

const Ctx = createContext<ValoreCodice | null>(null);
const MARGINE_MS = 3000;   // il codice scade qualche secondo prima sul tablet che sul server

export function ProviderCodice({ children }: { children: ReactNode }) {
  const { locale, ruolo } = useSessione();
  const [stato, setStato] = useState<StatoOperatore | null>(null);
  const [aperto, setAperto] = useState<string | false>(false);
  const attesa = useRef<((ok: boolean) => void) | null>(null);
  const statoRef = useRef<StatoOperatore | null>(null);
  statoRef.current = stato;
  const [trattenuto, setTrattenuto] = useState(0);
  const trattenutoRef = useRef(0);
  trattenutoRef.current = trattenuto;

  const ricarica = useCallback(async () => {
    if (!locale || !ruolo) { setStato(null); return; }
    const { data } = await sb().rpc("stato_operatore", { p_locale: locale.id });
    setStato((data as StatoOperatore | null) ?? null);
  }, [locale, ruolo]);
  useEffect(() => { void ricarica(); }, [ricarica]);

  const valido = (o: Operatore | null) => !!o && new Date(o.scade_at).getTime() - MARGINE_MS > Date.now();

  // Alla scadenza la postazione torna bloccata anche sullo schermo
  useEffect(() => {
    const o = stato?.operatore;
    if (!o) return;
    const ms = new Date(o.scade_at).getTime() - MARGINE_MS - Date.now();
    const t = setTimeout(() => setStato((s) => (s ? { ...s, operatore: null } : s)), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [stato?.operatore]);

  // Durata 0: il codice si chiede a ogni azione (nessuna finestra di validità sullo schermo)
  const ogniAzione = (s: StatoOperatore | null) => !!s && s.durata_secondi === 0;
  const richiedi = useCallback((motivo = "") => {
    const s = statoRef.current;
    if (!s?.chiede_codice || ((!ogniAzione(s) || trattenutoRef.current > 0) && valido(s.operatore))) return Promise.resolve(true);
    attesa.current?.(false);
    setAperto(motivo);
    return new Promise<boolean>((risolvi) => { attesa.current = risolvi; });
  }, []);

  // Tutte le azioni di sala passano dal tastierino (vedi lib/supabase.ts). Se il database rifiuta (codice scaduto
  // o ruolo insufficiente, es. uno storno) la postazione si blocca e si chiede il codice di chi può farlo.
  useEffect(() => {
    impostaCustode({
      richiedi: () => richiedi(),
      rifiutato: () => {
        const s = statoRef.current;
        if (!s?.chiede_codice) return Promise.resolve(false);
        statoRef.current = { ...s, operatore: null };
        setStato(statoRef.current);
        return richiedi("Codice scaduto o permesso riservato a un ruolo superiore (es. caposala): inserisci il codice di chi può farlo.");
      },
      dopo: () => {
        const s = statoRef.current;
        if (!s?.chiede_codice || !ogniAzione(s) || trattenutoRef.current > 0 || !locale) return;
        statoRef.current = { ...s, operatore: null };
        setStato(statoRef.current);
        void sb().rpc("esci_operatore", { p_locale: locale.id });
      },
    });
    return () => impostaCustode(null);
  }, [richiedi, locale]);

  const chiudi = (ok: boolean, operatore?: Operatore) => {
    if (operatore) setStato((s) => (s ? { ...s, operatore } : s));
    setAperto(false);
    attesa.current?.(ok);
    attesa.current = null;
  };
  const blocca = useCallback(async () => {
    if (!locale) return;
    await sb().rpc("esci_operatore", { p_locale: locale.id });
    setStato((s) => (s ? { ...s, operatore: null } : s));
  }, [locale]);

  // Finestra del conto aperta: il codice di chi l'ha inserito si rinnova sul server ogni 15 s (al massimo 10 minuti);
  // chiusa la finestra, con il codice a ogni azione la postazione si blocca subito
  const trattieni = useCallback(() => {
    setTrattenuto((n) => n + 1);
    let fatto = false;
    return () => {
      if (fatto) return;
      fatto = true;
      setTrattenuto((n) => n - 1);
      const s = statoRef.current;
      if (trattenutoRef.current <= 1 && s?.chiede_codice && ogniAzione(s) && locale) {
        statoRef.current = { ...s, operatore: null };
        setStato(statoRef.current);
        void sb().rpc("esci_operatore", { p_locale: locale.id });
      }
    };
  }, [locale]);
  const operatoreId = stato?.operatore?.id;
  useEffect(() => {
    if (!trattenuto || !operatoreId || !locale) return;
    const rinnova = async () => {
      const { data } = await sb().rpc("trattieni_operatore", { p_locale: locale.id });
      setStato((s) => (!s?.operatore ? s : { ...s, operatore: data ? { ...s.operatore, scade_at: data as string } : null }));
    };
    void rinnova();
    const t = setInterval(() => void rinnova(), 15000);
    return () => clearInterval(t);
  }, [trattenuto, operatoreId, locale]);

  const valore: ValoreCodice = {
    chiedeCodice: !!stato?.chiede_codice, ogniAzione: ogniAzione(stato), postazione: !!stato?.postazione, soloResponsabile: !!stato?.solo_responsabile,
    operatore: valido(stato?.operatore ?? null) ? stato!.operatore : null, personale: stato?.personale ?? [],
    richiedi, blocca, ricarica, trattieni,
  };
  return (
    <Ctx.Provider value={valore}>
      {children}
      {aperto !== false && locale && <Tastierino localeId={locale.id} motivo={aperto} personale={(stato?.personale ?? []).filter((p) => p.ha_codice && !p.postazione && !p.esente)} onFine={chiudi} />}
    </Ctx.Provider>
  );
}

export function useCodice(): ValoreCodice {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCodice fuori dal provider");
  return v;
}

/** Nome del collega (per «Tavolo seguito da …»). */
export const nomePersona = (personale: Persona[], id: string | null | undefined) => (id ? personale.find((p) => p.id === id)?.nome ?? "un collega" : "");

const TASTI = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/** Tastierino: si tocca il proprio nome, poi il codice (da 4 a 6 cifre); Invio o «Entra» per confermare. */
function Tastierino(props: { localeId: string; motivo: string; personale: Persona[]; onFine: (ok: boolean, o?: Operatore) => void }) {
  const [scelto, setScelto] = useState<Persona | null>(props.personale.length === 1 ? props.personale[0]! : null);
  const [cifre, setCifre] = useState("");
  const [errore, setErrore] = useState("");
  const [invio, setInvio] = useState(false);

  const entra = useCallback(async (codice: string) => {
    if (!scelto || codice.length < 4 || invio) return;
    setInvio(true);
    const { data, error } = await sb().rpc("entra_operatore", { p_locale: props.localeId, p_utente: scelto.id, p_codice: codice });
    setInvio(false);
    const r = data as (Operatore & { errore?: string }) | null;
    if (error || !r || r.errore) { setErrore(r?.errore ?? "Codice non valido"); setCifre(""); return; }
    props.onFine(true, r);
  }, [scelto, invio, props]);

  const premi = useCallback((t: string) => {
    setErrore("");
    if (t === "⌫") setCifre((c) => c.slice(0, -1));
    else if (/^\d$/.test(t)) setCifre((c) => (c.length < 6 ? c + t : c));
  }, []);

  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onFine(false);
      else if (!scelto) return;
      else if (/^\d$/.test(e.key)) premi(e.key);
      else if (e.key === "Backspace") premi("⌫");
      else if (e.key === "Enter") void entra(cifre);
    };
    addEventListener("keydown", tasto);
    return () => removeEventListener("keydown", tasto);
  }, [scelto, cifre, premi, entra, props]);

  return (
    <div className="popup-sfondo" role="dialog" aria-modal="true" aria-label="Codice personale" onClick={() => props.onFine(false)}>
      <div className="popup tastierino" onClick={(e) => e.stopPropagation()}>
        {props.motivo && <p className="tastierino-motivo">{props.motivo}</p>}
        {!scelto ? (
          <>
            <h2>Chi sei?</h2>
            {props.personale.length === 0
              ? <p className="muto">Nessuno ha ancora un codice personale: il responsabile lo imposta in Impostazioni → Codici personali.</p>
              : (
                <div className="tastierino-nomi">
                  {props.personale.map((p) => (
                    <button key={p.id} className="tastierino-nome" onClick={() => setScelto(p)}>
                      <span className="tastierino-iniziale" aria-hidden="true">{p.nome.slice(0, 1).toUpperCase()}</span>
                      <strong>{p.nome}</strong><span className="muto piccolo">{NOMI_RUOLO[p.ruolo]}</span>
                    </button>
                  ))}
                </div>
              )}
          </>
        ) : (
          <>
            <h2>{scelto.nome}, il tuo codice</h2>
            <div className="tastierino-punti" aria-live="polite" aria-label={`${cifre.length} cifre inserite`}>
              {Array.from({ length: Math.max(4, cifre.length) }, (_, i) => <span key={i} className={i < cifre.length ? "pieno" : ""} />)}
            </div>
            {errore && <p className="tastierino-errore" role="alert">{errore}</p>}
            <div className="tastierino-tasti">
              {TASTI.map((t, i) => t
                ? <button key={i} className="tastierino-tasto" onClick={() => premi(t)} aria-label={t === "⌫" ? "Cancella" : t}>{t}</button>
                : <span key={i} />)}
            </div>
            <button className="btn btn-pieno tastierino-entra" disabled={cifre.length < 4 || invio} onClick={() => void entra(cifre)}>{invio ? "Controllo…" : "Entra"}</button>
            {props.personale.length > 1 && <button className="link" onClick={() => { setScelto(null); setCifre(""); setErrore(""); }}>← Non sono {scelto.nome}</button>}
          </>
        )}
        <button className="btn tastierino-annulla" onClick={() => props.onFine(false)}>Annulla</button>
      </div>
    </div>
  );
}

/** Barra della postazione: chi è di turno (con il tempo che resta) e il tasto per bloccare subito. */
export function BarraOperatore() {
  const { chiedeCodice, ogniAzione: aOgniAzione, operatore, blocca, richiedi } = useCodice();
  const ogniAzione = aOgniAzione && !operatore;   // con il conto aperto si vede chi sta incassando
  const [, aggiorna] = useState(0);
  useEffect(() => {
    if (!operatore) return;
    const t = setInterval(() => aggiorna((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [operatore]);
  if (!chiedeCodice) return null;
  if (ogniAzione) return <span className="barra-operatore bloccata" title="Ogni apertura, comanda, incasso o storno chiede nome e codice">🔒 Codice personale a ogni azione</span>;
  if (!operatore) return (
    <button className="barra-operatore bloccata" onClick={() => void richiedi()} title="Le azioni di sala chiedono il codice personale">
      🔒 Postazione bloccata · tocca per entrare
    </button>
  );
  const resto = Math.max(0, Math.round((new Date(operatore.scade_at).getTime() - MARGINE_MS - Date.now()) / 1000));
  return (
    <div className="barra-operatore">
      <span>👤 <strong>{operatore.nome}</strong> · {NOMI_RUOLO[operatore.ruolo]} · {Math.floor(resto / 60)}:{String(resto % 60).padStart(2, "0")}</span>
      <button className="btn btn-piccolo" onClick={() => void blocca()}>🔒 Blocca</button>
    </div>
  );
}

/** Nuovo codice personale: il proprio (serve quello attuale, se c'è) o, per chi gestisce il personale, quello di un collega. */
export function CambiaCodice(props: { localeId: string; utente: string; nome: string; proprio: boolean; haCodice: boolean; onChiudi: (fatto: boolean) => void }) {
  const [attuale, setAttuale] = useState("");
  const [nuovo, setNuovo] = useState("");
  const [ripeti, setRipeti] = useState("");
  const [errore, setErrore] = useState("");
  const soloCifre = (v: string) => v.replace(/\D/g, "").slice(0, 6);
  async function salva(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(nuovo)) { setErrore("Il codice deve avere da 4 a 6 cifre"); return; }
    if (nuovo !== ripeti) { setErrore("I due codici non coincidono"); return; }
    const { data, error } = await sb().rpc("imposta_codice", { p_locale: props.localeId, p_utente: props.utente, p_codice: nuovo, p_attuale: props.proprio && props.haCodice ? attuale : null });
    const esito = data as { errore?: string } | null;
    if (error || esito?.errore) { setErrore(error?.message ?? esito?.errore ?? "Errore"); return; }
    props.onChiudi(true);
  }
  return (
    <div className="popup-sfondo" role="dialog" aria-modal="true" aria-label={`Codice personale di ${props.nome}`} onClick={() => props.onChiudi(false)}>
      <form className="popup cambia-codice" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void salva(e)} autoComplete="off">
        <h2>{props.proprio ? "Il mio codice" : `Codice di ${props.nome}`}</h2>
        <p className="muto piccolo">Da 4 a 6 cifre, niente cifre tutte uguali o in fila (1234). È personale: non va detto ai colleghi.</p>
        {props.proprio && props.haCodice && (
          <label>Codice attuale<input type="password" inputMode="numeric" value={attuale} onChange={(e) => setAttuale(soloCifre(e.target.value))} required /></label>
        )}
        <label>Nuovo codice<input type="password" inputMode="numeric" autoComplete="new-password" value={nuovo} onChange={(e) => setNuovo(soloCifre(e.target.value))} required /></label>
        <label>Ripeti il nuovo codice<input type="password" inputMode="numeric" autoComplete="new-password" value={ripeti} onChange={(e) => setRipeti(soloCifre(e.target.value))} required /></label>
        {errore && <p className="tastierino-errore" role="alert">{errore}</p>}
        <div className="riga-form">
          <button type="button" className="btn" onClick={() => props.onChiudi(false)}>Annulla</button>
          <button className="btn btn-pieno">Salva</button>
        </div>
      </form>
    </div>
  );
}
