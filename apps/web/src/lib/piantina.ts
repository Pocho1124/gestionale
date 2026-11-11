/** Modello della piantina: tipi, misure, arredi, sedie e stato dei tavoli (condiviso da sala, piantina e pannello). */
export interface Sala { id: string; locale_id: string; nome: string; posizione: number; larghezza_m: number; profondita_m: number; sfondo_dati: string | null; sfondo_path: string | null; sfondo_opacita: number; pavimento: Pavimento }
export type Pavimento = "parquet" | "cotto" | "marmo" | "cemento" | "nessuno";
export interface Tavolo { id: string; locale_id: string; sala_id: string; nome: string; posti: number; forma: "tondo" | "quadrato" | "rettangolo"; x: number; y: number; rotazione: number; qr_token: string; attivo: boolean }
export type TipoElemento = "muro" | "bancone" | "porta" | "finestra" | "colonna" | "pianta" | "zona" | "testo" | "cassa" | "bagni"
  | "botte" | "scaffale" | "divano" | "poltrona" | "sgabello" | "tappeto" | "camino" | "scala" | "cucina" | "vetrina" | "fioriera";
/** Lato trascinato per ridimensionare: il lato opposto resta fermo. */
export type Lato = "sinistra" | "destra" | "sopra" | "sotto";
export interface Elemento { id: string; locale_id: string; sala_id: string; tipo: TipoElemento; x: number; y: number; w: number; h: number; rotazione: number; etichetta: string }
export type Selezione = { tipo: "tavolo" | "elemento"; id: string } | null;
export interface SessioneT { id: string; tavolo_id: string; coperti: number; codice: string; aperta_at: string; codice_errati?: number; coperto_cent?: number; nomi_clienti?: { nome: string }[]; responsabile?: string | null }
export interface Wifi { locale_id?: string; ssid: string; sicurezza: "WPA" | "WEP" | "nopass"; password: string; nascosta: boolean; url_ordini: string }

export const W = 1000;
/** Altezza della piantina in punti, proporzionale alle misure reali della sala. */
export const altezza = (s?: Sala) => Math.round(Math.min(2000, Math.max(300, W * ((s?.profondita_m ?? 8) / (s?.larghezza_m ?? 12)))));
export const scatto = (v: number) => Math.round(v / 10) * 10;

/** Elementi d'arredo: etichetta nella barra, misure iniziali, testo predefinito. */
export const ARREDI: Record<TipoElemento, { nome: string; w: number; h: number; etichetta?: string }> = {
  muro: { nome: "Muro", w: 300, h: 12 }, bancone: { nome: "Bancone", w: 260, h: 60, etichetta: "Bancone" },
  porta: { nome: "Porta", w: 80, h: 12 }, finestra: { nome: "Finestra", w: 120, h: 10 },
  colonna: { nome: "Colonna", w: 40, h: 40 }, pianta: { nome: "Pianta", w: 40, h: 40 },
  zona: { nome: "Zona", w: 300, h: 200, etichetta: "Dehors" }, testo: { nome: "Scritta", w: 160, h: 40, etichetta: "Ingresso" },
  cassa: { nome: "Cassa", w: 90, h: 50, etichetta: "Cassa" }, bagni: { nome: "Bagni", w: 90, h: 70, etichetta: "WC" },
  botte: { nome: "Botte", w: 54, h: 54 }, scaffale: { nome: "Bottigliera", w: 220, h: 32, etichetta: "" },
  divano: { nome: "Divano", w: 170, h: 64 }, poltrona: { nome: "Poltrona", w: 62, h: 62 }, sgabello: { nome: "Sgabello", w: 26, h: 26 },
  tappeto: { nome: "Tappeto", w: 240, h: 150 }, camino: { nome: "Camino", w: 130, h: 42 }, scala: { nome: "Scala", w: 90, h: 170 },
  cucina: { nome: "Cucina", w: 240, h: 120, etichetta: "Cucina" }, vetrina: { nome: "Vetrina", w: 150, h: 50, etichetta: "" },
  fioriera: { nome: "Fioriera", w: 170, h: 30 },
};
/** Elementi sottili (muri, porte, finestre): si allungano dai due capi, lo spessore si cambia dal pannello. */
export const SOTTILI = new Set<TipoElemento>(["muro", "porta", "finestra"]);
/** Elementi a terra, disegnati sotto tutto il resto. */
export const A_TERRA = new Set<TipoElemento>(["zona", "tappeto"]);
export const LATI: Lato[] = ["sinistra", "destra", "sopra", "sotto"];
/** Distanza in più delle maniglie dal bordo quando l'elemento è sottile: così le due maniglie opposte non si sovrappongono. */
export const stacco = (meta: number) => Math.max(0, 18 - meta);
export const dimensioni = (t: Tavolo) => {
  const base = 34 + Math.min(t.posti, 12) * 3;
  return t.forma === "rettangolo" ? { w: base * 1.8, h: base } : { w: base, h: base };
};
/** Posizioni delle sedie attorno al tavolo (coordinate rispetto al centro, già ruotate con il tavolo). */
export function sedie(t: Tavolo, w: number, h: number): { x: number; y: number; a: number }[] {
  const n = Math.min(t.posti, 16), dist = 13, out: { x: number; y: number; a: number }[] = [];
  if (t.forma === "tondo") {
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI - Math.PI / 2; out.push({ x: Math.cos(a) * (w / 2 + dist), y: Math.sin(a) * (w / 2 + dist), a: (a * 180) / Math.PI + 90 }); }
    return out;
  }
  // Prima i lati lunghi, poi le testate se i posti avanzano
  const testate = t.forma === "rettangolo" ? (n > 6 ? 2 : 0) : (n > 4 ? 2 : 0);
  const lati = n - testate, sopra = Math.ceil(lati / 2), sotto = lati - sopra;
  const fila = (k: number, y: number, a: number) => { for (let i = 0; i < k; i++) out.push({ x: -w / 2 + (w * (i + 0.5)) / k, y, a }); };
  fila(sopra, -h / 2 - dist, 0); fila(sotto, h / 2 + dist, 180);
  if (testate) { out.push({ x: -w / 2 - dist, y: 0, a: 270 }, { x: w / 2 + dist, y: 0, a: 90 }); }
  return out;
}
/** Colore dello stato: libero, aperto da poco, da più di un'ora, da più di due. */
export const stato = (s?: SessioneT) => !s ? "libero" : minuti(s.aperta_at) >= 120 ? "lungo" : minuti(s.aperta_at) >= 60 ? "medio" : "aperto";

export const minuti = (da: string) => Math.max(0, Math.round((Date.now() - new Date(da).getTime()) / 60000));
export const durata = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
/** Versione corta per i tavoli piccoli: «25'», «1h15». */
export const durataBreve = (m: number) => (m < 60 ? `${m}'` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
