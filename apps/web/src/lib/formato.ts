import { centesimi, formatta } from "@gest/core";

/** Importo in euro per l'interfaccia (es. «12,50 €»); null o undefined valgono zero. */
export const euro = (c: number | null | undefined) => formatta(centesimi(c ?? 0));

/** Importo da modificare in un campo di testo (es. 1250 → «12,50»). */
export const euroTesto = (c: number) => (c / 100).toFixed(2).replace(".", ",");
