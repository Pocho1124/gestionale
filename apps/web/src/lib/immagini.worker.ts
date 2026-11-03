import { elabora } from "./immagini";

// Elaborazione fuori dalla pagina: se il file è anomalo, si blocca al massimo questo worker
const contesto = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void };
contesto.onmessage = async (e: MessageEvent<Parameters<typeof elabora>[0]>) => {
  try { contesto.postMessage({ blob: await elabora(e.data) }); }
  catch (err) { contesto.postMessage({ errore: err instanceof Error ? err.message : "Immagine non valida" }); }
};
