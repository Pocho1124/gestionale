export type Ruolo = "owner" | "manager" | "cameriere" | "cucina";

export interface Locale { id: string; nome: string; slug: string; organizzazione_id: string }

export interface Categoria {
  id: string; locale_id: string; nome: string; descrizione: string; posizione: number; visibile: boolean;
}

export interface Prodotto {
  id: string; locale_id: string; categoria_id: string; nome: string; descrizione: string;
  prezzo_cent: number; aliquota_iva: number; disponibile: boolean; visibile: boolean;
  allergeni: string[]; etichette: string[]; immagine_url: string | null; posizione: number;
}

export interface Aspetto {
  locale_id?: string;
  colore_primario: string; colore_accento: string; colore_sfondo: string; colore_testo: string;
  font_titoli: string; font_testo: string; logo_url: string | null; logo_dati: string | null; mostra_nome: boolean;
  layout: "lista" | "griglia" | "compatto" | "elegante";
  mostra_allergeni: boolean; mostra_descrizioni: boolean; testo_piede: string;
  sfondo_dati: string | null; sfondo_opacita: number; sfondo_sfocatura: number; sfondo_bn: boolean;
}

export interface MenuPubblico {
  locale: { nome: string; indirizzo: string };
  aspetto: Aspetto | null;
  categorie: {
    id: string; nome: string; descrizione: string;
    prodotti: {
      id: string; nome: string; descrizione: string; prezzo_cent: number; disponibile: boolean;
      allergeni: string[]; etichette: string[]; immagine_url: string | null; foto?: number | null;
      opzioni: { nome: string; min: number; max: number; scelte: { nome: string; sovrapprezzo_cent: number }[] }[];
    }[];
  }[];
}

export const ALLERGENI = ["Glutine", "Crostacei", "Uova", "Pesce", "Arachidi", "Soia", "Latte",
  "Frutta a guscio", "Sedano", "Senape", "Sesamo", "Solfiti", "Lupini", "Molluschi"] as const;

export const ETICHETTE = ["Vegetariano", "Vegano", "Piccante", "Senza glutine", "Novità", "Consigliato", "Surgelato"] as const;

export const FONT_TITOLI = ["Young Serif", "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather", "Oswald",
  "Montserrat", "Poppins", "Figtree", "Inter", "Nunito"] as const;

export const FONT_TESTO = ["Figtree", "Inter", "Nunito", "Poppins", "Montserrat", "Lora", "Merriweather", "Cormorant Garamond"] as const;
