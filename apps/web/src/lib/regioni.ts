// Copia di apps/bot/regioni.mjs per il backoffice e il menu interno: tenerle allineate.
// Dalla zona di produzione (es. «Sannio», «Bolgheri», «Langhe») alla regione italiana, per raggruppare e filtrare i vini.
// L'ordine conta: le zone più specifiche prima (es. «Montepulciano d'Abruzzo» prima di «Montepulciano» toscano).
const ZONE: [RegExp, string][] = [
  [/\bvalle d aosta\b|\baosta\b/, "Valle d'Aosta"],
  [/\babruzz|\bmontepulciano d abruzzo\b|\bcerasuolo d abruzzo\b|\btrebbiano d abruzzo\b/, "Abruzzo"],
  [/\bcampania\b|\bsannio\b|\btaburno\b|\birpinia\b|\bavellino\b|\btufo\b|\btaurasi\b|\bvesuvio\b|\blacryma\b|\bcampi flegrei\b|\bcilento\b|\bischia\b|\bamalfi\b|\bsorrent|\bgragnano\b|\bbenevent|\bcasert|\bfalerno\b|\baversa\b|\bpompei/, "Campania"],
  [/\bpuglia\b|\bapulia\b|\bsalento\b|\bmanduria\b|\bgioia del colle\b|\bcastel del monte\b|\bbrindisi\b|\blecce\b|\btarant/, "Puglia"],
  [/\bsicilia\b|\bsicily\b|\betna\b|\bvittoria\b|\bpantelleria\b|\bmarsala\b|\bnoto\b|\bmenfi\b|\bterre siciliane\b/, "Sicilia"],
  [/\bsardegna\b|\bsardinia\b|\bgallura\b|\bcannonau\b/, "Sardegna"],
  [/\bbasilicata\b|\bvulture\b/, "Basilicata"],
  [/\bcalabria\b|\bciro\b/, "Calabria"],
  [/\bmolise\b|\btintilia\b/, "Molise"],
  [/\btoscana\b|\btuscany\b|\bchianti\b|\bmontalcino\b|\bmontepulciano\b|\bbolgheri\b|\bmaremma\b|\bmorellino\b|\bcarmignano\b|\bsan gimignano\b|\bsuvereto\b/, "Toscana"],
  [/\bpiemonte\b|\bpiedmont\b|\blanghe\b|\bbarolo\b|\bbarbaresco\b|\broero\b|\bmonferrato\b|\basti\b|\balba\b|\bgavi\b|\bgattinara\b|\bghemme\b/, "Piemonte"],
  [/\bveneto\b|\bvalpolicella\b|\bsoave\b|\bamarone\b|\bprosecco\b|\bconegliano\b|\bvaldobbiadene\b|\bbardolino\b|\bcustoza\b|\bcolli euganei\b/, "Veneto"],
  [/\blombardia\b|\blombardy\b|\bfranciacorta\b|\boltrepo\b|\bvaltellina\b|\blugana\b/, "Lombardia"],
  [/\btrentino\b|\balto adige\b|\bsudtirol\b|\bsuedtirol\b|\bsouth tyrol\b|\btrento\b|\bbolzano\b/, "Trentino-Alto Adige"],
  [/\bfriuli\b|\bcollio\b|\bisonzo\b|\bcolli orientali\b|\bcarso\b/, "Friuli-Venezia Giulia"],
  [/\bemilia\b|\bromagna\b|\blambrusco\b|\bmodena\b|\bcolli piacentini\b/, "Emilia-Romagna"],
  [/\bumbria\b|\bmontefalco\b|\borvieto\b|\btorgiano\b/, "Umbria"],
  [/\bmarche\b|\bverdicchio\b|\bcastelli di jesi\b|\bmatelica\b|\bconero\b|\bpiceno\b/, "Marche"],
  [/\blazio\b|\bfrascati\b|\bcastelli romani\b|\bcesanese\b/, "Lazio"],
  [/\bliguria\b|\bcinque terre\b|\briviera ligure\b/, "Liguria"],
];
const pulisci = (s: unknown) => ` ${String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Regione italiana della zona indicata; se non è riconosciuta resta la zona com'è (es. «Bordeaux»). */
export function regioneDi(zona: string | null | undefined): string {
  const z = String(zona ?? "").trim();
  if (!z) return "";
  const t = pulisci(z);
  return ZONE.find(([re]) => re.test(t))?.[1] ?? z;
}
