import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { NOMI_RUOLO, puo, ruoliAssegnabili } from "../lib/permessi";
import type { Ruolo } from "../lib/tipi";

interface UtenteTelegram { id: string; telegram_id: number; nome: string; attivo: boolean }

function SezioneTelegram() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [utenti, setUtenti] = useState<UtenteTelegram[]>([]);
  const [nuovoId, setNuovoId] = useState("");
  const [nuovoNome, setNuovoNome] = useState("");

  const carica = useCallback(async () => {
    if (!locale) return;
    const { data, error } = await sb().from("telegram_utenti").select("id, telegram_id, nome, attivo").eq("locale_id", locale.id).order("created_at");
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setUtenti(data as UtenteTelegram[]);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);

  if (!locale || ruolo !== "owner") return null;

  async function aggiungi(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4,15}$/.test(nuovoId.trim())) { avvisa("L'ID Telegram è un numero (es. 123456789)", "errore"); return; }
    const { error } = await sb().from("telegram_utenti").insert({ locale_id: locale!.id, telegram_id: Number(nuovoId.trim()), nome: nuovoNome.trim() });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setNuovoId(""); setNuovoNome(""); avvisa("Utente aggiunto: entro un minuto il bot lo riconosce"); await carica();
  }
  const aggiorna = async (u: UtenteTelegram, patch: Partial<UtenteTelegram>) => {
    const { error } = await sb().from("telegram_utenti").update(patch).eq("id", u.id);
    if (error) avvisa(messaggioErrore(error), "errore"); else avvisa("Salvato");
    await carica();
  };

  return (
    <>
      <section className="gruppo">
        <legend>Bot Telegram: chi può usarlo</legend>
        <p className="muto piccolo">
          Le persone in elenco possono modificare il menu dal bot e ricevono le notifiche della sala (richieste, ordini, conti).
          Per conoscere il proprio ID basta scrivere <b>/id</b> al bot: risponde anche a chi non è ancora autorizzato.
          Gli utenti impostati sul server durante l'installazione restano sempre autorizzati.
        </p>
        {utenti.length === 0 ? <p className="muto">Nessun utente aggiunto da qui.</p> : (
          <table className="tabella">
            <thead><tr><th>Nome</th><th>ID Telegram</th><th>Attivo</th><th /></tr></thead>
            <tbody>
              {utenti.map((u) => (
                <tr key={u.id}>
                  <td><input defaultValue={u.nome} maxLength={40} onBlur={(e) => { if (e.target.value.trim() !== u.nome) void aggiorna(u, { nome: e.target.value.trim() }); }} /></td>
                  <td className="numero">{u.telegram_id}</td>
                  <td><input type="checkbox" checked={u.attivo} onChange={(e) => void aggiorna(u, { attivo: e.target.checked })} aria-label="Attivo" /></td>
                  <td><button className="btn btn-pericolo btn-piccolo" onClick={async () => {
                    if (!confirm(`Togliere ${u.nome || u.telegram_id} dal bot?`)) return;
                    const { error } = await sb().from("telegram_utenti").delete().eq("id", u.id);
                    if (error) avvisa(messaggioErrore(error), "errore"); else avvisa("Utente rimosso");
                    await carica();
                  }}>Rimuovi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="riga-form" onSubmit={aggiungi}>
          <input placeholder="Nome (es. Mario, sala)" maxLength={40} value={nuovoNome} onChange={(e) => setNuovoNome(e.target.value)} />
          <input placeholder="ID Telegram" inputMode="numeric" value={nuovoId} onChange={(e) => setNuovoId(e.target.value.replace(/\D/g, ""))} />
          <button className="btn btn-pieno" disabled={!nuovoId}>Aggiungi</button>
        </form>
      </section>
    </>
  );
}

/** Impostazioni: utenti (amministratore e responsabile), reparti e stampanti, bot Telegram (amministratore). */
export function Impostazioni() {
  const { ruolo } = useSessione();
  if (!puo(ruolo, "utenti")) return <div className="pagina"><h1>Impostazioni</h1><p className="muto">Non hai i permessi per le impostazioni.</p></div>;
  return (
    <div className="pagina">
      <div className="pagina-testa"><h1>Impostazioni</h1></div>
      <SezioneUtenti />
      {puo(ruolo, "reparti") && <SezioneReparti />}
      {puo(ruolo, "impostazioni") && <SezioneTavolo />}
      <SezioneTelegram />
    </div>
  );
}

interface ImpostazioniTavolo { chiedi_nome: boolean; nome_obbligatorio: boolean }
const TAVOLO_PREDEFINITO: ImpostazioniTavolo = { chiedi_nome: false, nome_obbligatorio: false };

/** Personalizzazioni della pagina del tavolo (QR): ognuna si attiva o disattiva qui. */
function SezioneTavolo() {
  const { locale } = useSessione();
  const avvisa = useAvviso();
  const [imp, setImp] = useState<ImpostazioniTavolo>(TAVOLO_PREDEFINITO);

  const carica = useCallback(async () => {
    if (!locale) return;
    const { data, error } = await sb().from("impostazioni_tavolo").select("chiedi_nome, nome_obbligatorio").eq("locale_id", locale.id).maybeSingle();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setImp((data as ImpostazioniTavolo | null) ?? TAVOLO_PREDEFINITO);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);
  if (!locale) return null;

  const salva = async (patch: Partial<ImpostazioniTavolo>) => {
    const nuove = { ...imp, ...patch };
    if (!nuove.chiedi_nome) nuove.nome_obbligatorio = false;   // obbligatorio solo se il nome si chiede
    const { error } = await sb().from("impostazioni_tavolo").upsert({ locale_id: locale.id, ...nuove }, { onConflict: "locale_id" });
    if (error) avvisa(messaggioErrore(error), "errore"); else avvisa("Salvato");
    await carica();
  };

  return (
    <section className="gruppo">
      <legend>Ordini dal tavolo (QR)</legend>
      <p className="muto piccolo">
        Personalizzazioni della pagina che il cliente apre dal QR del tavolo. Il nome è un dato personale: si chiede solo se lo attivi,
        lo vede solo il personale di sala, non entra nello storico e si cancella alla chiusura del tavolo (o se la richiesta è rifiutata o scade).
      </p>
      <label className="riga-form">
        <input type="checkbox" checked={imp.chiedi_nome} onChange={(e) => void salva({ chiedi_nome: e.target.checked })} />
        Chiedi il nome del cliente quando chiede di aprire il tavolo
      </label>
      <label className="riga-form">
        <input type="checkbox" checked={imp.nome_obbligatorio} disabled={!imp.chiedi_nome}
          onChange={(e) => void salva({ nome_obbligatorio: e.target.checked })} />
        Nome obbligatorio (senza nome la richiesta non parte)
      </label>
    </section>
  );
}

interface UtenteLocale { user_id: string; nome: string; accesso: string; ruolo: Ruolo; attivo: boolean; ultimo_accesso: string | null; gestibile: boolean }

function SezioneUtenti() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [utenti, setUtenti] = useState<UtenteLocale[]>([]);
  const assegnabili = ruoliAssegnabili(ruolo);
  const [nuovo, setNuovo] = useState({ nome: "", accesso: "", password: "", ruolo: assegnabili[assegnabili.length - 2] ?? assegnabili[0] ?? "cameriere" });

  const carica = useCallback(async () => {
    if (!locale) return;
    const { data, error } = await sb().rpc("elenco_utenti", { p_locale: locale.id });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setUtenti(data as UtenteLocale[]);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);
  if (!locale) return null;

  const azione = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await fn();
    if (error) avvisa(messaggioErrore(error), "errore"); else avvisa(ok);
    await carica();
  };
  async function crea(e: FormEvent) {
    e.preventDefault();
    if (nuovo.password.length < 10) { avvisa("La password deve avere almeno 10 caratteri", "errore"); return; }
    await azione(() => sb().rpc("crea_utente", { p_locale: locale!.id, p_nome: nuovo.nome.trim(), p_login: nuovo.accesso.trim(), p_password: nuovo.password, p_ruolo: nuovo.ruolo }),
      `Utente creato: accede con «${nuovo.accesso.trim()}» e la password indicata`);
    setNuovo({ ...nuovo, nome: "", accesso: "", password: "" });
  }

  return (
    <section className="gruppo">
      <legend>Personale e permessi</legend>
      <p className="muto piccolo">
        Puoi gestire solo chi ha un ruolo inferiore al tuo, e assegnare solo ruoli inferiori al tuo. Il personale senza email accede con un
        nome utente (es. «sara»). <b>Amministratore</b>: tutto, compresa la chiusura di cassa · <b>Responsabile</b>: menu, magazzino, reparti, personale ·
        <b> Caposala</b>: sala, annullamento ordini, incasso e chiusura dei tavoli · <b>Cameriere</b>: apre i tavoli e inserisce comande ·
        <b> Cucina / reparto</b>: avanzamento delle comande ed esauriti.
      </p>
      <table className="tabella">
        <thead><tr><th>Nome</th><th>Accesso</th><th>Ruolo</th><th>Stato</th><th /></tr></thead>
        <tbody>
          {utenti.map((u) => (
            <tr key={u.user_id}>
              <td>{u.nome || "—"}</td>
              <td className="numero">{u.accesso}</td>
              <td>{u.gestibile ? (
                <select value={u.ruolo} onChange={(e) => void azione(() => sb().rpc("modifica_ruolo_utente", { p_locale: locale.id, p_utente: u.user_id, p_ruolo: e.target.value }), "Ruolo aggiornato")}>
                  {assegnabili.map((r) => <option key={r} value={r}>{NOMI_RUOLO[r]}</option>)}
                </select>
              ) : NOMI_RUOLO[u.ruolo]}</td>
              <td>{u.attivo ? "Attivo" : "Disattivato"}</td>
              <td>{u.gestibile && (
                <span className="riga-form">
                  <button className="btn btn-piccolo" onClick={() => {
                    const pw = prompt(`Nuova password per ${u.nome || u.accesso} (almeno 10 caratteri):`);
                    if (pw) void azione(() => sb().rpc("reimposta_password_utente", { p_locale: locale.id, p_utente: u.user_id, p_password: pw }), "Password reimpostata: l'utente viene disconnesso");
                  }}>Password</button>
                  <button className="btn btn-piccolo" onClick={() => void azione(() => sb().rpc("imposta_attivo_utente", { p_locale: locale.id, p_utente: u.user_id, p_attivo: !u.attivo }), u.attivo ? "Account disattivato" : "Account riattivato")}>
                    {u.attivo ? "Disattiva" : "Riattiva"}</button>
                  <button className="btn btn-pericolo btn-piccolo" onClick={() => {
                    if (confirm(`Rimuovere ${u.nome || u.accesso} dal locale? L'account viene disattivato; lo storico resta.`))
                      void azione(() => sb().rpc("rimuovi_utente", { p_locale: locale.id, p_utente: u.user_id }), "Utente rimosso");
                  }}>Rimuovi</button>
                </span>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {assegnabili.length > 0 && (
        <form className="riga-form" onSubmit={crea} autoComplete="off">
          <input placeholder="Nome (es. Sara)" maxLength={120} value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} required />
          <input placeholder="Nome utente o email" autoCapitalize="none" value={nuovo.accesso} onChange={(e) => setNuovo({ ...nuovo, accesso: e.target.value.toLowerCase() })} required />
          <input type="password" placeholder="Password (min. 10)" autoComplete="new-password" value={nuovo.password} onChange={(e) => setNuovo({ ...nuovo, password: e.target.value })} required />
          <select value={nuovo.ruolo} onChange={(e) => setNuovo({ ...nuovo, ruolo: e.target.value as Ruolo })}>
            {assegnabili.map((r) => <option key={r} value={r}>{NOMI_RUOLO[r]}</option>)}
          </select>
          <button className="btn btn-pieno">Crea utente</button>
        </form>
      )}
    </section>
  );
}

interface Stampante { id: string; nome: string; indirizzo: string; porta: number; colonne: number; attiva: boolean }
interface Reparto { id: string; nome: string; stampante_id: string | null; copie: number }
interface Categoria { id: string; nome: string; reparto_id: string | null }

function SezioneReparti() {
  const { locale } = useSessione();
  const avvisa = useAvviso();
  const [stampanti, setStampanti] = useState<Stampante[]>([]);
  const [reparti, setReparti] = useState<Reparto[]>([]);
  const [categorie, setCategorie] = useState<Categoria[]>([]);
  const [nuovaS, setNuovaS] = useState({ nome: "", indirizzo: "", porta: 9100, colonne: 48 });
  const [nuovoR, setNuovoR] = useState("");

  const carica = useCallback(async () => {
    if (!locale) return;
    const [s, r, c] = await Promise.all([
      sb().from("stampanti").select("id, nome, indirizzo, porta, colonne, attiva").eq("locale_id", locale.id).order("nome"),
      sb().from("reparti").select("id, nome, stampante_id, copie").eq("locale_id", locale.id).order("posizione").order("nome"),
      sb().from("categorie").select("id, nome, reparto_id").eq("locale_id", locale.id).order("posizione").order("nome"),
    ]);
    const e = s.error ?? r.error ?? c.error;
    if (e) { avvisa(messaggioErrore(e), "errore"); return; }
    setStampanti(s.data as Stampante[]); setReparti(r.data as Reparto[]); setCategorie(c.data as Categoria[]);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);
  if (!locale) return null;

  const esito = async (r: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await r;
    if (error) avvisa(messaggioErrore(error), "errore"); else avvisa(ok);
    await carica();
  };

  return (
    <section className="gruppo">
      <legend>Reparti e stampanti</legend>
      <p className="muto piccolo">Ogni categoria del menu va a un reparto (es. Pinse → Cucina, Vini → Bar). Quando un ordine va in cucina, ogni reparto riceve
        il suo biglietto sulla sua stampante. Stampanti termiche di rete (ESC/POS, porta 9100), nella rete del locale.</p>

      <h3>Stampanti</h3>
      <table className="tabella">
        <thead><tr><th>Nome</th><th>Indirizzo</th><th>Carta</th><th>Attiva</th><th /></tr></thead>
        <tbody>
          {stampanti.map((s) => (
            <tr key={s.id}>
              <td>{s.nome}</td><td className="numero">{s.indirizzo}:{s.porta}</td><td>{s.colonne === 32 ? "58 mm" : "80 mm"}</td>
              <td><input type="checkbox" checked={s.attiva} onChange={(e) => void esito(sb().from("stampanti").update({ attiva: e.target.checked }).eq("id", s.id), "Salvato")} aria-label="Attiva" /></td>
              <td className="riga-form">
                <button className="btn btn-piccolo" onClick={() => void esito(sb().rpc("stampa_prova", { p_stampante: s.id }), "Prova inviata: controlla la stampante")}>Stampa di prova</button>
                <button className="btn btn-pericolo btn-piccolo" onClick={() => { if (confirm(`Eliminare la stampante ${s.nome}?`)) void esito(sb().from("stampanti").delete().eq("id", s.id), "Stampante eliminata"); }}>Elimina</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="riga-form" onSubmit={(e) => { e.preventDefault(); void esito(sb().from("stampanti").insert({ ...nuovaS, nome: nuovaS.nome.trim(), indirizzo: nuovaS.indirizzo.trim(), locale_id: locale.id }), "Stampante aggiunta").then(() => setNuovaS({ nome: "", indirizzo: "", porta: 9100, colonne: 48 })); }}>
        <input placeholder="Nome (es. Cucina)" maxLength={40} value={nuovaS.nome} onChange={(e) => setNuovaS({ ...nuovaS, nome: e.target.value })} required />
        <input placeholder="IP (es. 192.168.111.50)" inputMode="decimal" value={nuovaS.indirizzo} onChange={(e) => setNuovaS({ ...nuovaS, indirizzo: e.target.value })} required />
        <input type="number" min={1} max={65535} value={nuovaS.porta} onChange={(e) => setNuovaS({ ...nuovaS, porta: Number(e.target.value) })} aria-label="Porta" style={{ width: 90 }} />
        <select value={nuovaS.colonne} onChange={(e) => setNuovaS({ ...nuovaS, colonne: Number(e.target.value) })} aria-label="Carta">
          <option value={48}>80 mm</option><option value={32}>58 mm</option>
        </select>
        <button className="btn btn-pieno">Aggiungi stampante</button>
      </form>

      <h3>Reparti</h3>
      <table className="tabella">
        <thead><tr><th>Reparto</th><th>Stampante</th><th>Copie</th><th /></tr></thead>
        <tbody>
          {reparti.map((r) => (
            <tr key={r.id}>
              <td>{r.nome}</td>
              <td><select value={r.stampante_id ?? ""} onChange={(e) => void esito(sb().from("reparti").update({ stampante_id: e.target.value || null }).eq("id", r.id), "Salvato")}>
                <option value="">Nessuna (non stampa)</option>{stampanti.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select></td>
              <td><select value={r.copie} onChange={(e) => void esito(sb().from("reparti").update({ copie: Number(e.target.value) }).eq("id", r.id), "Salvato")}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
              <td><button className="btn btn-pericolo btn-piccolo" onClick={() => { if (confirm(`Eliminare il reparto ${r.nome}?`)) void esito(sb().from("reparti").delete().eq("id", r.id), "Reparto eliminato"); }}>Elimina</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="riga-form" onSubmit={(e) => { e.preventDefault(); void esito(sb().from("reparti").insert({ nome: nuovoR.trim(), locale_id: locale.id }), "Reparto aggiunto").then(() => setNuovoR("")); }}>
        <input placeholder="Nuovo reparto (es. Bar, Pizzeria)" maxLength={40} value={nuovoR} onChange={(e) => setNuovoR(e.target.value)} required />
        <button className="btn btn-pieno">Aggiungi reparto</button>
      </form>

      {reparti.length > 0 && (<>
        <h3>Categorie del menu</h3>
        <table className="tabella">
          <thead><tr><th>Categoria</th><th>Reparto</th></tr></thead>
          <tbody>
            {categorie.map((c) => (
              <tr key={c.id}><td>{c.nome}</td><td>
                <select value={c.reparto_id ?? ""} onChange={(e) => void esito(sb().from("categorie").update({ reparto_id: e.target.value || null }).eq("id", c.id), "Salvato")}>
                  <option value="">Nessuno</option>{reparti.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select></td></tr>
            ))}
          </tbody>
        </table>
      </>)}
    </section>
  );
}
