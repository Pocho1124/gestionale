import { useCallback, useEffect, useState } from "react";
import { centesimi, daEuro, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { euroTesto } from "../lib/formato";

interface Voce { id: string; nome: string; sovrapprezzo_cent: number; disponibile: boolean; posizione: number }
interface Gruppo { id: string; nome: string; min_scelte: number; max_scelte: number; posizione: number; opzioni: Voce[] }
interface AggiuntaBreve { nome: string; gruppo: string | null }
const chiave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Composizione di un piatto (es. tagliere personalizzato): gruppi come «Salumi» e «Formaggi»,
 * ognuno con quante voci si possono scegliere e le voci con il loro prezzo.
 */
export function EditorComposizione({ prodotto }: { prodotto: { id: string; locale_id: string; prezzo_cent: number } }) {
  const avvisa = useAvviso();
  const [gruppi, setGruppi] = useState<Gruppo[]>([]);
  const [nuovoGruppo, setNuovoGruppo] = useState("");
  /** Aggiunte del locale con un gruppo: le voci di un gruppo con lo stesso nome («Salumi») si prendono da lì. */
  const [aggiunte, setAggiunte] = useState<AggiuntaBreve[]>([]);
  useEffect(() => {
    void sb().from("aggiunte").select("nome, gruppo").eq("locale_id", prodotto.locale_id).neq("gruppo", "").order("posizione").order("nome")
      .then(({ data }) => setAggiunte((data as AggiuntaBreve[] | null) ?? []));
  }, [prodotto.locale_id]);
  const daAggiunte = (nomeGruppo: string, gia: string[] = []) => {
    const presenti = new Set(gia.map(chiave));
    return aggiunte.filter((a) => chiave(a.gruppo) === chiave(nomeGruppo) && !presenti.has(chiave(a.nome))).map((a) => a.nome);
  };

  const carica = useCallback(async () => {
    const { data, error } = await sb().from("gruppi_opzioni").select("id, nome, min_scelte, max_scelte, posizione, opzioni(id, nome, sovrapprezzo_cent, disponibile, posizione)")
      .eq("prodotto_id", prodotto.id).order("posizione");
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setGruppi((data as Gruppo[]).map((g) => ({ ...g, opzioni: [...g.opzioni].sort((a, b) => a.posizione - b.posizione || a.nome.localeCompare(b.nome)) })));
  }, [prodotto.id, avvisa]);
  useEffect(() => { void carica(); }, [carica]);

  const esito = async (r: PromiseLike<{ error: unknown }>, ok?: string) => {
    const { error } = await r;
    if (error) avvisa(messaggioErrore(error), "errore"); else if (ok) avvisa(ok);
    await carica();
  };

  return (
    <fieldset className="chip-gruppo vino-gruppo">
      <legend>Componibile (es. tagliere personalizzato)</legend>
      <p className="muto piccolo">Il cliente sceglie le voci di ogni gruppo. Prezzo fisso: quello del piatto ({formatta(centesimi(prodotto.prezzo_cent))});
        cambia solo con le aggiunte del locale o con un supplemento messo su una voce (es. tartufo +3 €). Le voci si possono incollare
        tutte insieme, separate da virgola, oppure prendere dalle aggiunte con lo stesso gruppo (es. aggiunte del gruppo «Salumi»).</p>
      {gruppi.length === 0 && (
        <button type="button" className="btn btn-piccolo" onClick={() => void (async () => {
          // Gruppi «Salumi» e «Formaggi» (3 scelte ciascuno), con le voci già prese dalle aggiunte con lo stesso gruppo
          const { data, error } = await sb().from("gruppi_opzioni").insert([
            { locale_id: prodotto.locale_id, prodotto_id: prodotto.id, nome: "Salumi", min_scelte: 3, max_scelte: 3, posizione: 0 },
            { locale_id: prodotto.locale_id, prodotto_id: prodotto.id, nome: "Formaggi", min_scelte: 3, max_scelte: 3, posizione: 1 },
          ]).select("id, nome");
          if (error) { avvisa(messaggioErrore(error), "errore"); return; }
          const voci = (data as { id: string; nome: string }[]).flatMap((g) => daAggiunte(g.nome).map((nome, i) =>
            ({ locale_id: prodotto.locale_id, gruppo_id: g.id, nome, sovrapprezzo_cent: 0, posizione: i })));
          await esito(voci.length ? sb().from("opzioni").insert(voci) : Promise.resolve({ error: null }),
            voci.length ? `Tagliere pronto: ${voci.length} voci prese dalle aggiunte` : "Tagliere pronto: aggiungi salumi e formaggi");
        })()}>🧀 Tagliere: scegli 3 salumi e 3 formaggi</button>
      )}
      {gruppi.map((g) => (
        <div key={g.id} className="gruppo-composizione">
          <div className="riga-form">
            <input defaultValue={g.nome} maxLength={80} aria-label="Nome del gruppo"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.nome) void esito(sb().from("gruppi_opzioni").update({ nome: v }).eq("id", g.id), "Salvato"); }} />
            <label>da <input type="number" min={0} max={20} defaultValue={g.min_scelte} style={{ width: 60 }}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== g.min_scelte) void esito(sb().from("gruppi_opzioni").update({ min_scelte: v }).eq("id", g.id), "Salvato"); }} /></label>
            <label>a <input type="number" min={1} max={20} defaultValue={g.max_scelte} style={{ width: 60 }}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== g.max_scelte) void esito(sb().from("gruppi_opzioni").update({ max_scelte: v }).eq("id", g.id), "Salvato"); }} /></label>
            <span className="muto piccolo">voci</span>
            <button className="btn btn-pericolo btn-piccolo" onClick={() => { if (confirm(`Eliminare il gruppo «${g.nome}» e le sue voci?`)) void esito(sb().from("gruppi_opzioni").delete().eq("id", g.id), "Gruppo eliminato"); }}>Elimina gruppo</button>
          </div>
          {g.opzioni.map((o) => (
            <div key={o.id} className="riga-form voce-composizione">
              <input defaultValue={o.nome} maxLength={80} aria-label="Voce"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.nome) void esito(sb().from("opzioni").update({ nome: v }).eq("id", o.id), "Salvato"); }} />
              <label>€ <input inputMode="decimal" defaultValue={euroTesto(o.sovrapprezzo_cent)} style={{ width: 80 }}
                onBlur={(e) => { try { const v = daEuro(e.target.value || "0"); if (v !== o.sovrapprezzo_cent) void esito(sb().from("opzioni").update({ sovrapprezzo_cent: v }).eq("id", o.id), "Prezzo salvato"); } catch { e.target.value = euroTesto(o.sovrapprezzo_cent); } }} /></label>
              <label className="interruttore"><input type="checkbox" checked={o.disponibile}
                onChange={(e) => void esito(sb().from("opzioni").update({ disponibile: e.target.checked }).eq("id", o.id))} />Disponibile</label>
              <button className="btn btn-pericolo btn-piccolo" onClick={() => void esito(sb().from("opzioni").delete().eq("id", o.id), "Voce eliminata")}>Togli</button>
            </div>
          ))}
          {daAggiunte(g.nome, g.opzioni.map((o) => o.nome)).length > 0 && (
            <button type="button" className="btn btn-piccolo" onClick={() => {
              const nomi = daAggiunte(g.nome, g.opzioni.map((o) => o.nome));
              void esito(sb().from("opzioni").insert(nomi.map((nome, i) =>
                ({ locale_id: prodotto.locale_id, gruppo_id: g.id, nome, sovrapprezzo_cent: 0, posizione: g.opzioni.length + i }))), `${nomi.length} voci prese dalle aggiunte «${g.nome}»`);
            }}>↓ Prendi dalle aggiunte «{g.nome}» ({daAggiunte(g.nome, g.opzioni.map((o) => o.nome)).length}, comprese nel prezzo)</button>
          )}
          {g.opzioni.length === 0 && g.min_scelte > 0 && <p className="muto piccolo">⚠️ Nessuna voce: senza voci il piatto non si può ordinare.</p>}
          <NuovaVoce onAggiungi={(nomi, cent) => esito(sb().from("opzioni").insert(nomi.map((nome, i) =>
            ({ locale_id: prodotto.locale_id, gruppo_id: g.id, nome, sovrapprezzo_cent: cent, posizione: g.opzioni.length + i }))),
            nomi.length > 1 ? `${nomi.length} voci aggiunte` : "Voce aggiunta")} />
        </div>
      ))}
      <form className="riga-form" onSubmit={(e) => {
        e.preventDefault();
        void esito(sb().from("gruppi_opzioni").insert({ locale_id: prodotto.locale_id, prodotto_id: prodotto.id, nome: nuovoGruppo.trim(), min_scelte: 0, max_scelte: 3, posizione: gruppi.length }), "Gruppo aggiunto")
          .then(() => setNuovoGruppo(""));
      }}>
        <input placeholder="Nuovo gruppo (es. Salumi)" maxLength={80} value={nuovoGruppo} onChange={(e) => setNuovoGruppo(e.target.value)} required />
        <button className="btn btn-piccolo">+ Gruppo</button>
      </form>
    </fieldset>
  );
}

/** Una o più voci («Crudo, Speck, Salame»), con un supplemento facoltativo uguale per tutte (vuoto = compreso nel prezzo). */
function NuovaVoce({ onAggiungi }: { onAggiungi: (nomi: string[], cent: number) => Promise<void> }) {
  const [nome, setNome] = useState("");
  const [prezzo, setPrezzo] = useState("");
  return (
    <form className="riga-form voce-composizione" onSubmit={(e) => {
      e.preventDefault();
      let cent = 0;
      try { cent = prezzo.trim() ? daEuro(prezzo) : 0; } catch { return; }
      const nomi = [...new Set(nome.split(/[,;\n]/).map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
      if (nomi.length) void onAggiungi(nomi, cent).then(() => { setNome(""); setPrezzo(""); });
    }}>
      <input placeholder="Voci (es. Prosciutto crudo, Speck, Salame)" maxLength={1000} value={nome} onChange={(e) => setNome(e.target.value)} required />
      <input placeholder="Supplemento € (facoltativo)" title="Vuoto = compreso nel prezzo del piatto" inputMode="decimal" style={{ width: 170 }}
        value={prezzo} onChange={(e) => setPrezzo(e.target.value)} />
      <button className="btn btn-piccolo">+ Aggiungi</button>
    </form>
  );
}
