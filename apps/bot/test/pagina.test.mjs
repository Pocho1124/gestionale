// Test della pagina pubblica del menu in jsdom: si controlla la visibilità CALCOLATA degli elementi
// (getComputedStyle su tutta la catena dei genitori), non il solo attributo «hidden».
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { menuEsempio, ID } from "./menu-esempio.mjs";
import { visibile, testo } from "./visibilita.mjs";

process.env.PUBBLICATORE_TEST = "1";
for (const n of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_KV_ID", "CLOUDFLARE_TOKEN", "CLOUDFLARE_D1_ID", "MENU_URL", "SLUGS"]) {
  process.env[n] ??= "valore-di-prova";
}
const { pagina } = await import("../pubblicatore.mjs");

const VERSIONE = "abc123";
let aperte = [];
afterEach(() => { aperte.forEach((w) => w.close()); aperte = []; });

/** Apre la pagina con gli script attivi; «versioneOnline» è ciò che risponde versione.json. */
async function apri({ menu = menuEsempio(), foto = {}, versioneOnline = VERSIONE } = {}) {
  const errori = [], navigazioni = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (e) => (/navigation/i.test(e.message) ? navigazioni : errori).push(e.message));
  const richieste = [];
  const dom = new JSDOM(pagina(menu, "01/01/26, 12:00", null, null, foto, VERSIONE), {
    url: "https://menu.esempio.test/locale-di-prova/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.fetch = async (url) => { richieste.push(String(url)); return { ok: true, json: async () => ({ versione: versioneOnline }) }; };
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  aperte.push(dom.window);
  await new Promise((r) => setTimeout(r, 10));
  const w = dom.window, d = w.document;
  const piatto = (pid) => d.querySelector(`article[data-id="${pid}"]`) ?? [...d.querySelectorAll("article")].find((a) => a.querySelector("h3")?.textContent.startsWith(pid));
  const clic = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const pulsante = (testo, dentro = d) => [...dentro.querySelectorAll("button")].find((b) => b.textContent.includes(testo));
  return { w, d, piatto, clic, pulsante, errori, navigazioni, richieste };
}

describe("caricamento", () => {
  test("nessun errore di script, scheda e mappa chiuse all'apertura", async () => {
    const p = await apri();
    assert.deepEqual(p.errori, []);
    assert.equal(visibile(p.d.querySelector(".scheda-sfondo")), false);
    assert.equal(visibile(p.d.querySelector(".mappa-sfondo")), false);
    assert.equal(visibile(p.d.querySelector("h1")), true);
  });

  test("regressione: [hidden] vince anche su un display assegnato da stile", async () => {
    const p = await apri();
    const mappa = p.d.querySelector(".mappa-sfondo");
    mappa.style.display = "grid";
    assert.equal(mappa.hidden, true);
    assert.equal(visibile(mappa), false);
  });

  test("senza la regola [hidden] la mappa resterebbe aperta (il controllo rileva il bug)", async () => {
    const html = pagina(menuEsempio(), "ora", null, null, {}, VERSIONE)
      .replace("[hidden]{display:none !important}", "").replace(".mappa-sfondo[hidden]{display:none !important}", "");
    const d = new JSDOM(html).window.document;
    const mappa = d.querySelector(".mappa-sfondo");
    mappa.style.removeProperty("display");
    assert.equal(mappa.hidden, true);
    assert.equal(visibile(mappa), true);
  });
});

describe("cascata CSS dei test", () => {
  const display = (css, attributi) => {
    const d = new JSDOM(`<style>${css}</style><div id="x" ${attributi}></div>`).window.document;
    return visibile(d.getElementById("x"));
  };
  test("specificità, !important, stile in linea e valori del browser", () => {
    assert.equal(display(".a.b{display:none} .a{display:grid}", 'class="a b"'), false);
    assert.equal(display("[hidden]{display:none !important} .a{display:grid}", 'class="a" hidden'), false);
    assert.equal(display("[hidden]{display:none !important}", 'hidden style="display:grid"'), false);
    assert.equal(display("[hidden]{display:none}", 'hidden style="display:grid"'), true);
    assert.equal(display(".a{display:grid}", 'class="a" hidden'), true);
    assert.equal(display("", "hidden"), false);
    assert.equal(display(".a{display:none}", 'class="a" style="display:block"'), true);
  });

  test("vini raggruppati per regione, esaurito segnalato", async () => {
    const p = await apri();
    const titoli = [...p.d.querySelectorAll(".regione-titolo")].map((h) => h.textContent);
    assert.deepEqual(titoli, ["Campania", "Piemonte", "Sardegna"]);
    const vermentino = p.piatto(ID.vermentino);
    assert.ok(vermentino.classList.contains("esaurito"));
    assert.equal(visibile(vermentino.querySelector(".badge")), true);
  });
});

describe("filtro per regione e mappa", () => {
  test("filtro: restano visibili i vini della regione e tutti i piatti", async () => {
    const p = await apri();
    p.clic(p.pulsante("Piemonte", p.d.querySelector(".filtro-regioni")));
    assert.equal(visibile(p.piatto(ID.barolo)), true);
    assert.equal(visibile(p.piatto(ID.aglianico)), false);
    assert.equal(visibile(p.piatto(ID.falanghina)), false);
    assert.equal(visibile(p.d.querySelector('.regione-titolo[data-regione="Campania"]')), false);
    assert.equal(visibile(p.piatto(ID.genovese)), true);
    assert.equal(p.pulsante("Piemonte").getAttribute("aria-pressed"), "true");

    p.clic(p.pulsante("Tutte"));
    for (const v of [ID.barolo, ID.aglianico, ID.falanghina]) assert.equal(visibile(p.piatto(v)), true);
  });

  test("mappa: si apre, la regione scelta applica il filtro e la mappa si chiude", async () => {
    const p = await apri();
    const mappa = p.d.querySelector(".mappa-sfondo");
    p.clic(p.pulsante("Scegli dalla mappa"));
    assert.equal(visibile(mappa), true);
    const regioni = [...mappa.querySelectorAll("path.con-vini")].map((x) => x.dataset.regioneMappa).sort();
    assert.deepEqual(regioni, ["Campania", "Piemonte", "Sardegna"]);

    p.clic(mappa.querySelector('path[data-regione-mappa="Campania"]'));
    assert.equal(visibile(mappa), false);
    assert.equal(visibile(p.piatto(ID.aglianico)), true);
    assert.equal(visibile(p.piatto(ID.barolo)), false);
  });

  test("mappa: chiusura con ×, con un tocco fuori e con Esc", async () => {
    const p = await apri();
    const mappa = p.d.querySelector(".mappa-sfondo");
    const apriMappa = () => { p.clic(p.pulsante("Scegli dalla mappa")); assert.equal(visibile(mappa), true); };
    apriMappa(); p.clic(mappa.querySelector(".mappa-chiudi")); assert.equal(visibile(mappa), false);
    apriMappa(); p.clic(mappa); assert.equal(visibile(mappa), false);
    apriMappa(); p.d.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape" })); assert.equal(visibile(mappa), false);
  });

  test("con una sola regione: niente filtro e niente mappa", async () => {
    const m = menuEsempio();
    m.categorie[1].prodotti = m.categorie[1].prodotti.filter((v) => /Campania|Taurasi|Sannio/.test(v.vino.regione));
    const p = await apri({ menu: m });
    assert.equal(p.d.querySelector(".filtro-regioni"), null);
    assert.equal(p.d.querySelector(".mappa-sfondo"), null);
  });
});

describe("scheda del piatto", () => {
  test("si apre al tocco con descrizione, allergeni, foto intera e vino consigliato", async () => {
    const p = await apri({ foto: { [ID.genovese]: "foto/genovese.jpg" } });
    p.clic(p.piatto(ID.genovese));
    const scheda = p.d.querySelector(".scheda-sfondo");
    assert.equal(visibile(scheda), true);
    const contenuto = testo(scheda);
    for (const t of ["Genovese", "Basilico e pinoli", "Allergeni: glutine", "Il sommelier consiglia", "Aglianico", "Struttura contro grassezza"]) assert.ok(contenuto.includes(t), t);
    const img = scheda.querySelector(".scheda-foto");
    assert.equal(visibile(img), true);
    assert.equal(img.getAttribute("src"), "foto/genovese.jpg");
  });

  test("percorso piatto → vino: «Torna a …» e nessun rimando circolare", async () => {
    const p = await apri();
    const scheda = p.d.querySelector(".scheda-sfondo");
    p.clic(p.piatto(ID.genovese));
    p.clic(p.pulsante("Aglianico", scheda));
    assert.ok(testo(scheda).includes("Calice 6,00 € · Bottiglia 28,00 €"));
    assert.ok(p.pulsante("← Torna a Genovese", scheda));
    assert.equal(scheda.querySelectorAll(".quiz-vino").length, 0);   // la Genovese non viene riproposta

    p.clic(p.pulsante("← Torna a Genovese", scheda));
    assert.equal(scheda.querySelector("h3").textContent, "Genovese");
    assert.equal(p.pulsante("← Torna", scheda), undefined);
  });

  test("piatto componibile: gruppi e sovrapprezzi", async () => {
    const p = await apri();
    p.clic(p.piatto(ID.tagliere));
    const contenuto = testo(p.d.querySelector(".scheda-corpo"));
    assert.ok(contenuto.includes("Salumi · da 1 a 2"));
    assert.ok(contenuto.includes("Culatello+ 3,00 €"));
    assert.ok(contenuto.includes("Prosciuttoincluso"));
  });

  test("piatto senza dettagli: non apribile", async () => {
    const p = await apri();
    const margherita = p.piatto("Margherita");
    assert.equal(margherita.classList.contains("apribile"), false);
    p.clic(margherita);
    assert.equal(visibile(p.d.querySelector(".scheda-sfondo")), false);
  });

  test("chiusura con ×, tocco fuori ed Esc; tastiera con Invio", async () => {
    const p = await apri();
    const scheda = p.d.querySelector(".scheda-sfondo");
    const art = p.piatto(ID.genovese);
    p.clic(art); p.clic(scheda.querySelector(".scheda-chiudi")); assert.equal(visibile(scheda), false);
    p.clic(art); p.clic(scheda); assert.equal(visibile(scheda), false);
    art.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(visibile(scheda), true);
    p.d.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(visibile(scheda), false);
  });
});

describe("quiz «Trova il tuo vino»", () => {
  const rispondi = (p, ...scelte) => {
    p.clic(p.pulsante("Trova il tuo vino"));
    const scheda = p.d.querySelector(".scheda-sfondo");
    for (const s of scelte) p.clic([...scheda.querySelectorAll(".quiz-scelta")].find((b) => b.textContent === s));
    return [...scheda.querySelectorAll(".quiz-vino strong")].map((x) => x.textContent);
  };

  test("tre domande; il colore scelto è vincolante e gli esauriti non compaiono", async () => {
    const p = await apri();
    assert.deepEqual(rispondi(p, "Bianco", "Strutturato e intenso", "Solo vino"), ["Falanghina"]);
  });

  test("rosso con le pizze: prima il vino abbinato", async () => {
    const p = await apri();
    assert.deepEqual(rispondi(p, "Rosso", "Strutturato e intenso", "Pizze"), ["Aglianico", "Barolo"]);
  });

  test("colore senza vini disponibili: non proposto alla prima domanda", async () => {
    const m = menuEsempio();
    m.categorie[1].prodotti.find((v) => v.id === ID.falanghina).disponibile = false;
    const p = await apri({ menu: m });
    p.clic(p.pulsante("Trova il tuo vino"));
    const scelte = [...p.d.querySelectorAll(".quiz-scelta")].map((b) => b.textContent);
    assert.deepEqual(scelte, ["Rosso", "Sorprendimi"]);
  });

  test("«Ricomincia» torna alla prima domanda", async () => {
    const p = await apri();
    rispondi(p, "Sorprendimi", "Indifferente", "Solo vino");
    p.clic(p.pulsante("Ricomincia"));
    assert.ok(testo(p.d.querySelector(".scheda-corpo")).includes("Domanda 1 di 3"));
  });
});

describe("aggiornamento automatico", () => {
  test("stessa versione online: nessun ricaricamento", async () => {
    const p = await apri();
    assert.ok(p.richieste.some((u) => u.startsWith("versione.json?t=")));
    assert.deepEqual(p.navigazioni, []);
  });

  test("versione nuova online: ricarica una sola volta per versione", async () => {
    const p = await apri({ versioneOnline: "nuova1" });
    assert.equal(p.navigazioni.length, 1);
    assert.equal(p.w.sessionStorage.getItem("menu-ricaricato"), "nuova1");
    p.d.dispatchEvent(new p.w.Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(p.navigazioni.length, 1);
  });
});
