import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";

export interface Prenotazione {
  id: string; tavolo_id: string | null; nome: string; telefono: string; persone: number; data_ora: string; durata_min: number;
  note: string; stato: "attiva" | "arrivata" | "annullata" | "non_presentata";
}
interface TavoloBreve { id: string; nome: string }

const NOMI_STATO: Record<Prenotazione["stato"], string> = { attiva: "Attesa", arrivata: "Arrivati", annullata: "Annullata", non_presentata: "Non presentati" };
const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const oraBreve = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const VUOTA = { nome: "", telefono: "", persone: 2, ora: "20:00", durata: 120, tavolo: "", note: "" };

/**
 * Prenotazioni del giorno: inserimento, tavolo, arrivo (apre il tavolo), annullo e mancato arrivo.
 * Nome e telefono sono dati personali: niente storico delle modifiche, cancellati dal database 30 giorni dopo la data.
 */
export function Prenotazioni(props: { locale: string; tavoli: TavoloBreve[]; onFatto: () => Promise<void> }) {
  const avvisa = useAvviso();
  const [giorno, setGiorno] = useState(oggi());
  const [lista, setLista] = useState<Prenotazione[]>([]);
  const [nuova, setNuova] = useState(VUOTA);
  const [aperto, setAperto] = useState(false);

  const carica = useCallback(async () => {
    const dal = new Date(`${giorno}T00:00`), al = new Date(dal.getTime() + 24 * 3600_000);
    const { data, error } = await sb().from("prenotazioni").select("id, tavolo_id, nome, telefono, persone, data_ora, durata_min, note, stato")
      .eq("locale_id", props.locale).gte("data_ora", dal.toISOString()).lt("data_ora", al.toISOString()).order("data_ora");
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setLista(data as Prenotazione[]);
  }, [giorno, props.locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);
  useEffect(() => {
    const canale = sb().channel(`prenotazioni-${props.locale}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prenotazioni", filter: `locale_id=eq.${props.locale}` }, () => void carica())
      .subscribe();
    return () => { void sb().removeChannel(canale); };
  }, [props.locale, carica]);

  async function esegui(azione: () => PromiseLike<{ error: unknown }>, ok: string) {
    const { error } = await azione();
    if (error) { avvisa(messaggioErrore(error), "errore"); return false; }
    avvisa(ok); await carica(); await props.onFatto(); return true;
  }
  async function salva(e: FormEvent) {
    e.preventDefault();
    const quando = new Date(`${giorno}T${nuova.ora}`);
    if (Number.isNaN(quando.getTime())) { avvisa("Ora non valida", "errore"); return; }
    const ok = await esegui(() => sb().from("prenotazioni").insert({
      locale_id: props.locale, nome: nuova.nome.trim(), telefono: nuova.telefono.trim(), persone: nuova.persone, data_ora: quando.toISOString(),
      durata_min: nuova.durata, tavolo_id: nuova.tavolo || null, note: nuova.note.trim(),
    }), `Prenotazione di ${nuova.nome.trim()} alle ${nuova.ora}`);
    if (ok) { setNuova(VUOTA); setAperto(false); }
  }
  const nomeTavolo = (id: string | null) => props.tavoli.find((t) => t.id === id)?.nome;
  const attive = lista.filter((p) => p.stato === "attiva");

  return (
    <section className="prenotazioni">
      <div className="riga-form" style={{ justifyContent: "space-between" }}>
        <div className="riga-form">
          <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value || oggi())} aria-label="Giorno" />
          {giorno !== oggi() && <button className="btn btn-testo" onClick={() => setGiorno(oggi())}>Oggi</button>}
          <span className="muto">{attive.length} in attesa · {attive.reduce((n, p) => n + p.persone, 0)} persone</span>
        </div>
        <button className="btn btn-pieno" onClick={() => setAperto((v) => !v)}>{aperto ? "Chiudi" : "+ Nuova prenotazione"}</button>
      </div>

      {aperto && (
        <form className="prenotazione-form" onSubmit={salva}>
          <label>Nome<input required maxLength={60} value={nuova.nome} onChange={(e) => setNuova({ ...nuova, nome: e.target.value })} /></label>
          <label>Telefono (facoltativo)<input inputMode="tel" maxLength={20} pattern="[0-9 +]*" value={nuova.telefono}
            onChange={(e) => setNuova({ ...nuova, telefono: e.target.value })} /></label>
          <label>Persone<input type="number" min={1} max={60} required value={nuova.persone} onChange={(e) => setNuova({ ...nuova, persone: Number(e.target.value) })} /></label>
          <label>Ora<input type="time" required value={nuova.ora} onChange={(e) => setNuova({ ...nuova, ora: e.target.value })} /></label>
          <label>Durata
            <select value={nuova.durata} onChange={(e) => setNuova({ ...nuova, durata: Number(e.target.value) })}>
              {[60, 90, 120, 150, 180, 240].map((m) => <option key={m} value={m}>{m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}` : `${m} min`}</option>)}
            </select>
          </label>
          <label>Tavolo
            <select value={nuova.tavolo} onChange={(e) => setNuova({ ...nuova, tavolo: e.target.value })}>
              <option value="">Da assegnare</option>
              {props.tavoli.map((t) => <option key={t.id} value={t.id}>Tavolo {t.nome}</option>)}
            </select>
          </label>
          <label className="prenotazione-note">Note<input maxLength={200} placeholder="Es. compleanno, seggiolone" value={nuova.note}
            onChange={(e) => setNuova({ ...nuova, note: e.target.value })} /></label>
          <div className="prenotazione-note"><button className="btn btn-pieno">Salva prenotazione</button>
            <span className="muto piccolo"> Nome e telefono si cancellano da soli 30 giorni dopo la data.</span></div>
        </form>
      )}

      {lista.length === 0 ? <p className="muto">Nessuna prenotazione per questo giorno.</p> : (
        <ul className="lista-prenotazioni">
          {lista.map((p) => (
            <li key={p.id} className={`prenotazione stato-pren-${p.stato}`}>
              <strong className="prenotazione-ora">{oraBreve(p.data_ora)}</strong>
              <span className="prenotazione-chi">
                <b>{p.nome}</b> · {p.persone} {p.persone === 1 ? "persona" : "persone"}
                {p.telefono && <> · <a href={`tel:${p.telefono.replace(/\s/g, "")}`}>{p.telefono}</a></>}
                {p.note && <span className="muto piccolo"> · {p.note}</span>}
              </span>
              {p.stato === "attiva" ? (
                <span className="riga-form">
                  <select value={p.tavolo_id ?? ""} aria-label={`Tavolo per ${p.nome}`}
                    onChange={(e) => void esegui(() => sb().from("prenotazioni").update({ tavolo_id: e.target.value || null }).eq("id", p.id), "Tavolo assegnato")}>
                    <option value="">Tavolo…</option>
                    {props.tavoli.map((t) => <option key={t.id} value={t.id}>Tavolo {t.nome}</option>)}
                  </select>
                  <button className="btn btn-pieno btn-piccolo" disabled={!p.tavolo_id} title={p.tavolo_id ? undefined : "Prima assegna il tavolo"}
                    onClick={() => void esegui(() => sb().rpc("arriva_prenotazione", { p_prenotazione: p.id }), `${p.nome}: tavolo ${nomeTavolo(p.tavolo_id) ?? ""} aperto`)}>Arrivati</button>
                  <button className="btn btn-piccolo" onClick={() => void esegui(() => sb().from("prenotazioni").update({ stato: "non_presentata" }).eq("id", p.id), "Segnati come non presentati")}>Non venuti</button>
                  <button className="btn btn-testo btn-piccolo" onClick={() => { if (confirm(`Annullare la prenotazione di ${p.nome}?`)) void esegui(() => sb().from("prenotazioni").update({ stato: "annullata" }).eq("id", p.id), "Prenotazione annullata"); }}>Annulla</button>
                </span>
              ) : (
                <span className="riga-form">
                  <span className="pill">{NOMI_STATO[p.stato]}{p.tavolo_id ? ` · tavolo ${nomeTavolo(p.tavolo_id) ?? ""}` : ""}</span>
                  <button className="btn btn-testo btn-piccolo" onClick={() => { if (confirm(`Eliminare la prenotazione di ${p.nome}?`)) void esegui(() => sb().from("prenotazioni").delete().eq("id", p.id), "Prenotazione eliminata"); }}>Elimina</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
