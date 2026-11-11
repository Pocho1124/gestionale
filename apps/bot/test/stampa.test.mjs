// Test del servizio di stampa (ESC/POS): indirizzi e porte ammessi, codifica dei caratteri, contenuto del biglietto,
// nessun comando di stampa iniettabile dai testi. Nessuna connessione reale: STAMPA_TEST=1 non avvia il servizio.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.STAMPA_TEST = "1";
process.env.SUPABASE_URL = "http://supabase.prova";
process.env.STAMPA_TOKEN = "token-di-prova";
process.env.SUPABASE_ANON_KEY = "anon-di-prova";
process.env.TZ = "Europe/Rome";
const { IP, porta, codifica, biglietto } = await import("../stampa.mjs");

const ESC = 0x1b, GS = 0x1d;
/** Quante volte compare la sequenza di byte nel biglietto. */
const conta = (buf, seq) => { let n = 0; for (let i = 0; i <= buf.length - seq.length; i++) if (seq.every((b, j) => buf[i + j] === b)) n++; return n; };
const testo = (buf) => buf.toString("latin1");
/** Testo leggibile: senza i comandi di formato (GS ! n = dimensione del carattere, ESC a n = allineamento). */
const leggibile = (buf) => testo(buf).replace(/!.|a./g, "");

describe("indirizzi e porte delle stampanti", () => {
  test("solo reti del locale (192.168/16 e 10/8)", () => {
    for (const ok of ["192.168.1.50", "192.168.111.183", "10.0.0.5", "10.255.255.254"]) assert.ok(IP.test(ok), ok);
    for (const no of ["127.0.0.1", "172.17.0.2", "8.8.8.8", "192.168.1.256", "192.168.1", "192.168.1.5; rm -rf /", "localhost", ""]) {
      assert.ok(!IP.test(no), no);
    }
  });

  test("porte da 9100 a 9109, solo numeri interi", () => {
    assert.ok(porta(9100) && porta(9109));
    for (const no of [9099, 9110, 80, 22, "9100", 9100.5, null]) assert.ok(!porta(no), String(no));
  });
});

describe("codifica dei caratteri (code page 858)", () => {
  test("lettere accentate italiane ed euro", () => {
    assert.deepEqual([...codifica("è €")], [0x8a, 0x20, 0xd5]);
    assert.deepEqual([...codifica("àòù")], [0x85, 0x95, 0x97]);
  });

  test("apostrofi e trattini tipografici diventano semplici, il resto «?»", () => {
    assert.equal(testo(codifica("L’oste — bene")), "L'oste - bene");
    assert.deepEqual([...codifica("漢")], [0x3f]);
  });

  test("un carattere di controllo nel testo non diventa un comando", () => {
    assert.deepEqual([...codifica("\x1b@")], [0x3f, 0x40]);
  });
});

describe("biglietto della comanda", () => {
  const lavoro = { tipo: "comanda", reparti: { nome: "Cucina" }, ordini: { nota: "Allergia sintetica", origine: "cliente", tavoli: { nome: "5" } } };
  const righe = [
    { nome: "Pinsa bianca", quantita: 2, nota: "ben cotta", opzioni: [{ nome: "+ Burrata" }, { nome: "+ Supplemento" }] },
    { nome: "Calice di rosso", quantita: 1, nota: "", opzioni: [] },
  ];

  test("tavolo, reparto, righe con scelte e note, nota dell'ordine, origine", () => {
    const t = leggibile(biglietto(lavoro, righe, 32));
    assert.match(t, /TAVOLO 5/);
    assert.match(t, /Cucina - \d{2}:\d{2}/);
    assert.match(t, /2 x Pinsa bianca\n {3}- \+ Burrata\n {3}- \+ Supplemento\n {3}> ben cotta/);
    assert.match(t, /1 x Calice di rosso/);
    assert.match(t, /NOTA: Allergia sintetica/);
    assert.match(t, /Ordine dal tavolo/);
  });

  test("una nota con a capo non simula una riga dell'ordine", () => {
    const finta = [{ nome: "Calice", quantita: 1, nota: "ok\n2 x Aragosta", opzioni: [] }];
    const t = leggibile(biglietto({ ...lavoro, ordini: { ...lavoro.ordini, nota: "a\n*** ANNULLATO ***" } }, finta, 32));
    assert.doesNotMatch(t, /\n2 x Aragosta/);
    assert.doesNotMatch(t, /\n\*\*\* ANNULLATO/);
    assert.match(t, /> ok 2 x Aragosta/);
  });

  test("inizia con l'inizializzazione e finisce con avanzamento e taglio", () => {
    const b = biglietto(lavoro, righe, 32);
    assert.deepEqual([...b.subarray(0, 5)], [ESC, 0x40, ESC, 0x74, 19]);
    assert.deepEqual([...b.subarray(b.length - 4)], [GS, 0x56, 0x42, 0x00]);
  });

  test("nomi lunghi accorciati alla larghezza della carta", () => {
    const t = leggibile(biglietto(lavoro, [{ nome: "Tagliere ".repeat(10), quantita: 1, nota: "", opzioni: [] }], 32));
    const riga = t.split("\n").find((x) => x.includes("1 x Tagliere"));
    assert.ok(riga.length <= 32, riga);
    assert.ok(riga.endsWith("."));
  });

  test("comandi ESC/POS nei testi (nome del piatto, nota) neutralizzati", () => {
    const b = biglietto({ ...lavoro, ordini: { ...lavoro.ordini, nota: "\x1b@\x1dV" } }, [{ nome: "Piatto\x1b@", quantita: 1, nota: "\x1dV\x00", opzioni: [{ nome: "\x1b!" }] }], 32);
    assert.equal(conta([...b], [ESC, 0x40]), 1, "una sola inizializzazione: la nostra");
    assert.equal(conta([...b], [GS, 0x56]), 1, "un solo taglio: il nostro");
  });

  test("annullo e prova di stampa", () => {
    assert.match(testo(biglietto({ ...lavoro, tipo: "annullo" }, righe, 32)), /\*\*\* ANNULLATO \*\*\*/);
    const prova = testo(biglietto({ tipo: "prova", stampanti: { nome: "Bar" } }, [], 32));
    assert.match(prova, /PROVA DI STAMPA/);
    assert.match(prova, /Bar/);
  });
});
