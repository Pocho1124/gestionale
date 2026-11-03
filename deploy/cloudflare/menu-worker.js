// Menu pubblico su Cloudflare: legge le pagine e le immagini pubblicate dal server del locale (archivio KV «MENU»)
// e le serve sul dominio del locale. Solo lettura: niente moduli, niente segreti, nessun accesso ad altro.
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

    const { value, metadata } = await env.MENU.getWithMetadata(chiave, { type: "arrayBuffer", cacheTtl: 60 });
    if (value === null) return nonTrovato();
    const pagina = /\.(html|json)$/.test(chiave);
    const intestazioni = new Headers({
      ...SICUREZZA,
      "content-type": metadata?.tipo || "application/octet-stream",
      // Pagine e versione: sempre ricontrollate; immagini con versione nel nome: in cache a lungo
      "cache-control": pagina ? "no-cache" : url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
    });
    return new Response(richiesta.method === "HEAD" ? null : value, { headers: intestazioni });
  },
};

const nonTrovato = () => new Response("Pagina non trovata", { status: 404, headers: { ...SICUREZZA, "content-type": "text/plain; charset=utf-8" } });
