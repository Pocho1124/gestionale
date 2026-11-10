import { useState } from "react";

/** Lingua del menu e della pagina del tavolo (QR). Nomi e descrizioni tradotti dall'IA locale o a mano; dove mancano resta l'italiano. */
import { LINGUE, type Lingua } from "./traduzioni";
export * from "./traduzioni";
const CHIAVE = "menu.lingua";

/** Lingua scelta dal cliente (ricordata sul telefono), altrimenti quella del telefono: italiano, spagnolo, tedesco o inglese. */
export function useLingua(): [Lingua, (l: Lingua) => void] {
  const [lingua, setLingua] = useState<Lingua>(() => {
    try { const s = localStorage.getItem(CHIAVE); const l = LINGUE.find(([c]) => c === s)?.[0]; if (l) return l; } catch { /* memoria non disponibile */ }
    const telefono = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "it";
    return telefono.startsWith("it") ? "it" : telefono.startsWith("es") ? "es" : telefono.startsWith("de") ? "de" : "en";
  });
  const scegli = (l: Lingua) => { setLingua(l); try { localStorage.setItem(CHIAVE, l); } catch { /* memoria non disponibile */ } };
  return [lingua, scegli];
}
