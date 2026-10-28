import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

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
  client = createClient(url || window.location.origin, chiave);
}

export function sb(): SupabaseClient {
  if (!client) throw new Error("Supabase non inizializzato");
  return client;
}
