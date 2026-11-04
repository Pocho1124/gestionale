// Conoscenza di base su vini, vitigni e denominazioni (soprattutto italiani), usata per compilare le schede dei vini.
// Dati certi e verificabili al posto delle «invenzioni» di un modello piccolo: l'ordine conta, le voci più specifiche
// vengono prima (es. «Cabernet Sauvignon» prima di «Sauvignon», «Cerasuolo di Vittoria» prima di «Cerasuolo»).
// Ogni voce: [espressione sul testo normalizzato, tipo, corpo, regione, vitigno]
export const VOCI = [
  // ---- Campania
  [/\bgragnano\b|\blettere\b/, "rosso", "leggero", "Campania", "Piedirosso, Aglianico, Sciascinoso"],
  [/\btaurasi\b/, "rosso", "strutturato", "Campania", "Aglianico"],
  [/\baglianico del vulture\b|\bvulture\b/, "rosso", "strutturato", "Basilicata", "Aglianico"],
  [/\baglianico\b/, "rosso", "strutturato", "Campania", "Aglianico"],
  [/\bpiedirosso\b|\bper e palummo\b|\bpere palummo\b/, "rosso", "leggero", "Campania", "Piedirosso"],
  [/\bgreco di tufo\b|\bgreco\b/, "bianco", "medio", "Campania", "Greco"],
  [/\bfiano\b/, "bianco", "medio", "Campania", "Fiano"],
  [/\bfalanghina\b/, "bianco", "leggero", "Campania", "Falanghina"],
  [/\bcoda di volpe\b/, "bianco", "medio", "Campania", "Coda di Volpe"],
  [/\basprinio\b/, "bianco", "leggero", "Campania", "Asprinio"],
  [/\bbiancolella\b|\bforastera\b/, "bianco", "leggero", "Campania", "Biancolella"],
  [/\bpallagrello bianco\b/, "bianco", "medio", "Campania", "Pallagrello bianco"],
  [/\bpallagrello nero\b|\bcasavecchia\b/, "rosso", "strutturato", "Campania", "Pallagrello nero"],
  // ---- Sud e isole
  [/\bprimitivo\b|\bzinfandel\b/, "rosso", "strutturato", "Puglia", "Primitivo"],
  [/\bnegroamaro\b|\bnegro amaro\b|\bsalice salentino\b/, "rosso", "medio", "Puglia", "Negroamaro"],
  [/\bsusumaniello\b/, "rosso", "medio", "Puglia", "Susumaniello"],
  [/\bnero di troia\b/, "rosso", "strutturato", "Puglia", "Nero di Troia"],
  [/\bcerasuolo di vittoria\b/, "rosso", "medio", "Sicilia", "Nero d'Avola, Frappato"],
  [/\bnero d avola\b|\bnero davola\b/, "rosso", "medio", "Sicilia", "Nero d'Avola"],
  [/\bnerello\b|\betna rosso\b/, "rosso", "medio", "Sicilia", "Nerello Mascalese"],
  [/\betna bianco\b|\bcarricante\b/, "bianco", "medio", "Sicilia", "Carricante"],
  [/\bfrappato\b/, "rosso", "leggero", "Sicilia", "Frappato"],
  [/\bgrillo\b/, "bianco", "medio", "Sicilia", "Grillo"],
  [/\binzolia\b|\binsolia\b|\bcatarratto\b/, "bianco", "leggero", "Sicilia", ""],
  [/\bpassito di pantelleria\b|\bzibibbo\b/, "dolce", "strutturato", "Sicilia", "Zibibbo"],
  [/\bmarsala\b/, "dolce", "strutturato", "Sicilia", ""],
  [/\bcannonau\b/, "rosso", "medio", "Sardegna", "Cannonau"],
  [/\bcarignano\b/, "rosso", "medio", "Sardegna", "Carignano"],
  [/\bvermentino\b/, "bianco", "leggero", "Sardegna", "Vermentino"],
  [/\bciro\b|\bgaglioppo\b/, "rosso", "medio", "Calabria", "Gaglioppo"],
  [/\btintilia\b/, "rosso", "medio", "Molise", "Tintilia"],
  // ---- Centro
  [/\bcerasuolo d abruzzo\b|\bcerasuolo\b/, "rosato", "medio", "Abruzzo", "Montepulciano"],
  [/\bvino nobile\b|\bnobile di montepulciano\b/, "rosso", "strutturato", "Toscana", "Sangiovese"],
  [/\bmontepulciano\b/, "rosso", "medio", "Abruzzo", "Montepulciano"],
  [/\bpecorino\b/, "bianco", "medio", "Abruzzo", "Pecorino"],
  [/\btrebbiano\b/, "bianco", "leggero", "Abruzzo", "Trebbiano"],
  [/\bpasserina\b/, "bianco", "leggero", "Marche", "Passerina"],
  [/\bverdicchio\b/, "bianco", "medio", "Marche", "Verdicchio"],
  [/\bsagrantino\b/, "rosso", "strutturato", "Umbria", "Sagrantino"],
  [/\bbrunello\b/, "rosso", "strutturato", "Toscana", "Sangiovese"],
  [/\brosso di montalcino\b|\bmorellino\b|\bchianti\b|\bsangiovese\b/, "rosso", "medio", "Toscana", "Sangiovese"],
  [/\bbolgheri\b|\bsupertuscan\b|\bsuper tuscan\b/, "rosso", "strutturato", "Toscana", ""],
  [/\bvin santo\b|\bvinsanto\b/, "dolce", "strutturato", "Toscana", ""],
  [/\bvernaccia\b/, "bianco", "medio", "Toscana", "Vernaccia"],
  [/\bciliegiolo\b/, "rosso", "leggero", "Toscana", "Ciliegiolo"],
  [/\blambrusco\b/, "rosso", "leggero", "Emilia-Romagna", "Lambrusco"],
  [/\bgutturnio\b|\bbonarda\b/, "rosso", "leggero", "Emilia-Romagna", ""],
  [/\balbana\b/, "bianco", "medio", "Emilia-Romagna", "Albana"],
  // ---- Nord
  [/\bbarolo\b|\bbarbaresco\b/, "rosso", "strutturato", "Piemonte", "Nebbiolo"],
  [/\bnebbiolo\b|\bvaltellina\b|\bsforzato\b/, "rosso", "strutturato", "Piemonte", "Nebbiolo"],
  [/\bbarbera\b/, "rosso", "medio", "Piemonte", "Barbera"],
  [/\bdolcetto\b|\bgrignolino\b|\bfreisa\b/, "rosso", "leggero", "Piemonte", ""],
  [/\bmoscato d asti\b|\bbrachetto\b/, "dolce", "leggero", "Piemonte", ""],
  [/\bgavi\b|\bcortese\b|\barneis\b|\broero\b|\berbaluce\b/, "bianco", "leggero", "Piemonte", ""],
  [/\btimorasso\b/, "bianco", "medio", "Piemonte", "Timorasso"],
  [/\bamarone\b/, "rosso", "strutturato", "Veneto", "Corvina"],
  [/\bripasso\b/, "rosso", "medio", "Veneto", "Corvina"],
  [/\bvalpolicella\b|\bbardolino\b|\bcorvina\b/, "rosso", "leggero", "Veneto", "Corvina"],
  [/\brecioto\b/, "dolce", "strutturato", "Veneto", ""],
  [/\bprosecco\b|\bglera\b/, "bollicine", "leggero", "Veneto", "Glera"],
  [/\bsoave\b|\bgarganega\b/, "bianco", "leggero", "Veneto", "Garganega"],
  [/\blugana\b|\bturbiana\b/, "bianco", "medio", "Lombardia", "Turbiana"],
  [/\bfranciacorta\b|\btrentodoc\b|\btrento doc\b|\boltrepo pavese metodo classico\b/, "bollicine", "medio", "Lombardia", ""],
  [/\blagrein\b/, "rosso", "medio", "Alto Adige", "Lagrein"],
  [/\bschiava\b|\bvernatsch\b/, "rosso", "leggero", "Alto Adige", "Schiava"],
  [/\bteroldego\b/, "rosso", "medio", "Trentino", "Teroldego"],
  [/\brefosco\b/, "rosso", "medio", "Friuli", "Refosco"],
  [/\bgewurztraminer\b|\bgewuerztraminer\b|\btraminer\b/, "bianco", "medio", "Alto Adige", "Gewürztraminer"],
  [/\bmuller thurgau\b|\bmueller thurgau\b/, "bianco", "leggero", "Trentino", "Müller-Thurgau"],
  [/\bkerner\b|\bsylvaner\b/, "bianco", "leggero", "Alto Adige", ""],
  [/\bribolla\b/, "bianco", "leggero", "Friuli", "Ribolla Gialla"],
  [/\bfriulano\b/, "bianco", "medio", "Friuli", "Friulano"],
  [/\bpinot grigio\b|\bpinot gris\b/, "bianco", "leggero", "", "Pinot grigio"],
  [/\bpinot bianco\b|\bpinot blanc\b/, "bianco", "leggero", "", "Pinot bianco"],
  [/\bpinot nero\b|\bpinot noir\b/, "rosso", "medio", "", "Pinot nero"],
  // ---- Vitigni internazionali (dopo quelli specifici)
  [/\bcabernet sauvignon\b/, "rosso", "strutturato", "", "Cabernet Sauvignon"],
  [/\bcabernet franc\b|\bcabernet\b/, "rosso", "medio", "", "Cabernet Franc"],
  [/\bmerlot\b/, "rosso", "medio", "", "Merlot"],
  [/\bsyrah\b|\bshiraz\b/, "rosso", "strutturato", "", "Syrah"],
  [/\bmalbec\b/, "rosso", "strutturato", "", "Malbec"],
  [/\btempranillo\b|\brioja\b/, "rosso", "medio", "Spagna", "Tempranillo"],
  [/\bsauvignon blanc\b|\bsauvignon\b/, "bianco", "leggero", "", "Sauvignon"],
  [/\bchardonnay\b/, "bianco", "medio", "", "Chardonnay"],
  [/\briesling\b/, "bianco", "leggero", "", "Riesling"],
  [/\bviognier\b/, "bianco", "medio", "", "Viognier"],
  [/\bchampagne\b/, "bollicine", "medio", "Francia", ""],
  [/\bcava\b/, "bollicine", "leggero", "Spagna", ""],
  [/\bporto\b|\bport wine\b|\bsherry\b|\bmadeira\b/, "dolce", "strutturato", "", ""],
  [/\bsauternes\b|\btokaji\b|\bicewine\b/, "dolce", "strutturato", "", ""],
  [/\bmoscato\b|\bmalvasia\b/, "dolce", "leggero", "", ""],
  // ---- Indicazioni generiche (ultime)
  [/\bpassito\b|\bvino dolce\b|\bda dessert\b|\bda meditazione\b/, "dolce", "strutturato", "", ""],
  [/\bspumante\b|\bmetodo classico\b|\bbrut\b|\bpas dose\b|\bbollicin/, "bollicine", "medio", "", ""],
  [/\brosato\b|\brose\b|\brosé\b/, "rosato", "leggero", "", ""],
];

const TIPI_TESTO = [[/\bvino rosso\b|\brosso\b/, "rosso"], [/\bvino bianco\b|\bbianco\b/, "bianco"], [/\brosato\b/, "rosato"],
  [/\bspumante\b|\bbollicin|\bfrizzante\b/, "bollicine"], [/\bdolce\b|\bpassito\b/, "dolce"]];
const CORPI_TESTO = [[/\bstrutturat|\bcorpos|\bintens|\bpotente\b|\bimportante\b|\btannic/, "strutturato"],
  [/\bleggero\b|\bfresco\b|\bbeverin|\bdelicat|\bvivace\b/, "leggero"]];

/**
 * Scheda di un vino dal suo nome e dalla descrizione.
 * «riconosciuto»: vitigno o denominazione noti; «descrizione»: solo dalle parole della descrizione; null: non riconosciuto.
 */
export function riconosciVino(nome, descrizione, norm) {
  const testoNome = ` ${norm(nome)} `;
  const testoTutto = ` ${norm(`${nome} ${descrizione ?? ""}`)} `;
  for (const testo of [testoNome, testoTutto]) {          // prima il nome, che è il dato più affidabile
    for (const [re, tipo, corpo, regione, vitigno] of VOCI) {
      if (re.test(testo)) return { tipo, corpo, regione, vitigno, fonte: "riconosciuto" };   // il corpo tipico del vitigno, non le parole della descrizione
    }
  }
  const d = ` ${norm(descrizione ?? "")} `;
  const tipo = TIPI_TESTO.find(([re]) => re.test(d))?.[1];
  if (!tipo) return null;
  return { tipo, corpo: corpoDaTesto(d) ?? "medio", regione: "", vitigno: "", fonte: "descrizione" };
}

const corpoDaTesto = (d) => CORPI_TESTO.find(([re]) => re.test(` ${d} `))?.[1] ?? null;
