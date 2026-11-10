import { useCallback, useEffect, useState } from "react";
import { centesimi, daEuro, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { euroTesto } from "../lib/formato";

interface Voce { id: string; nome: string; sovrapprezzo_cent: number; disponibile: boolean; posizione: number }
interface Gruppo { id: string; nome: string; min_scelte: number; max_scelte: number; posizione: number; da_aggiunte: string | null; opzioni: Voce[] }
interface AggiuntaBreve { nome: string; gruppo: string | null; disponibile: boolean }
const chiave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Composizione di un piatto (es. tagliere personalizzato): gruppi come «Salumi» e «Formaggi», ognuno con quante voci si
 * possono scegliere. Le voci si scrivono qui oppure si leggono sempre dalle aggiunte di un gruppo (collegamento, nessuna copia).
 */
export function EditorComposizione({ prodotto }: { prodotto: { id: string; locale_id: string; prezzo_cent: number } }) {
  const avvisa = useAvviso();
  const [gruppi, setGruppi] = useState<Gruppo[]>([]);
  const [nuovoGruppo, setNuovoGruppo] = useState("");
  /** Aggiunte del locale con un gruppo (ricaricate a ogni modifica e al ritorno sulla pagina: i gruppi si assegnano qui accanto). */
  const [aggiunte, setAggiunte] = useState<AggiuntaBreve[]>([]);
  const collegate = (nomeGruppo: string | null) => aggiunte.filter((a) => a.disponibile && chiave(a.gruppo) === chiave(nomeGruppo)).map((a) => a.nome);
  const gruppiAggiunte = [...new Set(["Salumi", "Formaggi", ...aggiunte.map((a) => (a.gruppo ?? "").trim()).filter(Boolean)])];

  const carica = useCallback(async () => {
    const [g, a] = await Promise.all([
      sb().from("gruppi_opzioni").select("id, nome, min_scelte, max_scelte, posizione, da_aggiunte, opzioni(id, nome, sovrapprezzo_cent, disponibile, posizione)")
        .eq("prodotto_id", prodotto.id).order("posizione"),
      sb().from("aggiunte").select("nome, gruppo, disponibile").eq("locale_id", prodotto.locale_id).neq("gruppo", "").order("posizione").order("nome"),
    ]);
    if (g.error) { avvisa(messaggioErrore(g.error), "errore"); return; }
    setGruppi((g.data as Gruppo[]).map((x) => ({ ...x, opzioni: [...x.opzioni].sort((p, q) => p.posizione - q.posizione || p.nome.localeCompare(q.nome)) })));
    setAggiunte((a.data as AggiuntaBreve[] | null) ?? []);
  }, [prodotto.id, prodotto.locale_id, avvisa]);
  useEffect(() => {
    void carica();
    const torna = () => { if (document.visibilityState === "visible") void carica(); };
    window.addEventListener("focus", torna); document.addEventListener("visibilitychange", torna);
    return () => { window.removeEventListener("focus", torna); document.removeEventListener("visibilitychange", torna); };
  }, [carica]);

  const esito = async (r: PromiseLike<{ error: unknown }>, ok?: string) => {
    const { error } = await r;
    if (error) avvisa(messaggioErrore(error), "errore"); else if (ok) avvisa(ok);
    await carica();
  };

  return (
    <fieldset className="chip-gruppo vino-gruppo">
      <legend>Componibile (es. tagliere personalizzato)</legend>
      <p className="muto piccolo">Il cliente sceglie le voci di ogni gruppo. Prezzo fisso: quello del piatto ({formatta(centesimi(prodotto.prezzo_cent))});
        cambia solo con le aggiunte del locale o con un supplemento messo su una voce (es. tartufo +3 €). Le voci di un gruppo si
        possono <strong>collegare a un gruppo di aggiunte</strong> (es. «Salumi»): compaiono sempre tutte quelle disponibili, comprese nel
        prezzo, e restano ordinabili anche a pagamento. Oppure si scrivono qui, anche tutte insieme separate da virgola.</p>
      {gruppi.length === 0 && (
        <button type="button" className="btn btn-piccolo" onClick={() => void esito(sb().from("gruppi_opzioni").insert([
          // Gruppi «Salumi» e «Formaggi» (3 scelte ciascuno), collegati alle aggiunte con lo stesso gruppo
          { locale_id: prodotto.locale_id, prodotto_id: prodotto.id, nome: "Salumi", min_scelte: 3, max_scelte: 3, posizione: 0, da_aggiunte: "Salumi" },
          { locale_id: prodotto.locale_id, prodotto_id: prodotto.id, nome: "Formaggi", min_scelte: 3, max_scelte: 3, posizione: 1, da_aggiunte: "Formaggi" },
        ]), "Tagliere pronto: salumi e formaggi presi dalle aggiunte")}>🧀 Tagliere: scegli 3 salumi e 3 formaggi</button>
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
            <label>Voci <select value={g.da_aggiunte ?? ""} aria-label={`Da dove vengono le voci di ${g.nome}`}
              onChange={(e) => void esito(sb().from("gruppi_opzioni").update({ da_aggiunte: e.target.value || null }).eq("id", g.id),
                e.target.value ? `«${g.nome}»: collegato alle aggiunte «${e.target.value}»` : `«${g.nome}»: voci scritte qui`)}>
              <option value="">scritte qui sotto</option>
              {[...new Set([...gruppiAggiunte, ...(g.da_aggiunte ? [g.da_aggiunte] : [])])].map((n) => <option key={n} value={n}>dalle aggiunte «{n}»</option>)}
            </select></label>
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
          {g.da_aggiunte && (
            <p className="muto piccolo">{collegate(g.da_aggiunte).length
              ? `Dalle aggiunte «${g.da_aggiunte}» (comprese nel prezzo): ${collegate(g.da_aggiunte).join(", ")}`
              : `⚠️ Nessuna aggiunta disponibile nel gruppo «${g.da_aggiunte}»: assegnala in «＋ Aggiunte» qui sopra (e attivala su questa categoria).`}</p>
          )}
          {!g.da_aggiunte && g.opzioni.length === 0 && g.min_scelte > 0 && <p className="muto piccolo">⚠️ Nessuna voce: senza voci il piatto non si può ordinare.</p>}
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
