import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { caricaFont, pilaFont } from "../lib/font";
import type { MenuPubblico, PiattoMenu } from "../lib/tipi";
import { ASPETTO_PREDEFINITO } from "./MenuPubblico";

interface InfoTavolo { tavolo: string; slug: string; locale: string; aperto: boolean }
interface RigaCarrello { piatto: PiattoMenu; quantita: number; nota: string }
interface OrdineCliente { id: string; stato: string; motivo: string; creato_at: string; righe: { nome: string; quantita: number; prezzo_cent: number; nota: string }[] }

const STATI: Record<string, { testo: string; icona: string }> = {
  da_confermare: { testo: "In attesa di conferma", icona: "⏳" }, confermato: { testo: "Confermato", icona: "✅" },
  in_preparazione: { testo: "In preparazione", icona: "👨‍🍳" }, pronto: { testo: "Pronto, sta arrivando", icona: "🛎️" },
  servito: { testo: "Servito", icona: "🍽️" }, rifiutato: { testo: "Non accettato", icona: "❌" },
};
const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);
const euro = (c: number) => formatta(centesimi(c));

/** Pagina aperta dal QR del tavolo: si sfoglia il menu, si compone l'ordine e lo si invia; lo staff conferma. */
export function OrdinaTavolo() {
  const { token = "" } = useParams();
  const chiaveCodice = `codice-tavolo-${token}`;
  const [info, setInfo] = useState<InfoTavolo | null | "assente">(null);
  const [menu, setMenu] = useState<MenuPubblico | null>(null);
  const [carrello, setCarrello] = useState<Record<string, RigaCarrello>>({});
  const [vista, setVista] = useState<"menu" | "carrello" | "ordini">("menu");
  const [codice, setCodice] = useState(() => { try { return localStorage.getItem(chiaveCodice) ?? ""; } catch { return ""; } });
  const [nota, setNota] = useState("");
  const [ordini, setOrdini] = useState<OrdineCliente[]>([]);
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
    if (data && !(data as { errore?: string }).errore) setOrdini((data as { ordini: OrdineCliente[] }).ordini);
  }, [token, codice]);

  useEffect(() => { void carica(); const t = setInterval(() => void carica(), 30_000); return () => clearInterval(t); }, [carica]);
  useEffect(() => { void caricaOrdini(); const t = setInterval(() => void caricaOrdini(), 8_000); return () => clearInterval(t); }, [caricaOrdini]);

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

  async function invia() {
    if (!/^\d{4}$/.test(codice)) { setMessaggio({ testo: "Inserisci il codice di 4 cifre che ti ha dato il personale", errore: true }); return; }
    setInvio(true); setMessaggio(null);
    const { data, error } = await sb().rpc("invia_ordine", {
      p_token: token, p_codice: codice, p_nota: nota.trim(),
      p_righe: righe.map((r) => ({ prodotto_id: r.piatto.id, quantita: r.quantita, nota: r.nota.trim() })),
    });
    setInvio(false);
    const esito = data as { errore?: string; codice_errato?: boolean } | null;
    if (error || esito?.errore) {
      if (esito?.codice_errato) { setCodice(""); try { localStorage.removeItem(chiaveCodice); } catch { /* memoria non disponibile */ } }
      setMessaggio({ testo: esito?.errore ?? error?.message ?? "Invio non riuscito", errore: true });
      if (error) void carica();
      return;
    }
    try { localStorage.setItem(chiaveCodice, codice); } catch { /* memoria non disponibile */ }
    setCarrello({}); setNota(""); setVista("ordini");
    setMessaggio({ testo: "Ordine inviato! Il personale lo sta confermando." });
    void caricaOrdini();
  }

  if (info === null) return <p className="centrato muto">Caricamento…</p>;
  if (info === "assente") return <p className="centrato muto">QR non valido: inquadra il codice sul tuo tavolo o chiedi al personale.</p>;

  return (
    <div className="menu ordina" style={stile}>
      <header className="menu-testata">
        {aspetto.logo_dati || aspetto.logo_url ? <img className="menu-logo" src={(aspetto.logo_dati || aspetto.logo_url)!} alt={info.locale} /> : <h1>{info.locale}</h1>}
        <p className="ordina-tavolo">Tavolo {info.tavolo}</p>
      </header>
      {!info.aperto && <p className="ordina-avviso">Il tavolo non è ancora aperto: puoi sfogliare il menu, per ordinare chiedi al personale di aprirlo.</p>}
      {messaggio && <p className={`ordina-avviso${messaggio.errore ? " errore" : " ok"}`} role="status">{messaggio.testo}</p>}

      <nav className="ordina-schede">
        <button className={vista === "menu" ? "attiva" : ""} onClick={() => setVista("menu")}>Menu</button>
        <button className={vista === "carrello" ? "attiva" : ""} onClick={() => setVista("carrello")}>Il tuo ordine{pezzi ? ` (${pezzi})` : ""}</button>
        <button className={vista === "ordini" ? "attiva" : ""} onClick={() => setVista("ordini")}>Ordini inviati{inAttesa ? " ⏳" : ""}</button>
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
              <label className="ordina-campo">Codice del tavolo
                <input inputMode="numeric" pattern="[0-9]*" maxLength={4} value={codice} placeholder="4 cifre, te lo dà il personale"
                  onChange={(e) => setCodice(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              </label>
              <button className="ordina-invia" disabled={invio || !info.aperto} onClick={() => void invia()}>
                {invio ? "Invio…" : `Invia ordine · ${euro(totale)}`}
              </button>
              <p className="menu-allergeni">L'ordine viene confermato dal personale prima di andare in cucina.</p>
            </>
          )}
        </section>
      )}

      {vista === "ordini" && (
        <section className="menu-categoria">
          <h2>Ordini inviati</h2>
          {!/^\d{4}$/.test(codice) ? <p className="menu-desc">Inserisci il codice del tavolo nel tuo ordine per vedere gli ordini inviati.</p>
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
