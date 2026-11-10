// Test del pubblicatore: lettura del menu, scrittura su D1/KV di Cloudflare, immagini versionate e pulizia.
// Rete simulata: Supabase, archivio immagini e API di Cloudflare non vengono mai contattati davvero.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reteSimulata, risposta, id } from "./simula.mjs";
import { menuEsempio, ID } from "./menu-esempio.mjs";

const SLUG = "locale-di-prova";
Object.assign(process.env, {
  PUBBLICATORE_TEST: "1",
  SUPABASE_URL: "http://db.test",
  SUPABASE_ANON_KEY: "anon-di-prova",
  ARCHIVIO_URL: "http://archivio.test",
  CLOUDFLARE_ACCOUNT_ID: "account-di-prova",
  CLOUDFLARE_KV_ID: "kv-di-prova",
  CLOUDFLARE_D1_ID: "d1-di-prova",
  CLOUDFLARE_TOKEN: "token-di-prova",
  MENU_URL: "https://menu.esempio.test",
  SLUGS: SLUG,
});
console.log = () => {};   // i log del servizio non servono nei test

const rete = reteSimulata();
globalThis.fetch = rete.fetch;
const LOGO = `${id(1)}/logo/${id(90)}.webp`;
const FOTO = `${id(1)}/piatti/${id(91)}.jpg`;
const D1 = "/d1/database/d1-di-prova/query";
const KV = "/storage/kv/namespaces/kv-di-prova";
let menu, chiaviKV;

rete.quando("*", "/", (c) => risposta({ errore: `inatteso: ${c.metodo} ${c.url}` }, 500))
  .quando("POST", "db.test/rest/v1/rpc/menu_pubblico", () => menu)
  .quando("GET", "archivio.test/object/public/immagini/", () => new Response(Buffer.from("immagine-finta")))
  .quando("POST", D1, { success: true })
  .quando("PUT", `${KV}/values/`, { success: true })
  .quando("GET", `${KV}/keys`, () => ({ result: chiaviKV.map((name) => ({ name })) }))
  .quando("DELETE", `${KV}/values/`, { success: true });

const pub = await import("../pubblicatore.mjs");

const paginePubblicate = () => rete.trova("POST", D1).map((c) => c.corpo.params[0]);
const caricate = () => rete.trova("PUT", `${KV}/values/`).map((c) => decodeURIComponent(c.url.split("/values/")[1]));

function menuConImmagini() {
  const m = menuEsempio();
  m.aspetto.logo_path = LOGO;
  const genovese = m.categorie[0].prodotti[0];
  Object.assign(genovese, { foto: "x", foto_path: FOTO });
  return m;
}

beforeEach(() => { rete.azzera(); chiaviKV = []; });

describe("pubblicazione", () => {
  test("primo giro: immagini su KV con nome versionato, pagina e poi versione su D1", async () => {
    menu = menuConImmagini();
    await pub.giro();
    const rpc = rete.trova("POST", "rpc/menu_pubblico")[0];
    assert.deepEqual(rpc.corpo, { p_slug: SLUG });
    assert.equal(rpc.intestazioni.Authorization, "Bearer anon-di-prova");   // solo la chiave pubblica

    assert.deepEqual(caricate().sort(), [`${SLUG}/foto/${ID.genovese}.${id(91).slice(0, 10)}.jpg`, `${SLUG}/logo.${id(90).slice(0, 10)}.webp`].sort());
    assert.deepEqual(paginePubblicate(), [`${SLUG}/index.html`, `${SLUG}/en/index.html`, `${SLUG}/es/index.html`, `${SLUG}/versione.json`]);   // prima le pagine (italiano, inglese, spagnolo), poi la versione
    for (const c of rete.chiamate.filter((x) => x.url.startsWith("https://api.cloudflare.com/"))) {
      assert.equal(c.intestazioni.Authorization, "Bearer token-di-prova");
    }
    const [, html, tipo] = rete.trova("POST", D1)[0].corpo.params;
    assert.equal(tipo, "text/html; charset=utf-8");
    assert.match(html, new RegExp(`src="logo\\.${id(90).slice(0, 10)}\\.webp"`));
    assert.doesNotMatch(html, /logo_path|data:image/);   // niente percorsi interni o immagini incorporate
    const versione = JSON.parse(rete.trova("POST", D1)[3].corpo.params[1]).versione;   // dopo le tre pagine
    assert.match(html, new RegExp(`"versione":"${versione}"`));
  });

  test("menu invariato: nessuna scrittura su Cloudflare", async () => {
    await pub.giro();
    assert.equal(rete.trova("POST", D1).length, 0);
    assert.equal(rete.trova("PUT", KV).length, 0);
  });

  test("menu cambiato: nuova pagina, immagini non ricaricate, eliminate solo quelle non più usate", async () => {
    menu = menuConImmagini();
    menu.categorie[0].prodotti[1].prezzo_cent = 750;
    const logo = `${SLUG}/logo.${id(90).slice(0, 10)}.webp`;
    chiaviKV = [logo, `${SLUG}/logo.vecchio0000.webp`, `${SLUG}/foto/${ID.margherita}.abc.jpg`, `${SLUG}/index.html`];
    await pub.giro();
    assert.deepEqual(paginePubblicate(), [`${SLUG}/index.html`, `${SLUG}/en/index.html`, `${SLUG}/es/index.html`, `${SLUG}/versione.json`]);
    assert.equal(caricate().length, 0);
    assert.match(rete.trova("POST", D1)[0].corpo.params[1], /7,50/);
    const eliminate = rete.trova("DELETE", KV).map((c) => decodeURIComponent(c.url.split("/values/")[1]));
    assert.deepEqual(eliminate.sort(), [`${SLUG}/foto/${ID.margherita}.abc.jpg`, `${SLUG}/logo.vecchio0000.webp`]);
  });

  test("Cloudflare non raggiungibile: nessun errore fatale, si riprova al giro successivo", async () => {
    menu = menuEsempio();
    rete.quando("POST", D1, risposta({ errors: ["non disponibile"] }, 503));
    await pub.giro();
    assert.equal(rete.trova("POST", D1).length, 1);
    rete.quando("POST", D1, { success: true });
    rete.azzera();
    await pub.giro();
    assert.deepEqual(paginePubblicate(), [`${SLUG}/index.html`, `${SLUG}/en/index.html`, `${SLUG}/es/index.html`, `${SLUG}/versione.json`]);
  });

  test("menu non trovato: niente pubblicazione", async () => {
    menu = null;
    await pub.giro();
    assert.equal(rete.trova("POST", D1).length, 0);
  });
});

describe("percorsi", () => {
  test("su KV solo percorsi semplici", async () => {
    for (const p of ["../altro/logo.png", `${SLUG}/../x.png`, "/assoluto.png", "spazio ok.png"]) {
      await assert.rejects(pub.suCloudflare(p, "AA=="), /percorso non valido/);
    }
  });

  test("dall'archivio solo percorsi <locale>/<tipo>/<uuid>.<ext>", async () => {
    for (const p of ["../../etc/passwd", `${id(1)}/altro/${id(2)}.png`, `${id(1)}/logo/${id(2)}.svg`]) {
      await assert.rejects(pub.daArchivio(p), /percorso immagine non valido/);
    }
    assert.equal(rete.chiamate.length, 0);
  });
});

describe("pagina statica", () => {
  test("testi dal database sempre neutralizzati (niente HTML iniettato)", () => {
    const m = menuEsempio();
    m.locale.nome = '<img src=x onerror="alert(1)">';
    m.categorie[0].prodotti[1].nome = "</script><script>alert(2)</script>";
    const html = pub.pagina(m, "01/01/26, 12:00");
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<\/script><script>alert/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /\\u003c\/script>\\u003cscript>alert\(2\)/);   // nei dati JSON «<» è codificato
  });

  test("colori, font e immagini esterne fuori elenco: valori predefiniti", () => {
    const m = menuEsempio();
    Object.assign(m.aspetto, { colore_primario: "red;}</style><script>", font_titoli: "Comic Sans", logo_url: "http://non-sicuro.test/l.png" });
    const html = pub.pagina(m, "ora");
    assert.match(html, /--p:#1F4FA8/);
    assert.match(html, /family=Young\+Serif/);
    assert.doesNotMatch(html, /non-sicuro\.test|Comic Sans/);
  });

  test("regola [hidden] con !important in testa allo stile", () => {
    const html = pub.pagina(menuEsempio(), "ora");
    assert.match(html, /<style>\s*\/\*[^*]*\*\/\s*\[hidden\]\{display:none !important\}/);
  });

  test("pagina in inglese: testi del locale tradotti dove ci sono, interfaccia e allergeni in inglese, file nella cartella superiore", () => {
    const m = menuEsempio();
    m.categorie[0].nome_en = "Pinsas";
    m.categorie[0].prodotti[0].nome_en = "Genoese pinsa";
    m.categorie[0].prodotti[0].allergeni = ["Glutine", "Latte"];
    m.categorie[0].prodotti[0].descrizione = "Basilico e pinoli";
    m.categorie[0].prodotti[0].descrizione_en = "Basil and pine nuts";
    const vino = m.categorie.flatMap((c) => c.prodotti).find((p) => p.vino);
    vino.vino.note = "Affinato in botte"; vino.vino.note_en = "Aged in barrel";
    const html = pub.pagina(m, "ora", "logo.abc.webp", null, { [m.categorie[0].prodotti[0].id]: "foto/x.jpg" }, "v1", "en");
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<h2>Pinsas<\/h2>/);
    assert.match(html, /Genoese pinsa/);
    assert.match(html, /Allergens: Gluten, Milk/);
    assert.match(html, /<p class="desc">Basil and pine nuts<\/p>/);   // descrizione tradotta nella pagina
    assert.match(html, /"note":"Aged in barrel"/);                       // note del vino tradotte nella scheda
    assert.doesNotMatch(html, /Basilico e pinoli|Affinato in botte/);
    assert.match(html, new RegExp(m.categorie[0].prodotti[1].nome));   // senza traduzione resta il nome italiano
    assert.match(html, /src="\.\.\/logo\.abc\.webp"/);
    assert.match(html, /\.\.\/foto\/x\.jpg/);   // foto del piatto nella cartella superiore
    assert.doesNotMatch(html, /class="lingua"/);   // scelta della lingua solo in fondo
    assert.match(html, /"base":"\.\.\/"/);
    assert.match(html, /<a href="\.\.\/" hreflang="it" lang="it">🇮🇹 Italiano<\/a>\s*<a href="\.\.\/en\/" hreflang="en" lang="en" aria-current="page">🇬🇧 English<\/a>\s*<a href="\.\.\/es\/" hreflang="es" lang="es">🇪🇸 Español<\/a>/);
  });

  test("pagina in spagnolo: testi del locale in spagnolo, interfaccia e allergeni in spagnolo", () => {
    const m = menuEsempio();
    m.categorie[0].nome_es = "Pinsas"; m.categorie[0].prodotti[0].descrizione_es = "Albahaca y piñones";
    m.categorie[0].prodotti[0].descrizione_en = "Basil and pine nuts";
    const html = pub.pagina(m, "ora", null, null, {}, "v1", "es");
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<p class="desc">Albahaca y piñones<\/p>/);
    assert.doesNotMatch(html, /<p class="desc">Basil/);
    assert.match(html, /Alérgenos: /);
    assert.match(html, /"base":"\.\.\/"/);
    assert.match(html, /aria-current="page">🇪🇸 Español/);
    const v = menuEsempio(); const p0 = v.categorie[0].prodotti[0];
    p0.descrizione_es = "Rojo de buena estructura"; p0.nome = "Aglianico";
    assert.match(pub.pagina(v, "ora", null, null, {}, "v1", "es"), /<p class="desc">Tinto de buena estructura<\/p>/);   // colore sistemato in pubblicazione
  });

  test("pagina italiana: lingue solo in fondo, testi invariati", () => {
    const html = pub.pagina(menuEsempio(), "ora");
    assert.match(html, /<html lang="it">/);
    assert.doesNotMatch(html, /class="lingua"/);
    // In fondo: bandierine delle tre lingue, l'italiano attivo
    assert.match(html, /<nav class="lingue"[^>]*>\s*<a href="\.\/" hreflang="it" lang="it" aria-current="page">🇮🇹 Italiano<\/a>\s*<a href="en\/" hreflang="en" lang="en">🇬🇧 English<\/a>\s*<a href="es\/" hreflang="es" lang="es">🇪🇸 Español<\/a>/);
    assert.match(html, /Per informazioni sugli allergeni rivolgersi al personale/);
  });
});
