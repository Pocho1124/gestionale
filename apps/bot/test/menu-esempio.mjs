// Menu sintetico come lo restituisce menu_pubblico(slug): due categorie di cibo, una di vini su tre regioni.
import { id } from "./simula.mjs";

export const ID = {
  pizze: id(10), vini: id(12),
  genovese: id(21), margherita: id(20), tagliere: id(24),
  aglianico: id(30), barolo: id(31), vermentino: id(32), falanghina: id(33),
};

const piatto = (extra) => ({ descrizione: "", disponibile: true, etichette: [], allergeni: [], abbinamenti: [], opzioni: [], ...extra });

export function menuEsempio() {
  return {
    locale: { nome: "Enoteca di prova", indirizzo: "Via Esempio 1" },
    aspetto: { layout: "lista", mostra_descrizioni: true, mostra_allergeni: true },
    categorie: [
      { id: ID.pizze, nome: "Pizze", prodotti: [
        piatto({ id: ID.genovese, nome: "Genovese", prezzo_cent: 900, descrizione: "Basilico e pinoli", allergeni: ["glutine"],
          abbinamenti: [{ id: ID.aglianico, motivo: "Struttura contro grassezza" }] }),
        piatto({ id: ID.margherita, nome: "Margherita", prezzo_cent: 700 }),
        piatto({ id: ID.tagliere, nome: "Tagliere", prezzo_cent: 1200,
          opzioni: [{ nome: "Salumi", min: 1, max: 2, scelte: [{ nome: "Prosciutto", sovrapprezzo_cent: 0 }, { nome: "Culatello", sovrapprezzo_cent: 300 }] }] }),
      ] },
      { id: ID.vini, nome: "Vini", prodotti: [
        piatto({ id: ID.aglianico, nome: "Aglianico", prezzo_cent: 600,
          vino: { tipo: "rosso", corpo: "strutturato", regione: "Taurasi", vitigno: "Aglianico", prezzo_bottiglia_cent: 2800 },
          abbinamenti: [{ id: ID.genovese, motivo: "Struttura contro grassezza" }] }),
        piatto({ id: ID.barolo, nome: "Barolo", prezzo_cent: 900, vino: { tipo: "rosso", corpo: "strutturato", regione: "Langhe", vitigno: "Nebbiolo" } }),
        piatto({ id: ID.vermentino, nome: "Vermentino", prezzo_cent: 500, disponibile: false, vino: { tipo: "bianco", corpo: "leggero", regione: "Gallura", vitigno: "Vermentino" } }),
        piatto({ id: ID.falanghina, nome: "Falanghina", prezzo_cent: 500, vino: { tipo: "bianco", corpo: "leggero", regione: "Sannio", vitigno: "Falanghina" } }),
      ] },
    ],
  };
}
