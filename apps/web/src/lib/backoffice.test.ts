// Test della logica del backoffice senza React. Si lanciano da packages/core: npx vitest run --config vitest.backoffice.config.mjs
// (describe, it ed expect sono globali). Dati sintetici.
import { euro, euroTesto } from "./formato";
import { LATI, dimensioni, sedie, stacco, stato, type Tavolo } from "./piantina";
import { nomeFileXml, xmlFattura, type Fattura } from "./fatture";
import { TESTI_TAVOLO, allergeniIn, descrizioneIn, nomeIn } from "./traduzioni";

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
  it("stessi testi in tutte e due le lingue", () => {
    expect(Object.keys(TESTI_TAVOLO.en).sort()).toEqual(Object.keys(TESTI_TAVOLO.it).sort());
    expect(Object.keys(TESTI_TAVOLO.en.stati).sort()).toEqual(Object.keys(TESTI_TAVOLO.it.stati).sort());
  });
});
