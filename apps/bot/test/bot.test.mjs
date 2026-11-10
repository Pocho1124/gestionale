// Test del bot Telegram: regole, IA vincolata, anteprima → conferma → /annulla, notifiche di sala.
// Rete simulata: Telegram, Supabase, Ollama e pubblicatore non vengono mai contattati davvero.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reteSimulata, risposta, id } from "./simula.mjs";

const LOCALE = id(1);
Object.assign(process.env, {
  BOT_TEST: "1",
  TELEGRAM_TOKEN: "token-di-prova",
  TELEGRAM_UTENTI: "111",
  SUPABASE_URL: "http://db.test",
  SUPABASE_ANON_KEY: "anon-di-prova",
  BOT_EMAIL: "bot@esempio.test",
  BOT_PASSWORD: "password-di-prova",
  LOCALE_ID: LOCALE,
  LLM_TIPO: "ollama",
  LLM_URL: "http://ia.test",
  PUBBLICATORE_URL: "http://pubblicatore.test",
});

const rete = reteSimulata();
globalThis.fetch = rete.fetch;

const PIZZE = { id: id(10), nome: "Pizze", posizione: 0 };
const BIRRE = { id: id(11), nome: "Birre", posizione: 1 };
const ROSSI = { id: id(12), nome: "Vini rossi", posizione: 2 };
const prodotto = (n, nome, prezzo_cent, categoria) =>
  ({ id: id(n), nome, descrizione: "", prezzo_cent, disponibile: true, visibile: true, categoria_id: categoria.id, posizione: n });
const MARGHERITA = prodotto(20, "Margherita", 700, PIZZE);
const GENOVESE = prodotto(21, "Genovese", 900, PIZZE);
const ANDROMEDA = prodotto(22, "Andromeda", 600, BIRRE);
const AGLIANICO = prodotto(23, "Aglianico", 500, ROSSI);
const PRODOTTI = [MARGHERITA, GENOVESE, ANDROMEDA, AGLIANICO];
const VINI = [{ prodotto_id: AGLIANICO.id, tipo: "rosso", corpo: "strutturato", regione: "Campania" }];

function configuraRete() {
  rete.quando("*", "/", (c) => risposta({ message: `inatteso: ${c.metodo} ${c.url}` }, 500))
    .quando("POST", "/auth/v1/token", { access_token: "jwt-di-prova", expires_in: 3600 })
    .quando("GET", "/rest/v1/categorie", [PIZZE, BIRRE, ROSSI])
    .quando("GET", "/rest/v1/prodotti", PRODOTTI)
    .quando("GET", "/rest/v1/vini", VINI)
    .quando("GET", "/rest/v1/abbinamenti", [])
    .quando("GET", "/rest/v1/opzioni", [])
    .quando("PATCH", "/rest/v1/prodotti", [{}])
    .quando("POST", "pubblicatore.test/ora", null)
    .quando("POST", "api.telegram.org", { ok: true, result: true })
    .quando("POST", "/sendMessage", { ok: true, result: { message_id: 1 } });
}
configuraRete();

const bot = await import("../bot.mjs");

const CHAT = 111;
const scrivi = (text) => bot.gestisciMessaggio({ chat: { id: CHAT, type: "private" }, from: { id: CHAT }, text });
const ultimoMessaggio = () => rete.trova("POST", "/sendMessage").at(-1)?.corpo;
const pulsanti = (msg) => (msg?.reply_markup?.inline_keyboard ?? []).flat();
const premi = (callback_data, testo) => bot.gestisciPulsante({
  id: "cb", data: callback_data, from: { id: CHAT }, message: { chat: { id: CHAT }, message_id: 5, text: testo },
});
const scritture = () => rete.chiamate.filter((c) => c.url.includes("/rest/v1/") && c.metodo !== "GET");
const catalogo = { categorie: [PIZZE, BIRRE, ROSSI], prodotti: PRODOTTI, vini: new Map(VINI.map((v) => [v.prodotto_id, v])), abbinamenti: [] };

beforeEach(() => rete.azzera());

describe("sicurezza", () => {
  test("uuid accetta solo identificativi validi (niente filtri iniettati nell'URL)", () => {
    assert.equal(bot.uuid(id(5)), id(5));
    for (const x of ["", "1", `${id(5)}&prezzo_cent=eq.1`, "or(1.eq.1)", null, 5]) assert.throws(() => bot.uuid(x), /non valido/);
  });

  test("solo gli utenti in TELEGRAM_UTENTI sono autorizzati", () => {
    assert.equal(bot.autorizzato(111), true);
    assert.equal(bot.autorizzato("999"), false);
  });

  test("un ID non UUID dal database blocca la modifica prima di scrivere", async () => {
    const finto = { ...MARGHERITA, id: "x&prezzo_cent=gt.0" };
    rete.quando("GET", "/rest/v1/prodotti", [finto, GENOVESE]);
    try {
      await scrivi("la margherita costa 9 euro");
      const ok = pulsanti(ultimoMessaggio()).find((b) => b.callback_data.startsWith("ok:"));
      await premi(ok.callback_data, `${ultimoMessaggio().text}`);
      assert.equal(scritture().length, 0);
      assert.match(rete.trova("POST", "/editMessageText").at(-1).corpo.text, /Non applicata: identificativo non valido/);
    } finally { rete.quando("GET", "/rest/v1/prodotti", PRODOTTI); }
  });
});

describe("interprete a regole", () => {
  test("elenco con le virgole «Nome – 35 €», punto finale compreso", () => {
    const a = bot.interpretaConRegole("aggiungi ai vini rossi: Barolo – 35 €, Barbaresco – 30 €, Rosso di Montalcino – 20 €.", catalogo);
    assert.equal(a.azione, "importa");
    assert.deepEqual(a.voci.map((v) => [v.nome, v.euro, v.categoria.nome]),
      [["Barolo", 35, "Vini rossi"], ["Barbaresco", 30, "Vini rossi"], ["Rosso di Montalcino", 20, "Vini rossi"]]);
  });

  test("elenco su più righe con «aggiungi ai vini rossi» in testa: categoria esistente, niente «a» nel nome", () => {
    const a = bot.interpretaConRegole("aggiungi ai vini rossi\n\nAmarone della Valpolicella a 35€\nBarbera d'Asti a 12€\nNebbiolo d'Alba a 18€", catalogo);
    assert.equal(a.azione, "importa");
    assert.deepEqual(a.voci.map((v) => [v.nome, v.euro, v.categoria.id]),
      [["Amarone della Valpolicella", 35, ROSSI.id], ["Barbera d'Asti", 12, ROSSI.id], ["Nebbiolo d'Alba", 18, ROSSI.id]]);
  });

  test("elenco con intestazione di una categoria che non c'è: nuova, senza il verbo", () => {
    const a = bot.interpretaConRegole("aggiungi alle bollicine\nFranciacorta a 30€\nProsecco a 20€", catalogo);
    assert.deepEqual(a.voci[0].categoria, { nuova: true, nome: "Bollicine" });
  });

  test("prezzo singolo con la virgola", () => {
    const a = bot.interpretaConRegole("la margherita costa 8,50 euro", catalogo);
    assert.equal(a.azione, "imposta_prezzo");
    assert.equal(a.prodotto.id, MARGHERITA.id);
    assert.equal(a.euro, 8.5);
  });

  test("percentuale su una categoria e diminuzione", () => {
    assert.deepEqual(
      (({ azione, percentuale, categoria }) => ({ azione, percentuale, categoria: categoria.nome }))(bot.interpretaConRegole("abbassa del 5% le pizze", catalogo)),
      { azione: "varia_prezzi", percentuale: -5, categoria: "Pizze" });
  });

  test("percentuale senza categoria: si chiede, mai tutto il menu per esclusione", () => {
    assert.deepEqual(bot.interpretaConRegole("aumenta del 10% i prezzi", catalogo), { azione: "chiedi_categoria", percentuale: 10 });
    assert.equal(bot.interpretaConRegole("aumenta del 10% tutto il menu", catalogo).categoria, null);
  });

  test("esaurito e di nuovo disponibile", () => {
    assert.equal(bot.interpretaConRegole("la genovese è finita", catalogo).valore, false);
    assert.equal(bot.interpretaConRegole("la genovese è di nuovo disponibile", catalogo).valore, true);
  });

  test("più prodotti con prezzo comune («l'una»)", () => {
    const a = bot.interpretaConRegole("aggiungi in birre Mida, Rubra e Ambrata a 6 € l'una", catalogo);
    assert.equal(a.azione, "importa");
    assert.deepEqual(a.voci.map((v) => [v.nome, v.euro, v.categoria.nome]), [["Mida", 6, "Birre"], ["Rubra", 6, "Birre"], ["Ambrata", 6, "Birre"]]);
  });

  test("più prodotti senza prezzo: il prezzo si chiede, non si inventa", () => {
    const a = bot.interpretaConRegole("aggiungi in birre Mida e Rubra", catalogo);
    assert.equal(a.azione, "chiedi_prezzi");
    assert.ok(a.voci.every((v) => v.euro === null));
  });

  test("prodotti già presenti non si duplicano", () => {
    const a = bot.interpretaConRegole("aggiungi in birre Andromeda e Mida a 6 € l'una", catalogo);
    assert.deepEqual(a.voci.map((v) => v.nome), ["Mida"]);
    assert.deepEqual(a.gia, ["Andromeda"]);
  });

  test("elenco incollato con categoria nuova", () => {
    const a = bot.interpretaConRegole("Antipasti\nBruschetta - 4,50\nTagliere - 12 | salumi misti", catalogo);
    assert.equal(a.azione, "importa");
    assert.deepEqual(a.voci.map((v) => [v.nome, v.euro, v.categoria.nome, !!v.categoria.nuova]), [["Bruschetta", 4.5, "Antipasti", true], ["Tagliere", 12, "Antipasti", true]]);
    assert.equal(a.voci[1].descrizione, "salumi misti");
  });

  test("scheda vino: solo valori ammessi, sinonimi ricondotti", () => {
    assert.deepEqual(bot.leggiSchedaVino("spumante, intenso, Campania, vitigno Falanghina, bottiglia 28 euro, annata 2021"),
      { tipo: "bollicine", corpo: "strutturato", prezzo_bottiglia_cent: 2800, annata: 2021, vitigno: "Falanghina", regione: "Campania" });
  });

  test("abbinamento senza scheda del vino: chiede prima la scheda", () => {
    const a = bot.interpretaConRegole("abbina la genovese alla margherita", catalogo);
    assert.equal(a.azione, "chiarisci");
    assert.equal(bot.interpretaConRegole("abbina l'Aglianico alla genovese", catalogo).coppie[0].piatto.id, GENOVESE.id);
  });

  test("nome inesistente in un'eliminazione: nessuna azione distruttiva", () => {
    assert.deepEqual(bot.interpretaConRegole("elimina la capricciosa", catalogo), { azione: "non_trovato", cosa: "capricciosa" });
  });
});

describe("anteprima", () => {
  test("rifiuta prezzi e percentuali fuori dai limiti", () => {
    assert.ok(bot.anteprima({ azione: "imposta_prezzo", prodotto: MARGHERITA, euro: 0 }, catalogo).errore);
    assert.ok(bot.anteprima({ azione: "varia_prezzi", percentuale: -100, categoria: null }, catalogo).errore);
    assert.ok(bot.anteprima({ azione: "varia_prezzi", percentuale: 501, categoria: null }, catalogo).errore);
  });

  test("variazione: prezzi arrotondati a 0,10 €", () => {
    const { testo } = bot.anteprima({ azione: "varia_prezzi", percentuale: 7, categoria: PIZZE }, catalogo);
    assert.match(testo, /Margherita: 7,00 € → 7,50 €/);
    assert.match(testo, /Genovese: 9,00 € → 9,60 €/);
    assert.doesNotMatch(testo, /Andromeda/);
  });
});

describe("IA locale vincolata", () => {
  const modello = (uscita) => rete.quando("POST", "ia.test/api/chat", { message: { content: JSON.stringify(uscita) } });

  test("la richiesta al modello limita prodotti e categorie ai valori presenti", async () => {
    modello({ azione: "nessuna" });
    await bot.interpretaConModelloPerTest("fai qualcosa con la genovese", catalogo);
    const corpo = rete.trova("POST", "ia.test/api/chat")[0].corpo;
    assert.deepEqual(corpo.format.properties.prodotto.enum, ["Genovese"]);
    assert.deepEqual(corpo.format.properties.categoria.enum, ["Pizze", "Birre", "Vini rossi", "tutte"]);
    assert.equal(corpo.options.temperature, 0);
  });

  test("prezzo presente nel testo: accettato", async () => {
    modello({ azione: "imposta_prezzo", prodotto: "Genovese", euro: 12 });
    const a = await bot.interpretaConModelloPerTest("la genovese adesso la facciamo 12", catalogo);
    assert.equal(a.azione, "imposta_prezzo");
    assert.equal(a.euro, 12);
  });

  test("prezzo o percentuale inventati dal modello: scartati", async () => {
    modello({ azione: "imposta_prezzo", prodotto: "Genovese", euro: 15 });
    assert.equal(await bot.interpretaConModelloPerTest("la genovese adesso la facciamo 12", catalogo), null);
    modello({ azione: "varia_prezzi", percentuale: 20, categoria: "Pizze" });
    assert.equal(await bot.interpretaConModelloPerTest("alza un po' le pizze", catalogo), null);
  });

  test("prodotto fuori elenco: scartato", async () => {
    modello({ azione: "imposta_prezzo", prodotto: "Capricciosa", euro: 12 });
    assert.equal(await bot.interpretaConModelloPerTest("la capricciosa la facciamo 12", catalogo), null);
  });

  test("descrizione proposta dal modello arriva in anteprima", async () => {
    modello({ azione: "imposta_descrizione", prodotto: "Genovese", descrizione: "Basilico, pinoli e pecorino" });
    const a = await bot.interpretaConModelloPerTest("nella genovese ci sono basilico, pinoli e pecorino", catalogo);
    assert.equal(a.azione, "imposta_descrizione");
    assert.match(bot.anteprima(a, catalogo).testo, /«Basilico, pinoli e pecorino»/);
  });

  test("descrizione dal modello confermata: PATCH con il testo proposto", async () => {
    modello({ azione: "imposta_descrizione", prodotto: "Genovese", descrizione: "Basilico, pinoli e pecorino" });
    await scrivi("nella genovese ci sono basilico, pinoli e pecorino");
    const msg = ultimoMessaggio();
    await premi(pulsanti(msg).find((b) => b.callback_data.startsWith("ok:")).callback_data, msg.text);
    assert.deepEqual(rete.trova("PATCH", "/rest/v1/prodotti").map((c) => c.corpo), [{ descrizione: "Basilico, pinoli e pecorino" }]);
  });

  test("senza LLM_TIPO=llamacpp si usa l'API di Ollama", async () => {
    modello({ azione: "nessuna" });
    await bot.chiediModello({ sistema: "s", utente: "u", schema: { type: "object" } });
    assert.equal(rete.trova("POST", "ia.test/v1/chat/completions").length, 0);
    assert.equal(rete.trova("POST", "ia.test/api/chat").length, 1);
  });
});

describe("anteprima → conferma → /annulla", () => {
  test("prezzo: nessuna scrittura prima della conferma, poi PATCH, menu pubblico aggiornato e annullamento", async () => {
    await scrivi("la margherita costa 8,50 euro");
    const msg = ultimoMessaggio();
    assert.match(msg.text, /Nuovo prezzo per «Margherita»: 7,00 € → 8,50 €\n\nConfermi\?/);
    assert.equal(scritture().length, 0);

    const ok = pulsanti(msg).find((b) => b.callback_data.startsWith("ok:"));
    await premi(ok.callback_data, msg.text);
    const patch = rete.trova("PATCH", "/rest/v1/prodotti");
    assert.equal(patch.length, 1);
    assert.equal(patch[0].url, `http://db.test/rest/v1/prodotti?id=eq.${MARGHERITA.id}`);
    assert.deepEqual(patch[0].corpo, { prezzo_cent: 850 });
    assert.equal(patch[0].intestazioni.Authorization, "Bearer jwt-di-prova");
    assert.equal(rete.trova("POST", "pubblicatore.test/ora").length, 1);
    assert.match(rete.trova("POST", "/editMessageText").at(-1).corpo.text, /✅ Prezzo aggiornato\./);

    rete.azzera();
    await scrivi("/annulla");
    assert.deepEqual(rete.trova("PATCH", "/rest/v1/prodotti").map((c) => c.corpo), [{ prezzo_cent: 700 }]);
    assert.match(ultimoMessaggio().text, /annullata/);
    rete.azzera();
    await scrivi("/annulla");
    assert.match(ultimoMessaggio().text, /nessuna modifica da annullare/);
  });

  test("❌ Annulla: nessuna modifica", async () => {
    await scrivi("la genovese è esaurita");
    const msg = ultimoMessaggio();
    const no = pulsanti(msg).find((b) => b.callback_data.startsWith("no:"));
    await premi(no.callback_data, msg.text);
    assert.equal(scritture().length, 0);
    assert.match(rete.trova("POST", "/editMessageText").at(-1).corpo.text, /Annullato, nessuna modifica/);
  });

  test("pulsante già usato o sconosciuto: richiesta scaduta", async () => {
    await premi("ok:inesistente", "Testo");
    assert.equal(scritture().length, 0);
    assert.match(rete.trova("POST", "/editMessageText").at(-1).corpo.text, /Scaduta/);
  });

  test("percentuale senza categoria: pulsanti con le categorie e «Tutto il menu»", async () => {
    await scrivi("aumenta del 10% i prezzi");
    const nomi = pulsanti(ultimoMessaggio()).map((b) => b.text);
    assert.deepEqual(nomi, ["Pizze", "Birre", "Vini rossi", "Tutto il menu"]);
    assert.equal(scritture().length, 0);
  });

  test("più prodotti senza prezzo: il bot chiede il prezzo, poi mostra l'anteprima", async () => {
    await scrivi("aggiungi in birre Mida e Rubra");
    assert.match(ultimoMessaggio().text, /Mi manca il prezzo di: Mida, Rubra/);
    await scrivi("6");
    assert.match(ultimoMessaggio().text, /\[Birre\] Mida — 6,00 €\n• \[Birre\] Rubra — 6,00 €/);
    assert.equal(scritture().length, 0);
  });

  test("richiesta non capita (regole e IA): nessuna modifica", async () => {
    rete.quando("POST", "ia.test/api/chat", { message: { content: JSON.stringify({ azione: "nessuna" }) } });
    await scrivi("che tempo fa domani?");
    assert.match(ultimoMessaggio().text, /Non ho capito/);
    assert.equal(scritture().length, 0);
  });
});

describe("notifiche di sala", () => {
  test("richiesta dal tavolo notificata una sola volta con il totale calcolato", async () => {
    rete.quando("GET", "/rest/v1/richieste_tavolo", [{ id: id(50), righe: [{ prodotto_id: MARGHERITA.id, quantita: 2, opzioni: [] }], nota: "", tavoli: { nome: "5" } }])
      .quando("GET", "/rest/v1/ordini", [])
      .quando("GET", "/rest/v1/richieste_conto", []);
    await bot.controllaSala();
    const inviati = rete.trova("POST", "/sendMessage");
    assert.equal(inviati.length, 1);
    assert.equal(inviati[0].corpo.chat_id, "111");
    assert.match(inviati[0].corpo.text, /Tavolo 5 vuole ordinare\n• 2× Margherita\nTotale 14,00 €/);
    assert.deepEqual(pulsanti(inviati[0].corpo).map((b) => b.callback_data), [`sa:${id(50)}`, `sr:${id(50)}`]);

    rete.azzera();
    await bot.controllaSala();
    assert.equal(rete.trova("POST", "/sendMessage").length, 0);
  });

  test("conferma dal pulsante: RPC del database, non scritture dirette", async () => {
    rete.quando("POST", "/rest/v1/rpc/accetta_richiesta", { codice: "AB12" });
    await premi(`sa:${id(50)}`, "🔔 Tavolo 5 vuole ordinare");
    const rpc = rete.trova("POST", "/rest/v1/rpc/accetta_richiesta");
    assert.deepEqual(rpc[0].corpo, { p_richiesta: id(50), p_coperti: 2 });
    assert.match(rete.trova("POST", "/editMessageText").at(-1).corpo.text, /codice AB12/);
  });
});
