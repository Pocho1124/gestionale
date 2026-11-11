import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Azioni di sala: sulle postazioni condivise passano dal codice personale (il database lo controlla comunque, vedi puo()). */
export const RPC_CON_CODICE = new Set([
  "apri_tavolo", "accetta_richiesta", "rifiuta_richiesta", "decidi_ordine", "ordine_sala", "annulla_ordine", "chiudi_tavolo",
  "registra_pagamento", "annulla_pagamento", "esito_pos", "imposta_sconto", "imposta_coperto", "imposta_coperti", "sposta_tavolo",
  "unisci_tavoli", "arriva_prenotazione", "gestisci_conto", "ristampa_comanda", "sblocca_codice_tavolo", "prendi_tavolo",
]);
interface Custode { richiedi: () => Promise<boolean>; rifiutato: () => Promise<boolean>; dopo: () => void }
let custode: Custode | null = null;
/** Tastierino del codice personale (lib/codice.tsx): chiede il codice prima dell'azione e, se il database rifiuta, una volta ancora. */
export const impostaCustode = (c: Custode | null) => { custode = c; };
const annullata = { data: null, error: { message: "Operazione annullata: serve il codice personale", details: "", hint: "", code: "annullata" }, count: null, status: 0, statusText: "" };

/**
 * La configurazione arriva dal server (/config.json, generato all'installazione):
 * lo stesso pacchetto funziona su qualsiasi server senza ricompilare.
 * In sviluppo locale si usano le variabili VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 */
export async function inizializzaSupabase(): Promise<void> {
  let url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  let chiave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!chiave) {
    const r = await fetch("/config.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Configurazione del server non trovata (/config.json).");
    const c = (await r.json()) as { anonKey?: string; supabaseUrl?: string };
    if (!c.anonKey) throw new Error("Configurazione del server incompleta.");
    chiave = c.anonKey;
    url = c.supabaseUrl || undefined;
  }
  const c = createClient(url || window.location.origin, chiave);
  const rpc = c.rpc.bind(c);
  c.rpc = ((fn: string, args?: Record<string, unknown>, opzioni?: Record<string, unknown>) => {
    const guardia = custode;
    if (!guardia || !RPC_CON_CODICE.has(fn)) return rpc(fn, args, opzioni);
    return (async () => {
      if (!(await guardia.richiedi())) return annullata;
      try {
        const r = await rpc(fn, args, opzioni);
        if (r.error?.code !== "42501" || r.error.message !== "Permesso negato") return r;
        return (await guardia.rifiutato()) ? await rpc(fn, args, opzioni) : r;
      } finally {
        guardia.dopo();   // codice a ogni azione: la postazione si blocca subito dopo
      }
    })();
  }) as typeof c.rpc;
  client = c;
}

export function sb(): SupabaseClient {
  if (!client) throw new Error("Supabase non inizializzato");
  return client;
}
