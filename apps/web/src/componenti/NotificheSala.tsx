import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { centesimi, formatta } from "@gest/core";
import { sb } from "../lib/supabase";
import { stampaConto } from "../lib/conto";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { suona } from "./ServizioSala";

interface RichiestaConto { id: string; sessione_id: string; tavolo_id: string; nota: string; creato_at: string; tavoli: { nome: string } | null }
const suoniAttivi = () => { try { return localStorage.getItem("gestionale.suoni") === "1"; } catch { return false; } };

/**
 * Notifiche su tutte le pagine del backoffice:
 * - popup quando un tavolo chiede il conto (Stampa conto / Gestita / Chiudi tavolo);
 * - avviso quando un tavolo ordina o chiede di aprire.
 */
export function NotificheSala({ localeId, localeNome }: { localeId: string; localeNome: string }) {
  const avvisa = useAvviso();
  const vai = useNavigate();
  const [conti, setConti] = useState<RichiestaConto[]>([]);
  const [nascosti, setNascosti] = useState<Set<string>>(new Set());
  const avvio = useRef(new Date().toISOString());

  const caricaConti = useCallback(async () => {
    const { data } = await sb().from("richieste_conto").select("id, sessione_id, tavolo_id, nota, creato_at, tavoli(nome)")
      .eq("locale_id", localeId).eq("stato", "in_attesa").order("creato_at");
    setConti((data as unknown as RichiestaConto[]) ?? []);
  }, [localeId]);

  useEffect(() => {
    void caricaConti();
    const canale = sb().channel(`notifiche-${localeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "richieste_conto", filter: `locale_id=eq.${localeId}` }, (p) => {
        if (p.eventType === "INSERT" && suoniAttivi()) suona();
        void caricaConti();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ordini", filter: `locale_id=eq.${localeId}` }, async (p) => {
        const o = p.new as { id: string; tavolo_id: string; origine: string; creato_at: string };
        if (o.origine !== "cliente" || o.creato_at < avvio.current) return;
        // Le righe vengono scritte subito dopo l'ordine: piccola attesa prima di leggerle
        await new Promise((r) => setTimeout(r, 800));
        const [t, r] = await Promise.all([
          sb().from("tavoli").select("nome").eq("id", o.tavolo_id).single(),
          sb().from("righe_ordine").select("nome, quantita, prezzo_cent").eq("ordine_id", o.id),
        ]);
        const righe = (r.data ?? []) as { nome: string; quantita: number; prezzo_cent: number }[];
        avvisa(`🍽️ Tavolo ${(t.data as { nome: string } | null)?.nome ?? "?"} ha ordinato: ${righe.map((x) => `${x.quantita}× ${x.nome}`).join(", ")} · ${formatta(centesimi(righe.reduce((n, x) => n + x.quantita * x.prezzo_cent, 0)))}`);
        if (suoniAttivi()) suona();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "richieste_tavolo", filter: `locale_id=eq.${localeId}` }, async (p) => {
        const t = await sb().from("tavoli").select("nome").eq("id", (p.new as { tavolo_id: string }).tavolo_id).single();
        avvisa(`🔔 Tavolo ${(t.data as { nome: string } | null)?.nome ?? "?"} vuole ordinare: apri la Sala per confermare`);
        if (suoniAttivi()) suona();
      })
      .subscribe();
    const t = setInterval(() => void caricaConti(), 30_000);
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [localeId, caricaConti, avvisa]);

  const conto = conti.find((c) => !nascosti.has(c.id));
  if (!conto) return null;

  const gestita = async () => {
    const { error } = await sb().rpc("gestisci_conto", { p_richiesta: conto.id });
    if (error) avvisa(messaggioErrore(error), "errore");
    await caricaConti();
  };
  return (
    <div className="popup-sfondo" role="dialog" aria-modal="true" aria-label={`Tavolo ${conto.tavoli?.nome} chiede il conto`}>
      <div className="popup">
        <p className="popup-icona">🧾</p>
        <h2>Tavolo {conto.tavoli?.nome ?? "?"} chiede il conto</h2>
        <p className="muto">Alle {new Date(conto.creato_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</p>
        {conto.nota && <p className="ordine-nota">📝 {conto.nota}</p>}
        <div className="popup-azioni">
          <button className="btn btn-pieno" onClick={async () => {
            const errore = await stampaConto(conto.sessione_id, localeNome);
            if (errore) { avvisa(errore, "errore"); return; }
            await gestita();
          }}>🖨️ Stampa conto</button>
          <button className="btn" onClick={() => void gestita()}>Segna come gestita</button>
          <button className="btn btn-pericolo" onClick={async () => {
            if (!confirm(`Chiudere il tavolo ${conto.tavoli?.nome}?`)) return;
            const { error } = await sb().rpc("chiudi_tavolo", { p_tavolo: conto.tavolo_id });
            if (error) avvisa(messaggioErrore(error), "errore"); else avvisa(`Tavolo ${conto.tavoli?.nome} chiuso`);
            await caricaConti();
          }}>Chiudi tavolo</button>
        </div>
        <button className="popup-dopo" onClick={() => { setNascosti((n) => new Set(n).add(conto.id)); vai("/sala"); }}>Più tardi</button>
      </div>
    </div>
  );
}
