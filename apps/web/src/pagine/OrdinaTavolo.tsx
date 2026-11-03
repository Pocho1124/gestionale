import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { caricaFont, pilaFont } from "../lib/font";
import type { MenuPubblico, PiattoMenu } from "../lib/tipi";
import { ASPETTO_PREDEFINITO } from "./MenuPubblico";
import { sorgenteImmagine } from "../lib/archivio";

interface InfoTavolo { tavolo: string; slug: string; locale: string; aperto: boolean }
interface RigaCarrello { piatto: PiattoMenu; quantita: number; nota: string }
interface OrdineCliente { id: string; stato: string; motivo: string; creato_at: string; righe: { nome: string; quantita: number; prezzo_cent: number; nota: string }[] }

const STATI: Record<string, { testo: string; icona: string }> = {
  da_confermare: { testo: "In attesa di conferma", icona: "⏳" }, confermato: { testo: "Inviato in cucina", icona: "✅" },
  in_preparazione: { testo: "In preparazione", icona: "👨‍🍳" }, pronto: { testo: "Pronto, sta arrivando", icona: "🛎️" },
  servito: { testo: "Servito", icona: "🍽️" }, rifiutato: { testo: "Non accettato", icona: "❌" },
};
const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);
const euro = (c: number) => formatta(centesimi(c));
const leggi = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const scrivi = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* memoria non disponibile */ } };
/** Segreto di questo telefono: solo lui potrà ricevere il codice del tavolo quando lo staff accetta. */
function segretoDispositivo(token: string) {
  let s = leggi(`segreto-${token}`);
  if (s.length < 16) {
    s = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    scrivi(`segreto-${token}`, s);
  }
  return s;
}

/** Pagina aperta dal QR del tavolo: si sfoglia il menu, si compone l'ordine e lo si invia; lo staff conferma. */
export function OrdinaTavolo() {
  const { token = "" } = useParams();
  const chiaveCodice = `codice-tavolo-${token}`;
  const [info, setInfo] = useState<InfoTavolo | null | "assente">(null);
  const [menu, setMenu] = useState<MenuPubblico | null>(null);
  const [carrello, setCarrello] = useState<Record<string, RigaCarrello>>({});
  const [vista, setVista] = useState<"menu" | "carrello" | "ordini">("menu");
  const [codice, setCodice] = useState(() => leggi(chiaveCodice));
  const [richiesta, setRichiesta] = useState(() => leggi(`richiesta-${token}`));
  const [mostraCodice, setMostraCodice] = useState(false);
  const [nota, setNota] = useState("");
  const [ordini, setOrdini] = useState<OrdineCliente[]>([]);
  const [conto, setConto] = useState<string | null>(null);
  const [notaConto, setNotaConto] = useState("");
  const [messaggio, setMessaggio] = useState<{ testo: string; errore?: boolean } | null>(null);
  const [invio, setInvio] = useState(false);

  const carica = useCallback(async () => {
    const { data } = await sb().rpc("tavolo_cliente", { p_token: token });
    if (!data) { setInfo("assente"); return; }
    setInfo(data as InfoTavolo);
    const m = await sb().rpc("menu_pubblico", { p_slug: (data as InfoTavolo).slug });
    if (m.data) setMenu(m.data as MenuPubblico);
  }, [token]);

  const caricaOrdini = useCallback(async () => {
    if (!/^\d{4}$/.test(codice)) return;
    const { data } = await sb().rpc("ordini_tavolo", { p_token: token, p_codice: codice });
    if (data && !(data as { errore?: string }).errore) {
      setOrdini((data as { ordini: OrdineCliente[] }).ordini);
      setConto((data as { conto?: string | null }).conto ?? null);
    }
  }, [token, codice]);

  useEffect(() => { void carica(); const t = setInterval(() => void carica(), 30_000); return () => clearInterval(t); }, [carica]);
  useEffect(() => { void caricaOrdini(); const t = setInterval(() => void caricaOrdini(), 8_000); return () => clearInterval(t); }, [caricaOrdini]);

  // Richiesta inviata a tavolo chiuso: si attende che il personale la accetti; il codice arriva da solo
  useEffect(() => {
    if (!richiesta) return;
    const controlla = async () => {
      const { data } = await sb().rpc("stato_richiesta", { p_token: token, p_richiesta: richiesta, p_segreto: segretoDispositivo(token) });
      const e = data as { stato?: string; codice?: string | null; motivo?: string; errore?: string } | null;
      if (!e || e.errore) { scrivi(`richiesta-${token}`, ""); setRichiesta(""); return; }
      if (e.stato === "accettata") {
        scrivi(`richiesta-${token}`, ""); setRichiesta("");
        if (e.codice) { setCodice(e.codice); scrivi(chiaveCodice, e.codice); }
        setVista("ordini");
        setMessaggio({ testo: `Tavolo aperto e ordine inviato in cucina! Codice del tavolo: ${e.codice ?? "—"} — d'ora in poi gli ordini vanno diretti in cucina; condividilo con chi è con te.` });
        void carica();
      } else if (e.stato === "rifiutata" || e.stato === "scaduta") {
        scrivi(`richiesta-${token}`, ""); setRichiesta("");
        setMessaggio({ testo: e.stato === "scaduta" ? "Nessuno ha ancora risposto: chiama il personale al tavolo." : `Il personale non ha accettato la richiesta${e.motivo ? `: ${e.motivo}` : ""}.`, errore: true });
      }
    };
    void controlla();
    const t = setInterval(() => void controlla(), 4_000);
    return () => clearInterval(t);
  }, [richiesta, token, chiaveCodice, carica]);

  const aspetto = menu?.aspetto ?? ASPETTO_PREDEFINITO;
  useEffect(() => { caricaFont(aspetto.font_titoli); caricaFont(aspetto.font_testo); }, [aspetto.font_titoli, aspetto.font_testo]);
  const stile = {
    "--m-primario": aspetto.colore_primario, "--m-accento": aspetto.colore_accento, "--m-sfondo": aspetto.colore_sfondo, "--m-testo": aspetto.colore_testo,
    "--m-font-titoli": pilaFont(aspetto.font_titoli, SERIF.has(aspetto.font_titoli)), "--m-font-testo": pilaFont(aspetto.font_testo, SERIF.has(aspetto.font_testo)),
  } as CSSProperties;

  const righe = Object.values(carrello);
  const pezzi = righe.reduce((n, r) => n + r.quantita, 0);
  const totale = righe.reduce((n, r) => n + r.quantita * r.piatto.prezzo_cent, 0);
  const cambia = (p: PiattoMenu, delta: number) => setCarrello((c) => {
    const q = Math.max(0, Math.min(20, (c[p.id]?.quantita ?? 0) + delta));
    const nuovo = { ...c };
    if (q === 0) delete nuovo[p.id]; else nuovo[p.id] = { piatto: p, quantita: q, nota: c[p.id]?.nota ?? "" };
    return nuovo;
  });
  const inAttesa = useMemo(() => ordini.filter((o) => o.stato === "da_confermare").length, [ordini]);

  async function inviaRichiesta() {
    const { data, error } = await sb().rpc("richiedi_tavolo", {
      p_token: token, p_segreto: segretoDispositivo(token), p_nota: nota.trim(),
      p_righe: righe.map((r) => ({ prodotto_id: r.piatto.id, quantita: r.quantita, nota: r.nota.trim() })),
    });
    const e = data as { richiesta?: string; errore?: string } | null;
    if (error || !e?.richiesta) { setMessaggio({ testo: e?.errore ?? error?.message ?? "Invio non riuscito", errore: true }); void carica(); return; }
    scrivi(`richiesta-${token}`, e.richiesta); setRichiesta(e.richiesta);
    setCarrello({}); setNota("");
    setMessaggio({ testo: "Richiesta inviata! Il personale sta arrivando a confermare il tuo ordine." });
  }

  async function invia() {
    setInvio(true); setMessaggio(null);
    try {
      if (!/^\d{4}$/.test(codice)) { await inviaRichiesta(); return; }
      const { data, error } = await sb().rpc("invia_ordine", {
        p_token: token, p_codice: codice, p_nota: nota.trim(),
        p_righe: righe.map((r) => ({ prodotto_id: r.piatto.id, quantita: r.quantita, nota: r.nota.trim() })),
      });
      const esito = data as { errore?: string; codice_errato?: boolean } | null;
      // Codice vecchio (tavolo chiuso e riaperto) o sbagliato: si passa alla richiesta al personale
      if (esito?.codice_errato || esito?.errore?.includes("non è ancora aperto")) {
        setCodice(""); scrivi(chiaveCodice, ""); await inviaRichiesta(); return;
      }
      if (error || esito?.errore) { setMessaggio({ testo: esito?.errore ?? error?.message ?? "Invio non riuscito", errore: true }); if (error) void carica(); return; }
      setCarrello({}); setNota(""); setVista("ordini");
      setMessaggio({ testo: "Ordine inviato in cucina! 🍽️" });
      void caricaOrdini();
    } finally { setInvio(false); }
  }

  if (info === null) return <p className="centrato muto">Caricamento…</p>;
  if (info === "assente") return <p className="centrato muto">QR non valido: inquadra il codice sul tuo tavolo o chiedi al personale.</p>;

  return (
    <div className="menu ordina" style={stile}>
      <header className="menu-testata">
        {sorgenteImmagine(aspetto.logo_path, aspetto.logo_dati, aspetto.logo_url)
          ? <img className="menu-logo" src={sorgenteImmagine(aspetto.logo_path, aspetto.logo_dati, aspetto.logo_url)!} alt={info.locale} /> : <h1>{info.locale}</h1>}
        <p className="ordina-tavolo">Tavolo {info.tavolo}</p>
      </header>
      {richiesta && <p className="ordina-avviso" role="status">⏳ Richiesta inviata: il personale sta arrivando a confermare il tuo ordine…</p>}
      {messaggio && <p className={`ordina-avviso${messaggio.errore ? " errore" : " ok"}`} role="status">{messaggio.testo}</p>}

      <nav className="ordina-schede" aria-label="Sezioni">
        <button className={vista === "menu" ? "attiva" : ""} onClick={() => setVista("menu")}>Menu</button>
        <button className={vista === "carrello" ? "attiva" : ""} onClick={() => setVista("carrello")}>Il tuo ordine{pezzi ? ` (${pezzi})` : ""}</button>
        <button className={vista === "ordini" ? "attiva" : ""} onClick={() => setVista("ordini")}>Ordini e conto{inAttesa ? " ⏳" : ""}</button>
      </nav>

      {vista === "menu" && menu?.categorie.map((c) => (
        <section key={c.id} className="menu-categoria">
          <h2>{c.nome}</h2>
          {c.prodotti.map((p) => (
            <article key={p.id} className={`menu-piatto ordina-piatto${p.disponibile ? "" : " esaurito"}`}>
              <div className="menu-riga">
                <h3>{p.nome}</h3>
                <span className="menu-prezzo">{euro(p.prezzo_cent)}</span>
              </div>
              {p.descrizione && <p className="menu-desc">{p.descrizione}</p>}
              {p.allergeni.length > 0 && <p className="menu-allergeni">Allergeni: {p.allergeni.join(", ")}</p>}
              <div className="ordina-quantita">
                {p.disponibile ? (
                  <>
                    {carrello[p.id] && <button onClick={() => cambia(p, -1)} aria-label={`Togli ${p.nome}`}>−</button>}
                    {carrello[p.id] && <strong>{carrello[p.id]!.quantita}</strong>}
                    <button onClick={() => cambia(p, 1)} aria-label={`Aggiungi ${p.nome}`}>{carrello[p.id] ? "+" : "Aggiungi"}</button>
                  </>
                ) : <span className="menu-badge">Esaurito</span>}
              </div>
            </article>
          ))}
        </section>
      ))}

      {vista === "carrello" && (
        <section className="menu-categoria">
          <h2>Il tuo ordine</h2>
          {righe.length === 0 ? <p className="menu-desc">Non hai ancora aggiunto nulla.</p> : (
            <>
              {righe.map((r) => (
                <article key={r.piatto.id} className="menu-piatto">
                  <div className="menu-riga"><h3>{r.quantita} × {r.piatto.nome}</h3><span className="menu-prezzo">{euro(r.quantita * r.piatto.prezzo_cent)}</span></div>
                  <div className="ordina-quantita">
                    <button onClick={() => cambia(r.piatto, -1)} aria-label="Meno">−</button><strong>{r.quantita}</strong>
                    <button onClick={() => cambia(r.piatto, 1)} aria-label="Più">+</button>
                    <input className="ordina-nota" placeholder="Nota (es. senza cipolla)" maxLength={120} value={r.nota}
                      onChange={(e) => setCarrello((c) => ({ ...c, [r.piatto.id]: { ...r, nota: e.target.value } }))} />
                  </div>
                </article>
              ))}
              <label className="ordina-campo">Nota per il personale
                <input maxLength={200} value={nota} placeholder="Facoltativa" onChange={(e) => setNota(e.target.value)} />
              </label>
              {mostraCodice || codice ? (
                <label className="ordina-campo">Codice del tavolo (facoltativo)
                  <input inputMode="numeric" pattern="[0-9]*" maxLength={4} value={codice} placeholder="4 cifre"
                    onChange={(e) => setCodice(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                </label>
              ) : (
                <button className="ordina-link" onClick={() => setMostraCodice(true)}>Hai già il codice del tavolo? Inseriscilo</button>
              )}
              <button className="ordina-invia" disabled={invio || !!richiesta} onClick={() => void invia()}>
                {invio ? "Invio…" : `Invia ordine · ${euro(totale)}`}
              </button>
              <p className="menu-allergeni">{codice ? "L'ordine va diretto in cucina." : "Il personale riceve la tua richiesta, apre il tavolo e da lì gli ordini vanno diretti in cucina."}</p>
            </>
          )}
        </section>
      )}

      {vista === "ordini" && (
        <section className="menu-categoria">
          <h2>Ordini inviati</h2>
          {/^\d{4}$/.test(codice) && <p className="ordina-codice">Codice del tavolo: <strong>{codice}</strong> · condividilo con chi è con te</p>}
          {/^\d{4}$/.test(codice) && ordini.some((o) => o.stato !== "rifiutato") && (
            conto === "in_attesa" ? <p className="ordina-avviso ok">🧾 Conto richiesto: il personale sta arrivando.</p> : (
              <div className="ordina-conto">
                <input maxLength={120} value={notaConto} placeholder="Nota per il conto (es. pago con carta, conti separati)" onChange={(e) => setNotaConto(e.target.value)} />
                <button className="ordina-invia" onClick={async () => {
                  const { data, error } = await sb().rpc("chiedi_conto", { p_token: token, p_codice: codice, p_nota: notaConto.trim() });
                  const esito = data as { errore?: string } | null;
                  if (error || esito?.errore) { setMessaggio({ testo: esito?.errore ?? error?.message ?? "Richiesta non riuscita", errore: true }); return; }
                  setConto("in_attesa"); setMessaggio({ testo: "Conto richiesto: il personale sta arrivando. 🧾" });
                }}>🧾 Chiedi il conto · {euro(ordini.filter((o) => o.stato !== "rifiutato").reduce((n, o) => n + o.righe.reduce((m, r) => m + r.quantita * r.prezzo_cent, 0), 0))}</button>
              </div>
            )
          )}
          {!/^\d{4}$/.test(codice) ? <p className="menu-desc">{richiesta ? "In attesa della conferma del personale…" : "Qui vedrai gli ordini dopo la conferma del personale."}</p>
            : ordini.length === 0 ? <p className="menu-desc">Nessun ordine inviato da questo tavolo.</p>
            : ordini.map((o) => (
              <article key={o.id} className="menu-piatto">
                <div className="menu-riga">
                  <h3>{STATI[o.stato]?.icona} {STATI[o.stato]?.testo ?? o.stato}</h3>
                  <span className="menu-prezzo">{euro(o.righe.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0))}</span>
                </div>
                <p className="menu-desc">{o.righe.map((r) => `${r.quantita} × ${r.nome}${r.nota ? ` (${r.nota})` : ""}`).join(" · ")}</p>
                {o.stato === "rifiutato" && o.motivo && <p className="menu-desc">Motivo: {o.motivo}</p>}
                <p className="menu-allergeni">Inviato alle {new Date(o.creato_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</p>
              </article>
            ))}
        </section>
      )}

      {vista === "menu" && pezzi > 0 && (
        <button className="ordina-barra" onClick={() => setVista("carrello")}>
          Vedi il tuo ordine · {pezzi} {pezzi === 1 ? "piatto" : "piatti"} · {euro(totale)}
        </button>
      )}
    </div>
  );
}
