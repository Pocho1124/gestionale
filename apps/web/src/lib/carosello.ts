// Sfondo a carosello (senza React: si prova con i test del backoffice). Stessa logica in apps/bot/pubblicatore.mjs.
// La foto principale resta ferma sotto; le altre compaiono una alla volta sfumando sopra di lei, in un ciclo continuo.

/** Durata della sfumatura tra una foto e l'altra (secondi). */
export const DISSOLVENZA = 2;

/**
 * Animazioni CSS del carosello: una regola @keyframes per ogni foto oltre alla principale.
 * n = foto in tutto (principale compresa), intervallo = secondi per foto. Restituisce le regole e l'animazione di ogni livello.
 */
export function animazioniCarosello(n: number, intervallo: number, prefisso = "carosello"): { css: string; animazione: (k: number) => string } {
  const T = Math.min(30, Math.max(4, Math.round(intervallo) || 8)), C = n * T, F = Math.min(DISSOLVENZA, T / 2);
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / C) * 100)).toFixed(3)}%`;
  let css = "";
  for (let k = 1; k < n; k++) {
    const fine = (k + 1) * T >= C ? "100%{opacity:0}" : `${pct((k + 1) * T)},100%{opacity:0}`;
    css += `@keyframes ${prefisso}${k}{0%,${pct(k * T - F)}{opacity:0}${pct(k * T)},${pct((k + 1) * T - F)}{opacity:1}${fine}}`;
  }
  return { css, animazione: (k) => `${prefisso}${k} ${C}s linear infinite` };
}
