// Pubblica una copia statica del menu dei clienti (solo dati pubblici) sul dominio del locale tramite Cloudflare:
// le pagine vanno nell'archivio KV del locale e il Worker del menu le serve su menu.<dominio>.
// Il server non riceve nessuna connessione da internet: è lui a inviare la pagina quando il menu cambia.
// Nessuna dipendenza esterna: Node 22. Configurazione da variabili d'ambiente.

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { regioneDi } from "./regioni.mjs";
import { MAPPA_ITALIA } from "./mappa-italia.mjs";
import { coloriVino } from "./traduttore.mjs";

const C = {
  url: obbligatoria("SUPABASE_URL").replace(/\/$/, ""),
  anon: obbligatoria("SUPABASE_ANON_KEY"),
  // Archivio delle immagini (Supabase Storage), raggiunto sulla rete interna dei servizi
  archivio: (process.env.ARCHIVIO_URL || "http://immagini:5000").replace(/\/$/, ""),
  // Destinazione: archivio KV di Cloudflare letto dal Worker del menu sul dominio del locale
  cloudflare: {
    account: obbligatoria("CLOUDFLARE_ACCOUNT_ID"), kv: obbligatoria("CLOUDFLARE_KV_ID"), token: obbligatoria("CLOUDFLARE_TOKEN"),
    d1: obbligatoria("CLOUDFLARE_D1_ID"),   // pagine e versione: lette sempre aggiornate dal Worker
    indirizzo: obbligatoria("MENU_URL").replace(/\/$/, ""),     // es. https://menu.enotechiasantalucia.it
  },
  slugs: obbligatoria("SLUGS").split(",").map((s) => s.trim()).filter(Boolean),
  // Al massimo 15 s tra un controllo e l'altro; il bot chiede comunque una pubblicazione immediata dopo ogni modifica
  // Controllo frequente delle modifiche fatte dal gestionale (il bot chiede comunque la pubblicazione immediata)
  intervallo: Math.max(3, Math.min(Number(process.env.INTERVALLO_SECONDI || 5), 15)) * 1000,
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

// ---------------------------------------------------------------- Lingue
// Testi fissi della pagina in italiano, inglese, spagnolo e tedesco. Nomi, descrizioni e note tradotti stanno nelle colonne
// <campo>_en / <campo>_es / <campo>_de (traduzione automatica dell'IA locale o scritta a mano): dove mancano resta l'italiano.
const TESTI = {
  it: {
    lang: "it", esaurito: "Esaurito", da: "da ", siAbbinaCon: "🍷 Si abbina con ", o: " o ", allergeni: "Allergeni: ",
    viniPerRegione: "Vini per regione", mappa: "🗺️ Scegli dalla mappa", tutte: "Tutte", altreZone: "Altre zone",
    scegliRegione: "Scegli una regione", tocca: "Tocca una regione illuminata", regioniItalia: "Regioni d'Italia", vini: "vini",
    fonteMappa: "Confini: ISTAT (CC BY 4.0)", mappaTitolo: "Scegli la regione dalla mappa", indeciso: "Sei indeciso?", trova: "Trova il tuo vino in 3 domande",
    vuoto: "Il menu sarà disponibile a breve.", chiudi: "Chiudi", infoAllergeni: "Per informazioni sugli allergeni rivolgersi al personale.",
    aggiornato: "Aggiornato il ", categorie: "Categorie", menuDi: "Menu di ",
    tipi: { rosso: "Rosso", bianco: "Bianco", rosato: "Rosato", bollicine: "Bollicine", dolce: "Dolce" },
    allergeniNomi: {}, etichetteNomi: {},
    c: {
      torna: "← Torna a ", esaurito: "Esaurito", calice: "Calice ", bottiglia: " · Bottiglia ", scegli: "scegli ", da: "da ", a: " a ",
      finoA: "fino a ", incluso: "incluso", allergeni: "Allergeni: ", idealeCon: "Ideale con", sommelier: "Il sommelier consiglia",
      domanda: "Domanda ", di3: " di 3", qVino: "Che vino preferisci?", sorprendimi: "Sorprendimi", qCorpo: "Come lo vorresti?",
      leggero: "Leggero e fresco", equilibrato: "Equilibrato", strutturato: "Strutturato e intenso", indifferente: "Indifferente",
      qCibo: "Cosa mangerai?", soloVino: "Solo vino", comePreferisci: ", come preferisci", siAbbinaA: "Si abbina a ", e: " e ",
      nonAbbiamo: "In questo momento non abbiamo un ", disponibile: " disponibile in carta", nessunVino: "Nessun vino disponibile in carta",
      chiedi: ": chiedi al personale, saprà consigliarti.", ricomincia: "Ricomincia", vino: " vino", vini: " vini",
      tipi: { rosso: "Rosso", bianco: "Bianco", rosato: "Rosato", bollicine: "Bollicine", dolce: "Dolce" },
      corpi: { leggero: "Leggero", medio: "Equilibrato", strutturato: "Strutturato" },
    },
  },
  en: {
    lang: "en", esaurito: "Sold out", da: "from ", siAbbinaCon: "🍷 Pairs with ", o: " or ", allergeni: "Allergens: ",
    viniPerRegione: "Wines by region", mappa: "🗺️ Choose on the map", tutte: "All", altreZone: "Other areas",
    scegliRegione: "Choose a region", tocca: "Tap a highlighted region", regioniItalia: "Regions of Italy", vini: "wines",
    fonteMappa: "Borders: ISTAT (CC BY 4.0)", mappaTitolo: "Choose the region on the map", indeciso: "Can't decide?", trova: "Find your wine in 3 questions",
    vuoto: "The menu will be available soon.", chiudi: "Close", infoAllergeni: "For allergen information, please ask our staff.",
    aggiornato: "Updated on ", categorie: "Categories", menuDi: "Menu of ",
    tipi: { rosso: "Red", bianco: "White", rosato: "Rosé", bollicine: "Sparkling", dolce: "Dessert" },
    allergeniNomi: {
      Glutine: "Gluten", Crostacei: "Crustaceans", Uova: "Eggs", Pesce: "Fish", Arachidi: "Peanuts", Soia: "Soy", Latte: "Milk",
      "Frutta a guscio": "Tree nuts", Sedano: "Celery", Senape: "Mustard", Sesamo: "Sesame", Solfiti: "Sulphites", Lupini: "Lupin", Molluschi: "Molluscs",
    },
    etichetteNomi: { Vegetariano: "Vegetarian", Vegano: "Vegan", Piccante: "Spicy", "Senza glutine": "Gluten free", "Novità": "New", Consigliato: "Recommended", Surgelato: "Frozen" },
    c: {
      torna: "← Back to ", esaurito: "Sold out", calice: "Glass ", bottiglia: " · Bottle ", scegli: "choose ", da: "from ", a: " to ",
      finoA: "up to ", incluso: "included", allergeni: "Allergens: ", idealeCon: "Ideal with", sommelier: "Our sommelier suggests",
      domanda: "Question ", di3: " of 3", qVino: "Which wine do you prefer?", sorprendimi: "Surprise me", qCorpo: "How would you like it?",
      leggero: "Light and fresh", equilibrato: "Balanced", strutturato: "Full-bodied and intense", indifferente: "No preference",
      qCibo: "What will you eat?", soloVino: "Just wine", comePreferisci: ", as you like", siAbbinaA: "Pairs with ", e: " and ",
      nonAbbiamo: "Right now we have no ", disponibile: " wine available", nessunVino: "No wine available right now",
      chiedi: ": please ask our staff, they will be happy to help.", ricomincia: "Start again", vino: " wine", vini: " wines",
      tipi: { rosso: "Red", bianco: "White", rosato: "Rosé", bollicine: "Sparkling", dolce: "Dessert" },
      corpi: { leggero: "Light", medio: "Balanced", strutturato: "Full-bodied" },
    },
  },
  es: {
    lang: "es", esaurito: "Agotado", da: "desde ", siAbbinaCon: "🍷 Marida con ", o: " o ", allergeni: "Alérgenos: ",
    viniPerRegione: "Vinos por región", mappa: "🗺️ Elige en el mapa", tutte: "Todas", altreZone: "Otras zonas",
    scegliRegione: "Elige una región", tocca: "Toca una región iluminada", regioniItalia: "Regiones de Italia", vini: "vinos",
    fonteMappa: "Límites: ISTAT (CC BY 4.0)", mappaTitolo: "Elige la región en el mapa", indeciso: "¿Indeciso?", trova: "Encuentra tu vino en 3 preguntas",
    vuoto: "El menú estará disponible en breve.", chiudi: "Cerrar", infoAllergeni: "Para información sobre alérgenos, consulte a nuestro personal.",
    aggiornato: "Actualizado el ", categorie: "Categorías", menuDi: "Menú de ",
    tipi: { rosso: "Tinto", bianco: "Blanco", rosato: "Rosado", bollicine: "Espumoso", dolce: "Dulce" },
    allergeniNomi: {
      Glutine: "Gluten", Crostacei: "Crustáceos", Uova: "Huevos", Pesce: "Pescado", Arachidi: "Cacahuetes", Soia: "Soja", Latte: "Leche",
      "Frutta a guscio": "Frutos de cáscara", Sedano: "Apio", Senape: "Mostaza", Sesamo: "Sésamo", Solfiti: "Sulfitos", Lupini: "Altramuces", Molluschi: "Moluscos",
    },
    etichetteNomi: { Vegetariano: "Vegetariano", Vegano: "Vegano", Piccante: "Picante", "Senza glutine": "Sin gluten", "Novità": "Novedad", Consigliato: "Recomendado", Surgelato: "Congelado" },
    c: {
      torna: "← Volver a ", esaurito: "Agotado", calice: "Copa ", bottiglia: " · Botella ", scegli: "elige ", da: "desde ", a: " a ",
      finoA: "hasta ", incluso: "incluido", allergeni: "Alérgenos: ", idealeCon: "Ideal con", sommelier: "Nuestro sumiller recomienda",
      domanda: "Pregunta ", di3: " de 3", qVino: "¿Qué vino prefieres?", sorprendimi: "Sorpréndeme", qCorpo: "¿Cómo lo quieres?",
      leggero: "Ligero y fresco", equilibrato: "Equilibrado", strutturato: "Con cuerpo e intenso", indifferente: "Me da igual",
      qCibo: "¿Qué vas a comer?", soloVino: "Solo vino", comePreferisci: ", como prefieras", siAbbinaA: "Marida con ", e: " y ",
      nonAbbiamo: "En este momento no tenemos un ", disponibile: " disponible en carta", nessunVino: "Ningún vino disponible en carta",
      chiedi: ": pregunta a nuestro personal, te aconsejará encantado.", ricomincia: "Empezar de nuevo", vino: " vino", vini: " vinos",
      tipi: { rosso: "Tinto", bianco: "Blanco", rosato: "Rosado", bollicine: "Espumoso", dolce: "Dulce" },
      corpi: { leggero: "Ligero", medio: "Equilibrado", strutturato: "Con cuerpo" },
    },
  },
  de: {
    lang: "de", esaurito: "Ausverkauft", da: "ab ", siAbbinaCon: "🍷 Passt zu ", o: " oder ", allergeni: "Allergene: ",
    viniPerRegione: "Weine nach Region", mappa: "🗺️ Auf der Karte wählen", tutte: "Alle", altreZone: "Andere Gebiete",
    scegliRegione: "Region wählen", tocca: "Tippe auf eine hervorgehobene Region", regioniItalia: "Regionen Italiens", vini: "Weine",
    fonteMappa: "Grenzen: ISTAT (CC BY 4.0)", mappaTitolo: "Region auf der Karte wählen", indeciso: "Unentschlossen?", trova: "Finde deinen Wein in 3 Fragen",
    vuoto: "Die Speisekarte ist bald verfügbar.", chiudi: "Schließen", infoAllergeni: "Informationen zu Allergenen erhalten Sie bei unserem Personal.",
    aggiornato: "Aktualisiert am ", categorie: "Kategorien", menuDi: "Speisekarte von ",
    tipi: { rosso: "Rotwein", bianco: "Weißwein", rosato: "Roséwein", bollicine: "Schaumwein", dolce: "Dessertwein" },
    allergeniNomi: {
      Glutine: "Gluten", Crostacei: "Krebstiere", Uova: "Eier", Pesce: "Fisch", Arachidi: "Erdnüsse", Soia: "Soja", Latte: "Milch",
      "Frutta a guscio": "Schalenfrüchte", Sedano: "Sellerie", Senape: "Senf", Sesamo: "Sesam", Solfiti: "Sulfite", Lupini: "Lupinen", Molluschi: "Weichtiere",
    },
    etichetteNomi: { Vegetariano: "Vegetarisch", Vegano: "Vegan", Piccante: "Scharf", "Senza glutine": "Glutenfrei", "Novità": "Neu", Consigliato: "Empfohlen", Surgelato: "Tiefgekühlt" },
    c: {
      torna: "← Zurück zu ", esaurito: "Ausverkauft", calice: "Glas ", bottiglia: " · Flasche ", scegli: "wähle ", da: "ab ", a: " bis ",
      finoA: "bis zu ", incluso: "inklusive", allergeni: "Allergene: ", idealeCon: "Ideal zu", sommelier: "Unser Sommelier empfiehlt",
      domanda: "Frage ", di3: " von 3", qVino: "Welchen Wein bevorzugst du?", sorprendimi: "Überrasch mich", qCorpo: "Wie hättest du ihn gern?",
      leggero: "Leicht und frisch", equilibrato: "Ausgewogen", strutturato: "Kräftig und intensiv", indifferente: "Egal",
      qCibo: "Was isst du dazu?", soloVino: "Nur Wein", comePreferisci: ", wie du magst", siAbbinaA: "Passt zu ", e: " und ",
      // In tedesco i nomi restano con la maiuscola («keinen Rotwein»)
      nonAbbiamo: "Im Moment haben wir keinen ", disponibile: " auf der Karte", nessunVino: "Derzeit kein Wein auf der Karte", maiuscole: true,
      chiedi: ": frag unser Personal, wir beraten dich gern.", ricomincia: "Neu starten", vino: " Wein", vini: " Weine",
      tipi: { rosso: "Rotwein", bianco: "Weißwein", rosato: "Roséwein", bollicine: "Schaumwein", dolce: "Dessertwein" },
      corpi: { leggero: "Leicht", medio: "Ausgewogen", strutturato: "Kräftig" },
    },
  },
};

/**
 * Sfondo a carosello: una regola @keyframes per ogni foto oltre alla principale, che resta ferma sotto.
 * n = foto in tutto, intervallo = secondi per foto, sfumatura di 2 s (copia in apps/web/src/lib/carosello.ts).
 */
export function animazioniCarosello(n, intervallo, prefisso = "carosello") {
  const T = Math.min(30, Math.max(4, Math.round(intervallo) || 8)), C = n * T, F = Math.min(2, T / 2);
  const pct = (x) => `${Math.max(0, Math.min(100, (x / C) * 100)).toFixed(3)}%`;
  let css = "";
  for (let k = 1; k < n; k++) {
    const fine = (k + 1) * T >= C ? "100%{opacity:0}" : `${pct((k + 1) * T)},100%{opacity:0}`;
    css += `@keyframes ${prefisso}${k}{0%,${pct(k * T - F)}{opacity:0}${pct(k * T)},${pct((k + 1) * T - F)}{opacity:1}${fine}}`;
  }
  return { css, animazione: (k) => `${prefisso}${k} ${C}s linear infinite` };
}

/** Prezzo «da» di un piatto componibile: prezzo del piatto più le voci obbligatorie più economiche (copia in apps/web/src/lib/aggiunte.ts). */
export const prezzoMinimo = (p) => p.prezzo_cent + (p.opzioni || []).reduce((tot, g) =>
  tot + (g.scelte || []).map((s) => s.sovrapprezzo_cent).sort((a, b) => a - b).slice(0, g.min).reduce((n, c) => n + c, 0), 0);

/** Lingue del menu: codice, bandierina e nome nella propria lingua (in fondo alla pagina). */
export const LINGUE = [["it", "🇮🇹", "Italiano"], ["en", "🇬🇧", "English"], ["es", "🇪🇸", "Español"], ["de", "🇩🇪", "Deutsch"]];

/** Menu con i testi del locale nella lingua scelta (dove manca la traduzione resta l'italiano). */
export function menuInLingua(menu, lingua) {
  if (lingua === "it" || !TESTI[lingua]) return menu;
  const t = TESTI[lingua], x = (o, campo) => o[`${campo}_${lingua}`] || o[campo];
  return {
    ...menu,
    categorie: menu.categorie.map((c) => ({
      ...c, nome: x(c, "nome"), descrizione: x(c, "descrizione"),
      prodotti: c.prodotti.map((p) => ({
        // Colori dei vini sistemati anche sulle traduzioni già salvate (Tinto/Blanco, Red/White; nomi propri invariati)
        ...p, nome: x(p, "nome"), descrizione: coloriVino(lingua, x(p, "descrizione"), p.nome),
        vino: p.vino ? { ...p.vino, note: coloriVino(lingua, x(p.vino, "note"), p.nome) } : p.vino,
        allergeni: (p.allergeni || []).map((a) => t.allergeniNomi[a] ?? a),
        etichette: (p.etichette || []).map((e) => t.etichetteNomi[e] ?? e),
      })),
    })),
  };
}

// ---------------------------------------------------------------- Pagina statica
/**
 * logoFile / sfondoFile: file pubblicati accanto alla pagina (es. «logo.png?v=…»), se presenti.
 * sfondoFile può essere anche un elenco: la prima è la foto principale, le altre formano il carosello.
 * lingua «en» / «es» / «de»: pagina pubblicata in «<slug>/en/», «<slug>/es/» o «<slug>/de/» (i file del menu sono nella cartella superiore).
 */
export function pagina(menuOriginale, aggiornato, logoFileIt = null, sfondoFileIt = null, fotoPiattiIt = {}, versione = "", lingua = "it") {
  const L = TESTI[lingua] ?? TESTI.it;
  const su = lingua !== "it" && TESTI[lingua] ? "../" : "";   // percorso verso i file del menu
  const menu = menuInLingua(menuOriginale, lingua);
  const logoFile = logoFileIt && !/^https:\/\//.test(logoFileIt) ? su + logoFileIt : logoFileIt;
  const sfondi = (Array.isArray(sfondoFileIt) ? sfondoFileIt : [sfondoFileIt]).filter(Boolean).map((f) => su + f);
  const sfondoFile = sfondi[0] ?? null;
  const fotoPiatti = Object.fromEntries(Object.entries(fotoPiattiIt).map(([k, v]) => [k, su + v]));
  const TIPI = L.tipi;
  const perId = new Map(menu.categorie.flatMap((c) => c.prodotti.map((p) => [p.id, p])));
  const apribile = (p) => !!(fotoPiatti[p.id] || p.descrizione || p.vino || p.abbinamenti?.length || p.opzioni?.length);
  const numeroVini = menu.categorie.reduce((n, c) => n + c.prodotti.filter((p) => p.vino && p.disponibile).length, 0);
  // Dati per scheda e quiz: senza immagini incorporate, «<» neutralizzato per non chiudere lo <script>
  const dati = JSON.stringify({ versione, base: su, t: L.c, foto: fotoPiatti, categorie: menu.categorie }).replace(/</g, "\\u003c");
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
  const modo = a.sfondo_modo === "testata" ? "testata" : "pagina";
  const filtro = `filter:blur(${entro(a.sfondo_sfocatura, 0, 20, 3)}px)${a.sfondo_bn ? " grayscale(1)" : ""}`;
  // Carosello: le foto oltre alla principale si caricano dopo la pagina (data-sfondo) e sfumano a turno sopra la principale
  const carosello = animazioniCarosello(sfondi.length, entro(a.sfondo_intervallo, 4, 30, 8));
  const foto = sfondoFile
    ? `<div class="sfondo-menu sfondo-menu-${modo}" aria-hidden="true"><div class="sfondo-menu-strati${sfondi.length > 1 && a.sfondo_zoom !== false ? " zoom" : ""}">`
      + `<div class="sfondo-menu-img" style="background-image:url('${esc(sfondoFile)}');${filtro}"></div>`
      + sfondi.slice(1).map((f, i) => `<div class="sfondo-menu-img sfondo-carosello" data-sfondo="${esc(f)}" style="${filtro};animation:${carosello.animazione(i + 1)}"></div>`).join("")
      + `</div><div class="sfondo-menu-velo" style="opacity:${1 - entro(a.sfondo_opacita, 0, 100, 22) / 100}"></div></div>`
    : "";

  const regioneVino = (p) => (p.vino ? regioneDi(p.vino.regione) || L.altreZone : null);
  const prodotto = (p) => `
        <article class="piatto${p.disponibile ? "" : " esaurito"}${apribile(p) ? " apribile" : ""}"${apribile(p) ? ` tabindex="0" role="button" data-id="${esc(p.id)}"` : ""}${p.vino ? ` data-regione="${esc(regioneVino(p))}"` : ""}>
          ${layout === "griglia" && /^https:\/\//.test(p.immagine_url ?? "") ? `<img class="foto" src="${esc(p.immagine_url)}" alt="" loading="lazy">` : ""}
          <div class="riga"><h3>${esc(p.nome)}${fotoPiatti[p.id] ? '<span class="icona-foto" aria-hidden="true"> ◉</span>' : ""}</h3>${p.disponibile ? "" : `<span class="badge">${esc(L.esaurito)}</span>`}${layout === "elegante" ? "" : '<span class="punti" aria-hidden="true"></span>'}<span class="prezzo">${p.opzioni?.length ? esc(L.da) : ""}${esc(euro(prezzoMinimo(p)))}</span></div>
          ${p.vino ? `<p class="vino-info">${esc([TIPI[p.vino.tipo], p.vino.regione, p.vino.vitigno].filter(Boolean).join(" · "))}</p>` : ""}
          ${a.mostra_descrizioni && p.descrizione ? `<p class="desc">${esc(p.descrizione)}</p>` : ""}
          ${!p.vino && p.abbinamenti?.length ? `<p class="abbinamento">${esc(L.siAbbinaCon)}${esc(p.abbinamenti.slice(0, 2).map((x) => perId.get(x.id)?.nome).filter(Boolean).join(L.o))}</p>` : ""}
          ${p.etichette?.length ? `<ul class="etichette">${p.etichette.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
          ${a.mostra_allergeni && p.allergeni?.length ? `<p class="allergeni">${esc(L.allergeni)}${esc(p.allergeni.join(", "))}</p>` : ""}
        </article>`;
  // Nelle categorie di vini con più regioni: vini raggruppati per regione (in ordine alfabetico, «Altre zone» in fondo)
  const corpoCategoria = (c) => {
    const vini = c.prodotti.filter((p) => p.vino);
    const regioni = [...new Set(vini.map(regioneVino))];
    if (vini.length < 2 || regioni.length < 2 || vini.length !== c.prodotti.length) return c.prodotti.map(prodotto).join("");
    regioni.sort((x, y) => (x === L.altreZone) - (y === L.altreZone) || x.localeCompare(y, "it"));
    return regioni.map((r) => `<h3 class="regione-titolo" data-regione="${esc(r)}">${esc(r)}</h3>${vini.filter((p) => regioneVino(p) === r).map(prodotto).join("")}`).join("");
  };
  const tutteLeRegioni = [...new Set(menu.categorie.flatMap((c) => c.prodotti.filter((p) => p.vino).map(regioneVino)))]
    .sort((x, y) => (x === L.altreZone) - (y === L.altreZone) || x.localeCompare(y, "it"));
  // Mappa: le regioni con vini in carta si illuminano e si possono scegliere
  const viniPerRegione = new Map();
  for (const c of menu.categorie) for (const p of c.prodotti) if (p.vino) viniPerRegione.set(regioneVino(p), (viniPerRegione.get(regioneVino(p)) ?? 0) + 1);
  // La mappa compare solo insieme al filtro (almeno due regioni) e se almeno una regione è italiana
  const conMappa = tutteLeRegioni.length >= 2 && [...viniPerRegione.keys()].some((r) => MAPPA_ITALIA.regioni[r]);
  const mappa = conMappa ? `
<div class="mappa-sfondo" hidden style="display:none"><div class="mappa" role="dialog" aria-modal="true" aria-label="${esc(L.mappaTitolo)}">
  <button class="scheda-chiudi mappa-chiudi" aria-label="${esc(L.chiudi)}">×</button>
  <p class="quiz-passo">${esc(L.scegliRegione)}</p><p class="mappa-nome" aria-live="polite">${esc(L.tocca)}</p>
  <svg viewBox="0 0 ${MAPPA_ITALIA.larghezza} ${MAPPA_ITALIA.altezza}" role="group" aria-label="${esc(L.regioniItalia)}">${Object.entries(MAPPA_ITALIA.regioni).map(([r, d]) =>
    viniPerRegione.has(r)
      ? `<path d="${d}" class="con-vini" data-regione-mappa="${esc(r)}" data-quanti="${viniPerRegione.get(r)}" tabindex="0" role="button" aria-label="${esc(r)}: ${viniPerRegione.get(r)} ${esc(L.vini)}"><title>${esc(r)}</title></path>`
      : `<path d="${d}"><title>${esc(r)}</title></path>`).join("")}</svg>
  <p class="mappa-fonte">${esc(L.fonteMappa)}</p>
</div></div>` : "";
  const filtroRegioni = tutteLeRegioni.length >= 2
    ? `<div class="filtro-regioni" role="group" aria-label="${esc(L.viniPerRegione)}"><p class="filtro-titolo">${esc(L.viniPerRegione)}</p>${conMappa ? `<button type="button" class="apri-mappa">${esc(L.mappa)}</button>` : ""}<div class="filtro-scelte"><button type="button" class="attiva" data-filtro="" aria-pressed="true">${esc(L.tutte)}</button>${tutteLeRegioni.map((r) => `<button type="button" data-filtro="${esc(r)}" aria-pressed="false">${esc(r)}</button>`).join("")}</div></div>`
    : "";
  const categorie = menu.categorie.map((c) => `
    <section class="cat${c.prodotti.some((p) => p.vino) ? " cat-vini" : ""}" id="c-${esc(c.id)}">
      <h2>${esc(c.nome)}</h2>
      ${a.mostra_descrizioni && c.descrizione ? `<p class="cat-desc">${esc(c.descrizione)}</p>` : ""}
      <div class="piatti">${corpoCategoria(c)}
      </div>
    </section>`).join("");

  return `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Menu · ${esc(menu.locale.nome)}</title>
<meta name="description" content="${esc(L.menuDi)}${esc(menu.locale.nome)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${famiglie}&display=swap" rel="stylesheet">
<style>
/* Qualsiasi elemento con l'attributo hidden resta nascosto, anche se uno stile gli assegna un display */
[hidden]{display:none !important}
:root{--p:${colore(a.colore_primario, PREDEFINITO.colore_primario)};--a:${colore(a.colore_accento, PREDEFINITO.colore_accento)};--s:${colore(a.colore_sfondo, PREDEFINITO.colore_sfondo)};--t:${colore(a.colore_testo, PREDEFINITO.colore_testo)};--ft:${pila(ft)};--fc:${pila(fc)}}
*{box-sizing:border-box}
html{scroll-padding-top:56px}
body{margin:0;background:var(--s);color:var(--t);font:16px/1.5 var(--fc);-webkit-font-smoothing:antialiased}
.menu{max-width:720px;margin:0 auto;padding:0 18px calc(30px + env(safe-area-inset-bottom,0px));position:relative;isolation:isolate}
.sfondo-menu{pointer-events:none;overflow:hidden;z-index:-1}
.sfondo-menu-pagina{position:fixed;inset:0}
.sfondo-menu-testata{position:absolute;inset:0;border-radius:0 0 18px 18px}
.sfondo-menu-img{position:absolute;inset:0;background-size:cover;background-position:center;transform:scale(1.08)}
.sfondo-menu-velo{position:absolute;inset:0;background:var(--s)}
/* Carosello dello sfondo: sfumature lente, zoom appena percettibile; fermo se il telefono chiede meno movimento */
.sfondo-menu-strati{position:absolute;inset:0}.sfondo-carosello{opacity:0}
.sfondo-menu-strati.zoom{animation:sfondo-lento 24s ease-in-out infinite alternate}
@keyframes sfondo-lento{from{transform:scale(1)}to{transform:scale(1.07)}}
${carosello.css}
@media (prefers-reduced-motion:reduce){.sfondo-carosello{display:none}.sfondo-menu-strati.zoom{animation:none}}
/* Scelta della lingua in alto, sopra «Trova il tuo vino» */
.lingue{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:14px 0 0}.lingue a{color:var(--p);text-decoration:none;font-weight:700;border:1px solid color-mix(in srgb,var(--p) 60%,transparent);border-radius:999px;padding:5px 12px;font-size:.82rem;background:color-mix(in srgb,var(--s) 70%,transparent)}.lingue a[aria-current]{background:var(--p);color:var(--s);border-color:var(--p)}
.filtro-regioni{margin:16px 0 0;padding:16px 14px 14px;border-radius:18px;text-align:center;background:color-mix(in srgb,var(--s) 90%,transparent);border:1px solid color-mix(in srgb,var(--p) 30%,transparent);box-shadow:0 10px 30px rgba(0,0,0,.2);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.filtro-titolo{margin:0 0 10px;font:600 .78rem var(--fc);letter-spacing:.2em;text-transform:uppercase;color:var(--p)}
.filtro-scelte{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--p) 22%,transparent)}
.filtro-regioni button{border:1px solid color-mix(in srgb,var(--p) 55%,transparent);background:transparent;color:var(--t);border-radius:999px;padding:5px 12px;font:600 .8rem var(--fc);cursor:pointer}
.filtro-regioni button.attiva{background:var(--p);color:var(--s);border-color:var(--p)}
.menu .filtro-regioni .apri-mappa{display:block;width:min(320px,100%);margin:0 auto;padding:12px 18px;border:0;border-radius:14px;background:var(--p);color:var(--s);font:700 1rem var(--fc);letter-spacing:.03em;box-shadow:0 6px 18px color-mix(in srgb,var(--p) 35%,transparent)}
.menu .filtro-regioni .apri-mappa:hover,.menu .filtro-regioni .apri-mappa:focus-visible{filter:brightness(1.08);outline:2px solid color-mix(in srgb,var(--p) 60%,transparent);outline-offset:3px}
.scheda-indietro{background:none;border:0;padding:0;color:var(--p);font:600 .85rem var(--fc);cursor:pointer;text-align:left}
.mappa-sfondo{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.7);display:grid;place-items:center;padding:16px}
.mappa-sfondo[hidden]{display:none !important}
.mappa{position:relative;width:min(460px,100%);max-height:92vh;overflow:auto;background:var(--s);color:var(--t);border-radius:18px;padding:18px 16px 10px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.mappa svg{width:100%;height:auto;max-height:68vh;display:block;margin:6px auto}
.mappa path{fill:color-mix(in srgb,var(--t) 10%,transparent);stroke:color-mix(in srgb,var(--t) 45%,transparent);stroke-width:.8;transition:fill .15s}
.mappa path.con-vini{fill:color-mix(in srgb,var(--p) 45%,transparent);cursor:pointer}
.mappa path.con-vini:hover,.mappa path.con-vini:focus-visible,.mappa path.acceso{fill:var(--p);outline:none}
.mappa-nome{margin:2px 0 0;font-weight:600;color:var(--p);min-height:1.5em}
.mappa-fonte{margin:0;font-size:.65rem;opacity:.55}
.regione-titolo{margin:18px 0 2px;font:600 .78rem var(--fc);letter-spacing:.2em;text-transform:uppercase;color:var(--p);opacity:.9}
.con-sfondo nav{background:color-mix(in srgb,var(--s) 80%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.testata-foto header{position:relative;isolation:isolate;padding-left:12px;padding-right:12px}
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
.scheda-foto{width:100%;height:auto;max-height:min(62vh,560px);object-fit:contain;display:block;background:color-mix(in srgb,var(--t) 6%,transparent);border-radius:18px 18px 0 0}
.scheda-corpo{padding:16px 20px 22px;display:grid;gap:8px}
.scheda-corpo h3{font-family:var(--ft);font-weight:400;font-size:1.5rem;margin:0}
.scheda-corpo .riga{justify-content:space-between}
.scheda-corpo .prezzo{color:var(--p);font-size:1.15rem}
.scheda-corpo p{margin:0}
.scheda-chiudi{position:absolute;top:10px;right:10px;z-index:1;width:36px;height:36px;border-radius:999px;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:1.4rem;line-height:1;cursor:pointer}
/* Sommelier digitale: «Sei indeciso?» in un riquadro come il resto del menu, con il punto interrogativo */
.trova-vino{display:flex;align-items:center;gap:12px;width:min(380px,100%);margin:14px auto 0;padding:10px 16px 10px 10px;border-radius:16px;text-align:left;cursor:pointer;color:var(--t);font-family:var(--fc);background:color-mix(in srgb,var(--s) 90%,transparent);border:1px solid color-mix(in srgb,var(--p) 45%,transparent);box-shadow:0 8px 24px rgba(0,0,0,.2);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:border-color .2s,transform .2s}
.trova-vino:hover,.trova-vino:focus-visible{border-color:var(--p);transform:translateY(-1px);outline:none}
.trova-icona{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:999px;background:var(--p);color:var(--s);font:700 1.45rem/1 var(--ft);box-shadow:0 0 0 4px color-mix(in srgb,var(--p) 22%,transparent)}
.trova-testi{display:grid;gap:1px;min-width:0}
.trova-testi strong{font:400 1.15rem/1.2 var(--ft);color:var(--p)}
.trova-testi span{font-size:.82rem;opacity:.85}
.trova-freccia{margin-left:auto;color:var(--p);font-size:1.5rem;line-height:1}
@media (prefers-reduced-motion:no-preference){.trova-icona{animation:trova-respiro 3.2s ease-in-out infinite}@keyframes trova-respiro{0%,100%{box-shadow:0 0 0 4px color-mix(in srgb,var(--p) 22%,transparent)}50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--p) 8%,transparent)}}}
.vino-info{margin:3px 0 0;font-size:.8rem;letter-spacing:.05em;color:var(--p)}
.abbinamento{margin:4px 0 0;font-size:.82rem;font-style:italic;opacity:.85}
.scheda-vino{color:var(--p);font-weight:600;letter-spacing:.04em}
.quiz-passo{margin:0;font-size:.75rem;text-transform:uppercase;letter-spacing:.18em;color:var(--p)}
.quiz-scelte{display:grid;gap:8px}
.quiz-scelta{border:1px solid color-mix(in srgb,var(--t) 30%,transparent);background:transparent;color:var(--t);border-radius:12px;padding:12px 14px;font:500 1rem var(--fc);text-align:left;cursor:pointer}
.quiz-scelta:hover{border-color:var(--p);background:color-mix(in srgb,var(--p) 12%,transparent)}
.quiz-vino{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid color-mix(in srgb,var(--p) 40%,transparent);background:transparent;color:var(--t);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:var(--fc)}
.quiz-posizione{flex:none;width:28px;height:28px;border-radius:999px;display:grid;place-items:center;background:var(--p);color:var(--s);font-weight:700}
.quiz-dati{display:grid;gap:2px;flex:1;min-width:0}
.quiz-dati strong{font-family:var(--ft);font-weight:400;font-size:1.1rem}
.quiz-info{font-size:.8rem;color:var(--p)}
.quiz-perche{font-size:.8rem;font-style:italic;opacity:.8}
/* Leggibilità: ogni categoria in un riquadro velato (testi pieni anche sopra la foto di sfondo), titoli grandi, descrizioni dritte */
.menu .cat{margin-top:22px;padding:18px 18px 8px;border-radius:18px;background:color-mix(in srgb,var(--s) 90%,transparent);border:1px solid color-mix(in srgb,var(--p) 30%,transparent);box-shadow:0 10px 30px rgba(0,0,0,.2);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.menu .cat h2{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 6px;font-family:var(--ft);font-size:clamp(1.45rem,5vw,1.85rem);font-weight:400;text-transform:none;letter-spacing:.02em;color:var(--p);text-align:center}
.menu .cat h2::before,.menu .cat h2::after{content:"";flex:1;max-width:90px;height:1px;background:linear-gradient(90deg,transparent,var(--p))}
.menu .cat h2::after{transform:scaleX(-1)}
.menu .cat-desc{text-align:center;font-style:italic;opacity:1;color:color-mix(in srgb,var(--t) 82%,transparent);margin:0 0 8px}
.menu .piatto{padding:13px 0;border-bottom:1px solid color-mix(in srgb,var(--t) 12%,transparent)}
.menu .piatti > .piatto:last-child{border-bottom:0}
.menu .riga h3{font-size:1.14rem;line-height:1.3}
.menu .prezzo{color:var(--p);font-weight:700}
.menu .desc{opacity:1;font-style:normal;font-size:.96rem;line-height:1.55;margin-top:5px;color:color-mix(in srgb,var(--t) 88%,transparent)}
.menu .vino-info{font-size:.76rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.menu .allergeni{opacity:.85}
.menu .regione-titolo{display:flex;align-items:center;gap:10px;margin:18px 0 2px;opacity:1}
.menu .regione-titolo::after{content:"";flex:1;height:1px;background:color-mix(in srgb,var(--p) 30%,transparent)}
.menu.griglia .piatto{border:1px solid color-mix(in srgb,var(--t) 15%,transparent);border-radius:12px;padding:10px}
.con-sfondo header{text-shadow:0 1px 4px rgba(0,0,0,.55)}
/* Barra delle categorie nello stesso stile dei riquadri: arrotondata, velata, fissa in alto staccata dal bordo */
html{scroll-padding-top:76px}
.menu > nav{top:8px;margin:16px 0 0;padding:10px 16px;border-radius:14px;background:color-mix(in srgb,var(--s) 92%,transparent);border:1px solid color-mix(in srgb,var(--p) 30%,transparent);box-shadow:0 8px 24px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.menu > nav a:hover,.menu > nav a:focus-visible{color:var(--p);opacity:1}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
</style>
</head>
<body>
<div class="menu ${layout}${modo === "testata" && foto ? " testata-foto" : ""}${modo === "pagina" && foto ? " con-sfondo" : ""}">
  ${modo === "pagina" ? foto : ""}
  <header>
    ${modo === "testata" ? foto : ""}
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="${mostraNome ? "" : esc(menu.locale.nome)}">` : ""}
    ${mostraNome ? `<h1>${esc(menu.locale.nome)}</h1>` : ""}
    ${menu.locale.indirizzo ? `<p>${esc(menu.locale.indirizzo)}</p>` : ""}
  </header>
  <div class="lingue" role="navigation" aria-label="Lingua / Language">
    ${LINGUE.map(([l, bandiera, nome]) => `<a href="${l === "it" ? su || "./" : `${su}${l}/`}" hreflang="${l}" lang="${l}"${l === L.lang ? ' aria-current="page"' : ""}>${bandiera} ${nome}</a>`).join("\n    ")}
  </div>
  ${numeroVini >= 2 ? `<button class="trova-vino"><span class="trova-icona" aria-hidden="true">?</span><span class="trova-testi"><strong>${esc(L.indeciso)}</strong><span>${esc(L.trova)}</span></span><span class="trova-freccia" aria-hidden="true">›</span></button>` : ""}
  ${filtroRegioni}
  ${mappa}
  ${menu.categorie.length ? `<nav aria-label="${esc(L.categorie)}">${menu.categorie.map((c) => `<a href="#c-${esc(c.id)}">${esc(c.nome)}</a>`).join("")}</nav>` : ""}
  ${categorie || `<p class="vuoto">${esc(L.vuoto)}</p>`}
  <div class="scheda-sfondo" hidden><div class="scheda" role="dialog" aria-modal="true">
    <button class="scheda-chiudi" aria-label="${esc(L.chiudi)}">×</button><img class="scheda-foto" alt="" hidden>
    <div class="scheda-corpo"></div>
  </div></div>
  <footer>
    ${a.testo_piede ? `<p>${esc(a.testo_piede)}</p>` : ""}
    <p>${esc(L.infoAllergeni)}</p>
    <p>${esc(L.aggiornato)}${esc(aggiornato)}</p>
  </footer>
</div>
<script type="application/json" id="dati">${dati}</script>
<script>
(() => {
  // Foto del carosello: dopo il caricamento della pagina, così il menu compare subito
  addEventListener("load", () => document.querySelectorAll("[data-sfondo]").forEach((e) => { e.style.backgroundImage = "url('" + e.dataset.sfondo.replace(/['()]/g, "") + "')"; }));
  const D = JSON.parse(document.getElementById("dati").textContent);
  const per = new Map();
  D.categorie.forEach((c) => c.prodotti.forEach((p) => per.set(p.id, Object.assign({ categoria: c.id }, p))));
  const T = D.t, TIPI = T.tipi, CORPI = T.corpi;
  const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);
  const sfondo = document.querySelector(".scheda-sfondo"), corpo = sfondo.querySelector(".scheda-corpo"), foto = sfondo.querySelector(".scheda-foto");
  // Tutto il testo entra con textContent: niente HTML costruito da dati
  const el = (tag, classe, testo) => { const e = document.createElement(tag); if (classe) e.className = classe; if (testo != null) e.textContent = testo; return e; };
  const mostra = (nodi, url, alt) => {
    corpo.replaceChildren(...nodi);
    if (url) { foto.src = url; foto.alt = alt; foto.hidden = false; } else { foto.hidden = true; foto.removeAttribute("src"); }
    sfondo.hidden = false; sfondo.querySelector(".scheda").scrollTop = 0; sfondo.querySelector(".scheda-chiudi").focus();
  };
  // Percorso tra le schede (piatto → vino → altro piatto): «Torna a …» e niente rimandi a schede già aperte
  let corrente = null, storia = [];
  const riga = (p, motivo, posizione, daScheda) => {
    const b = el("button", "quiz-vino");
    if (posizione) b.append(el("span", "quiz-posizione", String(posizione)));
    const d = el("span", "quiz-dati");
    d.append(el("strong", null, p.nome));
    if (p.vino) d.append(el("span", "quiz-info", [TIPI[p.vino.tipo], p.vino.regione, p.vino.vitigno].filter(Boolean).join(" · ")));
    if (motivo) d.append(el("span", "quiz-perche", motivo));
    b.append(d, el("span", "prezzo", euro(p.prezzo_cent)));
    b.addEventListener("click", () => apri(p.id, daScheda ? "avanti" : "nuova"));
    return b;
  };
  function apri(id, modo) {
    const p = per.get(id); if (!p) return;
    if (modo === "avanti" && corrente) storia.push(corrente);
    else if (modo !== "indietro") storia = [];
    corrente = id;
    const n = [], r = el("div", "riga"), v = p.vino;
    if (storia.length) {
      const prec = per.get(storia[storia.length - 1]);
      const ind = el("button", "scheda-indietro", T.torna + prec.nome);
      ind.addEventListener("click", () => apri(storia.pop(), "indietro"));
      n.push(ind);
    }
    r.append(el("h3", null, p.nome), el("span", "prezzo", euro(p.prezzo_cent))); n.push(r);
    if (!p.disponibile) n.push(el("p", null, T.esaurito));
    if (v) {
      n.push(el("p", "scheda-vino", [TIPI[v.tipo], CORPI[v.corpo], v.regione, v.vitigno].filter(Boolean).join(" · ")));
      if (v.cantina || v.annata) n.push(el("p", "desc", [v.cantina, v.annata].filter(Boolean).join(", ")));
      if (v.prezzo_bottiglia_cent) n.push(el("p", null, T.calice + euro(p.prezzo_cent) + T.bottiglia + euro(v.prezzo_bottiglia_cent)));
    }
    if (p.descrizione) n.push(el("p", "desc", p.descrizione));
    if (v && v.note) n.push(el("p", "desc", v.note));
    // Piatto componibile: gruppi con le voci e i loro prezzi (la scelta si fa al tavolo)
    (p.opzioni || []).forEach((g) => {
      n.push(el("p", "quiz-passo", g.nome + " · " + (g.min === g.max ? T.scegli + g.max : g.min > 0 ? T.da + g.min + T.a + g.max : T.finoA + g.max)));
      g.scelte.forEach((c) => { const r2 = el("div", "riga"); r2.append(el("span", null, c.nome), el("span", "prezzo", c.sovrapprezzo_cent ? "+ " + euro(c.sovrapprezzo_cent) : T.incluso)); n.push(r2); });
    });
    if (p.allergeni && p.allergeni.length) n.push(el("p", "allergeni", T.allergeni + p.allergeni.join(", ")));
    const ab = (p.abbinamenti || []).map((a) => ({ q: per.get(a.id), m: a.motivo })).filter((x) => x.q && !storia.includes(x.q.id));
    if (ab.length) { n.push(el("p", "quiz-passo", v ? T.idealeCon : T.sommelier)); ab.forEach((x) => n.push(riga(x.q, x.m, 0, true))); }
    mostra(n, D.foto[p.id], p.nome);
  }
  function quiz() {
    const vini = [...per.values()].filter((p) => p.vino && p.disponibile), stato = {};
    const domanda = (passo, titolo, scelte, avanti) => {
      const box = el("div", "quiz-scelte");
      scelte.forEach(([etichetta, valore]) => { const b = el("button", "quiz-scelta", etichetta); b.addEventListener("click", () => avanti(valore)); box.append(b); });
      mostra([el("p", "quiz-passo", T.domanda + passo + T.di3), el("h3", null, titolo), box], null, "");
    };
    const tipi = [...new Set(vini.map((v) => v.vino.tipo))];
    domanda(1, T.qVino, [...tipi.map((t) => [TIPI[t], t]), [T.sorprendimi, "sorpresa"]], (t) => { stato.tipo = t;
      domanda(2, T.qCorpo, [[T.leggero, "leggero"], [T.equilibrato, "medio"], [T.strutturato, "strutturato"], [T.indifferente, "indifferente"]], (c) => { stato.corpo = c;
        const cibo = D.categorie.filter((c) => c.prodotti.some((p) => !p.vino));
        domanda(3, T.qCibo, [...cibo.map((c) => [c.nome, c.id]), [T.soloVino, null]], (x) => { stato.cibo = x; risultati(vini, stato); });
      });
    });
  }
  function risultati(vini, s) {
    const O = ["leggero", "medio", "strutturato"];
    // Il colore scelto è vincolante; il corpo opposto solo se non c'è altro
    const valutati = vini.filter((v) => s.tipo === "sorpresa" || v.vino.tipo === s.tipo).map((v) => {
      let pt = 0, d = 0; const pq = [];
      if (s.tipo !== "sorpresa") pq.push(TIPI[v.vino.tipo] + T.comePreferisci);
      if (s.corpo !== "indifferente") { d = Math.abs(O.indexOf(v.vino.corpo) - O.indexOf(s.corpo)); if (d === 0) { pt += 3; pq.push(CORPI[v.vino.corpo]); } else if (d === 1) pt += 1; }
      const piatti = (v.abbinamenti || []).map((a) => per.get(a.id)).filter((p) => p && (!s.cibo || p.categoria === s.cibo));
      if (piatti.length) { pt += Math.min(4, piatti.length * 2); pq.push(T.siAbbinaA + piatti.slice(0, 2).map((p) => p.nome).join(T.e)); }
      return { v, pt, pq, d };
    });
    const vicini = valutati.filter((x) => x.d < 2);
    const r = (vicini.length ? vicini : valutati).sort((a, b) => b.pt - a.pt || a.v.prezzo_cent - b.v.prezzo_cent).slice(0, 3);
    const n = [el("p", "quiz-passo", T.sommelier)];
    if (!r.length) n.push(el("p", null, (s.tipo !== "sorpresa" ? T.nonAbbiamo + (T.maiuscole ? TIPI[s.tipo] : TIPI[s.tipo].toLowerCase()) + T.disponibile : T.nessunVino) + T.chiedi));
    r.forEach((x, i) => n.push(riga(x.v, x.pq.join(" · "), i + 1)));
    const b = el("button", "quiz-scelta", T.ricomincia); b.addEventListener("click", quiz); n.push(b);
    mostra(n, null, "");
  }
  document.querySelectorAll(".apribile").forEach((art) => {
    art.addEventListener("click", () => apri(art.dataset.id));
    art.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apri(art.dataset.id); } });
  });
  const tv = document.querySelector(".trova-vino"); if (tv) tv.addEventListener("click", quiz);
  // Mappa delle regioni: passando sopra si illumina e mostra il nome, toccando applica il filtro
  const mappaS = document.querySelector(".mappa-sfondo");
  if (mappaS) {
    mappaS.style.display = "none";
    const nome = mappaS.querySelector(".mappa-nome");
    const chiudiMappa = () => { mappaS.hidden = true; mappaS.style.display = "none"; };
    document.querySelector(".apri-mappa")?.addEventListener("click", () => { mappaS.hidden = false; mappaS.style.display = "grid"; mappaS.querySelector(".mappa-chiudi").focus(); });
    mappaS.addEventListener("click", (e) => { if (e.target === mappaS) chiudiMappa(); });
    mappaS.querySelector(".mappa-chiudi")?.addEventListener("click", (e) => { e.stopPropagation(); chiudiMappa(); });
    mappaS.querySelectorAll("path.con-vini").forEach((pt) => {
      const mostra = () => { mappaS.querySelectorAll("path.acceso").forEach((x) => x.classList.remove("acceso")); pt.classList.add("acceso");
        nome.textContent = pt.dataset.regioneMappa + " · " + pt.dataset.quanti + (pt.dataset.quanti === "1" ? T.vino : T.vini); };
      const scegli = () => { chiudiMappa(); const b = [...document.querySelectorAll(".filtro-regioni button[data-filtro]")].find((x) => x.dataset.filtro === pt.dataset.regioneMappa); if (b) b.click(); };
      pt.addEventListener("mouseenter", mostra); pt.addEventListener("focus", mostra);
      pt.addEventListener("click", scegli);
      pt.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scegli(); } });
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiMappa(); });
  }
  // Filtro per regione: mostra solo i vini della regione scelta (gli altri piatti restano visibili)
  document.querySelectorAll(".filtro-regioni button[data-filtro]").forEach((b) => b.addEventListener("click", () => {
    const scelta = b.dataset.filtro;
    document.querySelectorAll(".filtro-regioni button[data-filtro]").forEach((x) => { const on = x === b; x.classList.toggle("attiva", on); x.setAttribute("aria-pressed", String(on)); });
    document.querySelectorAll("[data-regione]").forEach((el) => { el.hidden = !!scelta && el.dataset.regione !== scelta; });
    document.querySelectorAll(".cat-vini").forEach((sez) => { sez.hidden = !!scelta && !sez.querySelector("article[data-regione]:not([hidden])"); });
    const primo = document.querySelector(".cat-vini:not([hidden])");
    if (scelta && primo) primo.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  const chiudi = () => { sfondo.hidden = true; corrente = null; storia = []; };
  sfondo.addEventListener("click", (e) => { if (e.target === sfondo) chiudi(); });
  sfondo.querySelector(".scheda-chiudi").addEventListener("click", chiudi);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudi(); });
  // Aggiornamento rapido: se esiste una versione più recente del menu, ricarica scavalcando la cache (una sola volta per versione)
  const controlla = () => fetch(D.base + "versione.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j || !j.versione || j.versione === D.versione) return;
    try { if (sessionStorage.getItem("menu-ricaricato") === j.versione) return; sessionStorage.setItem("menu-ricaricato", j.versione); } catch (e) {}
    location.replace(location.pathname + "?v=" + encodeURIComponent(j.versione));
  }).catch(() => {});
  controlla();
  setInterval(() => { if (document.visibilityState === "visible" && sfondo.hidden) controlla(); }, 10000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") controlla(); });
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


const TIPI = { html: "text/html; charset=utf-8", json: "application/json; charset=utf-8", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const giaInviati = new Map();   // chiave -> impronta dell'ultimo contenuto inviato a Cloudflare

/** Scrive un file nell'archivio KV del menu (Cloudflare): il Worker lo serve sul dominio. */
/** Pagine e file di versione nel database D1: il Worker li legge sempre aggiornati (niente attese di cache). */
async function suD1(percorso, base64) {
  const impronta = createHash("sha256").update(base64).digest("hex");
  if (giaInviati.get(percorso) === impronta) return;
  const est = percorso.split(".").pop().toLowerCase();
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${C.cloudflare.account}/d1/database/${C.cloudflare.d1}/query`, {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${C.cloudflare.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sql: "insert into pagine (chiave, contenuto, tipo) values (?1, ?2, ?3) on conflict (chiave) do update set contenuto = excluded.contenuto, tipo = excluded.tipo, aggiornato = current_timestamp",
      params: [percorso, Buffer.from(base64, "base64").toString("utf8"), TIPI[est]],
    }),
  });
  if (!r.ok) throw new Error(`Cloudflare D1 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  giaInviati.set(percorso, impronta);
}

export async function suCloudflare(percorso, base64) {
  if (/\.(html|json)$/.test(percorso)) return suD1(percorso, base64);
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(percorso) || percorso.includes("..")) throw new Error(`percorso non valido: ${percorso}`);
  const impronta = createHash("sha256").update(base64).digest("hex");
  if (giaInviati.get(percorso) === impronta) return;
  const est = percorso.split(".").pop().toLowerCase();
  const modulo = new FormData();
  modulo.append("value", new Blob([Buffer.from(base64, "base64")]));
  modulo.append("metadata", JSON.stringify({ tipo: TIPI[est] ?? "application/octet-stream" }));
  const cf = C.cloudflare;
  const r = await fetch(`${API_KV()}/values/${encodeURIComponent(percorso)}`, {
    method: "PUT", body: modulo, headers: { Authorization: `Bearer ${cf.token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Cloudflare ${r.status}: ${(await r.text()).slice(0, 200)}`);
  giaInviati.set(percorso, impronta);
}

async function pubblicaBinario(percorso, base64) {
  return suCloudflare(percorso, base64);
}

const API_KV = () => `https://api.cloudflare.com/client/v4/accounts/${C.cloudflare.account}/storage/kv/namespaces/${C.cloudflare.kv}`;

/** Elenco delle chiavi con un prefisso (es. le foto di un locale). */
async function chiaviCloudflare(prefisso) {
  const r = await fetch(`${API_KV()}/keys?prefix=${encodeURIComponent(prefisso)}&limit=1000`, {
    headers: { Authorization: `Bearer ${C.cloudflare.token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Cloudflare ${r.status}`);
  return ((await r.json()).result ?? []).map((k) => k.name);
}

async function eliminaCloudflare(chiave) {
  const r = await fetch(`${API_KV()}/values/${encodeURIComponent(chiave)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${C.cloudflare.token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok && r.status !== 404) throw new Error(`Cloudflare ${r.status}`);
  giaInviati.delete(chiave);
}

const pubblica = (percorso, testo) => pubblicaBinario(percorso, Buffer.from(testo).toString("base64"));

const ultimo = new Map();      // slug -> impronta dell'ultimo menu pubblicato
const ultimeImmagini = new Set();   // immagini già pubblicate (chiavi con versione nel nome)

/** Pubblica un'immagine incorporata come file accanto alla pagina (solo se cambiata). */
const PERCORSO_ARCHIVIO = /^[0-9a-f-]{36}\/(logo|sfondo|sale|piatti)\/([0-9a-f-]{36})\.(jpg|png|webp)$/;

/** Scarica un'immagine dall'archivio come base64 (solo percorsi nel formato previsto). */
export async function daArchivio(percorso) {
  if (!PERCORSO_ARCHIVIO.test(percorso)) throw new Error("percorso immagine non valido");
  const r = await fetch(`${C.archivio}/object/public/immagini/${percorso}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`immagine non disponibile nell'archivio (${r.status})`);
  const dati = Buffer.from(await r.arrayBuffer());
  if (dati.length > 2 * 1024 * 1024) throw new Error("immagine oltre il limite");
  return dati.toString("base64");
}

/** Immagine nell'archivio: il nome è unico e non cambia mai, quindi si scarica e pubblica solo quando cambia il percorso. */
// Le immagini hanno un nome nuovo a ogni modifica (nome.versione.est): nessuna copia vecchia in cache, mai
export async function immagineArchivio(slug, nome, percorso) {
  const m = PERCORSO_ARCHIVIO.exec(percorso);
  if (!m) return null;
  const file = `${nome}.${m[2].slice(0, 10)}.${m[3]}`;
  if (!ultimeImmagini.has(`${slug}/${file}`)) {
    await pubblicaBinario(`${slug}/${file}`, await daArchivio(percorso));
    ultimeImmagini.add(`${slug}/${file}`);
  }
  return file;
}

async function immagine(slug, nome, dati, percorso) {
  if (percorso) return immagineArchivio(slug, nome, percorso);
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dati ?? "");
  if (!m) return null;
  const file = `${nome}.${createHash("sha256").update(m[2]).digest("hex").slice(0, 10)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  if (!ultimeImmagini.has(`${slug}/${file}`)) {
    await pubblicaBinario(`${slug}/${file}`, m[2]);
    ultimeImmagini.add(`${slug}/${file}`);
  }
  return file;
}

/** Toglie dall'archivio le immagini del locale non più usate dalla pagina appena pubblicata. */
export async function pulisciArchivio(slug, usate) {
  const presenti = await chiaviCloudflare(`${slug}/`).catch(() => null);
  if (!Array.isArray(presenti)) return;
  for (const chiave of presenti) {
    if (/\.(html|json)$/.test(chiave) || usate.has(chiave)) continue;
    await eliminaCloudflare(chiave).catch((e) => log(`Immagine non rimossa (${chiave}): ${e.message}`));
    ultimeImmagini.delete(chiave);
  }
}

/** Pubblica le foto dei piatti (nome nuovo a ogni modifica). Restituisce id -> percorso relativo. */
export async function fotoDeiPiatti(slug, menu) {
  const percorsi = {};
  for (const c of menu.categorie) {
    for (const p of c.prodotti) {
      if (!p.foto) continue;
      if (p.foto_path) {
        const m = PERCORSO_ARCHIVIO.exec(p.foto_path);
        if (!m) continue;
        const file = `foto/${p.id}.${m[2].slice(0, 10)}.jpg`;
        if (!ultimeImmagini.has(`${slug}/${file}`)) {
          await pubblicaBinario(`${slug}/${file}`, await daArchivio(p.foto_path));
          ultimeImmagini.add(`${slug}/${file}`);
        }
        percorsi[p.id] = file;
        continue;
      }
      const file = `foto/${p.id}.${p.foto}.jpg`;
      if (!ultimeImmagini.has(`${slug}/${file}`)) {
        const r = await fetch(`${C.url}/rest/v1/rpc/foto_prodotto`, {
          method: "POST",
          headers: { apikey: C.anon, Authorization: `Bearer ${C.anon}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_prodotto: p.id }),
        });
        const dati = r.ok ? await r.json() : null;
        const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dati ?? "");
        if (!m) continue;
        await pubblicaBinario(`${slug}/${file}`, m[2]);
        ultimeImmagini.add(`${slug}/${file}`);
      }
      percorsi[p.id] = file;
    }
  }
  return percorsi;
}

export async function giro() {
  for (const slug of C.slugs) {
    try {
      const menu = await menuPubblico(slug);
      if (!menu) { log(`Menu «${slug}» non trovato o non attivo: salto`); continue; }
      const impronta = createHash("sha256").update(JSON.stringify(menu)).digest("hex");
      if (ultimo.get(slug) === impronta) continue;
      const ora = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date());
      const logoFile = await immagine(slug, "logo", menu.aspetto?.logo_dati, menu.aspetto?.logo_path);
      const sfondoPrincipale = await immagine(slug, "sfondo", menu.aspetto?.sfondo_dati, menu.aspetto?.sfondo_path);
      // Carosello: solo insieme a una foto principale, al massimo 5 in più (il database lo garantisce)
      const altriSfondi = [];
      if (sfondoPrincipale) for (const [i, percorso] of (menu.aspetto?.sfondo_carosello ?? []).slice(0, 5).entries()) {
        const f = await immagineArchivio(slug, `sfondo-${i + 2}`, percorso);
        if (f) altriSfondi.push(f);
      }
      const sfondoFile = sfondoPrincipale ? [sfondoPrincipale, ...altriSfondi] : null;
      const fotoPiatti = await fotoDeiPiatti(slug, menu);
      const { aspetto, ...resto } = menu;
      const leggero = { ...resto, aspetto: aspetto ? { ...aspetto, logo_dati: null, sfondo_dati: null, logo_path: null, sfondo_path: null, sfondo_carosello: [] } : aspetto };
      const versione = impronta.slice(0, 12);
      await pubblica(`${slug}/index.html`, pagina(leggero, ora, logoFile, sfondoFile, fotoPiatti, versione), `Menu ${slug} aggiornato`);
      for (const [l] of LINGUE.slice(1)) await pubblica(`${slug}/${l}/index.html`, pagina(leggero, ora, logoFile, sfondoFile, fotoPiatti, versione, l), `Menu ${slug} (${l})`);
      // Dopo la pagina: chi ha il menu aperto vede la nuova versione e ricarica scavalcando la cache
      await pubblica(`${slug}/versione.json`, JSON.stringify({ versione, aggiornato: ora }), `Versione ${slug}`);
      ultimo.set(slug, impronta);
      log(`Pubblicato il menu «${slug}»`);
      // Dopo la pubblicazione: via le immagini non più usate (vecchie versioni, piatti tolti)
      const usate = new Set([logoFile, ...(sfondoFile ?? []), ...Object.values(fotoPiatti)].filter(Boolean).map((f) => `${slug}/${f}`));
      await pulisciArchivio(slug, usate);
    } catch (e) {
      // Offline o Cloudflare irraggiungibile: online resta l'ultima versione, si riprova al giro successivo
      log(`Pubblicazione di «${slug}» non riuscita:`, e.message);
    }
  }
}

// Un solo giro alla volta: le richieste arrivate durante un giro ne fanno partire subito un altro
let inCorso = false, ancora = false;
async function giroSicuro() {
  if (inCorso) { ancora = true; return; }
  inCorso = true;
  try { do { ancora = false; await giro(); } while (ancora); } finally { inCorso = false; }
}

async function avvia() {
  log(`Destinazione del menu: ${C.cloudflare.indirizzo}`);
  // Solo rete interna dei servizi: il bot chiama POST /ora dopo ogni modifica confermata
  createServer((req, res) => {
    if (req.method === "POST" && req.url === "/ora") { res.writeHead(202).end(); void giroSicuro(); }
    else res.writeHead(404).end();
  }).listen(8090);
  log(`Pubblicatore avviato: ${C.slugs.join(", ")} → ${C.cloudflare.indirizzo}, controllo ogni ${C.intervallo / 1000} s`);
  for (;;) {
    await giroSicuro();
    await new Promise((r) => setTimeout(r, C.intervallo));
  }
}

if (process.env.PUBBLICATORE_TEST !== "1") avvia();
