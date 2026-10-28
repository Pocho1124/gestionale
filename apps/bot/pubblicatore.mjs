// Pubblica su GitHub Pages una copia statica del menu dei clienti (solo dati pubblici).
// Il server non riceve nessuna connessione da internet: è lui a inviare la pagina quando il menu cambia.
// Nessuna dipendenza esterna: Node 22. Configurazione da variabili d'ambiente.

import { createHash } from "node:crypto";

const C = {
  url: obbligatoria("SUPABASE_URL").replace(/\/$/, ""),
  anon: obbligatoria("SUPABASE_ANON_KEY"),
  token: obbligatoria("GITHUB_TOKEN"),
  repo: obbligatoria("GITHUB_REPO"),                 // es. Pocho1124/menu
  slugs: obbligatoria("SLUGS").split(",").map((s) => s.trim()).filter(Boolean),
  intervallo: Number(process.env.INTERVALLO_SECONDI || 60) * 1000,
};

function obbligatoria(nome) {
  const v = process.env[nome];
  if (!v) { console.error(`Variabile mancante: ${nome}`); process.exit(1); }
  return v;
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);
const COLORE = /^#[0-9A-Fa-f]{6}$/;
const SERIF = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather"]);
const FONT_AMMESSI = new Set(["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather", "Oswald", "Montserrat", "Poppins", "Figtree", "Inter", "Nunito"]);
// Pesi richiesti a Google Fonts: il corsivo solo dove esiste (una famiglia senza corsivo farebbe fallire la richiesta)
const PESI = { "Cormorant Garamond": "ital,wght@0,400;0,600;1,400", "Lora": "ital,wght@0,400;0,700;1,400", "Playfair Display": "ital,wght@0,400;0,700;1,400" };

const PREDEFINITO = {
  colore_primario: "#1F4FA8", colore_accento: "#F2C230", colore_sfondo: "#F2F5F8", colore_testo: "#13233A",
  font_titoli: "Young Serif", font_testo: "Figtree", logo_url: null, logo_dati: null, mostra_nome: true, layout: "lista",
  mostra_allergeni: true, mostra_descrizioni: true, testo_piede: "",
  sfondo_dati: null, sfondo_opacita: 22, sfondo_sfocatura: 3, sfondo_bn: false,
};

// ---------------------------------------------------------------- Pagina statica
/** logoFile / sfondoFile: file pubblicati accanto alla pagina (es. «logo.png?v=…»), se presenti. */
export function pagina(menu, aggiornato, logoFile = null, sfondoFile = null, fotoPiatti = {}) {
  const a = { ...PREDEFINITO, ...(menu.aspetto ?? {}) };
  const colore = (v, d) => (COLORE.test(v) ? v : d);
  const font = (v, d) => (FONT_AMMESSI.has(v) ? v : d);
  const ft = font(a.font_titoli, "Young Serif");
  const fc = font(a.font_testo, "Figtree");
  const pila = (f) => `"${f}", ${SERIF.has(f) ? 'Georgia, serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`;
  const famiglie = [...new Set([ft, fc])].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:${PESI[f] ?? "wght@400;700"}`).join("&");
  const layout = ["lista", "griglia", "compatto", "elegante"].includes(a.layout) ? a.layout : "lista";
  const logo = logoFile ?? (typeof a.logo_url === "string" && /^https:\/\//.test(a.logo_url) ? a.logo_url : null);
  const mostraNome = !logo || a.mostra_nome !== false;
  const entro = (v, min, max, d) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  const foto = sfondoFile
    ? `<div class="foto" aria-hidden="true" style="background-image:url('${esc(sfondoFile)}');opacity:${entro(a.sfondo_opacita, 0, 100, 22) / 100};filter:blur(${entro(a.sfondo_sfocatura, 0, 20, 3)}px)${a.sfondo_bn ? " grayscale(1)" : ""}"></div>`
    : "";

  const categorie = menu.categorie.map((c) => `
    <section class="cat" id="c-${esc(c.id)}">
      <h2>${esc(c.nome)}</h2>
      ${a.mostra_descrizioni && c.descrizione ? `<p class="cat-desc">${esc(c.descrizione)}</p>` : ""}
      <div class="piatti">${c.prodotti.map((p) => `
        <article class="piatto${p.disponibile ? "" : " esaurito"}${fotoPiatti[p.id] || p.descrizione ? " apribile" : ""}"${fotoPiatti[p.id] || p.descrizione ? ` tabindex="0" role="button" data-nome="${esc(p.nome)}" data-prezzo="${esc(euro(p.prezzo_cent))}" data-desc="${esc(p.descrizione)}" data-allergeni="${esc((p.allergeni ?? []).join(", "))}"${fotoPiatti[p.id] ? ` data-foto="${esc(fotoPiatti[p.id])}"` : ""}` : ""}>
          ${layout === "griglia" && /^https:\/\//.test(p.immagine_url ?? "") ? `<img class="foto" src="${esc(p.immagine_url)}" alt="" loading="lazy">` : ""}
          <div class="riga"><h3>${esc(p.nome)}${fotoPiatti[p.id] ? '<span class="icona-foto" aria-hidden="true"> ◉</span>' : ""}</h3>${p.disponibile ? "" : '<span class="badge">Esaurito</span>'}${layout === "elegante" ? "" : '<span class="punti" aria-hidden="true"></span>'}<span class="prezzo">${esc(euro(p.prezzo_cent))}</span></div>
          ${a.mostra_descrizioni && p.descrizione ? `<p class="desc">${esc(p.descrizione)}</p>` : ""}
          ${p.etichette?.length ? `<ul class="etichette">${p.etichette.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
          ${a.mostra_allergeni && p.allergeni?.length ? `<p class="allergeni">Allergeni: ${esc(p.allergeni.join(", "))}</p>` : ""}
        </article>`).join("")}
      </div>
    </section>`).join("");

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Menu · ${esc(menu.locale.nome)}</title>
<meta name="description" content="Menu di ${esc(menu.locale.nome)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${famiglie}&display=swap" rel="stylesheet">
<style>
:root{--p:${colore(a.colore_primario, PREDEFINITO.colore_primario)};--a:${colore(a.colore_accento, PREDEFINITO.colore_accento)};--s:${colore(a.colore_sfondo, PREDEFINITO.colore_sfondo)};--t:${colore(a.colore_testo, PREDEFINITO.colore_testo)};--ft:${pila(ft)};--fc:${pila(fc)}}
*{box-sizing:border-box}
html{scroll-padding-top:56px}
body{margin:0;background:var(--s);color:var(--t);font:16px/1.5 var(--fc);-webkit-font-smoothing:antialiased}
.menu{max-width:720px;margin:0 auto;padding:0 18px calc(30px + env(safe-area-inset-bottom,0px));position:relative;isolation:isolate}
.foto{position:fixed;inset:-20px;z-index:-1;background-size:cover;background-position:center;pointer-events:none}
header{text-align:center;padding:calc(28px + env(safe-area-inset-top,0px)) 0 16px;border-bottom:6px double var(--p)}
header h1{font-family:var(--ft);font-weight:400;font-size:clamp(1.9rem,7vw,2.8rem);line-height:1.1;margin:0}
header p{margin:6px 0 0;opacity:.75}
.logo{max-height:72px;max-width:70%;margin-bottom:10px}
nav{position:sticky;top:0;display:flex;gap:6px;overflow-x:auto;padding:10px 0;background:var(--s);z-index:2;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
nav a{flex:none;border:1px solid color-mix(in srgb,var(--t) 25%,transparent);border-radius:999px;padding:5px 12px;color:inherit;text-decoration:none;font-weight:600;font-size:.9rem}
.cat{padding-top:18px}
.cat h2{font-family:var(--ft);font-weight:400;color:var(--p);font-size:1.5rem;margin:0}
.cat-desc{margin:2px 0 6px;opacity:.75}
.piatto{padding:10px 0;border-bottom:1px dashed color-mix(in srgb,var(--t) 22%,transparent)}
.riga{display:flex;align-items:baseline;gap:8px}
.riga h3{margin:0;font-size:1.02rem}
.punti{flex:1;border-bottom:2px dotted color-mix(in srgb,var(--t) 25%,transparent);transform:translateY(-4px);min-width:12px}
.prezzo{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.desc{margin:3px 0 0;opacity:.78;font-size:.93rem}
.etichette{list-style:none;display:flex;flex-wrap:wrap;gap:4px;padding:0;margin:5px 0 0}
.etichette li{font-size:.72rem;font-weight:700;background:var(--a);color:#13233A;border-radius:6px;padding:1px 7px}
.allergeni{margin:4px 0 0;font-size:.78rem;opacity:.7}
.esaurito h3,.esaurito .prezzo{text-decoration:line-through;opacity:.55}
.badge{font-size:.7rem;font-weight:700;background:#B3261E;color:#fff;border-radius:6px;padding:1px 6px}
.vuoto{text-align:center;opacity:.7;padding:40px 0}
footer{margin-top:26px;font-size:.82rem;opacity:.7;text-align:center}
.griglia .piatti{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.griglia .piatto{border:1px solid color-mix(in srgb,var(--t) 15%,transparent);border-radius:12px;padding:10px}
.griglia .riga{flex-wrap:wrap}.griglia .punti{display:none}.griglia .prezzo{width:100%;color:var(--p)}
.foto{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;margin-bottom:6px}
.compatto .piatto{padding:5px 0}.compatto .desc{display:none}.compatto .cat h2{font-size:1.2rem}
.elegante{padding:0 22px calc(40px + env(safe-area-inset-bottom,0px))}
.elegante header{border-bottom:0;padding-bottom:6px}
.elegante header::after{content:"◆";display:block;color:var(--p);font-size:.7rem;margin-top:20px}
.elegante .logo{max-height:150px;max-width:80%;margin-bottom:6px}
.elegante header h1{letter-spacing:.04em}
.elegante nav{justify-content:safe center;gap:20px;border-bottom:1px solid color-mix(in srgb,var(--p) 35%,transparent)}
.elegante nav a{border:0;border-radius:0;padding:6px 0;text-transform:uppercase;letter-spacing:.16em;font-size:.7rem;opacity:.85}
.elegante .cat{padding-top:36px}
.elegante .cat h2{display:flex;align-items:center;gap:14px;font-family:var(--fc);font-size:.9rem;font-weight:600;text-transform:uppercase;letter-spacing:.24em}
.elegante .cat h2::before,.elegante .cat h2::after{content:"";flex:1;height:1px;background:color-mix(in srgb,var(--p) 45%,transparent)}
.elegante .cat-desc{text-align:center;font-style:italic}
.elegante .piatto{border-bottom:0;padding:12px 0}
.elegante .riga{justify-content:space-between}
.elegante .riga h3{font-family:var(--ft);font-size:1.3rem;font-weight:400;letter-spacing:.01em}
.elegante .prezzo{color:var(--p);font-weight:600;margin-left:auto}
.elegante .desc{font-style:italic}
.elegante .etichette li{background:transparent;color:var(--p);border:1px solid currentColor;font-weight:600}
.elegante .badge{background:var(--a)}
.elegante footer{border-top:1px solid color-mix(in srgb,var(--p) 35%,transparent);padding-top:18px;letter-spacing:.05em}
.apribile{cursor:pointer}
.apribile:focus-visible{outline:2px solid var(--p);outline-offset:4px;border-radius:6px}
.icona-foto{font-size:.7em;color:var(--p);vertical-align:middle}
.scheda-sfondo{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.6);display:grid;place-items:end center;padding:16px}
.scheda-sfondo[hidden]{display:none}
@media (min-width:640px){.scheda-sfondo{place-items:center}}
.scheda{position:relative;width:min(520px,100%);max-height:90vh;overflow:auto;background:var(--s);color:var(--t);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.scheda-foto{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:18px 18px 0 0}
.scheda-corpo{padding:16px 20px 22px;display:grid;gap:8px}
.scheda-corpo h3{font-family:var(--ft);font-weight:400;font-size:1.5rem;margin:0}
.scheda-corpo .riga{justify-content:space-between}
.scheda-corpo .prezzo{color:var(--p);font-size:1.15rem}
.scheda-corpo p{margin:0}
.scheda-chiudi{position:absolute;top:10px;right:10px;z-index:1;width:36px;height:36px;border-radius:999px;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:1.4rem;line-height:1;cursor:pointer}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
</style>
</head>
<body>
<div class="menu ${layout}">
  ${foto}
  <header>
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="${mostraNome ? "" : esc(menu.locale.nome)}">` : ""}
    ${mostraNome ? `<h1>${esc(menu.locale.nome)}</h1>` : ""}
    ${menu.locale.indirizzo ? `<p>${esc(menu.locale.indirizzo)}</p>` : ""}
  </header>
  ${menu.categorie.length ? `<nav aria-label="Categorie">${menu.categorie.map((c) => `<a href="#c-${esc(c.id)}">${esc(c.nome)}</a>`).join("")}</nav>` : ""}
  ${categorie || '<p class="vuoto">Il menu sarà disponibile a breve.</p>'}
  <div class="scheda-sfondo" hidden><div class="scheda" role="dialog" aria-modal="true">
    <button class="scheda-chiudi" aria-label="Chiudi">×</button><img class="scheda-foto" alt="" hidden>
    <div class="scheda-corpo"><div class="riga"><h3></h3><span class="prezzo"></span></div><p class="desc"></p><p class="allergeni"></p></div>
  </div></div>
  <footer>
    ${a.testo_piede ? `<p>${esc(a.testo_piede)}</p>` : ""}
    <p>Per informazioni sugli allergeni rivolgersi al personale.</p>
    <p>Aggiornato il ${esc(aggiornato)}</p>
  </footer>
</div>
<script>
(() => {
  const sfondo = document.querySelector(".scheda-sfondo"), foto = sfondo.querySelector(".scheda-foto");
  const imposta = (sel, v) => { const el = sfondo.querySelector(sel); el.textContent = v || ""; el.hidden = !v; };
  const apri = (art) => {
    imposta("h3", art.dataset.nome); imposta(".scheda .prezzo", art.dataset.prezzo); imposta(".scheda .desc", art.dataset.desc);
    imposta(".scheda .allergeni", art.dataset.allergeni ? "Allergeni: " + art.dataset.allergeni : "");
    if (art.dataset.foto) { foto.src = art.dataset.foto; foto.alt = art.dataset.nome; foto.hidden = false; } else { foto.hidden = true; foto.removeAttribute("src"); }
    sfondo.hidden = false; sfondo.querySelector(".scheda-chiudi").focus();
  };
  const chiudi = () => { sfondo.hidden = true; };
  document.querySelectorAll(".apribile").forEach((art) => {
    art.addEventListener("click", () => apri(art));
    art.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apri(art); } });
  });
  sfondo.addEventListener("click", (e) => { if (e.target === sfondo) chiudi(); });
  sfondo.querySelector(".scheda-chiudi").addEventListener("click", chiudi);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudi(); });
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- Dati e pubblicazione
async function menuPubblico(slug) {
  const r = await fetch(`${C.url}/rest/v1/rpc/menu_pubblico`, {
    method: "POST",
    headers: { apikey: C.anon, Authorization: `Bearer ${C.anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!r.ok) throw new Error(`Menu ${slug}: errore ${r.status}`);
  return r.json();
}

async function github(percorso, opzioni = {}) {
  const r = await fetch(`https://api.github.com/repos/${C.repo}/contents/${percorso}`, {
    ...opzioni,
    headers: {
      Authorization: `Bearer ${C.token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gestionale-pubblicatore",
      ...(opzioni.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 404) return null;
  const j = await r.json();
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${j.message}`);
  return j;
}

async function pubblicaBinario(percorso, base64, messaggio) {
  const esistente = await github(percorso);
  await github(percorso, {
    method: "PUT",
    body: JSON.stringify({ message: messaggio, content: base64, ...(esistente ? { sha: esistente.sha } : {}) }),
  });
}

const pubblica = (percorso, testo, messaggio) => pubblicaBinario(percorso, Buffer.from(testo).toString("base64"), messaggio);

const ultimo = new Map();      // slug -> impronta dell'ultimo menu pubblicato
const ultimeImmagini = new Map();  // "slug/nome" -> impronta dell'ultima immagine pubblicata

/** Pubblica un'immagine incorporata come file accanto alla pagina (solo se cambiata). */
async function immagine(slug, nome, dati) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dati ?? "");
  if (!m) return null;
  const est = m[1] === "jpeg" ? "jpg" : m[1];
  const impronta = createHash("sha256").update(m[2]).digest("hex").slice(0, 10);
  const chiave = `${slug}/${nome}`;
  if (ultimeImmagini.get(chiave) !== impronta) {
    await pubblicaBinario(`${slug}/${nome}.${est}`, m[2], `${nome} ${slug} aggiornato`);
    ultimeImmagini.set(chiave, impronta);
  }
  return `${nome}.${est}?v=${impronta}`;   // il parametro forza il browser a ricaricare l'immagine nuova
}

/** Pubblica le foto dei piatti cambiate e rimuove dal sito quelle non più usate. Restituisce id -> percorso relativo. */
async function fotoDeiPiatti(slug, menu) {
  const percorsi = {};
  for (const c of menu.categorie) {
    for (const p of c.prodotti) {
      if (!p.foto) continue;
      const chiave = `${slug}/foto/${p.id}`;
      if (ultimeImmagini.get(chiave) !== String(p.foto)) {
        const r = await fetch(`${C.url}/rest/v1/rpc/foto_prodotto`, {
          method: "POST",
          headers: { apikey: C.anon, Authorization: `Bearer ${C.anon}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_prodotto: p.id }),
        });
        const dati = r.ok ? await r.json() : null;
        const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dati ?? "");
        if (!m) continue;
        await pubblicaBinario(`${chiave}.jpg`, m[2], `Foto ${p.nome} aggiornata`);
        ultimeImmagini.set(chiave, String(p.foto));
      }
      percorsi[p.id] = `foto/${p.id}.jpg?v=${p.foto}`;
    }
  }
  // Le foto di piatti rimossi o nascosti non devono restare raggiungibili sul sito pubblico
  const presenti = await github(`${slug}/foto`).catch(() => null);
  if (Array.isArray(presenti)) {
    for (const f of presenti) {
      const id = f.name.replace(/\.jpg$/, "");
      if (percorsi[id]) continue;
      await github(f.path, { method: "DELETE", body: JSON.stringify({ message: `Foto rimossa`, sha: f.sha }) });
      ultimeImmagini.delete(`${slug}/foto/${id}`);
    }
  }
  return percorsi;
}

async function giro() {
  for (const slug of C.slugs) {
    try {
      const menu = await menuPubblico(slug);
      if (!menu) { log(`Menu «${slug}» non trovato o non attivo: salto`); continue; }
      const impronta = createHash("sha256").update(JSON.stringify(menu)).digest("hex");
      if (ultimo.get(slug) === impronta) continue;
      const ora = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date());
      const logoFile = await immagine(slug, "logo", menu.aspetto?.logo_dati);
      const sfondoFile = await immagine(slug, "sfondo", menu.aspetto?.sfondo_dati);
      const fotoPiatti = await fotoDeiPiatti(slug, menu);
      const { aspetto, ...resto } = menu;
      const leggero = { ...resto, aspetto: aspetto ? { ...aspetto, logo_dati: null, sfondo_dati: null } : aspetto };
      await pubblica(`${slug}/index.html`, pagina(leggero, ora, logoFile, sfondoFile, fotoPiatti), `Menu ${slug} aggiornato`);
      ultimo.set(slug, impronta);
      log(`Pubblicato il menu «${slug}»`);
    } catch (e) {
      // Offline o GitHub irraggiungibile: online resta l'ultima versione, si riprova al giro successivo
      log(`Pubblicazione di «${slug}» non riuscita:`, e.message);
    }
  }
}

async function avvia() {
  log(`Pubblicatore avviato: ${C.slugs.join(", ")} → ${C.repo}, controllo ogni ${C.intervallo / 1000} s`);
  for (;;) {
    await giro();
    await new Promise((r) => setTimeout(r, C.intervallo));
  }
}

if (process.env.PUBBLICATORE_TEST !== "1") avvia();
