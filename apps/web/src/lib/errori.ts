/** Traduce gli errori di Postgres/Supabase in messaggi comprensibili per il gestore. */
export function messaggioErrore(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string };
  switch (err.code) {
    case "23505": return "Questo valore è già in uso (ad esempio l'indirizzo del locale).";
    case "23514": return "Valore non valido: controlla prezzi, colori o lunghezza dei testi.";
    case "23503": return "Elemento collegato non valido.";
    case "42501": return "Non hai i permessi per questa operazione.";
    case "22023": return err.message ?? "Valore non valido.";
  }
  if (err.message?.includes("Invalid login credentials")) return "Email o password errate.";
  if (err.message?.includes("already registered")) return "Esiste già un account con questa email.";
  if (err.message?.includes("Failed to fetch")) return "Server non raggiungibile: controlla la rete.";
  return err.message || "Operazione non riuscita.";
}
