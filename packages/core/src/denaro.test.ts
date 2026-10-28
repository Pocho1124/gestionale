import { describe, expect, it } from "vitest";
import { centesimi, daEuro, formatta, moltiplica, scorporaIva, somma, variaPercentuale } from "./denaro";

describe("daEuro", () => {
  it("accetta virgola e punto", () => {
    expect(daEuro("8,50")).toBe(850);
    expect(daEuro("8.5")).toBe(850);
    expect(daEuro("12")).toBe(1200);
    expect(daEuro(" 0,05 ")).toBe(5);
  });
  it("rifiuta formati ambigui", () => {
    expect(() => daEuro("1.000,00")).toThrow();
    expect(() => daEuro("8,505")).toThrow();
    expect(() => daEuro("abc")).toThrow();
    expect(() => daEuro("")).toThrow();
  });
});

describe("operazioni", () => {
  it("somma e moltiplica restano interi", () => {
    expect(somma([centesimi(10), centesimi(20)])).toBe(30);
    expect(moltiplica(centesimi(650), 3)).toBe(1950);
  });
  it("rifiuta importi non interi", () => {
    expect(() => centesimi(0.1 + 0.2)).toThrow();
  });
  it("formatta in euro italiano", () => {
    expect(formatta(centesimi(850))).toMatch(/8,50/);
  });
});

describe("scorporaIva", () => {
  it("imponibile + imposta = lordo", () => {
    for (const lordo of [1, 99, 650, 1000, 12345]) {
      for (const aliquota of [4, 5, 10, 22]) {
        const { imponibile, imposta } = scorporaIva(centesimi(lordo), aliquota);
        expect(imponibile + imposta).toBe(lordo);
      }
    }
  });
  it("calcola il 10% su 11,00 €", () => {
    expect(scorporaIva(centesimi(1100), 10)).toEqual({ imponibile: 1000, imposta: 100 });
  });
});

describe("variaPercentuale", () => {
  it("arrotonda ai 10 centesimi", () => {
    expect(variaPercentuale(centesimi(650), 5)).toBe(680); // 6,825 → 6,80
  });
  it("non scende sotto zero e rifiuta -100%", () => {
    expect(variaPercentuale(centesimi(100), -99)).toBe(0);
    expect(() => variaPercentuale(centesimi(100), -100)).toThrow();
  });
});
