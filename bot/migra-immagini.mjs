// Sposta nell'archivio (Supabase Storage) le immagini ancora salvate in base64 nel database.
// Si lancia una volta dall'installer dell'archivio; è ripetibile: salta ciò che è già migrato.
import { randomUUID } from "node:crypto";

const obbligatoria = (n) => { const v = process.env[n]; if (!v) { console.error(`Manca ${n}`); process.exit(1); } return v; };
const REST = obbligatoria("SUPABASE_URL").replace(/\/$/, "");
const ARCHIVIO = (process.env.ARCHIVIO_URL || "http://immagini:5000").replace(/\/$/, "");
const CHIAVE = obbligatoria("SERVICE_KEY");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const intestazioni = { apikey: CHIAVE, Authorization: `Bearer ${CHIAVE}` };

async function rest(percorso, opz = {}) {
  const r = await fetch(`${REST}/rest/v1/${percorso}`, { ...opz, headers: { ...intestazioni, "Content-Type": "application/json", ...(opz.headers ?? {}) } });
  if (!r.ok) throw new Error(`${percorso}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/** Carica un data URI nell'archivio del locale e restituisce il percorso. */
async function carica(localeId, cartella, dati) {
  if (!UUID.test(localeId)) throw new Error("locale non valido");
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dati);
  if (!m) throw new Error("formato non riconosciuto");
  const corpo = Buffer.from(m[2], "base64");
  if (corpo.length > 2 * 1024 * 1024) throw new Error("oltre 2 MB");
  const est = m[1] === "jpeg" ? "jpg" : m[1];
  const percorso = `${localeId}/${cartella}/${randomUUID()}.${est}`;
  const r = await fetch(`${ARCHIVIO}/object/immagini/${percorso}`, {
    method: "POST", body: corpo,
    headers: { ...intestazioni, "Content-Type": `image/${m[1]}`, "cache-control": "max-age=31536000", "x-upsert": "false" },
  });
  if (!r.ok) throw new Error(`archivio: ${r.status} ${await r.text()}`);
  return percorso;
}

let spostate = 0, errori = 0;
async function prova(descrizione, fn) {
  try { await fn(); spostate++; console.log(`✓ ${descrizione}`); }
  catch (e) { errori++; console.error(`✗ ${descrizione}: ${e.message}`); }
}

for (const a of await rest("aspetto?select=locale_id,logo_dati,logo_path,sfondo_dati,sfondo_path")) {
  if (a.logo_dati && !a.logo_path) await prova(`logo del locale ${a.locale_id}`, async () => {
    const p = await carica(a.locale_id, "logo", a.logo_dati);
    await rest(`aspetto?locale_id=eq.${a.locale_id}`, { method: "PATCH", body: JSON.stringify({ logo_path: p, logo_dati: null }) });
  });
  if (a.sfondo_dati && !a.sfondo_path) await prova(`sfondo del locale ${a.locale_id}`, async () => {
    const p = await carica(a.locale_id, "sfondo", a.sfondo_dati);
    await rest(`aspetto?locale_id=eq.${a.locale_id}`, { method: "PATCH", body: JSON.stringify({ sfondo_path: p, sfondo_dati: null }) });
  });
}
for (const s of await rest("sale?select=id,locale_id,sfondo_dati,sfondo_path&sfondo_dati=not.is.null&sfondo_path=is.null")) {
  await prova(`planimetria della sala ${s.id}`, async () => {
    const p = await carica(s.locale_id, "sale", s.sfondo_dati);
    await rest(`sale?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ sfondo_path: p, sfondo_dati: null }) });
  });
}
for (const f of await rest("foto_prodotti?select=prodotto_id,locale_id,dati,path&dati=not.is.null&path=is.null")) {
  await prova(`foto del piatto ${f.prodotto_id}`, async () => {
    const p = await carica(f.locale_id, "piatti", f.dati);
    await rest(`foto_prodotti?prodotto_id=eq.${f.prodotto_id}`, { method: "PATCH", body: JSON.stringify({ path: p, dati: null }) });
  });
}
console.log(`Immagini spostate nell'archivio: ${spostate}${errori ? ` · non riuscite: ${errori}` : ""}`);
process.exit(errori ? 1 : 0);
