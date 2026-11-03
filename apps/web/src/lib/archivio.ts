import { sb } from "./supabase";

export type Cartella = "logo" | "sfondo" | "sale" | "piatti";
const CONTENITORE = "immagini";
/**
 * UUID v4 con getRandomValues: crypto.randomUUID esiste solo in contesti sicuri (HTTPS o localhost),
 * mentre il backoffice nella rete del locale è servito in HTTP.
 */
export function nuovoUuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;   // versione 4
  b[8] = (b[8]! & 0x3f) | 0x80;   // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const estensione = (tipo: string) => (tipo === "image/webp" ? "webp" : tipo === "image/png" ? "png" : "jpg");

/** Carica nell'archivio del locale con un nome nuovo e casuale (mai sovrascritture): restituisce il percorso. */
export async function caricaImmagine(localeId: string, cartella: Cartella, blob: Blob): Promise<string> {
  const percorso = `${localeId}/${cartella}/${nuovoUuid()}.${estensione(blob.type)}`;
  const { error } = await sb().storage.from(CONTENITORE).upload(percorso, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Caricamento non riuscito: ${error.message}`);
  return percorso;
}

/** Indirizzo pubblico dell'immagine (il nome non cambia mai: cache lunga sicura). */
export const urlImmagine = (percorso: string | null | undefined) =>
  percorso ? sb().storage.from(CONTENITORE).getPublicUrl(percorso).data.publicUrl : null;

/** Toglie dall'archivio un'immagine non più usata; un errore qui non blocca il lavoro. */
export async function eliminaImmagine(percorso: string | null | undefined) {
  if (percorso) await sb().storage.from(CONTENITORE).remove([percorso]).catch(() => undefined);
}

/** Sorgente da mostrare: archivio se presente, altrimenti il vecchio formato incorporato. */
export const sorgenteImmagine = (percorso?: string | null, dati?: string | null, url?: string | null) =>
  urlImmagine(percorso) ?? dati ?? url ?? null;
