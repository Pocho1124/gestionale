/**
 * Importi monetari: sempre interi in centesimi, mai float.
 * Il tipo "branded" impedisce di passare per errore un numero qualsiasi dove serve un importo.
 */
export type Centesimi = number & { readonly __brand: "Centesimi" };

const MAX = 100_000_000_00; // 100 milioni di euro: oltre è sicuramente un errore di input

export function centesimi(n: number): Centesimi {
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX) {
    throw new RangeError(`Importo non valido: ${n}`);
  }
  return n as Centesimi;
}

/** Converte un input utente ("8,50", "8.5", "12") in centesimi. Rifiuta separatori delle migliaia e più di 2 decimali. */
export function daEuro(input: string): Centesimi {
  const m = /^\s*(-?)(\d{1,9})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) throw new RangeError(`Formato importo non valido: "${input}"`);
  const [, segno, interi, dec = ""] = m;
  const valore = Number(interi) * 100 + Number(dec.padEnd(2, "0"));
  return centesimi(segno === "-" ? -valore : valore);
}

export function formatta(c: Centesimi, locale = "it-IT", valuta = "EUR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: valuta }).format(c / 100);
}

export function somma(importi: readonly Centesimi[]): Centesimi {
  return centesimi(importi.reduce((tot, c) => tot + c, 0));
}

export function moltiplica(c: Centesimi, quantita: number): Centesimi {
  if (!Number.isSafeInteger(quantita) || quantita < 0) throw new RangeError(`Quantità non valida: ${quantita}`);
  return centesimi(c * quantita);
}

/**
 * Scorporo IVA da un prezzo ivato (i prezzi al pubblico in ristorazione sono ivati).
 * L'aliquota è in percentuale (es. 10, 22). L'imposta è arrotondata al centesimo, l'imponibile è la differenza:
 * così imponibile + imposta = lordo sempre, senza centesimi persi.
 */
export function scorporaIva(lordo: Centesimi, aliquotaPercento: number): { imponibile: Centesimi; imposta: Centesimi } {
  if (!(aliquotaPercento >= 0 && aliquotaPercento <= 100)) throw new RangeError(`Aliquota non valida: ${aliquotaPercento}`);
  const bp = Math.round(aliquotaPercento * 100); // punti base, evita float sull'aliquota
  const imposta = Math.round((lordo * bp) / (10_000 + bp));
  return { imponibile: centesimi(lordo - imposta), imposta: centesimi(imposta) };
}

/** Variazione percentuale con arrotondamento al passo indicato (default 10 centesimi). Mai sotto zero. */
export function variaPercentuale(c: Centesimi, percento: number, passo = 10): Centesimi {
  if (!Number.isFinite(percento) || percento <= -100) throw new RangeError(`Percentuale non valida: ${percento}`);
  if (!Number.isSafeInteger(passo) || passo <= 0) throw new RangeError(`Passo non valido: ${passo}`);
  const nuovo = Math.round((c * (1 + percento / 100)) / passo) * passo;
  return centesimi(Math.max(0, nuovo));
}
