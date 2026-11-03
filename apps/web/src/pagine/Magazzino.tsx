import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { puo } from "../lib/permessi";

interface Articolo { id: string; nome: string; unita: string; giacenza: number; scorta_minima: number; costo_cent: number | null; blocca_esauriti: boolean }
interface Componente { prodotto_id: string; articolo_id: string; quantita: number }
interface Movimento { id: string; articolo_id: string; tipo: string; quantita: number; nota: string; creato_at: string }
interface Prodotto { id: string; nome: string }
interface Voce { id: string; nome: string; gruppi_opzioni: { nome: string; prodotti: { nome: string } | null } | null }
interface ComponenteVoce { opzione_id: string; articolo_id: string; quantita: number }
const UNITA = ["pz", "kg", "g", "l", "ml", "bottiglia"];
const num = (v: number) => Number(v).toLocaleString("it-IT", { maximumFractionDigits: 3 });
const leggi = (t: string) => Number(t.replace(",", "."));

/** Magazzino: articoli, carichi, inventario, collegamento ai piatti (ogni vendita scarica le quantità). */
export function Magazzino() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [articoli, setArticoli] = useState<Articolo[]>([]);
  const [componenti, setComponenti] = useState<Componente[]>([]);
  const [movimenti, setMovimenti] = useState<Movimento[]>([]);
  const [prodotti, setProdotti] = useState<Prodotto[]>([]);
  const [voci, setVoci] = useState<Voce[]>([]);
  const [compVoci, setCompVoci] = useState<ComponenteVoce[]>([]);
  const [aperto, setAperto] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState({ nome: "", unita: "pz", scorta_minima: "0", blocca_esauriti: false });

  const carica = useCallback(async () => {
    if (!locale) return;
    const [a, c, m, p] = await Promise.all([
      sb().from("articoli").select("id, nome, unita, giacenza, scorta_minima, costo_cent, blocca_esauriti").eq("locale_id", locale.id).order("nome"),
      sb().from("componenti").select("prodotto_id, articolo_id, quantita").eq("locale_id", locale.id),
      sb().from("movimenti").select("id, articolo_id, tipo, quantita, nota, creato_at").eq("locale_id", locale.id).order("creato_at", { ascending: false }).limit(200),
      sb().from("prodotti").select("id, nome").eq("locale_id", locale.id).order("nome"),
    ]);
    const [v, cv] = await Promise.all([
      sb().from("opzioni").select("id, nome, gruppi_opzioni(nome, prodotti(nome))").eq("locale_id", locale.id).order("nome"),
      sb().from("componenti_opzioni").select("opzione_id, articolo_id, quantita").eq("locale_id", locale.id),
    ]);
    if (!v.error) setVoci(v.data as unknown as Voce[]);
    if (!cv.error) setCompVoci(cv.data as ComponenteVoce[]);
    const e = a.error ?? c.error ?? m.error ?? p.error;
    if (e) { avvisa(messaggioErrore(e), "errore"); return; }
    setArticoli(a.data as Articolo[]); setComponenti(c.data as Componente[]); setMovimenti(m.data as Movimento[]); setProdotti(p.data as Prodotto[]);
  }, [locale, avvisa]);
  useEffect(() => { void carica(); }, [carica]);

  if (!locale) return null;
  if (!puo(ruolo, "magazzino")) return <div className="pagina"><h1>Magazzino</h1><p className="muto">Non hai i permessi per il magazzino.</p></div>;

  const esito = async (r: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await r;
    if (error) { avvisa(messaggioErrore(error), "errore"); return false; }
    avvisa(ok); await carica(); return true;
  };
  async function crea(e: FormEvent) {
    e.preventDefault();
    const minima = leggi(nuovo.scorta_minima);
    if (Number.isNaN(minima) || minima < 0) { avvisa("Scorta minima non valida", "errore"); return; }
    if (await esito(sb().from("articoli").insert({ locale_id: locale!.id, nome: nuovo.nome.trim(), unita: nuovo.unita, scorta_minima: minima, blocca_esauriti: nuovo.blocca_esauriti }), "Articolo aggiunto"))
      setNuovo({ nome: "", unita: "pz", scorta_minima: "0", blocca_esauriti: false });
  }
  const sotto = articoli.filter((a) => Number(a.giacenza) <= Number(a.scorta_minima));

  return (
    <div className="pagina">
      <div className="pagina-testa"><h1>Magazzino</h1></div>
      {sotto.length > 0 && <p className="ordina-avviso errore" style={{ margin: 0 }}>⚠️ Sotto scorta: {sotto.map((a) => `${a.nome} (${num(a.giacenza)} ${a.unita})`).join(" · ")}</p>}
      <p className="muto piccolo">Ogni vendita confermata scarica gli articoli collegati al piatto; un ordine annullato li restituisce. Con «Esaurisce i piatti»,
        a giacenza zero i piatti collegati diventano esauriti nel menu, e tornano disponibili al carico successivo.</p>

      <table className="tabella">
        <thead><tr><th>Articolo</th><th>Giacenza</th><th>Scorta minima</th><th>Esaurisce i piatti</th><th /></tr></thead>
        <tbody>
          {articoli.map((a) => (<Fragment key={a.id}>
            <tr className={Number(a.giacenza) <= Number(a.scorta_minima) ? "sotto-scorta" : ""}>
              <td><button className="link" onClick={() => setAperto(aperto === a.id ? null : a.id)}>{a.nome}</button></td>
              <td className="numero"><b>{num(a.giacenza)}</b> {a.unita}</td>
              <td className="numero">{num(a.scorta_minima)} {a.unita}</td>
              <td><input type="checkbox" checked={a.blocca_esauriti} aria-label="Esaurisce i piatti"
                onChange={(e) => void esito(sb().from("articoli").update({ blocca_esauriti: e.target.checked }).eq("id", a.id), "Salvato")} /></td>
              <td className="riga-form">
                <button className="btn btn-piccolo btn-pieno" onClick={() => {
                  const q = prompt(`Carico di «${a.nome}» (${a.unita}):`); if (!q) return;
                  const n = leggi(q); if (!(n > 0)) { avvisa("Quantità non valida", "errore"); return; }
                  void esito(sb().rpc("carico_magazzino", { p_articolo: a.id, p_quantita: n, p_nota: "Carico" }), `Caricati ${num(n)} ${a.unita}`);
                }}>+ Carico</button>
                <button className="btn btn-piccolo" onClick={() => {
                  const q = prompt(`Inventario di «${a.nome}»: quantità contata (${a.unita})`, String(a.giacenza)); if (q === null) return;
                  const n = leggi(q); if (Number.isNaN(n) || n < 0) { avvisa("Quantità non valida", "errore"); return; }
                  void esito(sb().rpc("rettifica_magazzino", { p_articolo: a.id, p_contata: n, p_nota: "Inventario" }), "Inventario registrato");
                }}>Inventario</button>
              </td>
            </tr>
            {aperto === a.id && (
              <tr key={`${a.id}-dettaglio`}><td colSpan={5}>
                <DettaglioArticolo articolo={a} componenti={componenti.filter((c) => c.articolo_id === a.id)} prodotti={prodotti}
                  voci={voci} compVoci={compVoci.filter((c) => c.articolo_id === a.id)}
                  movimenti={movimenti.filter((m) => m.articolo_id === a.id)} localeId={locale.id} onFatto={carica} />
              </td></tr>
            )}
          </Fragment>))}
        </tbody>
      </table>

      <form className="riga-form" onSubmit={crea}>
        <input placeholder="Nuovo articolo (es. Aglianico, Mozzarella)" maxLength={80} value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} required />
        <select value={nuovo.unita} onChange={(e) => setNuovo({ ...nuovo, unita: e.target.value })} aria-label="Unità">{UNITA.map((u) => <option key={u}>{u}</option>)}</select>
        <input inputMode="decimal" style={{ width: 120 }} placeholder="Scorta minima" value={nuovo.scorta_minima} onChange={(e) => setNuovo({ ...nuovo, scorta_minima: e.target.value })} aria-label="Scorta minima" />
        <label className="interruttore"><input type="checkbox" checked={nuovo.blocca_esauriti} onChange={(e) => setNuovo({ ...nuovo, blocca_esauriti: e.target.checked })} />Esaurisce i piatti</label>
        <button className="btn btn-pieno">Aggiungi</button>
      </form>
    </div>
  );
}

function DettaglioArticolo(props: { articolo: Articolo; componenti: Componente[]; prodotti: Prodotto[]; movimenti: Movimento[]; localeId: string; onFatto: () => Promise<void>;
  voci: Voce[]; compVoci: ComponenteVoce[] }) {
  const avvisa = useAvviso();
  const [prodotto, setProdotto] = useState("");
  const [quantita, setQuantita] = useState("");
  const [voce, setVoce] = useState("");
  const [quantitaVoce, setQuantitaVoce] = useState("");
  const nome = (id: string) => props.prodotti.find((p) => p.id === id)?.nome ?? "?";
  const nomeVoce = (v?: Voce) => (v ? `${v.gruppi_opzioni?.prodotti?.nome ?? "?"} › ${v.gruppi_opzioni?.nome ?? ""}: ${v.nome}` : "?");
  const esito = async (r: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await r;
    if (error) avvisa(messaggioErrore(error), "errore"); else avvisa(ok);
    await props.onFatto();
  };
  return (
    <div className="dettaglio-articolo">
      <strong>Piatti che lo usano (quantità consumata a ogni vendita)</strong>
      {props.componenti.length === 0 && <p className="muto piccolo">Nessun piatto collegato: le vendite non lo scaricano.</p>}
      {props.componenti.map((c) => (
        <div key={c.prodotto_id} className="riga-form">
          <span>{nome(c.prodotto_id)}: <b>{num(c.quantita)} {props.articolo.unita}</b></span>
          <button className="btn btn-pericolo btn-piccolo" onClick={() => void esito(sb().from("componenti").delete().eq("prodotto_id", c.prodotto_id).eq("articolo_id", c.articolo_id), "Collegamento rimosso")}>Togli</button>
        </div>
      ))}
      <form className="riga-form" onSubmit={(e) => {
        e.preventDefault();
        const q = leggi(quantita); if (!prodotto || !(q > 0)) { avvisa("Scegli il piatto e una quantità maggiore di zero", "errore"); return; }
        void esito(sb().from("componenti").upsert({ prodotto_id: prodotto, articolo_id: props.articolo.id, locale_id: props.localeId, quantita: q }), "Piatto collegato")
          .then(() => { setProdotto(""); setQuantita(""); });
      }}>
        <select value={prodotto} onChange={(e) => setProdotto(e.target.value)} aria-label="Piatto"><option value="">Scegli un piatto…</option>
          {props.prodotti.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
        <input inputMode="decimal" style={{ width: 120 }} placeholder={`Quantità (${props.articolo.unita})`} value={quantita} onChange={(e) => setQuantita(e.target.value)} />
        <button className="btn btn-pieno btn-piccolo">Collega</button>
      </form>
      {props.voci.length > 0 && (<>
        <strong>Voci dei piatti componibili che lo usano</strong>
        {props.compVoci.map((c) => (
          <div key={c.opzione_id} className="riga-form">
            <span>{nomeVoce(props.voci.find((v) => v.id === c.opzione_id))}: <b>{num(c.quantita)} {props.articolo.unita}</b></span>
            <button className="btn btn-pericolo btn-piccolo" onClick={() => void esito(sb().from("componenti_opzioni").delete().eq("opzione_id", c.opzione_id).eq("articolo_id", c.articolo_id), "Collegamento rimosso")}>Togli</button>
          </div>
        ))}
        <form className="riga-form" onSubmit={(e) => {
          e.preventDefault();
          const q = leggi(quantitaVoce); if (!voce || !(q > 0)) { avvisa("Scegli la voce e una quantità maggiore di zero", "errore"); return; }
          void esito(sb().from("componenti_opzioni").upsert({ opzione_id: voce, articolo_id: props.articolo.id, locale_id: props.localeId, quantita: q }), "Voce collegata")
            .then(() => { setVoce(""); setQuantitaVoce(""); });
        }}>
          <select value={voce} onChange={(e) => setVoce(e.target.value)} aria-label="Voce"><option value="">Scegli una voce…</option>
            {props.voci.map((v) => <option key={v.id} value={v.id}>{nomeVoce(v)}</option>)}</select>
          <input inputMode="decimal" style={{ width: 120 }} placeholder={`Quantità (${props.articolo.unita})`} value={quantitaVoce} onChange={(e) => setQuantitaVoce(e.target.value)} />
          <button className="btn btn-pieno btn-piccolo">Collega</button>
        </form>
      </>)}
      <strong>Ultimi movimenti</strong>
      <ul className="movimenti">
        {props.movimenti.slice(0, 15).map((m) => (
          <li key={m.id}>{new Date(m.creato_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })} · {m.tipo} ·
            <b className={Number(m.quantita) < 0 ? "negativo" : "positivo"}> {Number(m.quantita) > 0 ? "+" : ""}{num(m.quantita)} {props.articolo.unita}</b>{m.nota && ` · ${m.nota}`}</li>
        ))}
      </ul>
    </div>
  );
}
