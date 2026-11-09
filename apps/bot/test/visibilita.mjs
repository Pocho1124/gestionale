// Visibilità calcolata come in un browser. Serve perché getComputedStyle di jsdom applica le regole solo in
// ordine di apparizione: ignora specificità e «!important», quindi non vedrebbe il bug reale della mappa
// (attributo hidden scavalcato da un «display» assegnato da stile). Qui la cascata della proprietà display è
// risolta per intero: importanza, stile in linea, specificità, ordine. Le regole dentro @media sono ignorate
// (nella pagina non toccano display).

/** Specificità [id, classi/attributi/pseudo-classi, tipi] di un selettore semplice o composto. */
function specificita(selettore) {
  const s = selettore.replace(/::?[a-z-]+\([^)]*\)/gi, (m) => (m.startsWith(":not(") ? m.slice(5, -1) : " "));
  const id = (s.match(/#[\w-]+/g) ?? []).length;
  const classi = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const tipi = (s.replace(/\[[^\]]+\]/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [id, classi, tipi];
}
const confronta = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Divide «a, b:not(c, d)» solo sulle virgole al primo livello. */
function dividi(lista) {
  const parti = []; let livello = 0, attuale = "";
  for (const c of lista) {
    if (c === "(") livello++;
    if (c === ")") livello--;
    if (c === "," && livello === 0) { parti.push(attuale.trim()); attuale = ""; } else attuale += c;
  }
  return [...parti, attuale.trim()].filter(Boolean);
}

/** Valore di display dopo la cascata (autore e stile in linea, poi valori predefiniti del browser). */
export function displayCalcolato(el) {
  const w = el.ownerDocument.defaultView;
  let migliore = null, ordine = 0;
  const candida = (valore, importante, spec, inLinea) => {
    const chiave = { valore, importante, inLinea, spec, ordine: ordine++ };
    if (!migliore) { migliore = chiave; return; }
    const v = (x) => [x.importante ? 1 : 0, x.inLinea && !x.importante ? 1 : 0];
    const [ia, la] = v(chiave), [ib, lb] = v(migliore);
    if (ia !== ib) { if (ia > ib) migliore = chiave; return; }
    if (ia && chiave.inLinea !== migliore.inLinea) { if (chiave.inLinea) migliore = chiave; return; }
    if (la !== lb) { if (la > lb) migliore = chiave; return; }
    if (confronta(chiave.spec, migliore.spec) >= 0) migliore = chiave;
  };
  for (const foglio of el.ownerDocument.styleSheets) {
    for (const regola of foglio.cssRules) {
      if (!(regola instanceof w.CSSStyleRule)) continue;
      const valore = regola.style.getPropertyValue("display");
      if (!valore) continue;
      const importante = regola.style.getPropertyPriority("display") === "important";
      const corrispondenti = dividi(regola.selectorText).filter((s) => { try { return el.matches(s); } catch { return false; } });
      if (!corrispondenti.length) continue;
      candida(valore, importante, corrispondenti.map(specificita).sort(confronta).at(-1), false);
    }
  }
  const inLinea = el.style.getPropertyValue("display");
  if (inLinea) candida(inLinea, el.style.getPropertyPriority("display") === "important", [1, 0, 0, 0], true);
  if (migliore) return migliore.valore;
  // Foglio predefinito del browser (solo ciò che nasconde)
  return el.matches("[hidden], head, script, style, template, title, meta, link") ? "none" : "block";
}

/** Visibile se né l'elemento né un suo antenato ha display:none. */
export function visibile(el) {
  if (!el) return false;
  for (let e = el; e; e = e.parentElement) if (displayCalcolato(e) === "none") return false;
  return true;
}

/** Testo visibile con gli spazi tipografici (es. tra importo e «€») resi come spazi normali. */
export const testo = (el) => (el?.textContent ?? "").replace(/[  ]/g, " ");
