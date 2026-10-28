/** Riduce un'immagine e la incorpora come JPEG, provando dimensioni e qualità decrescenti fino a stare nel limite. */
export async function comprimiFoto(file: File, limite: number, passi: readonly (readonly [number, number])[]): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Formato non supportato: usa JPG, PNG o WebP.");
  const img = await createImageBitmap(file);
  for (const [lato, qualita] of passi) {
    const scala = Math.min(1, lato / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.max(1, Math.round(img.width * scala));
    tela.height = Math.max(1, Math.round(img.height * scala));
    const ctx = tela.getContext("2d")!;
    ctx.fillStyle = "#ffffff";                      // il JPEG non ha trasparenza: fondo bianco invece che nero
    ctx.fillRect(0, 0, tela.width, tela.height);
    ctx.drawImage(img, 0, 0, tela.width, tela.height);
    const dati = tela.toDataURL("image/jpeg", qualita);
    if (dati.startsWith("data:image/jpeg;base64,") && dati.length <= limite) return dati;
  }
  throw new Error("Immagine troppo pesante anche dopo la riduzione: prova con un'altra.");
}
