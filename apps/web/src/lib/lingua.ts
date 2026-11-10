import { useState } from "react";

/** Lingue della pagina del tavolo (QR). I nomi e le descrizioni in inglese li scrive il locale; dove mancano resta l'italiano. */
import type { Lingua } from "./traduzioni";
export * from "./traduzioni";
const CHIAVE = "menu.lingua";

/** Lingua scelta dal cliente (ricordata sul telefono), altrimenti quella del telefono: italiano o inglese. */
export function useLingua(): [Lingua, (l: Lingua) => void] {
  const [lingua, setLingua] = useState<Lingua>(() => {
    try { const s = localStorage.getItem(CHIAVE); if (s === "it" || s === "en") return s; } catch { /* memoria non disponibile */ }
    return typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("it") ? "en" : "it";
  });
  const scegli = (l: Lingua) => { setLingua(l); try { localStorage.setItem(CHIAVE, l); } catch { /* memoria non disponibile */ } };
  return [lingua, scegli];
}
