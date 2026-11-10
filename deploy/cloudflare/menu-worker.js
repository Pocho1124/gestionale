// Menu pubblico su Cloudflare: serve sul dominio del locale ciò che pubblica il server del locale.
// Pagine e versione (cambiano spesso) nel database D1 «DB», letto sempre aggiornato: le modifiche si vedono subito.
// Immagini nell'archivio KV «MENU», con un nome nuovo a ogni modifica (mai contenuti vecchi in cache).
// Solo lettura: nessun segreto, nessun accesso ad altro.
const SICUREZZA = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  // La pagina ha script e stili incorporati (generati dal server, valori sempre «escapati») e i font di Google
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; "
    + "font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
/** Le pagine restano nella cache del nodo Cloudflare pochi secondi: una raffica di richieste non consuma il database. */
const CACHE_SECONDI = 5;

export default {
  async fetch(richiesta, env) {
    const url = new URL(richiesta.url);
    if (richiesta.method !== "GET" && richiesta.method !== "HEAD") return new Response("Metodo non consentito", { status: 405, headers: SICUREZZA });
    let chiave = url.pathname.replace(/^\/+/, "");
    try { chiave = decodeURIComponent(chiave); } catch { return nonTrovato(); }
    // Indirizzo principale: si va al menu del locale predefinito
    if (chiave === "") return rimanda(new URL(`/${env.PREDEFINITO}/`, url), 302);
    // Solo percorsi semplici: lettere, numeri, trattini, punti e barre (niente «..»)
    if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(chiave) || chiave.includes("..")) return nonTrovato();
    if (chiave.endsWith("/")) chiave += "index.html";
    else if (!/\.[a-z0-9]+$/i.test(chiave)) return rimanda(new URL(`/${chiave}/`, url), 301);

    const pagina = /\.(html|json)$/.test(chiave);
    let corpo, tipo;
    if (pagina) {
      // Cache del nodo per percorso (senza query: «versione.json?t=…» non deve aggirarla), anche per le pagine inesistenti
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const chiaveCache = new Request(new URL(`/${chiave}`, url).toString());
      const inCache = cache ? await cache.match(chiaveCache) : undefined;
      if (inCache) return richiesta.method === "HEAD" ? new Response(null, inCache) : inCache;
      const riga = await env.DB.prepare("select contenuto, tipo from pagine where chiave = ?").bind(chiave).first();
      const risposta = riga
        ? new Response(riga.contenuto, { headers: { ...SICUREZZA, "content-type": riga.tipo || "text/html; charset=utf-8", "cache-control": "no-cache" } })
        : nonTrovato();
      if (cache) await cache.put(chiaveCache, new Response(risposta.clone().body, {
        status: risposta.status, headers: { ...Object.fromEntries(risposta.headers), "cache-control": `public, max-age=${CACHE_SECONDI}` } }));
      return richiesta.method === "HEAD" ? new Response(null, risposta) : risposta;
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

const rimanda = (dove, stato) => new Response(null, { status: stato, headers: { ...SICUREZZA, location: dove.toString() } });
const nonTrovato = () => new Response("Pagina non trovata", { status: 404, headers: { ...SICUREZZA, "content-type": "text/plain; charset=utf-8" } });
