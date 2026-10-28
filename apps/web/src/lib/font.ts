/** Font inclusi nel pacchetto (nessuna dipendenza da internet), caricati solo quando servono. */
const caricatori: Record<string, () => Promise<unknown>> = {
  "Young Serif": () => import("@fontsource/young-serif/400.css"),
  "Playfair Display": () => Promise.all([import("@fontsource/playfair-display/400.css"), import("@fontsource/playfair-display/700.css")]),
  "Lora": () => Promise.all([import("@fontsource/lora/400.css"), import("@fontsource/lora/700.css")]),
  "Merriweather": () => Promise.all([import("@fontsource/merriweather/400.css"), import("@fontsource/merriweather/700.css")]),
  "Oswald": () => Promise.all([import("@fontsource/oswald/400.css"), import("@fontsource/oswald/600.css")]),
  "Montserrat": () => Promise.all([import("@fontsource/montserrat/400.css"), import("@fontsource/montserrat/700.css")]),
  "Poppins": () => Promise.all([import("@fontsource/poppins/400.css"), import("@fontsource/poppins/600.css")]),
  "Figtree": () => Promise.all([import("@fontsource/figtree/400.css"), import("@fontsource/figtree/600.css")]),
  "Inter": () => Promise.all([import("@fontsource/inter/400.css"), import("@fontsource/inter/600.css")]),
  "Nunito": () => Promise.all([import("@fontsource/nunito/400.css"), import("@fontsource/nunito/700.css")]),
};

const caricati = new Set<string>();

export function caricaFont(nome: string): void {
  if (caricati.has(nome)) return;
  caricati.add(nome);
  void caricatori[nome]?.();
}

export const pilaFont = (nome: string, serif = false) =>
  `"${nome}", ${serif ? 'Georgia, "Times New Roman", serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`;
