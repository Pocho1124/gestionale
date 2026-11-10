// Test della traduzione automatica del menu: voci nuove o cambiate, campi indipendenti, traduzioni a mano intoccabili
// (si completano solo i campi vuoti), note dei vini, nomi dei vini invariati, numeri controllati, modello spento.
// Database e modello simulati.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dimenticaTentativi, impronta, sembraItaliano, traduciMenu, traduzioneValida } from "../traduttore.mjs";

const LOCALE = "00000000-0000-4000-8000-000000000001";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Database finto: restituisce le righe date e registra le modifiche. */
function dbFinto({ categorie = [], prodotti = [], vini = [] } = {}) {
  const modifiche = [];
  const db = async (percorso, opz = {}) => {
    if (opz.metodo === "PATCH") { modifiche.push({ percorso, corpo: opz.corpo }); return []; }
    if (percorso.startsWith("categorie?")) return categorie;
    if (percorso.startsWith("prodotti?")) return prodotti;
    if (percorso.startsWith("vini?")) return vini;
    throw new Error(`percorso inatteso: ${percorso}`);
  };
  return { db, modifiche };
}
const riga = (n, nome, descrizione = "", extra = {}) => ({ id: id(n), nome, descrizione, nome_en: "", descrizione_en: "", traduzione_da: "", vini: null, ...extra });
/** Modello finto: traduce con un dizionario parola per parola i campi che riceve. */
const dizionario = { Taglieri: "Boards", "Tagliere misto": "Mixed board", "Salumi e formaggi per 2": "Cured meats and cheeses for 2",
  "Rosso strutturato": "Full-bodied red", "Affinato 24 mesi in botte": "Aged 24 months in barrel", "Pinsa bianca": "White pinsa" };
const modello = async ({ utente }) => {
  const x = JSON.parse(utente); delete x.tipo;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [`${k}_inglese`, dizionario[v] ?? `EN ${v}`]));
};

beforeEach(() => dimenticaTentativi());

describe("controllo delle traduzioni", () => {
  test("stessi numeri, niente HTML, lunghezza entro il limite", () => {
    assert.ok(traduzioneValida("Tagliere per 2 persone", "Board for 2 people", 120));
    assert.ok(!traduzioneValida("Tagliere per 2 persone", "Board for 3 people", 120), "numero cambiato");
    assert.ok(!traduzioneValida("Calice 15 cl", "Glass", 120), "numero tolto");
    assert.ok(!traduzioneValida("Bruschetta", "Bruschetta <b>new</b>", 120), "HTML");
    assert.ok(!traduzioneValida("Pinsa", "", 120), "vuota");
    assert.ok(!traduzioneValida("Pinsa", "x".repeat(121), 120), "troppo lunga");
    assert.ok(traduzioneValida("", "", 500), "descrizione vuota resta vuota");
    assert.ok(traduzioneValida("Affinato 24,5 mesi", "Aged 24.5 months", 500), "virgola e punto decimale equivalenti");
  });
  test("riconosce il testo rimasto in italiano", () => {
    assert.ok(sembraItaliano("Pane e pomodoro", "Pane e pomodoro"), "ricopiato");
    assert.ok(sembraItaliano("Salumi misti", "Salumi misti con formaggi della casa e miele"), "italiano");
    assert.ok(!sembraItaliano("Salumi misti con miele", "Mixed cured meats with honey"));
    assert.ok(!sembraItaliano("Affinato in botte", "Aged in barrel"));
  });
});

describe("traduzione del menu", () => {
  test("traduce nomi e descrizioni delle voci nuove e salva l'impronta dell'italiano", async () => {
    const { db, modifiche } = dbFinto({ categorie: [riga(1, "Taglieri")], prodotti: [riga(2, "Tagliere misto", "Salumi e formaggi per 2")] });
    assert.equal(await traduciMenu({ lingue: ["en"], db, chiediModello: modello, locale: LOCALE }), 2);
    assert.deepEqual(modifiche[0], { percorso: `categorie?id=eq.${id(1)}&traduzione_da=neq.manuale`,
      corpo: { nome_en: "Boards", descrizione_en: "", traduzione_da: impronta("Taglieri", "") } });
    assert.deepEqual(modifiche[1].corpo, { nome_en: "Mixed board", descrizione_en: "Cured meats and cheeses for 2", traduzione_da: impronta("Tagliere misto", "Salumi e formaggi per 2") });
  });

  test("campi indipendenti: il nome scartato non blocca la descrizione", async () => {
    const { db, modifiche } = dbFinto({ prodotti: [riga(3, "Calice 15 cl", "Rosso strutturato")] });
    await traduciMenu({ lingue: ["en"], db, chiediModello: async () => ({ nome_inglese: "Glass 20 cl", descrizione_inglese: "Full-bodied red" }), locale: LOCALE });
    assert.deepEqual(modifiche[0].corpo, { nome_en: "", descrizione_en: "Full-bodied red", traduzione_da: impronta("Calice 15 cl", "Rosso strutturato") });
  });

  test("nome scritto a mano: resta il suo, si completa solo la descrizione", async () => {
    const { db, modifiche } = dbFinto({ prodotti: [riga(4, "Tagliere misto", "Salumi e formaggi per 2", { traduzione_da: "manuale", nome_en: "Our board" })] });
    let chiesto;
    await traduciMenu({ lingue: ["en"], db, chiediModello: async (r) => { chiesto = JSON.parse(r.utente); return modello(r); }, locale: LOCALE });
    assert.deepEqual(Object.keys(chiesto).sort(), ["descrizione", "tipo"], "al modello va solo la descrizione");
    assert.deepEqual(modifiche[0], { percorso: `prodotti?id=eq.${id(4)}`, corpo: { descrizione_en: "Cured meats and cheeses for 2" } });
  });

  test("traduzione completa scritta a mano: nessuna richiesta al modello", async () => {
    const { db, modifiche } = dbFinto({ prodotti: [riga(5, "Bruschetta", "Pane e pomodoro", { traduzione_da: "manuale", nome_en: "Bruschetta", descrizione_en: "Bread and tomato" })] });
    let chiamate = 0;
    await traduciMenu({ lingue: ["en"], db, chiediModello: async () => { chiamate++; return {}; }, locale: LOCALE });
    assert.equal(chiamate, 0);
    assert.equal(modifiche.length, 0);
  });

  test("voci invariate non ritradotte; quando cambia l'italiano sì", async () => {
    const prodotti = [riga(6, "Pinsa", "", { traduzione_da: impronta("Pinsa", ""), nome_en: "Pinsa" })];
    const { db, modifiche } = dbFinto({ prodotti });
    await traduciMenu({ lingue: ["en"], db, chiediModello: modello, locale: LOCALE });
    assert.equal(modifiche.length, 0);
    prodotti[0].nome = "Pinsa bianca";
    await traduciMenu({ lingue: ["en"], db, chiediModello: modello, locale: LOCALE });
    assert.equal(modifiche[0].corpo.nome_en, "White pinsa");
  });

  test("vini: il nome resta l'originale, si traducono descrizione e note della scheda", async () => {
    const { db, modifiche } = dbFinto({
      prodotti: [riga(7, "Taurasi Riserva", "Rosso strutturato", { vini: { prodotto_id: id(7) } })],
      vini: [{ prodotto_id: id(7), note: "Affinato 24 mesi in botte", note_en: "", traduzione_da: "" }],
    });
    await traduciMenu({ lingue: ["en"], db, chiediModello: modello, locale: LOCALE });
    assert.deepEqual(modifiche[0].corpo, { descrizione_en: "Full-bodied red", traduzione_da: impronta("Taurasi Riserva", "Rosso strutturato") });
    assert.deepEqual(modifiche[1], { percorso: `vini?prodotto_id=eq.${id(7)}&traduzione_da=neq.manuale`,
      corpo: { note_en: "Aged 24 months in barrel", traduzione_da: impronta("Affinato 24 mesi in botte") } });
  });

  test("tutto scartato: si segna e non si ritenta nello stesso avvio", async () => {
    const prodotti = [riga(8, "Calice 15 cl", "")];
    const { db, modifiche } = dbFinto({ prodotti });
    await traduciMenu({ lingue: ["en"], db, chiediModello: async () => ({ nome_inglese: "Glass 20 cl" }), locale: LOCALE });
    assert.deepEqual(modifiche[0].corpo, { nome_en: "", descrizione_en: "", traduzione_da: impronta("Calice 15 cl", "") + ":scartata" });
    let chiamate = 0;
    await traduciMenu({ lingue: ["en"], db, chiediModello: async () => { chiamate++; return {}; }, locale: LOCALE });
    assert.equal(chiamate, 0);
  });

  test("modello spento: nessuna modifica, si riprova al giro dopo", async () => {
    const { db, modifiche } = dbFinto({ prodotti: [riga(9, "Pinsa", "")] });
    const salvate = await traduciMenu({ lingue: ["en"], db, chiediModello: async () => { throw new Error("Modello non disponibile (503)"); }, locale: LOCALE });
    assert.equal(salvate, 0);
    assert.equal(modifiche.length, 0);
    assert.equal(await traduciMenu({ lingue: ["en"], db, chiediModello: modello, locale: LOCALE }), 1);
  });

  test("descrizione ricopiata in italiano: scartata, il nome tradotto resta", async () => {
    const { db, modifiche } = dbFinto({ prodotti: [riga(10, "Tagliere misto", "Salumi e formaggi della casa")] });
    await traduciMenu({ lingue: ["en"], db, chiediModello: async () => ({ nome_inglese: "Mixed board", descrizione_inglese: "Salumi e formaggi della casa" }), locale: LOCALE });
    assert.deepEqual(modifiche[0].corpo, { nome_en: "Mixed board", descrizione_en: "", traduzione_da: impronta("Tagliere misto", "Salumi e formaggi della casa") });
  });

  test("traduzione già salvata ma in italiano: si rifà", async () => {
    const im = impronta("Tagliere misto", "Salumi e formaggi per 2");
    const { db, modifiche } = dbFinto({ prodotti: [riga(11, "Tagliere misto", "Salumi e formaggi per 2", { traduzione_da: im, nome_en: "Mixed board", descrizione_en: "Salumi e formaggi per 2" })] });
    await traduciMenu({ lingue: ["en"], db, chiediModello: modello, locale: LOCALE });
    assert.equal(modifiche[0].corpo.descrizione_en, "Cured meats and cheeses for 2");
  });

  test("nome della categoria ricopiato in italiano: scartato; nome del piatto uguale: accettato", async () => {
    const { db, modifiche } = dbFinto({ categorie: [riga(12, "Carta dei vini")], prodotti: [riga(13, "Bruschetta")] });
    await traduciMenu({ lingue: ["en"], db, chiediModello: async ({ utente }) => ({ nome_inglese: JSON.parse(utente).nome }), locale: LOCALE });
    assert.equal(modifiche[0].corpo.nome_en, "");
    assert.equal(modifiche[1].corpo.nome_en, "Bruschetta");
  });

  test("spagnolo: colonne e stato propri, campi della risposta in spagnolo", async () => {
    const { db, modifiche } = dbFinto({ prodotti: [riga(14, "Tagliere misto", "Salumi e formaggi per 2", { traduzione_da: "manuale", nome_en: "Our board", descrizione_en: "Board" })] });
    let chiesto;
    const es = { "Tagliere misto": "Tabla mixta", "Salumi e formaggi per 2": "Embutidos y quesos para 2" };
    await traduciMenu({ db, locale: LOCALE, chiediModello: async (r) => {
      chiesto = r; const x = JSON.parse(r.utente); delete x.tipo;
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [`${k}_spagnolo`, es[v]]));
    } });
    assert.match(chiesto.sistema, /spagnolo/);
    assert.equal(modifiche.length, 1, "l'inglese scritto a mano è completo: si traduce solo lo spagnolo");
    assert.deepEqual(modifiche[0], { percorso: `prodotti?id=eq.${id(14)}&traduzione_es_da=neq.manuale`,
      corpo: { nome_es: "Tabla mixta", descrizione_es: "Embutidos y quesos para 2", traduzione_es_da: impronta("Tagliere misto", "Salumi e formaggi per 2") } });
  });

  test("lo spagnolo che condivide parole con l'italiano non viene scartato", () => {
    assert.ok(!sembraItaliano("Pasta con salsa del giorno", "Pasta con la salsa del día y queso"));
  });

  test("al massimo «limite» voci per giro", async () => {
    const { db, modifiche } = dbFinto({ prodotti: Array.from({ length: 30 }, (_, i) => riga(100 + i, `Piatto ${i}`, "")) });
    await traduciMenu({ lingue: ["en"], db, chiediModello: async ({ utente }) => ({ nome_inglese: `Dish ${JSON.parse(utente).nome.split(" ")[1]}` }), locale: LOCALE, limite: 15 });
    assert.equal(modifiche.length, 15);
  });
});
