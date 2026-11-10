import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { sb } from "../lib/supabase";
import { caricaFont, pilaFont } from "../lib/font";
import type { GruppoScelte, MenuPubblico, PiattoMenu, Scelta } from "../lib/tipi";
import { Componi, chiaveRiga, conAggiunte, descriviScelte, prezzoComposto } from "../componenti/Componi";
import { ASPETTO_PREDEFINITO } from "./MenuPubblico";
import { sorgenteImmagine } from "../lib/archivio";
import { euro } from "../lib/formato";
import { TESTI_TAVOLO, allergeniIn, descrizioneIn, nomeIn, useLingua } from "../lib/lingua";

interface InfoTavolo { tavolo: string; slug: string; locale: string; aperto: boolean; chiedi_nome?: boolean; nome_obbligatorio?: boolean }
interface RigaCarrello { chiave: string; piatto: PiattoMenu; quantita: number; nota: string; scelte: Scelta[]; prezzo: number }
interface OrdineCliente { id: string; stato: string; motivo: string; creato_at: string; righe: { nome: string; quantita: number; prezzo_cent: number; nota: string; opzioni?: string[] }[] }

const ICONE: Record<string, string> = { da_confermare: "⏳", confermato: "✅", in_preparazione: "👨‍🍳", pronto: "🛎️", servito: "🍽️", rifiutato: "❌" };
const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);
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
  const [componendo, setComponendo] = useState<{ p: PiattoMenu; gruppi: GruppoScelte[] } | null>(null);
  const [vista, setVista] = useState<"menu" | "carrello" | "ordini">("menu");
  const [codice, setCodice] = useState(() => leggi(chiaveCodice));
  const [richiesta, setRichiesta] = useState(() => leggi(`richiesta-${token}`));
  const [mostraCodice, setMostraCodice] = useState(false);
  const [nota, setNota] = useState("");
  // Nome del cliente: solo in memoria (non si salva sul telefono), inviato solo con la richiesta di apertura
  const [nome, setNome] = useState("");
  const [ordini, setOrdini] = useState<OrdineCliente[]>([]);
  const [conto, setConto] = useState<string | null>(null);
  const [coperto, setCoperto] = useState<{ coperti: number; prezzo_cent: number } | null>(null);
  const [notaConto, setNotaConto] = useState("");
  const [messaggio, setMessaggio] = useState<{ testo: string; errore?: boolean } | null>(null);
  const [invio, setInvio] = useState(false);
  const [lingua, setLingua] = useLingua();
  const T = TESTI_TAVOLO[lingua];

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
      setCoperto((data as { coperto?: { coperti: number; prezzo_cent: number } | null }).coperto ?? null);
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
        setMessaggio({ testo: TESTI_TAVOLO[lingua].aperto(e.codice ?? "—") });
        void carica();
      } else if (e.stato === "rifiutata" || e.stato === "scaduta") {
        scrivi(`richiesta-${token}`, ""); setRichiesta("");
        setMessaggio({ testo: e.stato === "scaduta" ? TESTI_TAVOLO[lingua].scaduta : `${TESTI_TAVOLO[lingua].rifiutata}${e.motivo ? `: ${e.motivo}` : ""}.`, errore: true });
      }
    };
    void controlla();
    const t = setInterval(() => void controlla(), 4_000);
    return () => clearInterval(t);
  }, [richiesta, token, chiaveCodice, carica, lingua]);

  const aspetto = menu?.aspetto ?? ASPETTO_PREDEFINITO;
  useEffect(() => { caricaFont(aspetto.font_titoli); caricaFont(aspetto.font_testo); }, [aspetto.font_titoli, aspetto.font_testo]);
  const stile = {
    "--m-primario": aspetto.colore_primario, "--m-accento": aspetto.colore_accento, "--m-sfondo": aspetto.colore_sfondo, "--m-testo": aspetto.colore_testo,
    "--m-font-titoli": pilaFont(aspetto.font_titoli, SERIF.has(aspetto.font_titoli)), "--m-font-testo": pilaFont(aspetto.font_testo, SERIF.has(aspetto.font_testo)),
  } as CSSProperties;

  const righe = Object.values(carrello);
  const pezzi = righe.reduce((n, r) => n + r.quantita, 0);
  const totale = righe.reduce((n, r) => n + r.quantita * r.prezzo, 0);
  const componibile = (p: PiattoMenu) => (p.opzioni?.length ?? 0) > 0;
  /** Aggiunge o toglie una riga; i piatti composti sono righe distinte per ogni combinazione di scelte. */
  const cambiaRiga = (piatto: PiattoMenu, scelte: Scelta[], delta: number) => setCarrello((c) => {
    const chiave = chiaveRiga(piatto.id, scelte);
    const q = Math.max(0, Math.min(20, (c[chiave]?.quantita ?? 0) + delta));
    const nuovo = { ...c };
    if (q === 0) delete nuovo[chiave];
    else nuovo[chiave] = { chiave, piatto, quantita: q, nota: c[chiave]?.nota ?? "", scelte, prezzo: prezzoComposto(piatto.prezzo_cent, scelte) };
    return nuovo;
  });
  const cambia = (p: PiattoMenu, delta: number) => cambiaRiga(p, [], delta);
  const nelCarrello = (p: PiattoMenu) => righe.filter((r) => r.piatto.id === p.id).reduce((n, r) => n + r.quantita, 0);
  const inAttesa = useMemo(() => ordini.filter((o) => o.stato === "da_confermare").length, [ordini]);

  async function inviaRichiesta() {
    if (info !== null && info !== "assente" && info.nome_obbligatorio && !nome.trim()) {
      setMessaggio({ testo: T.scriviNome, errore: true }); return;
    }
    const { data, error } = await sb().rpc("richiedi_tavolo", {
      p_token: token, p_segreto: segretoDispositivo(token), p_nota: nota.trim(),
      p_nome: info !== null && info !== "assente" && info.chiedi_nome ? nome.trim() : "",
      p_righe: righe.map((r) => ({ prodotto_id: r.piatto.id, quantita: r.quantita, nota: r.nota.trim(), opzioni: r.scelte.map((x) => x.id) })),
    });
    const e = data as { richiesta?: string; errore?: string } | null;
    if (error || !e?.richiesta) { setMessaggio({ testo: e?.errore ?? error?.message ?? T.invioFallito, errore: true }); void carica(); return; }
    scrivi(`richiesta-${token}`, e.richiesta); setRichiesta(e.richiesta);
    setCarrello({}); setNota(""); setNome("");
    setMessaggio({ testo: T.richiestaOk });
  }

  async function invia() {
    setInvio(true); setMessaggio(null);
    try {
      if (!/^\d{4}$/.test(codice)) { await inviaRichiesta(); return; }
      const { data, error } = await sb().rpc("invia_ordine", {
        p_token: token, p_codice: codice, p_nota: nota.trim(),
        p_righe: righe.map((r) => ({ prodotto_id: r.piatto.id, quantita: r.quantita, nota: r.nota.trim(), opzioni: r.scelte.map((x) => x.id) })),
      });
      const esito = data as { errore?: string; codice_errato?: boolean } | null;
      // Codice vecchio (tavolo chiuso e riaperto) o sbagliato: si passa alla richiesta al personale
      if (esito?.codice_errato || esito?.errore?.includes("non è ancora aperto")) {
        setCodice(""); scrivi(chiaveCodice, ""); await inviaRichiesta(); return;
      }
      if (error || esito?.errore) { setMessaggio({ testo: esito?.errore ?? error?.message ?? T.invioFallito, errore: true }); if (error) void carica(); return; }
      setCarrello({}); setNota(""); setVista("ordini");
      setMessaggio({ testo: T.ordineOk });
      void caricaOrdini();
    } finally { setInvio(false); }
  }

  if (info === null) return <p className="centrato muto">{T.caricamento}</p>;
  if (info === "assente") return <p className="centrato muto">{T.qrNonValido}</p>;

  return (
    <div className="menu ordina" style={stile}>
      <header className="menu-testata">
        {sorgenteImmagine(aspetto.logo_path, aspetto.logo_dati, aspetto.logo_url)
          ? <img className="menu-logo" src={sorgenteImmagine(aspetto.logo_path, aspetto.logo_dati, aspetto.logo_url)!} alt={info.locale} /> : <h1>{info.locale}</h1>}
        <p className="ordina-tavolo">{T.tavolo} {info.tavolo}</p>
        <button className="ordina-lingua" onClick={() => setLingua(lingua === "it" ? "en" : "it")} lang={lingua === "it" ? "en" : "it"}>{T.altraLingua}</button>
      </header>
      {richiesta && <p className="ordina-avviso" role="status">{T.richiestaInviata}</p>}
      {messaggio && <p className={`ordina-avviso${messaggio.errore ? " errore" : " ok"}`} role="status">{messaggio.testo}</p>}

      <nav className="ordina-schede" aria-label={T.sezioni}>
        <button className={vista === "menu" ? "attiva" : ""} onClick={() => setVista("menu")}>{T.menu}</button>
        <button className={vista === "carrello" ? "attiva" : ""} onClick={() => setVista("carrello")}>{T.ilTuoOrdine}{pezzi ? ` (${pezzi})` : ""}</button>
        <button className={vista === "ordini" ? "attiva" : ""} onClick={() => setVista("ordini")}>{T.ordiniConto}{inAttesa ? " ⏳" : ""}</button>
      </nav>

      {vista === "menu" && menu?.categorie.map((c) => (
        <section key={c.id} className="menu-categoria">
          <h2>{nomeIn(lingua, c)}</h2>
          {c.prodotti.map((p) => (
            <article key={p.id} className={`menu-piatto ordina-piatto${p.disponibile ? "" : " esaurito"}`}>
              <div className="menu-riga">
                <h3>{nomeIn(lingua, p)}</h3>
                <span className="menu-prezzo">{componibile(p) ? T.da : ""}{euro(p.prezzo_cent)}</span>
              </div>
              {descrizioneIn(lingua, p) && <p className="menu-desc">{descrizioneIn(lingua, p)}</p>}
              {componibile(p) && <p className="menu-allergeni">{T.componiPiacere}{p.opzioni.map((g) => g.nome).join(", ")}</p>}
              {p.disponibile && (c.aggiunte?.length ?? 0) > 0 && nelCarrello(p) > (carrello[chiaveRiga(p.id, [])]?.quantita ?? 0) && !componibile(p) && (
                <p className="menu-allergeni">{nelCarrello(p) - (carrello[chiaveRiga(p.id, [])]?.quantita ?? 0)} {T.conAggiunte}</p>
              )}
              {p.allergeni.length > 0 && <p className="menu-allergeni">{T.allergeni}{allergeniIn(lingua, p.allergeni).join(", ")}</p>}
              <div className="ordina-quantita">
                {p.disponibile ? (componibile(p) ? (
                  <>
                    {nelCarrello(p) > 0 && <strong>{nelCarrello(p)} {T.nelTuoOrdine}</strong>}
                    <button onClick={() => setComponendo({ p, gruppi: conAggiunte(p.opzioni, c.aggiunte) })} aria-label={`${T.componi} ${nomeIn(lingua, p)}`}>{T.componi}</button>
                  </>
                ) : (
                  <>
                    {carrello[chiaveRiga(p.id, [])] && <button onClick={() => cambia(p, -1)} aria-label={`${T.togli} ${nomeIn(lingua, p)}`}>−</button>}
                    {carrello[chiaveRiga(p.id, [])] && <strong>{carrello[chiaveRiga(p.id, [])]!.quantita}</strong>}
                    <button onClick={() => cambia(p, 1)} aria-label={`${T.aggiungi} ${nomeIn(lingua, p)}`}>{carrello[chiaveRiga(p.id, [])] ? "+" : T.aggiungi}</button>
                    {(c.aggiunte?.length ?? 0) > 0 && (
                      <button className="ordina-aggiunte" onClick={() => setComponendo({ p, gruppi: conAggiunte([], c.aggiunte) })}
                        aria-label={`${T.aggiuntePer} ${nomeIn(lingua, p)}`}>{T.aggiunte}</button>
                    )}
                  </>
                )) : <span className="menu-badge">{T.esaurito}</span>}
              </div>
            </article>
          ))}
        </section>
      ))}

      {vista === "carrello" && (
        <section className="menu-categoria">
          <h2>{T.ilTuoOrdine}</h2>
          {righe.length === 0 ? <p className="menu-desc">{T.vuoto}</p> : (
            <>
              {righe.map((r) => (
                <article key={r.chiave} className="menu-piatto">
                  <div className="menu-riga"><h3>{r.quantita} × {nomeIn(lingua, r.piatto)}</h3><span className="menu-prezzo">{euro(r.quantita * r.prezzo)}</span></div>
                  {r.scelte.length > 0 && <p className="menu-desc">{r.scelte.map((x) => x.nome).join(", ")}</p>}
                  <div className="ordina-quantita">
                    <button onClick={() => cambiaRiga(r.piatto, r.scelte, -1)} aria-label={T.meno}>−</button><strong>{r.quantita}</strong>
                    <button onClick={() => cambiaRiga(r.piatto, r.scelte, 1)} aria-label={T.piu}>+</button>
                    <input className="ordina-nota" placeholder={T.notaRiga} maxLength={120} value={r.nota}
                      onChange={(e) => setCarrello((c) => ({ ...c, [r.chiave]: { ...r, nota: e.target.value } }))} />
                  </div>
                </article>
              ))}
              <label className="ordina-campo">{T.notaPersonale}
                <input maxLength={200} value={nota} placeholder={T.facoltativa} onChange={(e) => setNota(e.target.value)} />
              </label>
              {info.chiedi_nome && !/^\d{4}$/.test(codice) && (
                <>
                  <label className="ordina-campo">{T.tuoNome}{info.nome_obbligatorio ? "" : T.facoltativo}
                    <input maxLength={40} value={nome} autoComplete="given-name" required={info.nome_obbligatorio}
                      placeholder={T.chiCercare} onChange={(e) => setNome(e.target.value)} />
                  </label>
                  <p className="menu-allergeni">{T.infoNome}</p>
                </>
              )}
              {mostraCodice || codice ? (
                <label className="ordina-campo">{T.codiceTavolo}
                  <input inputMode="numeric" pattern="[0-9]*" maxLength={4} value={codice} placeholder={T.quattroCifre}
                    onChange={(e) => setCodice(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                </label>
              ) : (
                <button className="ordina-link" onClick={() => setMostraCodice(true)}>{T.haiCodice}</button>
              )}
              <button className="ordina-invia" disabled={invio || !!richiesta} onClick={() => void invia()}>
                {invio ? T.invio : `${T.inviaOrdine} · ${euro(totale)}`}
              </button>
              <p className="menu-allergeni">{codice ? T.direttoCucina : T.spiegazione}</p>
            </>
          )}
        </section>
      )}

      {vista === "ordini" && (
        <section className="menu-categoria">
          <h2>{T.ordiniInviati}</h2>
          {/^\d{4}$/.test(codice) && <p className="ordina-codice">{T.codice} <strong>{codice}</strong> · {T.condividi}</p>}
          {/^\d{4}$/.test(codice) && ordini.some((o) => o.stato !== "rifiutato") && (
            conto === "in_attesa" ? <p className="ordina-avviso ok">{T.contoRichiesto}</p> : (
              <div className="ordina-conto">
                <input maxLength={120} value={notaConto} placeholder={T.notaConto} onChange={(e) => setNotaConto(e.target.value)} />
                <button className="ordina-invia" onClick={async () => {
                  const { data, error } = await sb().rpc("chiedi_conto", { p_token: token, p_codice: codice, p_nota: notaConto.trim() });
                  const esito = data as { errore?: string } | null;
                  if (error || esito?.errore) { setMessaggio({ testo: esito?.errore ?? error?.message ?? T.richiestaFallita, errore: true }); return; }
                  setConto("in_attesa"); setMessaggio({ testo: T.contoOk });
                }}>{T.chiediConto} · {euro(ordini.filter((o) => o.stato !== "rifiutato").reduce((n, o) => n + o.righe.reduce((m, r) => m + r.quantita * r.prezzo_cent, 0), 0)
                  + (coperto ? coperto.coperti * coperto.prezzo_cent : 0))}</button>
                {coperto && <p className="menu-allergeni">{T.comprendeCoperto} {coperto.coperti} × {euro(coperto.prezzo_cent)}</p>}
              </div>
            )
          )}
          {!/^\d{4}$/.test(codice) ? <p className="menu-desc">{richiesta ? T.attesaConferma : T.quiVedrai}</p>
            : ordini.length === 0 ? <p className="menu-desc">{T.nessunOrdine}</p>
            : ordini.map((o) => (
              <article key={o.id} className="menu-piatto">
                <div className="menu-riga">
                  <h3>{ICONE[o.stato]} {T.stati[o.stato] ?? o.stato}</h3>
                  <span className="menu-prezzo">{euro(o.righe.reduce((n, r) => n + r.quantita * r.prezzo_cent, 0))}</span>
                </div>
                <p className="menu-desc">{o.righe.map((r) => `${r.quantita} × ${r.nome}${descriviScelte((r.opzioni ?? []).map((nome) => ({ nome })))}${r.nota ? ` — ${r.nota}` : ""}`).join(" · ")}</p>
                {o.stato === "rifiutato" && o.motivo && <p className="menu-desc">{T.motivo} {o.motivo}</p>}
                <p className="menu-allergeni">{T.inviatoAlle} {new Date(o.creato_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</p>
              </article>
            ))}
        </section>
      )}

      {componendo && (
        <Componi nome={nomeIn(lingua, componendo.p)} base={componendo.p.prezzo_cent} gruppi={componendo.gruppi} variante="menu" onChiudi={() => setComponendo(null)}
          onConferma={(scelte) => { cambiaRiga(componendo.p, scelte, 1); setComponendo(null); setMessaggio({ testo: `${nomeIn(lingua, componendo.p)} ${T.aggiuntoAlTuo}` }); }} />
      )}

      <nav className="ordina-lingue" aria-label="Lingua / Language">
        <button lang="it" aria-pressed={lingua === "it"} className={lingua === "it" ? "attiva" : ""} onClick={() => setLingua("it")}>🇮🇹 Italiano</button>
        <button lang="en" aria-pressed={lingua === "en"} className={lingua === "en" ? "attiva" : ""} onClick={() => setLingua("en")}>🇬🇧 English</button>
      </nav>

      {vista === "menu" && pezzi > 0 && (
        <button className="ordina-barra" onClick={() => setVista("carrello")}>
          {T.vedi} · {pezzi} {pezzi === 1 ? T.piatto : T.piatti} · {euro(totale)}
        </button>
      )}
    </div>
  );
}
