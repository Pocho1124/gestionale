// Menu pubblico su Cloudflare: serve sul dominio del locale ciò che pubblica il server del locale.
// Pagine e versione (cambiano spesso) nel database D1 «DB», letto sempre aggiornato: le modifiche si vedono subito.
// Immagini nell'archivio KV «MENU», con un nome nuovo a ogni modifica (mai contenuti vecchi in cache).
// Solo lettura: nessun segreto, nessun accesso ad altro.
const SICUREZZA = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};

export default {
  async fetch(richiesta, env) {
    const url = new URL(richiesta.url);
    if (richiesta.method !== "GET" && richiesta.method !== "HEAD") return new Response("Metodo non consentito", { status: 405, headers: SICUREZZA });
    let chiave = url.pathname.replace(/^\/+/, "");
    try { chiave = decodeURIComponent(chiave); } catch { return nonTrovato(); }
    // Indirizzo principale: si va al menu del locale predefinito
    if (chiave === "") return Response.redirect(new URL(`/${env.PREDEFINITO}/`, url).toString(), 302);
    // Solo percorsi semplici: lettere, numeri, trattini, punti e barre (niente «..»)
    if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(chiave) || chiave.includes("..")) return nonTrovato();
    if (chiave.endsWith("/")) chiave += "index.html";
    else if (!/\.[a-z0-9]+$/i.test(chiave)) return Response.redirect(new URL(`/${chiave}/`, url).toString(), 301);

    const pagina = /\.(html|json)$/.test(chiave);
    let corpo, tipo;
    if (pagina) {
      const riga = await env.DB.prepare("select contenuto, tipo from pagine where chiave = ?").bind(chiave).first();
      if (!riga) return nonTrovato();
      corpo = riga.contenuto; tipo = riga.tipo;
    } else {
      const { value, metadata } = await env.MENU.getWithMetadata(chiave, { type: "arrayBuffer", cacheTtl: 3600 });
      if (value === null) return nonTrovato();
      corpo = value; tipo = metadata?.tipo;
    }
    const intestazioni = new Headers({
      ...SICUREZZA,
      "content-type": tipo || "application/octet-stream",
      // Pagine e versione: sempre ricontrollate; immagini: il nome cambia a ogni modifica, quindi in cache a lungo
      "cache-control": pagina ? "no-cache" : "public, max-age=31536000, immutable",
    });
    return new Response(richiesta.method === "HEAD" ? null : corpo, { headers: intestazioni });
  },
};

const nonTrovato = () => new Response("Pagina non trovata", { status: 404, headers: { ...SICUREZZA, "content-type": "text/plain; charset=utf-8" } });
