// Aggiunte divise per gruppo nella scelta di un piatto (senza React: si prova con i test del backoffice).
import type { GruppoScelte, Scelta } from "./tipi";

/**
 * Aggiunte in coda alle scelte del piatto, divise per gruppo («Aggiunte · Salumi», «Aggiunte · Formaggi», poi le generiche):
 * sempre facoltative, al massimo 10 in tutto (stesso limite del database).
 */
const ID_AGGIUNTE = "aggiunte";
export const eAggiunte = (id: string) => id === ID_AGGIUNTE || id.startsWith(`${ID_AGGIUNTE}:`);
export function conAggiunte(gruppi: GruppoScelte[], aggiunte: Scelta[] | undefined): GruppoScelte[] {
  if (!aggiunte?.length) return gruppi;
  const nomi = [...new Set(aggiunte.map((a) => a.gruppo?.trim() ?? ""))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "it"));
  return [...gruppi, ...nomi.map((n) => {
    const scelte = aggiunte.filter((a) => (a.gruppo?.trim() ?? "") === n);
    return { id: n ? `${ID_AGGIUNTE}:${n}` : ID_AGGIUNTE, nome: n ? `Aggiunte · ${n}` : nomi.length > 1 ? "Altre aggiunte" : "Aggiunte",
      min: 0, max: Math.min(10, scelte.length), scelte };
  })];
}
