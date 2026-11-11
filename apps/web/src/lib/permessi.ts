import type { Ruolo } from "./tipi";

/**
 * Specchio lato interfaccia delle capacità definite nel database (funzione public.puo).
 * Serve solo a mostrare o nascondere i comandi: il controllo vero lo fa sempre il database.
 */
export type Capacita = "sala.apri" | "sala.comanda" | "ordini.conferma" | "sala.chiudi" | "ordini.annulla" | "cucina.avanza"
  | "esauriti" | "magazzino" | "reparti" | "utenti" | "cassa" | "catalogo" | "impostazioni";

const MATRICE: Record<Capacita, Ruolo[]> = {
  "sala.apri": ["owner", "manager", "caposala", "cameriere"],
  "sala.comanda": ["owner", "manager", "caposala", "cameriere"],
  "ordini.conferma": ["owner", "manager", "caposala", "cameriere"],
  "sala.chiudi": ["owner", "manager", "caposala"],
  "ordini.annulla": ["owner", "manager", "caposala"],
  "cucina.avanza": ["owner", "manager", "caposala", "cameriere", "cucina"],
  esauriti: ["owner", "manager", "caposala", "cameriere", "cucina"],
  magazzino: ["owner", "manager"],
  reparti: ["owner", "manager"],
  utenti: ["owner", "manager"],
  catalogo: ["owner", "manager"],
  impostazioni: ["owner", "manager"],
  cassa: ["owner"],
};

export const puo = (ruolo: Ruolo | null | undefined, c: Capacita) => !!ruolo && MATRICE[c].includes(ruolo);

/** Capacità che sulle postazioni condivise valgono con il ruolo di chi inserisce il codice (come puo() nel database). */
export const CAPACITA_CON_CODICE: Capacita[] = ["sala.apri", "sala.comanda", "ordini.conferma", "sala.chiudi", "ordini.annulla"];
/** Sulla postazione si mostrano tutti i comandi di sala: il codice di chi li usa decide se sono permessi. */
export const puoSala = (ruolo: Ruolo | null | undefined, c: Capacita, postazione: boolean) =>
  postazione && !!ruolo && ruolo !== "cucina" && CAPACITA_CON_CODICE.includes(c) ? true : puo(ruolo, c);

export const NOMI_RUOLO: Record<Ruolo, string> = {
  owner: "Amministratore", manager: "Responsabile", caposala: "Caposala", cameriere: "Cameriere", cucina: "Cucina / reparto",
};
const LIVELLO: Record<Ruolo, number> = { owner: 4, manager: 3, caposala: 2, cameriere: 1, cucina: 1 };

/** Ruoli che chi ha il ruolo indicato può assegnare: solo inferiori al proprio, mai l'amministratore. */
export const ruoliAssegnabili = (mio: Ruolo | null) =>
  (["manager", "caposala", "cameriere", "cucina"] as Ruolo[]).filter((r) => mio && LIVELLO[r] < LIVELLO[mio]);
