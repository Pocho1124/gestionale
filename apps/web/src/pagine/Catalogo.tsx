import { useCallback, useEffect, useState, type FormEvent } from "react";
import { centesimi, daEuro, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { ALLERGENI, ETICHETTE, type Categoria, type Prodotto } from "../lib/tipi";
import { comprimiFoto } from "../lib/immagini";

const euroTesto = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export function Catalogo() {
  const { locale, puoModificare } = useSessione();
  const avvisa = useAvviso();
  const [categorie, setCategorie] = useState<Categoria[]>([]);
  const [prodotti, setProdotti] = useState<Prodotto[]>([]);
  const [caricato, setCaricato] = useState(false);
  const [nuovaCat, setNuovaCat] = useState("");
  const [pct, setPct] = useState("");
  const [ambito, setAmbito] = useState("tutte");

  const carica = useCallback(async () => {
    if (!locale) return;
    const [c, p] = await Promise.all([
      sb().from("categorie").select("*").eq("locale_id", locale.id).order("posizione").order("nome"),
      sb().from("prodotti").select("*").eq("locale_id", locale.id).order("posizione").order("nome"),
    ]);
    if (c.error || p.error) { avvisa(messaggioErrore(c.error ?? p.error), "errore"); return; }
    setCategorie(c.data as Categoria[]);
    setProdotti(p.data as Prodotto[]);
    setCaricato(true);
  }, [locale, avvisa]);

  useEffect(() => { void carica(); }, [carica]);

  // Aggiornamento ottimistico: la UI cambia subito, in caso di errore si ricarica lo stato reale
  async function aggiornaProdotto(id: string, patch: Partial<Prodotto>) {
    setProdotti((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const { error } = await sb().from("prodotti").update(patch).eq("id", id);
    if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); } else avvisa("Salvato");
  }

  async function aggiornaCategoria(id: string, patch: Partial<Categoria>) {
    setCategorie((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await sb().from("categorie").update(patch).eq("id", id);
    if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); } else avvisa("Salvato");
  }

  async function impostaDisponibile(p: Prodotto, valore: boolean) {
    setProdotti((ps) => ps.map((x) => (x.id === p.id ? { ...x, disponibile: valore } : x)));
    const { error } = await sb().rpc("imposta_disponibilita", { p_prodotto: p.id, p_disponibile: valore });
    if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); }
    else avvisa(valore ? `${p.nome}: di nuovo disponibile` : `${p.nome}: esaurito`);
  }

  async function aggiungiCategoria(e: FormEvent) {
    e.preventDefault();
    if (!locale || !nuovaCat.trim()) return;
    const posizione = categorie.reduce((m, c) => Math.max(m, c.posizione), -1) + 1;
    const { error } = await sb().from("categorie").insert({ locale_id: locale.id, nome: nuovaCat.trim(), posizione });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setNuovaCat(""); avvisa("Categoria aggiunta"); await carica();
  }

  async function aggiungiProdotto(cat: Categoria) {
    if (!locale) return;
    const posizione = prodotti.filter((p) => p.categoria_id === cat.id).reduce((m, p) => Math.max(m, p.posizione), -1) + 1;
    const { error } = await sb().from("prodotti")
      .insert({ locale_id: locale.id, categoria_id: cat.id, nome: "Nuovo piatto", posizione });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa("Piatto aggiunto: modifica nome e prezzo"); await carica();
  }

  async function elimina(tabella: "categorie" | "prodotti", id: string, nome: string, extra = "") {
    if (!confirm(`Eliminare «${nome}»?${extra}`)) return;
    const { error } = await sb().from(tabella).delete().eq("id", id);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa("Eliminato"); await carica();
  }

  // Riordino: scambia due elementi e rinumera le posizioni 0..n-1
  async function sposta<T extends { id: string; posizione: number }>(tabella: "categorie" | "prodotti", lista: T[], i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const nuova = [...lista];
    [nuova[i], nuova[j]] = [nuova[j]!, nuova[i]!];
    const modifiche = nuova.map((x, k) => ({ id: x.id, posizione: k, prima: x.posizione })).filter((m) => m.prima !== m.posizione);
    const esiti = await Promise.all(modifiche.map((m) => sb().from(tabella).update({ posizione: m.posizione }).eq("id", m.id)));
    const err = esiti.find((r) => r.error)?.error;
    if (err) avvisa(messaggioErrore(err), "errore");
    await carica();
  }

  async function variaPrezzi(e: FormEvent) {
    e.preventDefault();
    if (!locale) return;
    const v = Number(pct.replace(",", ".").replace("+", ""));
    if (!Number.isFinite(v) || v === 0 || v <= -100 || v > 500) { avvisa("Inserisci una percentuale tra -99 e 500", "errore"); return; }
    const coinvolti = prodotti.filter((p) => ambito === "tutte" || p.categoria_id === ambito);
    const esempio = coinvolti[0];
    const dettaglio = esempio
      ? `\nEsempio: ${esempio.nome} da ${formatta(centesimi(esempio.prezzo_cent))} a ${formatta(centesimi(Math.max(0, Math.round(esempio.prezzo_cent * (1 + v / 100) / 10) * 10)))}`
      : "";
    if (!confirm(`Applicare ${v > 0 ? "+" : ""}${v}% a ${coinvolti.length} piatti? I prezzi vengono arrotondati a 0,10 €.${dettaglio}`)) return;
    const { data, error } = await sb().rpc("varia_prezzi", {
      p_locale: locale.id, p_percento: v, p_categoria: ambito === "tutte" ? null : ambito, p_arrotonda_cent: 10,
    });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setPct(""); avvisa(`${data as number} prezzi aggiornati`); await carica();
  }

  if (!caricato) return <p className="muto">Caricamento del catalogo…</p>;

  return (
    <div className="pagina">
      <div className="pagina-testa">
        <h1>Catalogo</h1>
        {!puoModificare && <p className="muto">Puoi segnare i piatti come esauriti. Prezzi e piatti li modifica il titolare.</p>}
      </div>

      {puoModificare && (
        <div className="strumenti">
          <form className="riga-form" onSubmit={aggiungiCategoria}>
            <input placeholder="Nuova categoria (es. Pizze)" value={nuovaCat} maxLength={80} onChange={(e) => setNuovaCat(e.target.value)} />
            <button className="btn btn-pieno" disabled={!nuovaCat.trim()}>Aggiungi categoria</button>
          </form>
          {prodotti.length > 0 && (
            <form className="riga-form" onSubmit={variaPrezzi}>
              <span>Variazione prezzi</span>
              <input className="input-pct" inputMode="decimal" placeholder="+5" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percentuale" />
              <span>%</span>
              <select value={ambito} onChange={(e) => setAmbito(e.target.value)} aria-label="Su quali piatti">
                <option value="tutte">Tutto il menu</option>
                {categorie.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <button className="btn">Applica</button>
            </form>
          )}
        </div>
      )}

      {categorie.length === 0 && (
        <div className="vuoto">
          <p>Il catalogo è vuoto.</p>
          {puoModificare && <p className="muto">Inizia aggiungendo una categoria, per esempio «Antipasti» o «Pizze».</p>}
        </div>
      )}

      {categorie.map((cat, ci) => {
        const piatti = prodotti.filter((p) => p.categoria_id === cat.id);
        return (
          <section key={cat.id} className={`blocco${cat.visibile ? "" : " nascosto"}`}>
            <div className="blocco-testa">
              {puoModificare ? (
                <input className="input-titolo" defaultValue={cat.nome} key={cat.nome} maxLength={80} aria-label="Nome categoria"
                       onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cat.nome) void aggiornaCategoria(cat.id, { nome: v }); else e.target.value = cat.nome; }} />
              ) : <h2>{cat.nome}</h2>}
              {puoModificare && (
                <div className="azioni">
                  <label className="interruttore"><input type="checkbox" checked={cat.visibile}
                    onChange={(e) => void aggiornaCategoria(cat.id, { visibile: e.target.checked })} />Visibile</label>
                  <button className="btn btn-icona" disabled={ci === 0} onClick={() => void sposta("categorie", categorie, ci, -1)} aria-label="Sposta su">↑</button>
                  <button className="btn btn-icona" disabled={ci === categorie.length - 1} onClick={() => void sposta("categorie", categorie, ci, 1)} aria-label="Sposta giù">↓</button>
                  <button className="btn btn-pericolo" onClick={() => void elimina("categorie", cat.id, cat.nome, `\nVerranno eliminati anche i suoi ${piatti.length} piatti.`)}>Elimina</button>
                </div>
              )}
            </div>

            {piatti.map((p, pi) => (
              <RigaProdotto key={p.id} p={p} modificabile={puoModificare}
                primo={pi === 0} ultimo={pi === piatti.length - 1}
                onAggiorna={(patch) => void aggiornaProdotto(p.id, patch)}
                onDisponibile={(v) => void impostaDisponibile(p, v)}
                onSposta={(dir) => void sposta("prodotti", piatti, pi, dir)}
                onElimina={() => void elimina("prodotti", p.id, p.nome)} />
            ))}

            {puoModificare && <button className="btn btn-testo" onClick={() => void aggiungiProdotto(cat)}>+ Aggiungi piatto</button>}
          </section>
        );
      })}
    </div>
  );
}

function RigaProdotto(props: {
  p: Prodotto; modificabile: boolean; primo: boolean; ultimo: boolean;
  onAggiorna: (patch: Partial<Prodotto>) => void; onDisponibile: (v: boolean) => void;
  onSposta: (dir: -1 | 1) => void; onElimina: () => void;
}) {
  const { p, modificabile, onAggiorna } = props;
  const [aperto, setAperto] = useState(false);
  const [prezzo, setPrezzo] = useState(euroTesto(p.prezzo_cent));
  const [foto, setFoto] = useState<string | null | undefined>(undefined);   // undefined = non ancora caricata
  const avvisa = useAvviso();

  useEffect(() => {
    if (!aperto || foto !== undefined) return;
    void sb().from("foto_prodotti").select("dati").eq("prodotto_id", p.id).maybeSingle()
      .then(({ data }) => setFoto((data?.dati as string | undefined) ?? null));
  }, [aperto, foto, p.id]);

  async function caricaFoto(file: File | undefined) {
    if (!file) return;
    try {
      const dati = await comprimiFoto(file, 880_000, [[1280, 0.8], [1024, 0.72], [800, 0.65]]);
      const { error } = await sb().from("foto_prodotti").upsert({ prodotto_id: p.id, locale_id: p.locale_id, dati });
      if (error) throw error;
      setFoto(dati); avvisa("Foto salvata");
    } catch (e) { avvisa(e instanceof Error ? e.message : messaggioErrore(e), "errore"); }
  }

  async function rimuoviFoto() {
    if (!confirm(`Rimuovere la foto di «${p.nome}»?`)) return;
    const { error } = await sb().from("foto_prodotti").delete().eq("prodotto_id", p.id);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setFoto(null); avvisa("Foto rimossa");
  }
  useEffect(() => { setPrezzo(euroTesto(p.prezzo_cent)); }, [p.prezzo_cent]);

  function salvaPrezzo() {
    try {
      const c = daEuro(prezzo);
      if (c < 0) throw new RangeError("negativo");
      if (c !== p.prezzo_cent) onAggiorna({ prezzo_cent: c });
    } catch { setPrezzo(euroTesto(p.prezzo_cent)); }
  }
  const scatta = (delta: number) => onAggiorna({ prezzo_cent: Math.max(0, p.prezzo_cent + delta) });
  const alterna = (campo: "allergeni" | "etichette", valore: string) => {
    const attuali = p[campo];
    onAggiorna({ [campo]: attuali.includes(valore) ? attuali.filter((x) => x !== valore) : [...attuali, valore] });
  };

  return (
    <div className={`piatto${p.disponibile ? "" : " esaurito"}${p.visibile ? "" : " nascosto"}`}>
      <div className="piatto-riga">
        {modificabile ? (
          <input className="input-nome" defaultValue={p.nome} key={p.nome} maxLength={120} aria-label="Nome piatto"
                 onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.nome) onAggiorna({ nome: v }); else e.target.value = p.nome; }} />
        ) : <span className="nome">{p.nome}</span>}

        {modificabile ? (
          <div className="prezzo">
            <button className="btn btn-icona" onClick={() => scatta(-50)} aria-label="Meno 50 centesimi">−</button>
            <input inputMode="decimal" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} onBlur={salvaPrezzo}
                   onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label="Prezzo in euro" />
            <span>€</span>
            <button className="btn btn-icona" onClick={() => scatta(50)} aria-label="Più 50 centesimi">+</button>
          </div>
        ) : <span className="prezzo-testo">{formatta(centesimi(p.prezzo_cent))}</span>}

        <label className={`interruttore${p.disponibile ? "" : " spento"}`}>
          <input type="checkbox" checked={p.disponibile} onChange={(e) => props.onDisponibile(e.target.checked)} />
          {p.disponibile ? "Disponibile" : "Esaurito"}
        </label>

        {modificabile && (
          <div className="azioni">
            <button className="btn btn-icona" disabled={props.primo} onClick={() => props.onSposta(-1)} aria-label="Sposta su">↑</button>
            <button className="btn btn-icona" disabled={props.ultimo} onClick={() => props.onSposta(1)} aria-label="Sposta giù">↓</button>
            <button className="btn btn-piccolo" onClick={() => setAperto((a) => !a)} aria-expanded={aperto}>{aperto ? "Chiudi" : "Dettagli"}</button>
          </div>
        )}
      </div>

      {modificabile && aperto && (
        <div className="piatto-dettagli">
          <div className="foto-piatto">
            {foto ? <img src={foto} alt={`Foto di ${p.nome}`} /> : <div className="foto-vuota">{foto === undefined ? "…" : "Nessuna foto"}</div>}
            <div className="riga-form">
              <label className="btn btn-piccolo">{foto ? "Sostituisci foto" : "Aggiungi foto"}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void caricaFoto(e.target.files?.[0])} />
              </label>
              {foto && <button className="btn btn-pericolo" onClick={() => void rimuoviFoto()}>Rimuovi foto</button>}
              <span className="muto piccolo">I clienti la vedono toccando il piatto. Puoi inviarla anche dal bot Telegram.</span>
            </div>
          </div>
          <label className="campo">Descrizione
            <textarea defaultValue={p.descrizione} maxLength={500} rows={2}
                      onBlur={(e) => { if (e.target.value !== p.descrizione) onAggiorna({ descrizione: e.target.value }); }} />
          </label>
          <fieldset className="chip-gruppo"><legend>Allergeni</legend>
            {ALLERGENI.map((a) => (
              <label key={a} className={`chip${p.allergeni.includes(a) ? " attivo" : ""}`}>
                <input type="checkbox" checked={p.allergeni.includes(a)} onChange={() => alterna("allergeni", a)} />{a}
              </label>
            ))}
          </fieldset>
          <fieldset className="chip-gruppo"><legend>Etichette</legend>
            {ETICHETTE.map((t) => (
              <label key={t} className={`chip${p.etichette.includes(t) ? " attivo" : ""}`}>
                <input type="checkbox" checked={p.etichette.includes(t)} onChange={() => alterna("etichette", t)} />{t}
              </label>
            ))}
          </fieldset>
          <div className="riga-form">
            <label className="interruttore"><input type="checkbox" checked={p.visibile}
              onChange={(e) => onAggiorna({ visibile: e.target.checked })} />Visibile nel menu</label>
            <label>IVA&nbsp;
              <select value={String(p.aliquota_iva)} onChange={(e) => onAggiorna({ aliquota_iva: Number(e.target.value) })}>
                {[4, 5, 10, 22].map((a) => <option key={a} value={a}>{a}%</option>)}
              </select>
            </label>
            <button className="btn btn-pericolo" onClick={props.onElimina}>Elimina piatto</button>
          </div>
        </div>
      )}
    </div>
  );
}
