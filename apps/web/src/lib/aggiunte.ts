// Aggiunte divise per gruppo nella scelta di un piatto (senza React: si prova con i test del backoffice).
import type { GruppoScelte, Scelta } from "./tipi";

/**
 * Aggiunte in coda alle scelte del piatto, divise per gruppo («Aggiunte · Salumi», «Aggiunte · Formaggi», poi le generiche):
 * sempre facoltative, al massimo 10 in tutto (stesso limite del database).
 */
const ID_AGGIUNTE = "aggiunte";
export const eAggiunte = (id: string) => id === ID_AGGIUNTE || id.startsWith(`${ID_AGGIUNTE}:`);
export function conAggiunte(gruppi: GruppoScelte[], tutte: Scelta[] | undefined): GruppoScelte[] {
  // Le aggiunte già scelte in un gruppo collegato del piatto (id «gruppo:aggiunta», es. tagliere «Salumi») non si ripetono sotto
  const nelPiatto = new Set(gruppi.flatMap((g) => g.scelte.map((s) => s.id.split(":")[1]).filter(Boolean)));
  const aggiunte = (tutte ?? []).filter((a) => !nelPiatto.has(a.id));
  if (!aggiunte.length) return gruppi;
  const nomi = [...new Set(aggiunte.map((a) => a.gruppo?.trim() ?? ""))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "it"));
  return [...gruppi, ...nomi.map((n) => {
    const scelte = aggiunte.filter((a) => (a.gruppo?.trim() ?? "") === n);
    return { id: n ? `${ID_AGGIUNTE}:${n}` : ID_AGGIUNTE, nome: n ? `Aggiunte · ${n}` : nomi.length > 1 ? "Altre aggiunte" : "Aggiunte",
      min: 0, max: Math.min(10, scelte.length), scelte };
  })];
}

/** Prezzo «da» di un piatto componibile: prezzo del piatto più le voci obbligatorie più economiche di ogni gruppo. */
export function prezzoMinimo(base: number, gruppi: { min: number; scelte: { sovrapprezzo_cent: number }[] }[] | undefined): number {
  return base + (gruppi ?? []).reduce((tot, g) =>
    tot + g.scelte.map((s) => s.sovrapprezzo_cent).sort((a, b) => a - b).slice(0, g.min).reduce((n, c) => n + c, 0), 0);
}
