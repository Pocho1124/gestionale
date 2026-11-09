// Test del Worker del menu pubblico (deploy/cloudflare/menu-worker.js) con D1 e KV simulati.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Il Worker è un modulo ES con estensione .js fuori da un pacchetto «module»: si carica come modulo dal suo testo
const sorgente = await readFile(new URL("../../../deploy/cloudflare/menu-worker.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(sorgente).toString("base64")}`);

const PAGINE = { "locale-di-prova/index.html": { contenuto: "<h1>Menu</h1>", tipo: "text/html; charset=utf-8" } };
const IMMAGINI = { "locale-di-prova/logo.abc.webp": { value: new Uint8Array([1, 2, 3]).buffer, metadata: { tipo: "image/webp" } } };
const letture = [];
const env = {
  PREDEFINITO: "locale-di-prova",
  DB: { prepare: (sql) => ({ bind: (chiave) => ({ first: async () => { letture.push({ sql, chiave }); return PAGINE[chiave] ?? null; } }) }) },
  MENU: { getWithMetadata: async (chiave) => IMMAGINI[chiave] ?? { value: null, metadata: null } },
};
const chiedi = (percorso, method = "GET") => worker.fetch(new Request(`https://menu.esempio.test${percorso}`, { method }), env);

describe("Worker del menu", () => {
  test("indirizzo principale → menu del locale predefinito", async () => {
    const r = await chiedi("/");
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "https://menu.esempio.test/locale-di-prova/");
  });

  test("pagina da D1, mai in cache, con intestazioni di sicurezza", async () => {
    const r = await chiedi("/locale-di-prova/");
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "<h1>Menu</h1>");
    assert.equal(r.headers.get("cache-control"), "no-cache");
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.match(r.headers.get("strict-transport-security"), /max-age=31536000/);
    assert.match(letture.at(-1).sql, /where chiave = \?/);   // query con parametro, mai testo concatenato
  });

  test("immagine da KV, in cache a lungo (nome versionato)", async () => {
    const r = await chiedi("/locale-di-prova/logo.abc.webp");
    assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(r.headers.get("content-type"), "image/webp");
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
  });

  test("percorso senza barra finale → reindirizzato", async () => {
    const r = await chiedi("/locale-di-prova");
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "https://menu.esempio.test/locale-di-prova/");
  });

  test("percorsi non validi, inesistenti e metodi di scrittura rifiutati", async () => {
    for (const p of ["/locale-di-prova/%2e%2e/segreto.html", "/.env", "/locale-di-prova/%E0%A4%A.html", "/locale-di-prova/manca.html", "/locale-di-prova/manca.webp"]) {
      assert.equal((await chiedi(p)).status, 404, p);
    }
    for (const m of ["POST", "PUT", "DELETE"]) assert.equal((await chiedi("/locale-di-prova/", m)).status, 405);
  });

  test("HEAD: intestazioni senza corpo", async () => {
    const r = await chiedi("/locale-di-prova/", "HEAD");
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "");
  });
});
