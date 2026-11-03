import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";

interface UtenteTelegram { id: string; telegram_id: number; nome: string; attivo: boolean }

/** Impostazioni del locale (solo titolare): per ora gli utenti Telegram del bot. */
export function Impostazioni() {
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

  if (!locale) return null;
  if (ruolo !== "owner") return <div className="pagina"><h1>Impostazioni</h1><p className="muto">Solo il titolare può modificare le impostazioni.</p></div>;

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
    <div className="pagina">
      <div className="pagina-testa"><h1>Impostazioni</h1></div>
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
    </div>
  );
}
