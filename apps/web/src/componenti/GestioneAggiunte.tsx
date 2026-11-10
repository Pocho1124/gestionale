import { useCallback, useEffect, useState, type FormEvent } from "react";
import { centesimi, daEuro, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import type { Categoria } from "../lib/tipi";
import { euroTesto } from "../lib/formato";

interface Aggiunta { id: string; locale_id: string; nome: string; prezzo_cent: number; disponibile: boolean; posizione: number; aggiunte_categorie: { categoria_id: string }[] }

/**
 * Elenco delle aggiunte del locale (es. «Mozzarella di bufala» + 2 €) e categorie su cui valgono.
 * Al tavolo compaiono con il tasto «＋ Aggiunte»; il prezzo lo ricalcola sempre il database.
 */
export function GestioneAggiunte({ locale, categorie }: { locale: string; categorie: Categoria[] }) {
  const avvisa = useAvviso();
  const [aggiunte, setAggiunte] = useState<Aggiunta[] | null>(null);
  const [aperto, setAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [prezzo, setPrezzo] = useState("");

  const carica = useCallback(async () => {
    const { data, error } = await sb().from("aggiunte").select("id, locale_id, nome, prezzo_cent, disponibile, posizione, aggiunte_categorie(categoria_id)")
      .eq("locale_id", locale).order("posizione").order("nome");
    if (error) { setAggiunte([]); return; }   // database non ancora aggiornato
    setAggiunte(data as Aggiunta[]);
    if (!data.length) setAperto(true);
  }, [locale]);
  useEffect(() => { void carica(); }, [carica]);

  async function esegui(azione: () => PromiseLike<{ error: unknown }>, ok?: string) {
    const { error } = await azione();
    if (error) avvisa(messaggioErrore(error), "errore"); else if (ok) avvisa(ok);
    await carica();
  }
  async function aggiungi(e: FormEvent) {
    e.preventDefault();
    let cent = 0;
    try { cent = prezzo.trim() ? daEuro(prezzo) : 0; } catch { avvisa("Prezzo non valido (es. 1,50)", "errore"); return; }
    const posizione = (aggiunte ?? []).reduce((m, a) => Math.max(m, a.posizione + 1), 0);
    const { data, error } = await sb().from("aggiunte").insert({ locale_id: locale, nome: nome.trim(), prezzo_cent: cent, posizione }).select("id").single();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    // Una nuova aggiunta parte attiva sulle categorie della prima aggiunta, o su nessuna: si sceglie qui sotto
    const modello = aggiunte?.[0]?.aggiunte_categorie ?? [];
    if (modello.length) await sb().from("aggiunte_categorie").insert(modello.map((c) => ({ aggiunta_id: data.id, categoria_id: c.categoria_id, locale_id: locale })));
    setNome(""); setPrezzo("");
    avvisa(`Aggiunta «${nome.trim()}» creata`);
    await carica();
  }
  const alternaCategoria = (a: Aggiunta, cat: string) => a.aggiunte_categorie.some((c) => c.categoria_id === cat)
    ? esegui(() => sb().from("aggiunte_categorie").delete().eq("aggiunta_id", a.id).eq("categoria_id", cat))
    : esegui(() => sb().from("aggiunte_categorie").insert({ aggiunta_id: a.id, categoria_id: cat, locale_id: locale }));

  if (aggiunte === null) return null;
  return (
    <section className="blocco aggiunte-blocco">
      <div className="blocco-testa">
        <h2>＋ Aggiunte <span className="muto piccolo">{aggiunte.length ? `${aggiunte.length} voci` : "nessuna"}</span></h2>
        <button className="btn" onClick={() => setAperto((v) => !v)} aria-expanded={aperto}>{aperto ? "Chiudi" : "Gestisci aggiunte"}</button>
      </div>
      {aperto && (
        <div className="aggiunte-gestione">
          <p className="muto piccolo">Le aggiunte si scelgono al tavolo, dal tablet e dal telefono, con il tasto «＋ Aggiunte» sui piatti delle categorie indicate (se non ne scegli nessuna, su tutti i piatti).</p>
          <form className="riga-form" onSubmit={aggiungi}>
            <input placeholder="Nuova aggiunta (es. Mozzarella di bufala)" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
            <input className="input-prezzo" inputMode="decimal" placeholder="€ 0,00" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} aria-label="Prezzo" />
            <button className="btn btn-pieno" disabled={!nome.trim()}>Aggiungi</button>
          </form>
          {aggiunte.map((a) => (
            <div key={a.id} className={`aggiunta-riga${a.disponibile ? "" : " esaurita"}`}>
              <div className="riga-form">
                <input defaultValue={a.nome} key={a.nome} maxLength={60} aria-label="Nome dell'aggiunta"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.nome) void esegui(() => sb().from("aggiunte").update({ nome: v }).eq("id", a.id)); else e.target.value = a.nome; }} />
                <input className="input-prezzo" inputMode="decimal" defaultValue={euroTesto(a.prezzo_cent)} key={`p${a.prezzo_cent}`} aria-label={`Prezzo di ${a.nome}`}
                  onBlur={(e) => {
                    try {
                      const c = e.target.value.trim() ? daEuro(e.target.value) : 0;
                      if (c !== a.prezzo_cent) void esegui(() => sb().from("aggiunte").update({ prezzo_cent: c }).eq("id", a.id), `${a.nome}: ${formatta(centesimi(c))}`);
                    } catch { e.target.value = euroTesto(a.prezzo_cent); avvisa("Prezzo non valido (es. 1,50)", "errore"); }
                  }} />
                <label className={`interruttore${a.disponibile ? "" : " spento"}`}><input type="checkbox" checked={a.disponibile}
                  onChange={(e) => void esegui(() => sb().from("aggiunte").update({ disponibile: e.target.checked }).eq("id", a.id))} />{a.disponibile ? "Disponibile" : "Esaurita"}</label>
                <button className="btn btn-pericolo btn-piccolo" onClick={() => {
                  if (confirm(`Eliminare l'aggiunta «${a.nome}»? Gli ordini già fatti restano invariati.`)) void esegui(() => sb().from("aggiunte").delete().eq("id", a.id), "Aggiunta eliminata");
                }}>Elimina</button>
              </div>
              <fieldset className="chip-gruppo"><legend className="muto piccolo">Vale per</legend>
                {categorie.map((c) => {
                  const attiva = a.aggiunte_categorie.some((x) => x.categoria_id === c.id);
                  return (
                    <label key={c.id} className={`chip${attiva ? " attivo" : ""}`}>
                      <input type="checkbox" checked={attiva} onChange={() => void alternaCategoria(a, c.id)} />{c.nome}
                    </label>
                  );
                })}
                {!a.aggiunte_categorie.length && <span className="muto piccolo">nessuna categoria scelta: vale per tutte</span>}
              </fieldset>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
