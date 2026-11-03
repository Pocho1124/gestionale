/**
 * Preparazione delle immagini prima del caricamento, al riparo da file malevoli:
 * - peso massimo controllato prima di aprire il file;
 * - dimensioni lette dall'intestazione (JPEG, PNG, WebP) senza decodificare: niente «bombe di decompressione»;
 * - una sola decodifica, già alla misura finale, in un Web Worker (la pagina non si blocca);
 * - ricodifica che elimina i metadati (EXIF, posizione GPS).
 */

export const PESO_MASSIMO = 15 * 1024 * 1024;        // file originale
export const PIXEL_MASSIMI = 40_000_000;              // 40 megapixel
const FORMATI = ["image/jpeg", "image/png", "image/webp"];

export interface Opzioni {
  lato: number;              // lato lungo massimo in uscita
  limite: number;            // peso massimo in uscita (byte)
  trasparenza?: boolean;     // true per i loghi: WebP o PNG invece di JPEG
}

/** Larghezza e altezza lette dai primi byte del file; null se il formato non è riconosciuto o è malformato. */
export async function dimensioniDaIntestazione(file: Blob): Promise<{ w: number; h: number } | null> {
  const b = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const u16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  const le16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const le24 = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  if (b.length < 30) return null;
  // PNG: firma + blocco IHDR
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const tipo = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (tipo === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (tipo === "VP8L") { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 }; }
    if (tipo === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1 };
    return null;
  }
  // JPEG: si scorrono i segmenti fino al primo SOF
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      const lung = u16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + lung;
    }
  }
  return null;
}

/** Controlli prima di qualsiasi decodifica. */
export async function verificaFile(file: File): Promise<{ w: number; h: number }> {
  if (!FORMATI.includes(file.type)) throw new Error("Formato non supportato: usa JPG, PNG o WebP.");
  if (file.size > PESO_MASSIMO) throw new Error("File troppo pesante: massimo 15 MB.");
  const d = await dimensioniDaIntestazione(file);
  if (!d || d.w < 1 || d.h < 1) throw new Error("Immagine non valida o danneggiata.");
  if (d.w * d.h > PIXEL_MASSIMI) throw new Error("Immagine troppo grande: massimo 40 megapixel.");
  return d;
}

const PASSI_QUALITA = [0.82, 0.72, 0.62];

/** Prepara l'immagine da caricare: restituisce un file già ridotto, ricodificato e senza metadati. */
export async function preparaImmagine(file: File, opz: Opzioni): Promise<Blob> {
  const { w, h } = await verificaFile(file);
  const scala = Math.min(1, opz.lato / Math.max(w, h));
  const dest = { w: Math.max(1, Math.round(w * scala)), h: Math.max(1, Math.round(h * scala)) };
  const richiesta = { file, dest, limite: opz.limite, trasparenza: !!opz.trasparenza, qualita: PASSI_QUALITA };
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    const w = new Worker(new URL("./immagini.worker.ts", import.meta.url), { type: "module" });
    try {
      return await new Promise<Blob>((ok, ko) => {
        const t = setTimeout(() => ko(new Error("Elaborazione troppo lunga: prova con un'altra immagine.")), 30_000);
        w.onmessage = (e: MessageEvent<{ blob?: Blob; errore?: string }>) => { clearTimeout(t); if (e.data.blob) ok(e.data.blob); else ko(new Error(e.data.errore ?? "Immagine non valida")); };
        w.onerror = () => { clearTimeout(t); ko(new Error("Immagine non valida o danneggiata.")); };
        w.postMessage(richiesta);
      });
    } finally { w.terminate(); }
  }
  return elabora(richiesta);   // browser senza OffscreenCanvas: stesso lavoro sulla pagina
}

/** Decodifica una sola volta alla misura finale e ricodifica fino a stare nel limite (usata dal worker e come riserva). */
export async function elabora(r: { file: Blob; dest: { w: number; h: number }; limite: number; trasparenza: boolean; qualita: number[] }): Promise<Blob> {
  const img = await createImageBitmap(r.file, { resizeWidth: r.dest.w, resizeHeight: r.dest.h, resizeQuality: "high" });
  try {
    const tela = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(r.dest.w, r.dest.h) : Object.assign(document.createElement("canvas"), { width: r.dest.w, height: r.dest.h });
    const ctx = tela.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (!r.trasparenza) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, r.dest.w, r.dest.h); }   // il JPEG non ha trasparenza
    ctx.drawImage(img, 0, 0, r.dest.w, r.dest.h);
    const tipi = r.trasparenza ? ["image/webp", "image/png"] : ["image/jpeg"];
    for (const tipo of tipi) {
      for (const q of r.qualita) {
        // Nel worker HTMLCanvasElement non esiste: si riconosce la tela dal metodo che offre
        const blob = "convertToBlob" in tela
          ? await (tela as OffscreenCanvas).convertToBlob({ type: tipo, quality: q })
          : await new Promise<Blob | null>((ok) => (tela as HTMLCanvasElement).toBlob(ok, tipo, q));
        // Alcuni browser non sanno scrivere WebP e restituiscono PNG: si accetta solo il tipo chiesto
        if (blob && blob.type === tipo && blob.size <= r.limite) return blob;
        if (tipo === "image/png") break;   // il PNG non ha qualità: un solo tentativo
      }
    }
    throw new Error("Immagine troppo pesante anche dopo la riduzione: prova con un'altra.");
  } finally { img.close(); }
}
