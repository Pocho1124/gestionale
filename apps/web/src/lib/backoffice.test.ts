// Test della logica del backoffice senza React. Si lanciano da packages/core: npx vitest run --config vitest.backoffice.config.mjs
// (describe, it ed expect sono globali). Dati sintetici.
import { euro, euroTesto } from "./formato";
import { LATI, dimensioni, sedie, stacco, stato, type Tavolo } from "./piantina";
import { nomeFileXml, xmlFattura, type Fattura } from "./fatture";
import { conAggiunte, prezzoMinimo } from "./aggiunte";
import { animazioniCarosello } from "./carosello";
import { TESTI_MENU, TESTI_TAVOLO, allergeniIn, descrizioneIn, menuInLingua, nomeIn } from "./traduzioni";

const tavolo = (forma: Tavolo["forma"], posti: number): Tavolo =>
  ({ id: "t", locale_id: "l", sala_id: "s", nome: "1", posti, forma, x: 0, y: 0, rotazione: 0, qr_token: "q", attivo: true });

describe("formato degli importi", () => {
  it("euro con la virgola e il simbolo", () => {
    expect(euro(1250).replace(/\s/g, " ")).toBe("12,50 €");
    expect(euro(null).replace(/\s/g, " ")).toBe("0,00 €");
  });
  it("testo da modificare in un campo", () => {
    expect(euroTesto(1250)).toBe("12,50");
    expect(euroTesto(5)).toBe("0,05");
  });
});

describe("piantina", () => {
  it("una sedia per posto, attorno al tavolo", () => {
    for (const forma of ["tondo", "quadrato", "rettangolo"] as const) {
      const t = tavolo(forma, 6), { w, h } = dimensioni(t);
      const s = sedie(t, w, h);
      expect(s).toHaveLength(6);
      // ogni sedia è fuori dal piano del tavolo
      for (const c of s) expect(Math.max(Math.abs(c.x) - w / 2, Math.abs(c.y) - h / 2)).toBeGreaterThan(0);
    }
  });
  it("le maniglie dei lati sottili si staccano dal bordo, quelle dei lati larghi no", () => {
    expect(stacco(6)).toBe(12);       // muro spesso 12: maniglia a 18 dal centro
    expect(stacco(150)).toBe(0);
    expect(LATI).toEqual(["sinistra", "destra", "sopra", "sotto"]);
  });
  it("stato del tavolo dal tempo di apertura", () => {
    const fa = (min: number) => ({ id: "s", tavolo_id: "t", coperti: 2, codice: "1234", aperta_at: new Date(Date.now() - min * 60000).toISOString() });
    expect(stato(undefined)).toBe("libero");
    expect(stato(fa(10))).toBe("aperto");
    expect(stato(fa(70))).toBe("medio");
    expect(stato(fa(130))).toBe("lungo");
  });
});

describe("fattura elettronica (XML FatturaPA)", () => {
  const f: Fattura = {
    id: "f", anno: 2026, numero: 7, data: "2026-11-10", sessione_id: null, creato_at: "2026-11-10T12:00:00Z",
    cedente: { denominazione: "Locale Esempio Srl", partita_iva: "01234567897", codice_fiscale: "", regime_fiscale: "RF01", indirizzo: "Via Prova 1", cap: "00100", comune: "Roma", provincia: "RM" },
    cliente: { denominazione: "Azienda <Esempio> & C. ’s", nome: "", cognome: "", partita_iva: "11111111115", codice_fiscale: "", indirizzo: "Via Test 2", cap: "00100",
      comune: "Roma", provincia: "RM", nazione: "IT", codice_destinatario: "0000000", pec: "fatture@esempio.test" },
    righe: [{ descrizione: "Cena «aziendale»", quantita: 2, prezzo_cent: 1100, aliquota: 10, prezzo_unitario: "10.00000000", totale_netto_cent: 2000 }],
    riepilogo: [{ aliquota: 10, imponibile_cent: 2000, imposta_cent: 200 }], imponibile_cent: 2000, imposta_cent: 200, totale_cent: 2200, modalita: "MP08",
  };
  const xml = xmlFattura(f);
  it("struttura e importi dal database", () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('versione="FPR12"');
    expect(xml).toContain("<ImportoTotaleDocumento>22.00</ImportoTotaleDocumento>");
    expect(xml).toContain("<PrezzoUnitario>10.00000000</PrezzoUnitario><PrezzoTotale>20.00</PrezzoTotale><AliquotaIVA>10.00</AliquotaIVA>");
    expect(xml).toContain("<ModalitaPagamento>MP08</ModalitaPagamento>");
  });
  it("testi del cliente protetti e in caratteri ammessi", () => {
    expect(xml).toContain("Azienda &lt;Esempio&gt; &amp; C. &apos;s");
    expect(xml).not.toContain("<Esempio>");
    expect(xml).not.toMatch(/[’]/);
  });
  it("senza codice destinatario si usa la PEC; nome del file con partita IVA e progressivo", () => {
    expect(xml).toContain("<PECDestinatario>fatture@esempio.test</PECDestinatario>");
    expect(nomeFileXml(f)).toBe("IT01234567897_26007.xml");
  });
});

describe("traduzioni della pagina del tavolo", () => {
  it("nome e descrizione inglesi solo se scritti", () => {
    expect(nomeIn("en", { nome: "Tagliere", nome_en: "Board" })).toBe("Board");
    expect(nomeIn("en", { nome: "Tagliere", nome_en: "" })).toBe("Tagliere");
    expect(nomeIn("it", { nome: "Tagliere", nome_en: "Board" })).toBe("Tagliere");
    expect(descrizioneIn("en", { descrizione: "Salumi misti" })).toBe("Salumi misti");
  });
  it("allergeni tradotti", () => {
    expect(allergeniIn("en", ["Glutine", "Latte"])).toEqual(["Gluten", "Milk"]);
    expect(allergeniIn("it", ["Glutine"])).toEqual(["Glutine"]);
  });
  it("menu interno in inglese: nomi, descrizioni, note dei vini, allergeni ed etichette", () => {
    const menu = { categorie: [{ nome: "Rossi", nome_en: "Red wines", descrizione: "", prodotti: [
      { nome: "Taurasi", nome_en: "", descrizione: "Rosso strutturato", descrizione_en: "Full-bodied red", allergeni: ["Solfiti"], etichette: ["Consigliato"],
        vino: { note: "Affinato in botte", note_en: "Aged in barrel" } }] }] };
    const en = menuInLingua(menu, "en");
    expect(en.categorie[0]!.nome).toBe("Red wines");
    expect(en.categorie[0]!.prodotti[0]).toMatchObject({ nome: "Taurasi", descrizione: "Full-bodied red", allergeni: ["Sulphites"], etichette: ["Recommended"], vino: { note: "Aged in barrel" } });
    expect(menuInLingua(menu, "it")).toBe(menu);
    expect(Object.keys(TESTI_MENU.en).sort()).toEqual(Object.keys(TESTI_MENU.it).sort());
  });
  it("stessi testi in tutte le lingue", () => {
    for (const l of ["en", "es"] as const) {
      expect(Object.keys(TESTI_TAVOLO[l]).sort()).toEqual(Object.keys(TESTI_TAVOLO.it).sort());
      expect(Object.keys(TESTI_TAVOLO[l].stati).sort()).toEqual(Object.keys(TESTI_TAVOLO.it.stati).sort());
      expect(Object.keys(TESTI_MENU[l]).sort()).toEqual(Object.keys(TESTI_MENU.it).sort());
    }
  });
  it("menu interno in spagnolo; dove manca lo spagnolo resta l'italiano, non l'inglese", () => {
    const menu = { categorie: [{ nome: "Rossi", nome_es: "Tintos", descrizione: "", prodotti: [
      { nome: "Taurasi", descrizione: "Rosso strutturato", descrizione_en: "Full-bodied red", allergeni: ["Solfiti"], etichette: ["Vegano"],
        vino: { note: "Affinato in botte", note_es: "Criado en barrica" } }] }] };
    const es = menuInLingua(menu, "es");
    expect(es.categorie[0]!.nome).toBe("Tintos");
    expect(es.categorie[0]!.prodotti[0]).toMatchObject({ descrizione: "Rosso strutturato", allergeni: ["Sulfitos"], etichette: ["Vegano"], vino: { note: "Criado en barrica" } });
    expect(nomeIn("es", { nome: "Tagliere", nome_es: "Tabla" })).toBe("Tabla");
  });
});

describe("aggiunte divise per gruppo", () => {
  it("prima i gruppi in ordine alfabetico, poi le generiche; sempre facoltative", () => {
    const a = (id: string, gruppo = "") => ({ id, nome: id, sovrapprezzo_cent: 200, gruppo });
    const g = conAggiunte([{ id: "s", nome: "Salumi", min: 3, max: 3, scelte: [] }], [a("Miele"), a("Speck", "Salumi"), a("Pecorino", "Formaggi"), a("Coppa", "Salumi")]);
    expect(g.map((x) => [x.nome, x.min, x.max, x.scelte.length])).toEqual([
      ["Salumi", 3, 3, 0], ["Aggiunte · Formaggi", 0, 1, 1], ["Aggiunte · Salumi", 0, 2, 2], ["Altre aggiunte", 0, 1, 1]]);
    expect(conAggiunte([], [a("Miele")]).map((x) => x.nome)).toEqual(["Aggiunte"]);
    // Tagliere: i salumi del gruppo collegato non si ripetono tra le aggiunte
    const tagliere = conAggiunte([{ id: "g", nome: "Salumi", min: 1, max: 6, scelte: [{ id: "g:Speck", nome: "Speck", sovrapprezzo_cent: 400 }] }], [a("Speck", "Salumi"), a("Miele")]);
    expect(tagliere.map((x) => x.nome)).toEqual(["Salumi", "Aggiunte"]);
  });
  it("prezzo «da» di un tagliere da comporre: le voci obbligatorie più economiche", () => {
    const voci = (...p: number[]) => p.map((c) => ({ sovrapprezzo_cent: c }));
    expect(prezzoMinimo(0, [{ min: 1, scelte: voci(600, 400, 500) }, { min: 0, scelte: voci(300) }])).toBe(400);
    expect(prezzoMinimo(1000, [{ min: 2, scelte: voci(0, 0, 0) }])).toBe(1000);
  });
});

describe("sfondo a carosello", () => {
  it("una sfumatura per ogni foto oltre alla principale, ciclo = foto × intervallo", () => {
    const { css, animazione } = animazioniCarosello(3, 8);
    expect(animazione(2)).toBe("carosello2 24s linear infinite");
    expect(css).toContain("@keyframes carosello1{0%,25.000%{opacity:0}33.333%,58.333%{opacity:1}66.667%,100%{opacity:0}}");
    expect(animazioniCarosello(1, 8).css).toBe("");
    expect(animazioniCarosello(2, 1).animazione(1)).toBe("carosello1 8s linear infinite");   // intervallo minimo 4 s
  });
});
