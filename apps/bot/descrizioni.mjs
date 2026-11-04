// Descrizioni dei vini per il menu, composte solo da dati verificati (enciclopedia e scheda del vino):
// stile (tipo, corpo, acidità), vitigno e zona, profilo tipico del vitigno, abbinamenti, gradazione. Nessun dettaglio inventato.
const APERTURA = {
  rosso: { leggero: "Rosso agile e di facile beva", medio: "Rosso equilibrato e armonico", strutturato: "Rosso di bella struttura" },
  bianco: { leggero: "Bianco fresco e leggero", medio: "Bianco di buon corpo", strutturato: "Bianco ampio e avvolgente" },
  rosato: { leggero: "Rosato fresco e delicato", medio: "Rosato di buon corpo", strutturato: "Rosato intenso e strutturato" },
  bollicine: { leggero: "Bollicine fresche e vivaci", medio: "Bollicine eleganti", strutturato: "Bollicine di struttura" },
  dolce: { leggero: "Vino dolce e delicato", medio: "Vino dolce e armonico", strutturato: "Vino dolce intenso" },
};
const ACIDITA = { alta: "dalla freschezza vivace", bassa: "dal sorso morbido", media: "" };

/** «a, b e c» */
export const elenco = (voci) => (voci.length <= 1 ? voci.join("") : `${voci.slice(0, -1).join(", ")} e ${voci.at(-1)}`);

export function descriviVino({ tipo, corpo, vitigno, regione, profilo, acidita, gradazione, abbinamenti }) {
  if (!APERTURA[tipo]?.[corpo]) return null;
  const frasi = [];
  const acid = ACIDITA[acidita] ?? "";
  frasi.push(`${APERTURA[tipo][corpo]}${acid ? ` ${acid}` : ""}${vitigno ? `, da uve ${vitigno}` : ""}${regione ? ` (${regione})` : ""}.`);
  if (profilo) frasi.push(`Note di ${profilo}.`);
  const cibi = String(abbinamenti ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3);
  if (cibi.length) frasi.push(`Ideale con ${elenco(cibi)}.`);
  const g = Number(gradazione);
  if (g > 0 && g <= 25) frasi.push(`${g.toLocaleString("it-IT", { maximumFractionDigits: 1 })}% vol.`);
  return frasi.join(" ").slice(0, 500);
}
