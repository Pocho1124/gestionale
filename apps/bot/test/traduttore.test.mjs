// Test della traduzione automatica del menu: solo voci nuove o cambiate, traduzioni manuali intoccabili,
// nomi dei vini invariati, numeri controllati, modello spento senza danni. Database e modello simulati.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { impronta, traduciMenu, traduzioneValida } from "../traduttore.mjs";

const LOCALE = "00000000-0000-4000-8000-000000000001";

/** Database finto: restituisce le righe date e registra le modifiche. */
function dbFinto(categorie, prodotti) {
  const modifiche = [];
  const db = async (percorso, opz = {}) => {
    if (opz.metodo === "PATCH") { modifiche.push({ percorso, corpo: opz.corpo }); return []; }
    if (percorso.startsWith("categorie?")) return categorie;
    if (percorso.startsWith("prodotti?")) return prodotti;
    throw new Error(`percorso inatteso: ${percorso}`);
  };
  return { db, modifiche };
}
const riga = (id, nome, descrizione = "", extra = {}) => ({ id, nome, descrizione, nome_en: "", descrizione_en: "", traduzione_da: "", vini: null, ...extra });

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
});

describe("traduzione del menu", () => {
  test("traduce le voci nuove e salva l'impronta dell'italiano", async () => {
    const { db, modifiche } = dbFinto([riga("c1", "Taglieri")], [riga("p1", "Tagliere misto", "Salumi e formaggi per 2")]);
    const modello = async ({ utente }) => {
      const x = JSON.parse(utente);
      return x.tipo === "categoria" ? { nome: "Boards", descrizione: "" } : { nome: "Mixed board", descrizione: "Cured meats and cheeses for 2" };
    };
    assert.equal(await traduciMenu({ db, chiediModello: modello, locale: LOCALE }), 2);
    assert.deepEqual(modifiche[0], { percorso: "categorie?id=eq.c1&traduzione_da=neq.manuale",
      corpo: { nome_en: "Boards", descrizione_en: "", traduzione_da: impronta("Taglieri", "") } });
    assert.equal(modifiche[1].corpo.descrizione_en, "Cured meats and cheeses for 2");
  });

  test("non ritraduce le voci invariate né quelle scritte a mano", async () => {
    const { db, modifiche } = dbFinto([], [
      riga("p1", "Pinsa", "", { traduzione_da: impronta("Pinsa", "") }),
      riga("p2", "Bruschetta", "", { traduzione_da: "manuale", nome_en: "Toasted bread" }),
    ]);
    let chiamate = 0;
    assert.equal(await traduciMenu({ db, chiediModello: async () => { chiamate++; return { nome: "x", descrizione: "" }; }, locale: LOCALE }), 0);
    assert.equal(chiamate, 0);
    assert.equal(modifiche.length, 0);
  });

  test("ritraduce quando cambia l'italiano", async () => {
    const { db, modifiche } = dbFinto([], [riga("p1", "Pinsa bianca", "", { traduzione_da: impronta("Pinsa", ""), nome_en: "Pinsa" })]);
    await traduciMenu({ db, chiediModello: async () => ({ nome: "White pinsa", descrizione: "" }), locale: LOCALE });
    assert.equal(modifiche[0].corpo.nome_en, "White pinsa");
  });

  test("il nome del vino resta l'originale, si traduce la descrizione", async () => {
    const { db, modifiche } = dbFinto([], [riga("p1", "Taurasi Riserva", "Rosso strutturato", { vini: { prodotto_id: "p1" } })]);
    await traduciMenu({ db, chiediModello: async () => ({ nome: "Taurasi Reserve", descrizione: "Full-bodied red" }), locale: LOCALE });
    assert.deepEqual(modifiche[0].corpo, { nome_en: "", descrizione_en: "Full-bodied red", traduzione_da: impronta("Taurasi Riserva", "Rosso strutturato") });
  });

  test("traduzione che cambia i numeri: scartata e non ritentata", async () => {
    const prodotti = [riga("p1", "Calice 15 cl", "")];
    const { db, modifiche } = dbFinto([], prodotti);
    await traduciMenu({ db, chiediModello: async () => ({ nome: "Glass 20 cl", descrizione: "" }), locale: LOCALE });
    assert.deepEqual(modifiche[0].corpo, { traduzione_da: impronta("Calice 15 cl", "") + ":scartata" });
    prodotti[0].traduzione_da = modifiche[0].corpo.traduzione_da;
    let chiamate = 0;
    await traduciMenu({ db, chiediModello: async () => { chiamate++; return { nome: "", descrizione: "" }; }, locale: LOCALE });
    assert.equal(chiamate, 0);
  });

  test("modello spento: nessuna modifica, si riprova al giro dopo", async () => {
    const { db, modifiche } = dbFinto([], [riga("p1", "Pinsa", "")]);
    const salvate = await traduciMenu({ db, chiediModello: async () => { throw new Error("Modello non disponibile (503)"); }, locale: LOCALE });
    assert.equal(salvate, 0);
    assert.equal(modifiche.length, 0);
  });

  test("al massimo «limite» voci per giro", async () => {
    const { db, modifiche } = dbFinto([], Array.from({ length: 30 }, (_, i) => riga(`p${i}`, `Piatto ${i}`, "")));
    await traduciMenu({ db, chiediModello: async ({ utente }) => ({ nome: `Dish ${JSON.parse(utente).nome.split(" ")[1]}`, descrizione: "" }), locale: LOCALE, limite: 15 });
    assert.equal(modifiche.length, 15);
  });
});
