import { randomUUID } from "node:crypto";
import { riconosciVino } from "./vitigni.mjs";
import { descriviVino } from "./descrizioni.mjs";
import { regioneDi } from "./regioni.mjs";
import { traduciMenu } from "./traduttore.mjs";
// Bot Telegram privato del gestionale.
// Interpreta le richieste (prima con regole, poi con il modello locale Ollama), mostra un'anteprima
// e applica la modifica solo dopo conferma, con l'account dedicato del bot (permessi RLS, audit).
// Nessuna dipendenza esterna: Node 22 (fetch nativo). Configurazione da variabili d'ambiente.

// Ogni identificativo inserito nei percorsi del database deve essere un UUID: niente filtri iniettati nell'URL
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v) {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error("identificativo non valido");
  return v;
}
const TABELLE_ANNULLA = new Set(["prodotti", "categorie", "vini", "abbinamenti", "foto_prodotti", "enciclopedia_vini"]);
function uuidConfigurazione(nome) {
  const v = (process.env[nome] ?? "").trim();
  if (!UUID.test(v)) { console.error(`${nome} mancante o non valido: deve essere l'UUID del locale`); process.exit(1); }
  return v;
}

const C = {
  token: obbligatoria("TELEGRAM_TOKEN"),
  utenti: new Set(obbligatoria("TELEGRAM_UTENTI").split(",").map((s) => s.trim()).filter(Boolean)),
  url: obbligatoria("SUPABASE_URL").replace(/\/$/, ""),
  anon: obbligatoria("SUPABASE_ANON_KEY"),
  email: obbligatoria("BOT_EMAIL"),
  password: obbligatoria("BOT_PASSWORD"),
  locale: uuidConfigurazione("LOCALE_ID"),
  // Motore dell'IA locale: «ollama» (predefinito) oppure «llamacpp» (llama-server, API compatibile OpenAI)
  llm: (process.env.LLM_TIPO || "ollama").toLowerCase(),
  ollama: (process.env.LLM_URL || process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, ""),
  modello: process.env.LLM_MODELLO || process.env.OLLAMA_MODELLO || "qwen2.5:3b",
  trascrizione: (process.env.TRASCRIZIONE_URL || "http://trascrizione:9000").replace(/\/$/, ""),
  pubblicatore: (process.env.PUBBLICATORE_URL || "http://pubblicatore:8090").replace(/\/$/, ""),
  archivio: (process.env.ARCHIVIO_URL || "http://immagini:5000").replace(/\/$/, ""),
};

/** Chiede al pubblicatore di aggiornare subito il menu pubblico (se non è installato, nessun problema). */
const aggiornaMenuPubblico = () => fetch(`${C.pubblicatore}/ora`, { method: "POST", signal: AbortSignal.timeout(3000) }).catch(() => {});

function obbligatoria(nome) {
  const v = process.env[nome];
  if (!v) { console.error(`Variabile mancante: ${nome}`); process.exit(1); }
  return v;
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const TG = `https://api.telegram.org/bot${C.token}`;
const euro = (c) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
const arrotonda10 = (c, pct) => Math.max(0, Math.round((c * (1 + pct / 100)) / 10) * 10);

// ---------------------------------------------------------------- Telegram
async function tg(metodo, corpo) {
  const r = await fetch(`${TG}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo ?? {}), signal: AbortSignal.timeout(70_000),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description}`);
  return j.result;
}
const invia = (chat, testo, extra = {}) => tg("sendMessage", { chat_id: chat, text: testo, ...extra });

// ---------------------------------------------------------------- Supabase (con l'account del bot)
let sessione = { token: null, scade: 0 };

async function jwt() {
  if (sessione.token && Date.now() < sessione.scade) return sessione.token;
  const r = await fetch(`${C.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: C.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: C.email, password: C.password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Accesso del bot non riuscito: ${j.error_description || j.msg || r.status}`);
  sessione = { token: j.access_token, scade: Date.now() + (j.expires_in - 120) * 1000 };
  return sessione.token;
}

async function db(percorso, { metodo = "GET", corpo, unisci = false } = {}) {
  const r = await fetch(`${C.url}/rest/v1/${percorso}`, {
    method: metodo,
    headers: {
      apikey: C.anon, Authorization: `Bearer ${await jwt()}`,
      "Content-Type": "application/json", Prefer: `return=representation${unisci ? ",resolution=merge-duplicates" : ""}`,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const testo = await r.text();
  const dati = testo ? JSON.parse(testo) : null;
  if (!r.ok) {
    const msg = dati?.code === "42501" ? "permesso negato per l'account del bot" : dati?.message || `errore ${r.status}`;
    throw new Error(msg);
  }
  return dati;
}

async function catalogo() {
  const [categorie, prodotti, vini, abbinamenti] = await Promise.all([
    db(`categorie?select=id,nome,posizione&locale_id=eq.${C.locale}&order=posizione,nome`),
    db(`prodotti?select=id,nome,descrizione,prezzo_cent,disponibile,visibile,categoria_id,posizione&locale_id=eq.${C.locale}&order=posizione,nome`),
    db(`vini?select=*&locale_id=eq.${C.locale}`),
    db(`abbinamenti?select=piatto_id,vino_id,motivo&locale_id=eq.${C.locale}`),
  ]);
  return { categorie, prodotti, vini: new Map(vini.map((v) => [v.prodotto_id, v])), abbinamenti };
}

// ---------------------------------------------------------------- Interprete a regole
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9%.,€ ]+/g, " ").replace(/\s+/g, " ").trim();
const radice = (p) => (p.length > 3 ? p.replace(/[aeio]$/, "") : p);
const VUOTE = new Set(["alla", "alle", "allo", "agli", "dell", "della", "delle", "dello", "con", "per", "senza", "the"]);
const radici = (s) => norm(s).split(" ").filter((p) => p.length >= 3 && !VUOTE.has(p)).map(radice);

/** Trova l'elemento il cui nome compare nel testo: prima per sottostringa (il più lungo), poi per parole. */
function trova(testo, elementi) {
  const t = norm(testo);
  const diretti = elementi.filter((e) => t.includes(norm(e.nome))).sort((a, b) => b.nome.length - a.nome.length);
  if (diretti.length) return diretti[0];
  const parole = new Set(radici(testo));
  // Vale se copre metà del nome oppure se coincide una parola distintiva (es. «vongole» per «Spaghetti alle vongole»)
  const punteggi = elementi.map((e) => {
    const r = radici(e.nome);
    const comuni = r.filter((x) => parole.has(x));
    return { e, s: r.length ? comuni.length / r.length : 0, forte: comuni.some((x) => x.length >= 5) };
  }).filter((x) => x.s >= 0.5 || x.forte).sort((a, b) => b.s - a.s);
  if (punteggi.length && (punteggi.length === 1 || punteggi[0].s > punteggi[1].s)) return punteggi[0].e;
  return null;
}

const numero = (s) => Number(s.replace(",", "."));

/** Prodotti il cui nome intero compare nel testo, dal più lungo, senza sovrapposizioni; «resto» è il testo rimanente. */
function nomiNelTesto(testo, elementi) {
  let t = ` ${norm(testo)} `;
  const trovati = [];
  for (const e of [...elementi].sort((a, b) => b.nome.length - a.nome.length)) {
    const n = ` ${norm(e.nome)} `;
    if (n.trim().length >= 3 && t.includes(n)) { trovati.push(e); t = t.replace(n, " | "); }
  }
  return { trovati, resto: t };
}
const TUTTO = /\b(tutto|tutti|tutte|intero menu|tutto il menu)\b/;

const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pulisci = (s) => s.replace(/\s*(€|euro|eur)\s*$/i, "").replace(/\s+/g, " ").replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RIGA_PREZZO = /^(.*?)[\s\-–—:.]*?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?\s*$/i;

/** Elenco incollato: righe «Nome - 6,50» (opzionale «| descrizione»), righe senza prezzo = categoria. */
export function interpretaElenco(testo, cat) {
  const righe = testo.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (righe.length < 2) return null;
  const voci = [];
  let categoria = null;
  for (const r of righe.slice(0, 100)) {
    const [corpo, descrizione = ""] = r.split("|").map((x) => x.trim());
    const m = corpo.match(RIGA_PREZZO);
    if (m && m[1] && /[a-zà-ü]/i.test(m[1])) {
      voci.push({ nome: maiuscola(pulisci(m[1])).slice(0, 120), euro: numero(m[2]), descrizione: descrizione.slice(0, 500), categoria });
    } else if (!/\d/.test(corpo)) {
      const nome = maiuscola(pulisci(corpo.replace(/^categoria\s*:?\s*/i, ""))).slice(0, 80);
      categoria = cat.categorie.find((c) => norm(c.nome) === norm(nome)) ?? { nuova: true, nome };
    }
  }
  if (voci.length < 2) return null;
  return voci.some((v) => !v.categoria)
    ? { azione: "chiedi_categoria", per: "importa", voci }
    : { azione: "importa", voci };
}

/** «aggiungi alle pizze rosse la diavola a 8 euro con salame piccante» */
function interpretaNuovoPiatto(testo, cat) {
  if (!/^\s*(aggiungi|inserisci|crea|nuovo piatto|metti nel menu)\b/i.test(testo)) return null;
  let resto = testo;
  let descrizione = "";
  // Descrizione: «descrizione: …», «con …» oppure «: …», anche su più righe
  const con = resto.match(/\s*\bdescrizione\b\s*:?\s*([\s\S]+)$/i) ?? resto.match(/\s(?:con|:)\s+([\s\S]+)$/i);
  if (con) { descrizione = pulisci(con[1].replace(/\s+/g, " ")); resto = resto.slice(0, con.index); }
  const prezzo = resto.match(/\s(?:a|da|al prezzo di|prezzo)\s+(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?(?![a-z0-9])/i)
    || resto.match(/\s(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)(?![a-z0-9])/i);
  if (!prezzo) return null;
  resto = resto.slice(0, prezzo.index) + " " + resto.slice(prezzo.index + prezzo[0].length);
  const categoria = trova(resto, cat.categorie);
  if (categoria) resto = resto.replace(new RegExp(escapeRe(categoria.nome), "i"), " ");
  resto = resto.replace(/^\s*(aggiungi|inserisci|crea|nuovo piatto|metti nel menu)\b/i, " ")
    .replace(/\b(alle|alla|allo|ai|agli|al|nelle|nella|nello|nei|negli|nel|in|tra|fra|categoria)\b/gi, " ")
    .replace(/^\s*(il|la|lo|l'|i|le|gli|un|una|uno)\s+/i, " ");
  const nome = maiuscola(pulisci(resto.replace(/^\s*(il|la|lo|l'|i|le|gli|un|una|uno)\s+/i, ""))).slice(0, 120);
  if (!nome || nome.length < 2) return null;
  const piatto = { nome, euro: numero(prezzo[1]), descrizione: descrizione.slice(0, 500) };
  return categoria ? { azione: "aggiungi_piatto", ...piatto, categoria } : { azione: "chiedi_categoria", per: "aggiungi_piatto", ...piatto };
}

const REGIONI = ["Valle d'Aosta", "Piemonte", "Lombardia", "Trentino", "Alto Adige", "Veneto", "Friuli", "Liguria", "Emilia",
  "Romagna", "Toscana", "Umbria", "Marche", "Lazio", "Abruzzo", "Molise", "Campania", "Puglia", "Basilicata", "Calabria",
  "Sicilia", "Sardegna", "Francia", "Spagna", "Germania", "Portogallo"];

/** «rosso, strutturato, Campania, vitigno Aglianico, cantina X, annata 2020, bottiglia 28 euro, note ciliegia e spezie» */
export function leggiSchedaVino(testo) {
  const t = norm(testo);
  const campi = {};
  const tipo = t.match(/\b(rosso|bianco|rosato|bollicine|spumante|prosecco|champagne|franciacorta|dolce|passito)\b/);
  if (tipo) campi.tipo = { spumante: "bollicine", prosecco: "bollicine", champagne: "bollicine", franciacorta: "bollicine", passito: "dolce" }[tipo[1]] ?? tipo[1];
  const corpo = t.match(/\b(leggero|fresco|medio|equilibrato|strutturato|corposo|intenso|robusto)\b/);
  if (corpo) campi.corpo = { fresco: "leggero", equilibrato: "medio", corposo: "strutturato", intenso: "strutturato", robusto: "strutturato" }[corpo[1]] ?? corpo[1];
  const bottiglia = testo.match(/bottiglia\s*(?:a|da)?\s*(\d{1,5}(?:[.,]\d{1,2})?)/i);
  if (bottiglia) campi.prezzo_bottiglia_cent = Math.round(numero(bottiglia[1]) * 100);
  const annata = testo.match(/\b(19[5-9]\d|20\d{2})\b/);
  if (annata) campi.annata = Number(annata[1]);
  const testoSenzaNote = testo.replace(/\bnote?\b\s*:?.*$/is, "");
  for (const [chiave, re] of [["cantina", /cantina\s+([^,;]+)/i], ["vitigno", /vitign[oi]\s+([^,;]+)/i]]) {
    const m = testoSenzaNote.match(re);
    if (m) campi[chiave] = pulisci(m[1]).slice(0, 80);
  }
  const regione = REGIONI.find((r) => t.includes(norm(r))) ?? testoSenzaNote.match(/regione\s+([^,;]+)/i)?.[1];
  if (regione) campi.regione = pulisci(regione).slice(0, 60);
  const note = testo.match(/\bnote?\b\s*:?\s*(.+)$/is);
  if (note) campi.note = pulisci(note[1]).slice(0, 300);
  return campi;
}

const VERBO_AGGIUNTA = /^(?:\S+\s+){0,3}?(aggiung\w*|inserisc\w*|inserire|metti|mettere|carica|caricare)\b/i;
const PREZZO_COMUNE = /[.;,]?\s*\b(?:tutt[ei]|ciascun[oa]|cadaun[oa]|ognun[oa]|l\W?un[oa])\b[^\n\d]{0,25}?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?[^\n]*$/im;
const PREZZO_COMUNE_DOPO = /\s+(?:a\s+)?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?\s+(?:l\W?un[oa]|ciascun[oa]|cadaun[oa]|ognun[oa])\b[^\n]*$/im;

/**
 * Più prodotti in un messaggio: «aggiungi in birre: Amaranta, Andromeda e Mida a 6 € l'una»,
 * oppure un elenco su più righe, con prezzo per riga o comune. I prezzi non si inventano mai: se mancano, si chiedono.
 */
export function interpretaAggiuntaMultipla(testo, cat) {
  if (!VERBO_AGGIUNTA.test(testo)) return null;
  // Categoria: quella il cui nome compare nell'intestazione (prima dei «:» o nella prima riga)
  const due = testo.indexOf(":");
  const intestazione = due > 0 ? testo.slice(0, due) : testo.split(/\r?\n/)[0];
  // Un solo prodotto con prezzo e descrizione («aggiungi X … a 34 euro descrizione: …»): non è un elenco
  if (due > 0 && (/\d/.test(intestazione) || /\bdescrizion\w*\s*$/i.test(intestazione.trim()))) return null;
  const ti = ` ${norm(intestazione)} `;
  const categoria = [...cat.categorie].sort((a, b) => b.nome.length - a.nome.length).find((c) => {
    const n = norm(c.nome);
    return ti.includes(` ${n} `) || (!n.includes(" ") && ti.split(" ").some((w) => w.length > 3 && radice(w) === radice(n)));
  }) ?? null;
  // Prezzo comune («tutte a 6 €», «6 euro l'una»)
  let corpo = due > 0 ? testo.slice(due + 1) : testo;
  let comune = null;
  const pc = corpo.match(PREZZO_COMUNE) ?? corpo.match(PREZZO_COMUNE_DOPO);
  if (pc) { comune = numero(pc[1]); corpo = corpo.slice(0, pc.index); }
  if (due < 0) {
    // Senza «:»: le voci iniziano dopo il nome della categoria (o dopo il verbo)
    const nc = categoria ? norm(corpo).indexOf(norm(categoria.nome)) : -1;
    const parole = corpo.split(/\s+/);
    let salta = 0, acc = "";
    if (nc >= 0) { for (const w of parole) { acc = norm(`${acc} ${w}`); salta++; if (acc.length >= nc + norm(categoria.nome).length) break; } }
    else { const m = corpo.match(VERBO_AGGIUNTA); salta = m ? m[0].split(/\s+/).length : 0; }
    corpo = parole.slice(salta).join(" ");
  }
  const pezzi = (/\r?\n/.test(corpo.trim()) ? corpo.split(/\r?\n/) : corpo.split(/\s*;\s*|\s*,(?!\d)\s*|\s+e\s+/i))   // «6,50» non si spezza
    .map((x) => x.replace(/^\s*(?:[-•*]\s*)?(?:anche\s+)?(?:(?:le|i|gli|la|il)\s+seguenti\s+\S+\s*)?/i, "").trim()).filter(Boolean);
  const voci = [];
  for (const pz of pezzi.slice(0, 40)) {
    const m = pz.match(RIGA_PREZZO);
    const conPrezzo = m && m[1] && /[a-zà-ü]/i.test(m[1]);
    const nome = maiuscola(pulisci((conPrezzo ? m[1] : pz).replace(/\s+a$/i, ""))).slice(0, 120);
    if (!/[a-zà-ü]/i.test(nome) || nome.length > 60 || VERBO_AGGIUNTA.test(nome)) continue;
    voci.push({ nome, euro: conPrezzo ? numero(m[2]) : null, descrizione: "", categoria });
  }
  if (voci.length < 2) return null;
  // «Andromeda, Mida a 6 €»: un solo prezzo, sull'ultima voce, vale per tutte
  const conP = voci.filter((v) => v.euro);
  if (comune === null && conP.length === 1 && voci.at(-1).euro && /\sa\s+\d/i.test(pezzi.at(-1))) comune = voci.at(-1).euro;
  for (const v of voci) if (comune !== null && !v.euro) v.euro = comune;
  if (comune !== null && voci.at(-1).euro === comune) for (const v of voci) v.euro = v.euro ?? comune;
  // Già presenti nella categoria: non si duplicano
  const esistenti = categoria ? new Set(cat.prodotti.filter((p) => p.categoria_id === categoria.id).map((p) => norm(p.nome))) : new Set();
  const nuove = voci.filter((v) => !esistenti.has(norm(v.nome)));
  const gia = voci.filter((v) => esistenti.has(norm(v.nome))).map((v) => v.nome);
  if (!nuove.length) return { azione: "chiarisci", testo: `Sono già tutti in «${categoria.nome}»: ${gia.join(", ")}.` };
  if (nuove.some((v) => !v.euro)) return { azione: "chiedi_prezzi", voci: nuove, categoria, gia };
  return categoria ? { azione: "importa", voci: nuove, gia } : { azione: "chiedi_categoria", per: "importa", voci: nuove, gia };
}

export function interpretaConRegole(testo, cat) {
  const multipla = interpretaAggiuntaMultipla(testo, cat);
  if (multipla) return multipla;
  const elenco = interpretaElenco(testo, cat);
  if (elenco) return elenco;
  const t = norm(testo);
  const prodotto = () => trova(testo, cat.prodotti);

  const descr = testo.match(/^\s*descrizione\s+(?:della|dello|del|dei|degli|delle|di|per|alla|al|la|il)?\s*(.+?)\s*[:\-–]\s*(.+)$/is);
  if (descr) {
    const p = trova(descr[1], cat.prodotti);
    return p ? { azione: "imposta_descrizione", prodotto: p, testo: descr[2].trim().slice(0, 500) } : { azione: "non_trovato", cosa: descr[1] };
  }
  const viaFoto = testo.match(/^\s*(?:togli|rimuovi|elimina|cancella)\s+(?:la\s+)?foto\s+(?:della|dello|del|di|alla|al|a)?\s*(.+)$/i);
  if (viaFoto) {
    const p = trova(viaFoto[1], cat.prodotti);
    return p ? { azione: "rimuovi_foto", prodotto: p } : { azione: "non_trovato", cosa: viaFoto[1] };
  }

  // --- Sommelier: scheda vino, abbinamenti, suggerimenti dell'IA
  if (/^\s*(suggerisci|proponi|consigliami|trova|fammi|dammi)\b.*\babbinament/i.test(testo)) return { azione: "suggerisci_abbinamenti" };
  if (/^\s*(completa|compila|genera|crea|prepara|riempi|aggiorna)\b.*\bsched[ae]\b.*\bvin[oi]\b/i.test(testo)) return { azione: "completa_schede_vini" };
  // «descrizioni … vini» in qualsiasi forma (anche dai vocali: «riscrimi», «rescrivi», «puoi rifare…»), ma non «descrizione Nome: …»
  if ((/\bdescrizion\w*\b.*\bvin[oi]\b/i.test(testo) && !testo.includes(":")) || /^\s*descrivi\s+(i\s+|tutti\s+i\s+)?vini\b/i.test(testo)) {
    return { azione: "descrivi_vini", tutti: /\b(tutt[ei]|r[ie]scri\w*|rifa\w*|miglior\w*|aggiorn\w*|sistem\w*)\b/i.test(testo) };
  }
  const enc = testo.match(/^\s*(?:enciclopedia|aggiungi\s+all'?\s*enciclopedia)\s+(.+?)\s*:\s*(.+)$/is);
  if (enc) {
    const campi = leggiSchedaVino(enc[2]);
    if (!campi.tipo) return { azione: "chiarisci", testo: "Indica almeno il tipo: rosso, bianco, rosato, bollicine o dolce. Esempio: «enciclopedia Rubrato: rosso, strutturato, Campania, vitigno Aglianico, cantina Feudi di San Gregorio»." };
    const nome = maiuscola(pulisci(enc[1])).slice(0, 160);
    return { azione: "aggiungi_enciclopedia", nome, campi: { corpo: "medio", ...campi }, prodotto: trova(nome, cat.prodotti) && !cat.vini?.has(trova(nome, cat.prodotti).id) ? trova(nome, cat.prodotti) : null };
  }
  const vino = testo.match(/^\s*vino\s+(.+?)\s*:\s*(.+)$/is);
  if (vino) {
    const p = trova(vino[1], cat.prodotti);
    if (!p) return { azione: "non_trovato", cosa: vino[1] };
    const campi = leggiSchedaVino(vino[2]);
    if (!campi.tipo && !cat.vini?.has(p.id)) return { azione: "chiarisci", testo: "Indica il tipo del vino: rosso, bianco, rosato, bollicine o dolce. Esempio: «vino Aglianico: rosso, strutturato, Campania, bottiglia 28 euro»." };
    return { azione: "imposta_vino", prodotto: p, campi };
  }
  const viaAbb = testo.match(/^\s*(?:togli|rimuovi|elimina|cancella)\s+(?:l'|l |gli )?abbinament[oi]\s+(?:tra\s+)?(.+?)\s+(?:e|con|a|al|alla|allo|ai|alle|dal|dalla)\s+(.+)$/i);
  if (viaAbb) {
    const a = trova(viaAbb[1], cat.prodotti), b = trova(viaAbb[2], cat.prodotti);
    if (!a || !b) return { azione: "non_trovato", cosa: !a ? viaAbb[1] : viaAbb[2] };
    const [piatto, v] = cat.vini?.has(a.id) ? [b, a] : [a, b];
    return { azione: "togli_abbinamento", piatto, vino: v };
  }
  const abb = testo.match(/^\s*abbina\s+(?:il\s+|la\s+|l'|lo\s+)?(.+?)\s+(?:a|al|alla|allo|ai|alle|agli|con|col|coi)\s+(.+?)(?:\s+perch[eé]\s+(.+))?$/i);
  if (abb) {
    const sinistra = trova(abb[1], cat.prodotti);
    // Prima i nomi interi presenti nel testo (anche con «e» dentro, es. «Pinsa speck brie fichi e noci»), poi la divisione su virgole ed «e»
    const { trovati, resto } = nomiNelTesto(abb[2], cat.prodotti.filter((p) => p.id !== sinistra?.id));
    // Ciò che resta dopo i nomi interi si divide su virgole ed «e» (es. «al tagliere e alla genovese»)
    const frammenti = resto.split(/\s*\|\s*|\s*,\s*|\s+e\s+/)
      .map((x) => x.replace(/\b(a|al|alla|allo|ai|alle|agli|con|col|coi|il|la|lo|l|i|le|gli|e)\b/g, " ").trim()).filter((x) => x.length >= 3);
    const destre = [...trovati, ...frammenti.map((x) => trova(x, cat.prodotti))];
    if (!sinistra || destre.some((x) => !x)) return { azione: "non_trovato", cosa: !sinistra ? abb[1] : abb[2] };
    const eVino = (p) => cat.vini?.has(p.id);
    if (!eVino(sinistra) && !destre.every(eVino)) {
      // Probabile vino: quello che sta in una categoria di vini (altrimenti il secondo nominato)
      const inVini = (p) => /vin|calic|bottigl|cantin/i.test(cat.categorie.find((c) => c.id === p.categoria_id)?.nome ?? "");
      const candidato = [sinistra, ...destre].find(inVini) ?? destre[0];
      return { azione: "chiarisci", testo: `Per abbinare serve la scheda del vino. Prima scrivi ad esempio: «vino ${candidato.nome}: rosso, strutturato».` };
    }
    const coppie = eVino(sinistra) ? destre.map((d) => ({ piatto: d, vino: sinistra })) : destre.map((v) => ({ piatto: sinistra, vino: v }));
    return { azione: "abbina", coppie: coppie.map((c) => ({ ...c, motivo: (abb[3] ?? "").trim().slice(0, 200) })) };
  }

  const via = testo.match(/^\s*(?:elimina|cancella|rimuovi|togli)\s+(?:la\s+|il\s+)?(categoria|piatto)?\s*(.+)$/i);
  if (via && !/\bdal menu\b|\bfoto\b|abbinament/i.test(testo)) {
    if ((via[1] ?? "").toLowerCase() === "categoria") {
      const c = trova(via[2], cat.categorie);
      return c ? { azione: "elimina_categoria", categoria: c } : { azione: "non_trovato", cosa: via[2] };
    }
    const p = trova(via[2], cat.prodotti);
    if (p) return { azione: "elimina_piatto", prodotto: p };
    const c = trova(via[2], cat.categorie);
    if (c && norm(c.nome) === norm(via[2].replace(/^(la|il|lo|l'|i|le|gli)\s+/i, ""))) return { azione: "elimina_categoria", categoria: c };
    return { azione: "non_trovato", cosa: via[2] };
  }

  const nuovaCat = testo.match(/^\s*(?:crea|aggiungi|nuova)\s+(?:la\s+|una\s+)?(?:nuova\s+)?categoria\s+(.+)$/i);
  if (nuovaCat) return { azione: "aggiungi_categoria", nome: maiuscola(pulisci(nuovaCat[1])).slice(0, 80) };

  const pct = t.match(/(\d+(?:[.,]\d+)?)\s*(%|percento|per cento)/);
  if (pct) {
    const giu = /(diminu|abbass|ridu|scont|cala|togli)/.test(t);
    const su = /(aument|alza|incrementa|rincar|aggiung)/.test(t);
    if (giu || su) {
      const percentuale = (giu ? -1 : 1) * numero(pct[1]);
      if (TUTTO.test(t)) return { azione: "varia_prezzi", percentuale, categoria: null };
      const categoria = trova(testo, cat.categorie);
      // Mai applicare a tutto il menu per esclusione: se la categoria non è chiara si chiede
      return categoria ? { azione: "varia_prezzi", percentuale, categoria } : { azione: "chiedi_categoria", percentuale };
    }
  }

  const nuovo = interpretaNuovoPiatto(testo, cat);
  if (nuovo) return nuovo;

  const prezzo = t.match(/(\d+(?:[.,]\d{1,2})?)\s*(€|euro|eur)(?![a-z0-9])/)
    || (/(prezzo|costa|metti|porta)/.test(t) && !t.includes("%") ? t.match(/\ba\s+(\d+(?:[.,]\d{1,2})?)\b/) : null);
  if (prezzo) {
    const p = prodotto();
    if (p) return { azione: "imposta_prezzo", prodotto: p, euro: numero(prezzo[1]) };
  }

  if (/(esaurit|finit|terminat|non (e |c e |ce )?(piu )?disponibil|non ce piu|manca|mancano)/.test(t)) {
    const p = prodotto(); if (p) return { azione: "disponibilita", prodotto: p, valore: false };
  }
  if (/(disponibil|di nuovo|tornat|rimett|riattiv)/.test(t) && !/nel menu|visibil/.test(t)) {
    const p = prodotto(); if (p) return { azione: "disponibilita", prodotto: p, valore: true };
  }
  if (/(nascondi|togli dal menu|rimuovi dal menu|non mostrare)/.test(t)) {
    const p = prodotto(); if (p) return { azione: "visibilita", prodotto: p, valore: false };
  }
  if (/(mostra|rimetti nel menu|rendi visibil)/.test(t)) {
    const p = prodotto(); if (p) return { azione: "visibilita", prodotto: p, valore: true };
  }
  return null;
}

// ---------------------------------------------------------------- Modello locale (solo se le regole non bastano)
/**
 * Chiamata al modello locale con risposta JSON vincolata da uno schema (il modello non può uscire dai valori ammessi).
 * Funziona sia con Ollama (/api/chat) sia con llama.cpp (llama-server, /v1/chat/completions).
 */
export async function chiediModello({ sistema, utente, schema, temperatura = 0, attesa = 90_000 }) {
  const messaggi = [{ role: "system", content: sistema }, { role: "user", content: utente }];
  if (C.llm === "llamacpp") {
    const r = await fetch(`${C.ollama}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(attesa),
      body: JSON.stringify({ model: C.modello, messages: messaggi, temperature: temperatura, stream: false,
        response_format: { type: "json_schema", json_schema: { name: "risposta", strict: true, schema } } }),
    });
    if (!r.ok) throw new Error(`Modello non disponibile (${r.status})`);
    return JSON.parse((await r.json()).choices[0].message.content);
  }
  const r = await fetch(`${C.ollama}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(attesa),
    body: JSON.stringify({ model: C.modello, stream: false, format: schema, options: { temperature: temperatura }, messages: messaggi }),
  });
  if (!r.ok) throw new Error(`Modello non disponibile (${r.status})`);
  return JSON.parse((await r.json()).message.content);
}

export async function interpretaConModelloPerTest(testo, cat) { return interpretaConModello(testo, cat); }
async function interpretaConModello(testo, cat) {
  // Prompt corto = risposta rapida: solo i piatti che somigliano alla richiesta
  const parole = new Set(radici(testo));
  const simili = cat.prodotti.filter((p) => radici(p.nome).some((r) => parole.has(r)));
  const piatti = (simili.length ? simili : cat.prodotti).slice(0, 40);
  const nomiCat = cat.categorie.map((c) => c.nome);
  const nomiPiatti = piatti.map((p) => p.nome);
  const nomiVini = cat.prodotti.filter((p) => cat.vini?.has(p.id)).map((p) => p.nome).slice(0, 40);

  const schema = {
    type: "object",
    properties: {
      azione: { type: "string", enum: ["varia_prezzi", "imposta_prezzo", "disponibilita", "visibilita", "aggiungi_piatto", "aggiungi_categoria",
        "imposta_descrizione", "abbina", "togli_abbinamento", "completa_schede_vini", "descrivi_vini", "suggerisci_abbinamenti",
        "mostra_menu", "mostra_esauriti", "aiuto", "nessuna"] },
      vino: { type: "string", enum: nomiVini.length ? nomiVini : [""] },
      nome: { type: "string" },
      descrizione: { type: "string" },
      percentuale: { type: "number" },
      euro: { type: "number" },
      categoria: { type: "string", enum: [...nomiCat, "tutte"] },
      prodotto: { type: "string", enum: nomiPiatti.length ? nomiPiatti : [""] },
      valore: { type: "boolean" },
    },
    required: ["azione"],
  };
  const out = await chiediModello({
    schema, temperatura: 0,
    sistema:
      "Sei l'assistente del gestionale di un ristorante. Scegli la funzione che corrisponde alla richiesta e compila i campi. " +
      "varia_prezzi: percentuale (negativa per ridurre) e categoria ('tutte' per tutto il menu). imposta_prezzo: prodotto ed euro. " +
      "disponibilita: prodotto e valore (false = esaurito). visibilita: prodotto e valore (false = nascosto dal menu). " +
      "aggiungi_piatto: nome, euro, categoria, descrizione facoltativa. aggiungi_categoria: nome. imposta_descrizione: prodotto e descrizione. " +
      "abbina: prodotto (il piatto) e vino. togli_abbinamento: prodotto e vino. " +
      "completa_schede_vini: compilare o completare le schede dei vini (tipo, corpo, regione) per il quiz. " +
      "descrivi_vini: scrivere o migliorare le descrizioni dei vini del menu (valore true se vanno rifatte anche quelle esistenti). " +
      "suggerisci_abbinamenti: proporre abbinamenti tra piatti e vini. mostra_menu: vedere il menu con i prezzi. " +
      "mostra_esauriti: vedere cosa è esaurito. aiuto: sapere cosa può fare il bot. Se non corrisponde a nessuna funzione: 'nessuna'.",
    utente: `Categorie: ${nomiCat.join(", ") || "nessuna"}\nPiatti: ${nomiPiatti.join(", ") || "nessuno"}\nVini con scheda: ${nomiVini.join(", ") || "nessuno"}\nRichiesta: ${testo}`,
  });
  // Numeri scritti dall'utente (anche in lettere non contano: solo cifre), per verificare prezzi e percentuali
  const numeri = (testo.match(/\d{1,5}(?:[.,]\d{1,2})?/g) ?? []).map(numero);
  const nelTesto = (x) => numeri.some((n) => Math.abs(n - Math.abs(x)) < 0.001);
  const p = cat.prodotti.find((x) => x.nome === out.prodotto);
  const c = cat.categorie.find((x) => x.nome === out.categoria) ?? null;
  switch (out.azione) {
    case "varia_prezzi": {
      if (!Number.isFinite(out.percentuale) || out.percentuale === 0 || !nelTesto(out.percentuale)) return null;
      if (c) return { azione: "varia_prezzi", percentuale: out.percentuale, categoria: c };
      return TUTTO.test(norm(testo)) ? { azione: "varia_prezzi", percentuale: out.percentuale, categoria: null }
                                    : { azione: "chiedi_categoria", percentuale: out.percentuale };
    }
    case "imposta_prezzo": return p && out.euro > 0 && nelTesto(out.euro) ? { azione: "imposta_prezzo", prodotto: p, euro: out.euro } : null;
    case "disponibilita": return p && typeof out.valore === "boolean" ? { azione: "disponibilita", prodotto: p, valore: out.valore } : null;
    case "visibilita": return p && typeof out.valore === "boolean" ? { azione: "visibilita", prodotto: p, valore: out.valore } : null;
    case "aggiungi_categoria": return out.nome?.trim() ? { azione: "aggiungi_categoria", nome: maiuscola(pulisci(out.nome)).slice(0, 80) } : null;
    case "aggiungi_piatto": {
      if (!out.nome?.trim() || !(out.euro > 0) || !nelTesto(out.euro)) return null;   // mai un prezzo inventato
      const piatto = { nome: maiuscola(pulisci(out.nome)).slice(0, 120), euro: out.euro, descrizione: (out.descrizione ?? "").slice(0, 500) };
      return c ? { azione: "aggiungi_piatto", ...piatto, categoria: c } : { azione: "chiedi_categoria", per: "aggiungi_piatto", ...piatto };
    }
    case "imposta_descrizione":
      return p && out.descrizione?.trim() ? { azione: "imposta_descrizione", prodotto: p, testo: pulisci(out.descrizione).slice(0, 500) } : null;
    case "abbina": case "togli_abbinamento": {
      const v = cat.prodotti.find((x) => x.nome === out.vino && cat.vini?.has(x.id));
      if (!p || !v) return { azione: "chiarisci", testo: "Dimmi il piatto e il vino, ad esempio «abbina l'Aglianico al tagliere»." };
      return out.azione === "abbina" ? { azione: "abbina", coppie: [{ piatto: p, vino: v, motivo: "" }] } : { azione: "togli_abbinamento", piatto: p, vino: v };
    }
    case "completa_schede_vini": return { azione: "completa_schede_vini" };
    case "descrivi_vini": return { azione: "descrivi_vini", tutti: out.valore === true };
    case "suggerisci_abbinamenti": return { azione: "suggerisci_abbinamenti" };
    case "mostra_menu": return { azione: "comando", comando: "/menu" };
    case "mostra_esauriti": return { azione: "comando", comando: "/esauriti" };
    case "aiuto": return { azione: "comando", comando: "/aiuto" };
    default: return null;
  }
}

/** Il modello propone un vino per ogni piatto ancora senza abbinamento (con un breve perché). */
async function suggerisciAbbinamenti(cat) {
  const vini = cat.prodotti.filter((p) => cat.vini.has(p.id) && p.visibile).slice(0, 15);
  const piatti = cat.prodotti.filter((p) => !cat.vini.has(p.id) && p.visibile && !cat.abbinamenti.some((a) => a.piatto_id === p.id)).slice(0, 15);
  if (!vini.length) return { azione: "chiarisci", testo: "Non ci sono ancora vini con la scheda. Esempio: «vino Aglianico: rosso, strutturato, Campania»." };
  if (!piatti.length) return { azione: "chiarisci", testo: "Tutti i piatti hanno già almeno un abbinamento. 🍷" };
  const descriviVino = (p) => { const v = cat.vini.get(p.id); return `${p.nome} (${[v.tipo, v.corpo, v.regione, v.vitigno].filter(Boolean).join(", ")})`; };
  const schema = {
    type: "object", required: ["coppie"],
    properties: { coppie: { type: "array", items: { type: "object", required: ["piatto", "vino", "motivo"], properties: {
      piatto: { type: "string", enum: piatti.map((p) => p.nome) }, vino: { type: "string", enum: vini.map((v) => v.nome) }, motivo: { type: "string" } } } } },
  };
  const proposte = (await chiediModello({ schema, temperatura: 0.2, attesa: 240_000,
    sistema: "Sei il sommelier di un'enoteca italiana. Per ogni piatto scegli il vino più adatto tra quelli disponibili e spiega il perché in massimo 8 parole, in italiano.",
    utente: `Vini disponibili: ${vini.map(descriviVino).join("; ")}\nPiatti: ${piatti.map((p) => `${p.nome}${p.descrizione ? ` (${p.descrizione.slice(0, 80)})` : ""}`).join("; ")}`,
  })).coppie ?? [];
  const usati = new Set();
  const coppie = proposte.map((c) => ({ piatto: piatti.find((p) => p.nome === c.piatto), vino: vini.find((v) => v.nome === c.vino), motivo: String(c.motivo ?? "").slice(0, 200) }))
    .filter((c) => c.piatto && c.vino && !usati.has(c.piatto.id) && usati.add(c.piatto.id));
  return coppie.length ? { azione: "abbina", coppie, daIA: true } : { azione: "chiarisci", testo: "Non sono riuscito a proporre abbinamenti sensati: impostali a mano con «abbina Aglianico al tagliere»." };
}

/** Vini senza scheda: prodotti nelle categorie di vini (Carta dei vini, Vini al calice, Bollicine…) senza tipo e corpo. */
const CATEGORIE_VINI = /vin[oi]|calic|bottigl|cantin|bollic|spumant|champagne|rossi|bianchi|rosati|cantina/i;
/** Cerca un vino nell'enciclopedia e decide la scheda: nome intero trovato → quella voce; più cantine → la maggioranza. */
async function schedaDaEnciclopedia(prodotto) {
  const testo = `${prodotto.nome} ${prodotto.descrizione ?? ""}`;
  let righe = await db("rpc/cerca_vino", { metodo: "POST", corpo: { p_testo: prodotto.nome, p_limite: 30 } });
  if (!righe.some((r) => r.contenuto) && prodotto.descrizione) righe = await db("rpc/cerca_vino", { metodo: "POST", corpo: { p_testo: testo, p_limite: 30 } });
  const esatti = righe.filter((r) => r.contenuto);
  if (esatti.length) {
    // La voce più specifica; tra più cantine con lo stesso nome, quella citata nel testo o la scelta più comune
    const migliore = norm(esatti[0].nome);
    const stessi = esatti.filter((r) => norm(r.nome) === migliore);
    const conCantina = stessi.find((r) => r.cantina && ` ${norm(testo)} `.includes(` ${norm(r.cantina)} `));
    if (conCantina || stessi.length === 1) return { ...(conCantina ?? stessi[0]), fonte_scheda: (conCantina ?? stessi[0]).fonte };
    const piuComune = (campo) => Object.entries(stessi.reduce((m, r) => ((m[r[campo]] = (m[r[campo]] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0][0];
    return { ...stessi[0], tipo: piuComune("tipo"), corpo: piuComune("corpo"), cantina: "", fonte_scheda: `${stessi.length} voci` };
  }
  // Solo somiglianza (errori di battitura): accettata se nettamente migliore delle altre e coerente
  const [primo, secondo] = righe;
  if (primo && primo.punteggio >= 0.75 && (!secondo || secondo.punteggio < primo.punteggio - 0.1 || secondo.tipo === primo.tipo)) return { ...primo, fonte_scheda: "simile" };
  return null;
}

/** Nuove descrizioni dei vini dai dati dell'enciclopedia e della scheda (solo i vini senza descrizione, o tutti). */
async function descriviVini(cat, tutti) {
  const categorieVini = new Set(cat.categorie.filter((c) => CATEGORIE_VINI.test(c.nome)).map((c) => c.id));
  const vini = cat.prodotti.filter((p) => categorieVini.has(p.categoria_id) && (tutti || !p.descrizione?.trim())).slice(0, 25);
  if (!vini.length) return { azione: "chiarisci", testo: "Tutti i vini hanno già una descrizione. Per rifarle tutte: «riscrivi le descrizioni dei vini»." };
  const proposte = [], senzaDati = [];
  for (const p of vini) {
    let e = null;
    try { e = await schedaDaEnciclopedia({ ...p, descrizione: "" }); } catch (err) { log(`Enciclopedia non disponibile: ${err.message}`); }
    const scheda = cat.vini.get(p.id);   // la scheda del locale, già verificata, prevale
    const dati = { ...(e ?? {}), ...(scheda ? { tipo: scheda.tipo, corpo: scheda.corpo, regione: scheda.regione || e?.regione, vitigno: scheda.vitigno || e?.vitigno } : {}) };
    const nuova = dati.tipo ? descriviVino(dati) : null;
    if (nuova && nuova !== p.descrizione) proposte.push({ prodotto: p, vecchia: p.descrizione ?? "", nuova });
    else if (!nuova) senzaDati.push(p.nome);
  }
  if (!proposte.length) return { azione: "chiarisci", testo: `Non ho dati sufficienti per descrivere: ${senzaDati.join(", ")}. Completa prima le schede: «completa le schede dei vini».` };
  return { azione: "descrizioni_vini", proposte, senzaDati };
}

async function completaSchedeVini(cat) {
  const categorieVini = new Set(cat.categorie.filter((c) => CATEGORIE_VINI.test(c.nome)).map((c) => c.id));
  const senza = cat.prodotti.filter((p) => categorieVini.has(p.categoria_id) && !cat.vini.has(p.id));
  if (!senza.length) return { azione: "chiarisci", testo: "Tutti i vini in carta hanno già la scheda. 🍷 Per correggerne una: «vino Aglianico: rosso, strutturato, Campania»." };
  const schede = [], ignoti = [];
  for (const p of senza) {
    let r = null;
    try { r = await schedaDaEnciclopedia(p); }
    catch (e) {
      // Enciclopedia non ancora disponibile: base di conoscenza interna
      log(`Enciclopedia non disponibile: ${e.message}`);
      const b = riconosciVino(p.nome, p.descrizione, norm);
      if (b) r = { ...b, nome: b.vitigno || p.nome, fonte_scheda: b.fonte };
    }
    // Nella scheda la regione (es. «Campania»), per raggruppare e filtrare il menu; la zona precisa resta nell'enciclopedia
    if (r) schede.push({ prodotto: p, tipo: r.tipo, corpo: r.corpo, regione: regioneDi(r.regione ?? "").slice(0, 60), vitigno: (r.vitigno ?? "").slice(0, 80), note: "",
                         trovato: r.cantina ? `${r.nome}, ${r.cantina}` : r.nome, fonte: r.fonte_scheda });
    else ignoti.push(p.nome);
  }
  if (!schede.length) {
    return { azione: "chiarisci", testo: `Non trovo questi vini nell'enciclopedia: ${ignoti.join(", ")}.\n` +
      `Aggiungili così, un messaggio per vino: «enciclopedia ${ignoti[0]}: tipo, corpo, regione, vitigno …» (es. «rosso, strutturato, Campania, vitigno Aglianico»).` };
  }
  return { azione: "schede_vini", schede, ignoti };
}

// ---------------------------------------------------------------- Anteprima ed esecuzione
export function anteprima(a, cat) {
  switch (a.azione) {
    case "varia_prezzi": {
      if (a.percentuale <= -100 || a.percentuale > 500) return { errore: "Percentuale fuori dai limiti (-99% / +500%)." };
      const coinvolti = cat.prodotti.filter((p) => !a.categoria || p.categoria_id === a.categoria.id);
      if (!coinvolti.length) return { errore: "Nessun piatto coinvolto." };
      const righe = coinvolti.slice(0, 10).map((p) => `• ${p.nome}: ${euro(p.prezzo_cent)} → ${euro(arrotonda10(p.prezzo_cent, a.percentuale))}`);
      if (coinvolti.length > 10) righe.push(`… e altri ${coinvolti.length - 10}`);
      const dove = a.categoria ? `«${a.categoria.nome}»` : "tutto il menu";
      return { testo: `Variazione ${a.percentuale > 0 ? "+" : ""}${a.percentuale}% su ${dove} (${coinvolti.length === 1 ? "1 piatto" : `${coinvolti.length} piatti`}, arrotondati a 0,10 €):\n${righe.join("\n")}` };
    }
    case "imposta_prezzo": {
      const nuovo = Math.round(a.euro * 100);
      if (!(nuovo > 0 && nuovo <= 10_000_000)) return { errore: "Prezzo non valido." };
      return { testo: `Nuovo prezzo per «${a.prodotto.nome}»: ${euro(a.prodotto.prezzo_cent)} → ${euro(nuovo)}` };
    }
    case "disponibilita":
      return { testo: `«${a.prodotto.nome}» → ${a.valore ? "DI NUOVO DISPONIBILE" : "ESAURITO"}` };
    case "visibilita":
      return { testo: `«${a.prodotto.nome}» → ${a.valore ? "VISIBILE nel menu" : "NASCOSTO dal menu"}` };
    case "descrizioni_vini":
      return { testo: `✍️ Nuove descrizioni dei vini (dai dati dell'enciclopedia):\n${a.proposte.map((x) => `• ${x.prodotto.nome}\n  ${x.nuova}`).join("\n")}`
        + (a.senzaDati?.length ? `\n\n❔ Senza dati, lasciati com'erano: ${a.senzaDati.join(", ")}` : "")
        + "\n\nPuoi sempre ritoccarle dal backoffice o con «descrizione Nome: …»." };
    case "aggiungi_enciclopedia": {
      const c = a.campi;
      return { testo: `📚 Nuovo vino nell'enciclopedia del locale:\n• ${a.nome}: ${[c.tipo, c.corpo, c.regione, c.vitigno && `vitigno ${c.vitigno}`, c.cantina && `cantina ${c.cantina}`].filter(Boolean).join(", ")}` +
        (a.prodotto ? `\n\nE la stessa scheda per «${a.prodotto.nome}» del menu (così entra nel quiz).` : "") };
    }
    case "schede_vini":
      return { testo: `🍷 Schede dei vini (controllale prima di confermare):\n${a.schede.map((v) =>
        `• ${v.prodotto.nome}: ${[v.tipo, v.corpo, v.regione, v.vitigno].filter(Boolean).join(", ")}` +
        (v.trovato && norm(v.trovato) !== norm(v.prodotto.nome) ? `\n  ↳ ${v.trovato}${v.fonte === "simile" ? " (nome simile)" : ""}` : "")).join("\n")}`
        + (a.ignoti?.length ? `\n\n❔ Non presenti nell'enciclopedia: ${a.ignoti.join(", ")}\n  Aggiungili così: «enciclopedia ${a.ignoti[0]}: tipo, corpo, regione, vitigno …» (es. «rosso, strutturato, Campania, vitigno Aglianico»)` : "")
        + "\n\nServono al quiz «Trova il tuo vino». Per correggerne una: «vino Nome: rosso, strutturato…»." };
    case "imposta_vino": {
      const c = a.campi, prima = cat.vini?.get(a.prodotto.id);
      const tipo = c.tipo ?? prima?.tipo;
      const righe = [tipo, c.corpo, c.regione, c.vitigno && `vitigno ${c.vitigno}`, c.cantina && `cantina ${c.cantina}`, c.annata,
        c.prezzo_bottiglia_cent && `bottiglia ${euro(c.prezzo_bottiglia_cent)}`, c.note && `note: ${c.note}`].filter(Boolean);
      return { testo: `🍷 Scheda vino di «${a.prodotto.nome}»${prima ? " (aggiornamento)" : ""}:\n${righe.join(" · ")}\nIl prezzo del prodotto (${euro(a.prodotto.prezzo_cent)}) resta quello al calice.` };
    }
    case "abbina": {
      const righe = a.coppie.slice(0, 15).map((c) => `• ${c.piatto.nome} → ${c.vino.nome}${c.motivo ? ` (${c.motivo})` : ""}`);
      return { testo: `${a.daIA ? "🧠 Il sommelier propone:" : "🍷 Abbinamenti:"}\n${righe.join("\n")}` };
    }
    case "togli_abbinamento":
      return { testo: `Tolgo l'abbinamento ${a.piatto.nome} → ${a.vino.nome}.` };
    case "imposta_foto":
      return { testo: `📷 Foto per «${a.prodotto.nome}» (${Math.round(a.dati.length * 0.75 / 1024)} KB)` +
        (a.descrizione ? `\nNuova descrizione: «${a.descrizione}»` : "") + "\nI clienti la vedranno toccando il piatto nel menu." };
    case "imposta_descrizione":
      return { testo: `✏️ Descrizione di «${a.prodotto.nome}»:\n«${a.testo}»` };
    case "rimuovi_foto":
      return { testo: `Tolgo la foto di «${a.prodotto.nome}».` };
    case "elimina_piatto":
      return { testo: `🗑 Elimino il piatto «${a.prodotto.nome}» (${euro(a.prodotto.prezzo_cent)}).\nSe vuoi solo toglierlo dal menu per un po', scrivi invece «nascondi ${a.prodotto.nome}».` };
    case "elimina_categoria": {
      const n = cat.prodotti.filter((p) => p.categoria_id === a.categoria.id).length;
      return { testo: `🗑 Elimino la categoria «${a.categoria.nome}»${n === 1 ? " e il suo piatto" : n ? ` e i suoi ${n} piatti` : " (vuota)"}.` };
    }
    case "aggiungi_categoria": {
      if (!a.nome) return { errore: "Nome della categoria mancante." };
      if (cat.categorie.some((c) => norm(c.nome) === norm(a.nome))) return { errore: `La categoria «${a.nome}» esiste già.` };
      return { testo: `Nuova categoria: «${a.nome}»` };
    }
    case "aggiungi_piatto": {
      const c = Math.round(a.euro * 100);
      if (!(c > 0 && c <= 10_000_000)) return { errore: "Prezzo non valido." };
      if (cat.prodotti.some((p) => p.categoria_id === a.categoria.id && norm(p.nome) === norm(a.nome)))
        return { errore: `«${a.nome}» esiste già in «${a.categoria.nome}».` };
      return { testo: `Nuovo piatto in «${a.categoria.nome}»:\n• ${a.nome} — ${euro(c)}${a.descrizione ? `\n  ${a.descrizione}` : ""}${a.foto ? "\n📷 con la foto inviata" : ""}\n\nAllergeni ed etichette si completano dal backoffice.` };
    }
    case "importa": {
      const valide = a.voci.filter((v) => v.euro > 0 && v.euro <= 100000);
      if (!valide.length) return { errore: "Nessun piatto con prezzo valido nell'elenco." };
      const nuoveCat = [...new Set(valide.filter((v) => v.categoria.nuova).map((v) => v.categoria.nome))];
      const righe = valide.slice(0, 25).map((v) => `• [${v.categoria.nome}] ${v.nome} — ${euro(Math.round(v.euro * 100))}`);
      if (valide.length > 25) righe.push(`… e altri ${valide.length - 25}`);
      const scartate = a.voci.length - valide.length;
      return { testo: `Aggiungo ${valide.length === 1 ? "1 prodotto" : `${valide.length} prodotti`}${nuoveCat.length ? ` e creo ${nuoveCat.length} categorie (${nuoveCat.join(", ")})` : ""}:\n${righe.join("\n")}` +
        (a.gia?.length ? `\n\nGià presenti, non li duplico: ${a.gia.join(", ")}` : "") +
        (scartate ? `\n\n⚠️ ${scartate} righe ignorate per prezzo non valido.` : "") + "\n\nAllergeni ed etichette si completano dal backoffice." };
    }
    default:
      return { errore: "Azione non riconosciuta." };
  }
}

/** Esegue l'azione e restituisce le operazioni per annullarla. */
async function esegui(a, cat) {
  switch (a.azione) {
    case "varia_prezzi": {
      const prima = cat.prodotti.filter((p) => !a.categoria || p.categoria_id === a.categoria.id)
        .map((p) => ({ id: p.id, prezzo_cent: p.prezzo_cent }));
      const n = await db("rpc/varia_prezzi", { metodo: "POST", corpo: {
        p_locale: C.locale, p_percento: a.percentuale, p_categoria: a.categoria?.id ?? null, p_arrotonda_cent: 10 } });
      return { esito: `${n} prezzi aggiornati.`, annulla: prima.map((x) => ({ tabella: "prodotti", id: x.id, patch: { prezzo_cent: x.prezzo_cent } })) };
    }
    case "imposta_prezzo":
      await db(`prodotti?id=eq.${uuid(a.prodotto.id)}`, { metodo: "PATCH", corpo: { prezzo_cent: Math.round(a.euro * 100) } });
      return { esito: "Prezzo aggiornato.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { prezzo_cent: a.prodotto.prezzo_cent } }] };
    case "disponibilita":
      await db("rpc/imposta_disponibilita", { metodo: "POST", corpo: { p_prodotto: a.prodotto.id, p_disponibile: a.valore } });
      return { esito: "Disponibilità aggiornata.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { disponibile: a.prodotto.disponibile } }] };
    case "visibilita":
      await db(`prodotti?id=eq.${uuid(a.prodotto.id)}`, { metodo: "PATCH", corpo: { visibile: a.valore } });
      return { esito: "Visibilità aggiornata.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { visibile: a.prodotto.visibile } }] };
    case "descrizioni_vini": {
      for (const x of a.proposte) await db(`prodotti?id=eq.${uuid(x.prodotto.id)}`, { metodo: "PATCH", corpo: { descrizione: x.nuova } });
      return { esito: `${a.proposte.length === 1 ? "1 descrizione aggiornata" : `${a.proposte.length} descrizioni aggiornate`}.`,
               annulla: a.proposte.map((x) => ({ tabella: "prodotti", id: x.prodotto.id, patch: { descrizione: x.vecchia } })) };
    }
    case "aggiungi_enciclopedia": {
      const c = a.campi;
      const [voce] = await db("enciclopedia_vini", { metodo: "POST", corpo: { nome: a.nome, tipo: c.tipo, corpo: c.corpo, regione: c.regione ?? "",
        vitigno: (c.vitigno ?? "").slice(0, 200), cantina: (c.cantina ?? "").slice(0, 160), paese: "", fonte: "locale", locale_id: C.locale } });
      const annulla = [{ tabella: "enciclopedia_vini", id: voce.id, elimina: true }];
      if (a.prodotto) {
        await db("vini", { metodo: "POST", unisci: true, corpo: { prodotto_id: a.prodotto.id, locale_id: C.locale, tipo: c.tipo, corpo: c.corpo,
          regione: regioneDi(c.regione ?? "").slice(0, 60), vitigno: (c.vitigno ?? "").slice(0, 80), cantina: (c.cantina ?? "").slice(0, 80) } });
        annulla.push({ tabella: "vini", filtro: `prodotto_id=eq.${uuid(a.prodotto.id)}`, elimina: true });
      }
      return { esito: `«${a.nome}» aggiunto all'enciclopedia${a.prodotto ? " e alla scheda del menu" : ""}.`, annulla };
    }
    case "schede_vini": {
      await db("vini", { metodo: "POST", unisci: true, corpo: a.schede.map((v) => ({
        prodotto_id: v.prodotto.id, locale_id: C.locale, tipo: v.tipo, corpo: v.corpo, regione: v.regione, vitigno: v.vitigno, note: v.note })) });
      return { esito: `${a.schede.length === 1 ? "1 scheda salvata" : `${a.schede.length} schede salvate`}: ora il quiz li propone.`,
               annulla: a.schede.map((v) => ({ tabella: "vini", filtro: `prodotto_id=eq.${uuid(v.prodotto.id)}`, elimina: true })) };
    }
    case "imposta_vino": {
      const [prima] = await db(`vini?prodotto_id=eq.${uuid(a.prodotto.id)}&select=*`);
      await db("vini", { metodo: "POST", unisci: true, corpo: { ...(prima ?? { corpo: "medio" }), ...a.campi, prodotto_id: a.prodotto.id, locale_id: C.locale } });
      return { esito: "Scheda del vino salvata.", annulla: [prima ? { tabella: "vini", inserisci: [prima], unisci: true }
                                                          : { tabella: "vini", filtro: `prodotto_id=eq.${uuid(a.prodotto.id)}`, elimina: true }] };
    }
    case "abbina": {
      const nuove = a.coppie.filter((c) => !cat.abbinamenti.some((x) => x.piatto_id === c.piatto.id && x.vino_id === c.vino.id));
      await db("abbinamenti", { metodo: "POST", unisci: true, corpo: a.coppie.map((c) => ({ locale_id: C.locale, piatto_id: c.piatto.id, vino_id: c.vino.id, motivo: c.motivo || "" })) });
      return { esito: `${a.coppie.length === 1 ? "Abbinamento salvato" : `${a.coppie.length} abbinamenti salvati`}.`,
               annulla: nuove.map((c) => ({ tabella: "abbinamenti", filtro: `piatto_id=eq.${uuid(c.piatto.id)}&vino_id=eq.${uuid(c.vino.id)}`, elimina: true })) };
    }
    case "togli_abbinamento": {
      const riga = cat.abbinamenti.find((x) => x.piatto_id === a.piatto.id && x.vino_id === a.vino.id);
      if (!riga) throw new Error("questo abbinamento non esiste");
      await db(`abbinamenti?piatto_id=eq.${uuid(a.piatto.id)}&vino_id=eq.${uuid(a.vino.id)}`, { metodo: "DELETE" });
      return { esito: "Abbinamento tolto.", annulla: [{ tabella: "abbinamenti", inserisci: [{ ...riga, locale_id: C.locale }], unisci: true }] };
    }
    case "imposta_foto": {
      const [prima] = await db(`foto_prodotti?prodotto_id=eq.${uuid(a.prodotto.id)}&select=*`);
      // Prima scelta: archivio immagini; se non è installato, la foto resta nel database come prima
      const percorso = await inArchivio(a.dati).catch((e) => { log(`Archivio non disponibile, foto nel database: ${e.message}`); return null; });
      await db("foto_prodotti", { metodo: "POST", unisci: true, corpo: percorso
        ? { prodotto_id: a.prodotto.id, locale_id: C.locale, path: percorso, dati: null, aggiornata_at: new Date().toISOString() }
        : { prodotto_id: a.prodotto.id, locale_id: C.locale, dati: a.dati, path: null, aggiornata_at: new Date().toISOString() } });
      const annulla = [prima ? { tabella: "foto_prodotti", inserisci: [prima], unisci: true }
                             : { tabella: "foto_prodotti", filtro: `prodotto_id=eq.${uuid(a.prodotto.id)}`, elimina: true }];
      if (a.descrizione) {
        const [riga] = await db(`prodotti?id=eq.${uuid(a.prodotto.id)}&select=descrizione`);
        await db(`prodotti?id=eq.${uuid(a.prodotto.id)}`, { metodo: "PATCH", corpo: { descrizione: a.descrizione } });
        annulla.push({ tabella: "prodotti", id: a.prodotto.id, patch: { descrizione: riga?.descrizione ?? "" } });
      }
      return { esito: "Foto salvata.", annulla };
    }
    case "imposta_descrizione": {
      const [riga] = await db(`prodotti?id=eq.${uuid(a.prodotto.id)}&select=descrizione`);
      await db(`prodotti?id=eq.${uuid(a.prodotto.id)}`, { metodo: "PATCH", corpo: { descrizione: a.testo } });
      return { esito: "Descrizione aggiornata.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { descrizione: riga?.descrizione ?? "" } }] };
    }
    case "rimuovi_foto": {
      const [prima] = await db(`foto_prodotti?prodotto_id=eq.${uuid(a.prodotto.id)}&select=*`);
      if (!prima) throw new Error("questo piatto non ha una foto");
      await db(`foto_prodotti?prodotto_id=eq.${uuid(a.prodotto.id)}`, { metodo: "DELETE" });
      return { esito: "Foto rimossa.", annulla: [{ tabella: "foto_prodotti", inserisci: [prima], unisci: true }] };
    }
    case "elimina_piatto": {
      const [riga] = await db(`prodotti?id=eq.${uuid(a.prodotto.id)}&select=*`);
      if (!riga) throw new Error("Il piatto non esiste più");
      await db(`prodotti?id=eq.${uuid(a.prodotto.id)}`, { metodo: "DELETE" });
      return { esito: `«${a.prodotto.nome}» eliminato.`, annulla: [{ tabella: "prodotti", inserisci: [riga] }] };
    }
    case "elimina_categoria": {
      const [riga] = await db(`categorie?id=eq.${uuid(a.categoria.id)}&select=*`);
      if (!riga) throw new Error("La categoria non esiste più");
      const piatti = await db(`prodotti?categoria_id=eq.${uuid(a.categoria.id)}&select=*`);
      await db(`categorie?id=eq.${uuid(a.categoria.id)}`, { metodo: "DELETE" });
      const annulla = [{ tabella: "categorie", inserisci: [riga] }];
      if (piatti.length) annulla.push({ tabella: "prodotti", inserisci: piatti });
      return { esito: `Categoria «${a.categoria.nome}» eliminata${piatti.length ? ` con ${piatti.length} piatti` : ""}.`, annulla };
    }
    case "aggiungi_categoria": {
      const [c] = await db("categorie", { metodo: "POST", corpo: { locale_id: C.locale, nome: a.nome, posizione: prossima(cat.categorie) } });
      return { esito: `Categoria «${a.nome}» creata.`, annulla: [{ tabella: "categorie", id: c.id, elimina: true }] };
    }
    case "aggiungi_piatto": {
      const [p] = await db("prodotti", { metodo: "POST", corpo: {
        locale_id: C.locale, categoria_id: a.categoria.id, nome: a.nome, descrizione: a.descrizione || "",
        prezzo_cent: Math.round(a.euro * 100), posizione: prossima(cat.prodotti.filter((x) => x.categoria_id === a.categoria.id)) } });
      if (a.foto) {
        // La foto va nell'archivio (o nel database se l'archivio non c'è); se fallisce, il piatto resta senza foto
        try {
          const percorso = await inArchivio(a.foto).catch(() => null);
          await db("foto_prodotti", { metodo: "POST", unisci: true, corpo: percorso
            ? { prodotto_id: p.id, locale_id: C.locale, path: percorso, dati: null }
            : { prodotto_id: p.id, locale_id: C.locale, dati: a.foto } });
        } catch (e) { log(`Foto del nuovo piatto non salvata: ${e.message}`); return { esito: `«${a.nome}» aggiunto al menu, ma la foto non è stata salvata: rimandala con il nome nella didascalia.`, annulla: [{ tabella: "prodotti", id: p.id, elimina: true }] }; }
      }
      return { esito: `«${a.nome}» aggiunto al menu${a.foto ? " con la foto" : ""}.`, annulla: [{ tabella: "prodotti", id: p.id, elimina: true }] };
    }
    case "importa": {
      const valide = a.voci.filter((v) => v.euro > 0 && v.euro <= 100000);
      const annulla = [];
      const idCat = new Map();
      let pos = prossima(cat.categorie);
      for (const v of valide) {
        if (!v.categoria.nuova || idCat.has(v.categoria.nome)) continue;
        const [c] = await db("categorie", { metodo: "POST", corpo: { locale_id: C.locale, nome: v.categoria.nome, posizione: pos++ } });
        idCat.set(v.categoria.nome, c.id);
        annulla.push({ tabella: "categorie", id: c.id, elimina: true });
      }
      const contatori = new Map();
      const righe = valide.map((v) => {
        const categoria_id = v.categoria.nuova ? idCat.get(v.categoria.nome) : v.categoria.id;
        const base = contatori.get(categoria_id) ?? prossima(cat.prodotti.filter((x) => x.categoria_id === categoria_id));
        contatori.set(categoria_id, base + 1);
        return { locale_id: C.locale, categoria_id, nome: v.nome, descrizione: v.descrizione, prezzo_cent: Math.round(v.euro * 100), posizione: base };
      });
      const creati = await db("prodotti", { metodo: "POST", corpo: righe });
      // Prima i piatti, poi le categorie create: l'annullamento li rimuove in quest'ordine
      return { esito: `${creati.length === 1 ? "1 prodotto aggiunto" : `${creati.length} prodotti aggiunti`}.`, annulla: [...creati.map((p) => ({ tabella: "prodotti", id: p.id, elimina: true })), ...annulla] };
    }
    default:
      throw new Error("Azione non riconosciuta");
  }
}

const prossima = (lista) => lista.reduce((m, x) => Math.max(m, x.posizione ?? 0), -1) + 1;

// ---------------------------------------------------------------- Conversazione
const inAttesa = new Map();   // id -> { azione, catalogo, chat, scade }
let ultimaModifica = null;    // operazioni per /annulla

const AIUTO =
  "Scrivimi cosa vuoi cambiare nel menu, ad esempio:\n" +
  "• aumenta del 5% le pizze\n• la genovese è esaurita\n• la margherita costa 7 euro\n• nascondi la marinara\n" +
  "• crea la categoria Dolci\n• aggiungi alle pizze rosse la diavola a 8 euro con salame piccante\n" +
  "• elimina la diavola\n• elimina la categoria Dolci\n" +
  "• descrizione margherita: pomodoro, fior di latte e basilico\n" +
  "• 📷 invia una foto con didascalia «Margherita» (o «Margherita: descrizione») per metterla sul piatto\n" +
  "• togli la foto alla margherita\n" +
  "• 🎙️ oppure invia un vocale: lo trascrivo qui sul server e lo tratto come un messaggio scritto\n\n" +
  "Sommelier:\n• vino Aglianico: rosso, strutturato, Campania, cantina X, annata 2020, bottiglia 28 euro, note ciliegia e spezie\n" +
  "• abbina l'aglianico al tagliere e alla genovese perché il tannino pulisce il grasso\n" +
  "• togli abbinamento aglianico e genovese\n• suggerisci abbinamenti (li propone l'IA, tu confermi)\n" +
  "• completa le schede dei vini (cerca i vini senza scheda nell'enciclopedia, per il quiz «Trova il tuo vino»)\n" +
  "• enciclopedia Rubrato: rosso, strutturato, Campania, vitigno Aglianico, cantina Feudi di San Gregorio (aggiunge un vino mancante)\n" +
  "• descrivi i vini (scrive le descrizioni mancanti dai dati dell'enciclopedia) · riscrivi le descrizioni dei vini (le rifà tutte)\n" +
  "• oppure incolla un elenco, una riga per piatto:\n   Pizze rosse\n   Margherita - 6,50\n   Diavola - 8 | salame piccante\n\n" +
  "Comandi: /menu (prezzi), /esauriti, /annulla (annulla l'ultima modifica).\n" +
  "Prima di ogni modifica ti mostro un'anteprima da confermare.";

const fotoInAttesa = new Map();   // chat -> { dati, descrizione, scade }: foto ricevuta senza il nome del piatto
const prezziInAttesa = new Map(); // chat -> { voci, categoria, gia, scade }: prodotti da aggiungere senza prezzo

/** Scarica la foto più grande che sta nel limite (Telegram invia sempre JPEG). */
/** Carica una foto JPEG (data URI) nell'archivio del locale con l'account del bot; restituisce il percorso. */
async function inArchivio(datiUri) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(datiUri);
  if (!m) throw new Error("formato non valido");
  const percorso = `${C.locale}/piatti/${randomUUID()}.jpg`;
  const r = await fetch(`${C.archivio}/object/immagini/${percorso}`, {
    method: "POST", body: Buffer.from(m[1], "base64"), signal: AbortSignal.timeout(20_000),
    headers: { apikey: C.anon, Authorization: `Bearer ${await jwt()}`, "Content-Type": "image/jpeg", "cache-control": "max-age=31536000", "x-upsert": "false" },
  });
  if (!r.ok) throw new Error(`risposta ${r.status}`);
  return percorso;
}

async function scaricaFoto(formati) {
  const ordinati = [...formati].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0));
  const scelto = ordinati.find((f) => (f.file_size ?? 0) <= 640_000) ?? ordinati[ordinati.length - 1];
  const file = await tg("getFile", { file_id: scelto.file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${C.token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error("Download della foto non riuscito");
  const dati = `data:image/jpeg;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  if (dati.length > 880_000) throw new Error("Foto troppo pesante: inviala come foto compressa, non come file.");
  return dati;
}

async function riceviFoto(m, cat) {
  const chat = m.chat.id;
  await tg("sendChatAction", { chat_id: chat, action: "upload_photo" });
  const dati = await scaricaFoto(m.photo);
  // Didascalia: «Margherita» oppure «Margherita: pomodoro, fior di latte e basilico»
  const didascalia = (m.caption || "").trim();
  // «Aggiungi Cabernet alla carta dei vini a 34 euro descrizione: …» con la foto: nuovo piatto con foto
  const nuovo = conFoto(interpretaConRegole(didascalia, cat), dati);
  if (nuovo) return gestisciAzioneConFoto(chat, nuovo, cat);
  const [nome, ...resto] = didascalia.split(":");
  const descrizione = resto.join(":").trim().slice(0, 500);
  const p = nome ? trova(nome.replace(/\bfoto\b/i, ""), cat.prodotti) : null;
  if (p) return chiediConferma(chat, { azione: "imposta_foto", prodotto: p, dati, descrizione }, cat);
  fotoInAttesa.set(chat, { dati, descrizione, scade: Date.now() + 10 * 60_000 });
  return invia(chat, didascalia ? `Non trovo «${nome.trim()}» nel menu. Scrivimi il nome del piatto per questa foto.` : "A quale piatto associo questa foto? Scrivimi il nome.");
}

/** Collega la foto a una richiesta di nuovo piatto (anche quando manca ancora la categoria). */
function conFoto(azione, dati) {
  if (azione?.azione === "aggiungi_piatto" || (azione?.azione === "chiedi_categoria" && azione.per === "aggiungi_piatto")) return { ...azione, foto: dati };
  return null;
}
async function gestisciAzioneConFoto(chat, azione, cat) {
  if (azione.azione === "chiedi_categoria") return chiediCategoria(chat, azione, cat);
  return chiediConferma(chat, azione, cat);
}

/** Vocale: trascritto sul server (nessun audio esce dal locale), poi trattato come un messaggio scritto. */
async function riceviVocale(m) {
  const chat = m.chat.id;
  const audio = m.voice ?? m.audio;
  if ((audio.duration ?? 0) > 90) return invia(chat, "Il vocale è troppo lungo: massimo 90 secondi, una richiesta alla volta.");
  await tg("sendChatAction", { chat_id: chat, action: "typing" });
  const file = await tg("getFile", { file_id: audio.file_id });
  const scaricato = await fetch(`https://api.telegram.org/file/bot${C.token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!scaricato.ok) throw new Error("Download del vocale non riuscito");
  const cat = await catalogo();
  // I nomi dei piatti aiutano a riconoscere le parole meno comuni (vitigni, piatti tipici)
  const suggerimento = encodeURIComponent([...cat.prodotti.map((p) => p.nome), ...cat.categorie.map((c) => c.nome)].join(", ").slice(0, 900));
  let r;
  try {
    r = await fetch(`${C.trascrizione}/trascrivi`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Suggerimento": suggerimento },
      body: Buffer.from(await scaricato.arrayBuffer()), signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return invia(chat, "La trascrizione dei vocali non è attiva sul server: scrivimi la richiesta a testo.");
  }
  const esito = await r.json().catch(() => ({}));
  if (!r.ok || !esito.testo) {
    log(`Trascrizione non riuscita: stato ${r.status}, ${esito.errore ?? "testo vuoto"}`);
    return invia(chat, "Non sono riuscito a capire il vocale: riprova parlando vicino al telefono, oppure scrivimi.");
  }
  log(`Vocale di ${esito.durata}s trascritto in ${esito.secondi}s`);
  await invia(chat, `🎙️ Ho capito: «${esito.testo}»`);
  return gestisciMessaggio({ ...m, voice: undefined, audio: undefined, text: esito.testo });
}

export async function gestisciMessaggio(m) {
  const chat = m.chat.id;
  if (m.voice || m.audio) return riceviVocale(m);
  if (m.photo?.length) return riceviFoto(m, await catalogo());
  if (m.document && /^image\//.test(m.document.mime_type ?? "")) {
    return invia(chat, "Invia l'immagine come foto (non come file), così Telegram la comprime: la uso per il menu.");
  }
  const testo = (m.text || "").trim();
  if (!testo) return;

  const attesa = fotoInAttesa.get(chat);
  if (attesa && !testo.startsWith("/")) {
    if (attesa.scade > Date.now()) {
      const cat = await catalogo();
      const nuovo = conFoto(interpretaConRegole(testo, cat), attesa.dati);
      if (nuovo) { fotoInAttesa.delete(chat); return gestisciAzioneConFoto(chat, nuovo, cat); }
      const p = trova(testo, cat.prodotti);
      if (p) { fotoInAttesa.delete(chat); return chiediConferma(chat, { azione: "imposta_foto", prodotto: p, dati: attesa.dati, descrizione: attesa.descrizione }, cat); }
      if (!/^\s*(aggiungi|inserisci|crea)\b/i.test(testo)) {
        return invia(chat, `Non trovo «${testo}» nel menu. Scrivimi il nome esatto del piatto, oppure per crearlo con questa foto: «aggiungi ${testo} in <categoria> a <prezzo> euro». /annulla per lasciar perdere.`);
      }
      return invia(chat, "Per creare il piatto con questa foto mi serve anche il prezzo, es. «aggiungi Cabernet Sauvignon alla carta dei vini a 34 euro».");
    }
    fotoInAttesa.delete(chat);
  }

  if (testo === "/start" || testo === "/aiuto") return invia(chat, AIUTO);

  if (testo === "/menu" || testo === "/esauriti") {
    const cat = await catalogo();
    const righe = [];
    for (const c of cat.categorie) {
      const piatti = cat.prodotti.filter((p) => p.categoria_id === c.id && (testo === "/menu" || !p.disponibile));
      if (!piatti.length) continue;
      righe.push(`\n${c.nome.toUpperCase()}`);
      for (const p of piatti) righe.push(`• ${p.nome} — ${euro(p.prezzo_cent)}${p.disponibile ? "" : " (esaurito)"}${p.visibile ? "" : " (nascosto)"}`);
    }
    return invia(chat, righe.length ? righe.join("\n").trim().slice(0, 4000) : testo === "/esauriti" ? "Nessun piatto esaurito." : "Il menu è vuoto.");
  }

  if (testo === "/annulla" && prezziInAttesa.has(chat)) {
    prezziInAttesa.delete(chat);
    return invia(chat, "Lasciato perdere: non ho aggiunto nulla.");
  }
  const attesaPrezzi = prezziInAttesa.get(chat);
  if (attesaPrezzi && !testo.startsWith("/")) {
    prezziInAttesa.delete(chat);
    if (attesaPrezzi.scade > Date.now() && /\d/.test(testo)) {
      const cat = await catalogo();
      const mancanti = attesaPrezzi.voci.filter((v) => !v.euro);
      const solo = testo.trim().match(/^(?:tutt[ei]\s+)?(?:a\s+)?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?(?:\s+(?:l\W?un[oa]|ciascun[oa]|cadaun[oa]))?\s*$/i);
      if (solo) mancanti.forEach((v) => { v.euro = numero(solo[1]); });
      else for (const r of testo.split(/\r?\n|,|;/)) {
        const m = r.trim().match(RIGA_PREZZO);
        const v = m && m[1] && mancanti.find((x) => norm(x.nome) === norm(pulisci(m[1])) || norm(x.nome).startsWith(norm(pulisci(m[1]))));
        if (v) v.euro = numero(m[2]);
      }
      const ancora = attesaPrezzi.voci.filter((v) => !v.euro);
      if (ancora.length) {
        prezziInAttesa.set(chat, { ...attesaPrezzi, scade: Date.now() + 10 * 60_000 });
        return invia(chat, `Mi manca ancora il prezzo di: ${ancora.map((v) => v.nome).join(", ")}. Scrivi un prezzo per tutti (es. «6») oppure «Nome 6», uno per riga.`);
      }
      const azione = attesaPrezzi.categoria ? { azione: "importa", voci: attesaPrezzi.voci, gia: attesaPrezzi.gia }
                                            : { azione: "chiedi_categoria", per: "importa", voci: attesaPrezzi.voci, gia: attesaPrezzi.gia };
      return azione.azione === "chiedi_categoria" ? chiediCategoria(chat, azione, cat) : chiediConferma(chat, azione, cat);
    }
  }
  if (testo === "/annulla" && fotoInAttesa.has(chat)) {
    fotoInAttesa.delete(chat);
    return invia(chat, "Foto scartata: non ho modificato nulla.");
  }
  if (testo === "/annulla") {
    if (!ultimaModifica) return invia(chat, "Non c'è nessuna modifica da annullare.");
    for (const op of ultimaModifica) {
      // Solo le tabelle che il bot modifica; i filtri sono costruiti dal bot con UUID già validati
      if (!TABELLE_ANNULLA.has(op.tabella)) throw new Error("operazione di annullamento non valida");
      if (op.inserisci) await db(op.tabella, { metodo: "POST", corpo: op.inserisci, unisci: !!op.unisci });
      else await db(`${op.tabella}?${op.filtro ?? `id=eq.${uuid(op.id)}`}`, op.elimina ? { metodo: "DELETE" } : { metodo: "PATCH", corpo: op.patch });
    }
    ultimaModifica = null;
    aggiornaMenuPubblico();
    return invia(chat, "↩️ Ultima modifica annullata.");
  }

  const cat = await catalogo();
  let azione = interpretaConRegole(testo, cat);
  if (!azione) {
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    try { azione = await interpretaConModello(testo, cat); }
    catch (e) { log("Modello:", e.message); }
  }
  if (!azione) return invia(chat, "Non ho capito quale modifica fare. Prova ad esempio: «la genovese è esaurita» oppure «aumenta del 5% le pizze». /aiuto per l'elenco dei comandi.");
  if (azione.azione === "comando") return gestisciMessaggio({ ...m, text: azione.comando });
  if (azione.azione === "chiedi_prezzi") {
    prezziInAttesa.set(chat, { voci: azione.voci, categoria: azione.categoria, gia: azione.gia, scade: Date.now() + 10 * 60_000 });
    const senza = azione.voci.filter((v) => !v.euro).map((v) => v.nome);
    return invia(chat, `Aggiungo ${azione.voci.map((v) => v.nome).join(", ")}${azione.categoria ? ` in «${azione.categoria.nome}»` : ""}.\n` +
      `💶 Mi manca il prezzo di: ${senza.join(", ")}.\nScrivi un prezzo per tutti (es. «6») oppure «Nome 6», uno per riga. /annulla per lasciar perdere.`);
  }

  if (azione.azione === "descrivi_vini") azione = await descriviVini(cat, azione.tutti);
  if (azione.azione === "completa_schede_vini") {
    azione = await completaSchedeVini(cat);
  }
  if (azione.azione === "suggerisci_abbinamenti") {
    await invia(chat, "🧠 Il sommelier ci pensa un momento (può volerci fino a un minuto)…");
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    azione = await suggerisciAbbinamenti(cat);
  }
  if (azione.azione === "chiarisci") return invia(chat, azione.testo);
  if (azione.azione === "non_trovato") {
    return invia(chat, `Non trovo «${azione.cosa.trim()}» nel menu, quindi non ho modificato nulla. Controlla il nome con /menu.`);
  }
  if (azione.azione === "chiedi_categoria") return chiediCategoria(chat, azione, cat);
  return chiediConferma(chat, azione, cat);
}

/** Pulsanti per scegliere la categoria (variazione prezzi, nuovo piatto, elenco da importare). */
async function chiediCategoria(chat, azione, cat) {
  const prezzi = (azione.per ?? "varia_prezzi") === "varia_prezzi";
  if (!prezzi && !cat.categorie.length) return invia(chat, "Non ci sono ancora categorie: creane una, ad esempio «crea la categoria Pizze».");
  const id = Math.random().toString(36).slice(2, 10);
  inAttesa.set(id, { azione, catalogo: cat, chat, scade: Date.now() + 10 * 60_000 });
  const pulsanti = cat.categorie.slice(0, 30).map((c, i) => [{ text: c.nome, callback_data: `cat:${id}:${i}` }]);
  if (prezzi) pulsanti.push([{ text: "Tutto il menu", callback_data: `cat:${id}:tutte` }]);
  const domanda = prezzi ? `Variazione ${azione.percentuale > 0 ? "+" : ""}${azione.percentuale}%: su quale categoria?`
    : azione.per === "aggiungi_piatto" ? `In quale categoria aggiungo «${azione.nome}»?`
    : "In quale categoria metto i piatti che non hanno una categoria nell'elenco?";
  return invia(chat, domanda, { reply_markup: { inline_keyboard: pulsanti } });
}

async function chiediConferma(chat, azione, cat) {
  const ant = anteprima(azione, cat);
  if (ant.errore) return invia(chat, `⚠️ ${ant.errore}`);
  const id = Math.random().toString(36).slice(2, 10);
  inAttesa.set(id, { azione, catalogo: cat, chat, scade: Date.now() + 10 * 60_000 });
  return invia(chat, `${ant.testo}\n\nConfermi?`, {
    reply_markup: { inline_keyboard: [[{ text: "✅ Conferma", callback_data: `ok:${id}` }, { text: "❌ Annulla", callback_data: `no:${id}` }]] },
  });
}

// ---------------------------------------------------------------- Notifiche di sala (richieste dal tavolo e ordini da confermare)
const notificati = new Set();
let erroreSalaSegnalato = false;
const avvioBot = new Date().toISOString();

/** Utenti gestiti dal backoffice (Impostazioni), aggiornati ogni 30 s; quelli del file di configurazione restano sempre validi. */
let utentiWeb = new Set();
async function aggiornaUtenti() {
  try {
    const righe = await db(`telegram_utenti?select=telegram_id&locale_id=eq.${C.locale}&attivo=eq.true`);
    utentiWeb = new Set(righe.map((r) => String(r.telegram_id)));
  } catch { /* tabella non ancora presente o rete: si tiene l'elenco precedente */ }
}
export const autorizzato = (id) => C.utenti.has(String(id)) || utentiWeb.has(String(id));
const tuttiGliUtenti = () => new Set([...C.utenti, ...utentiWeb]);

export async function controllaSala() {
  const quindici = encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString());
  const dall = encodeURIComponent(avvioBot);
  const [richieste, ordini, conti] = await Promise.all([
    db(`richieste_tavolo?select=id,righe,nota,tavoli(nome)&locale_id=eq.${C.locale}&stato=eq.in_attesa&creato_at=gte.${quindici}&order=creato_at`),
    // Ordini dal telefono: da confermare (casi particolari) oppure già in cucina, solo come aggiornamento
    db(`ordini?select=id,stato,nota,tavoli(nome),righe_ordine(nome,quantita,prezzo_cent,nota,opzioni)&locale_id=eq.${C.locale}&origine=eq.cliente&or=(stato.eq.da_confermare,creato_at.gte.${dall})&order=creato_at`),
    db(`richieste_conto?select=id,nota,sessione_id,tavoli(nome)&locale_id=eq.${C.locale}&stato=eq.in_attesa&order=creato_at`),
  ]);
  const nuove = richieste.filter((r) => !notificati.has(r.id)), nuovi = ordini.filter((o) => !notificati.has(o.id)), nuoviConti = conti.filter((c) => !notificati.has(c.id));
  if (!nuove.length && !nuovi.length && !nuoviConti.length) return;
  // Totale del tavolo per le richieste di conto
  const totali = new Map();
  for (const c of nuoviConti) {
    const ord = await db(`ordini?select=righe_ordine(quantita,prezzo_cent)&sessione_id=eq.${uuid(c.sessione_id)}&stato=neq.rifiutato`);
    totali.set(c.id, ord.reduce((n, o) => n + o.righe_ordine.reduce((m, r) => m + r.quantita * r.prezzo_cent, 0), 0));
  }
  const prodotti = nuove.length ? new Map((await db(`prodotti?select=id,nome,prezzo_cent&locale_id=eq.${C.locale}`)).map((p) => [p.id, p])) : new Map();
  const voci = nuove.length ? new Map((await db(`opzioni?select=id,nome,sovrapprezzo_cent&locale_id=eq.${C.locale}`)).map((v) => [v.id, v])) : new Map();
  const conScelte = (righe) => righe.map((r) => ({ ...r, scelte: (Array.isArray(r.opzioni) ? r.opzioni : []).map((o) => o.nome) }));
  const righeTesto = (righe) => righe.map((r) => `• ${r.quantita}× ${r.nome}${r.scelte?.length ? ` (${r.scelte.join(", ")})` : ""}${r.nota ? ` — ${r.nota}` : ""}`).join("\n");
  const messaggi = [
    ...nuove.map((r) => {
      const righe = r.righe.map((x) => {
        const scelte = (Array.isArray(x.opzioni) ? x.opzioni : []).map((id) => voci.get(id)).filter(Boolean);
        return { ...x, nome: prodotti.get(x.prodotto_id)?.nome ?? "?", scelte: scelte.map((v) => v.nome),
                 prezzo_cent: (prodotti.get(x.prodotto_id)?.prezzo_cent ?? 0) + scelte.reduce((n, v) => n + v.sovrapprezzo_cent, 0) };
      });
      return { id: r.id, testo: `🔔 Tavolo ${r.tavoli?.nome ?? "?"} vuole ordinare\n${righeTesto(righe)}\nTotale ${euro(righe.reduce((n, x) => n + x.quantita * x.prezzo_cent, 0))}${r.nota ? `\n📝 ${r.nota}` : ""}`,
               pulsanti: [{ text: "✅ Apri tavolo e conferma", callback_data: `sa:${r.id}` }, { text: "❌ Rifiuta", callback_data: `sr:${r.id}` }] };
    }),
    ...nuovi.map((o) => o.stato === "da_confermare"
      ? { id: o.id, testo: `⏳ Tavolo ${o.tavoli?.nome ?? "?"}: ordine da confermare\n${righeTesto(conScelte(o.righe_ordine))}\nTotale ${euro(o.righe_ordine.reduce((n, x) => n + x.quantita * x.prezzo_cent, 0))}${o.nota ? `\n📝 ${o.nota}` : ""}`,
          pulsanti: [{ text: "✅ Conferma", callback_data: `so:${o.id}` }, { text: "❌ Rifiuta", callback_data: `sx:${o.id}` }] }
      : { id: o.id, testo: `🍽️ Tavolo ${o.tavoli?.nome ?? "?"} ha ordinato (in cucina)\n${righeTesto(conScelte(o.righe_ordine))}\nTotale ${euro(o.righe_ordine.reduce((n, x) => n + x.quantita * x.prezzo_cent, 0))}${o.nota ? `\n📝 ${o.nota}` : ""}` }),
    ...nuoviConti.map((c) => ({ id: c.id, testo: `🧾 Tavolo ${c.tavoli?.nome ?? "?"} chiede il conto · ${euro(totali.get(c.id) ?? 0)}${c.nota ? `\n📝 ${c.nota}` : ""}\nStampalo dal gestionale.`,
                               pulsanti: [{ text: "✅ Gestita", callback_data: `sc:${c.id}` }] })),
  ];
  for (const m of messaggi) {
    notificati.add(m.id);
    for (const utente of tuttiGliUtenti()) {
      await tg("sendMessage", { chat_id: utente, text: m.testo, ...(m.pulsanti ? { reply_markup: { inline_keyboard: [m.pulsanti] } } : {}) })
        .catch((e) => log(`Notifica non inviata: ${e.message}`));
    }
  }
  if (notificati.size > 2000) notificati.clear();
}

export async function gestisciSala(q, tipo, id) {
  const chiudi = (esito) => tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `${q.message.text}\n\n${esito}` });
  try {
    if (tipo === "sa") {
      const r = await db("rpc/accetta_richiesta", { metodo: "POST", corpo: { p_richiesta: id, p_coperti: 2 } });
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: `Codice ${r.codice}` });
      return chiudi(`✅ Tavolo aperto · codice ${r.codice} · ordine in cucina.\nIl codice arriva da solo sul telefono del cliente. Coperti impostati a 2: correggili dalla Sala se serve.`);
    }
    if (tipo === "sr") await db("rpc/rifiuta_richiesta", { metodo: "POST", corpo: { p_richiesta: id, p_motivo: "Chiedi al personale al tavolo" } });
    if (tipo === "sc") {
      await db("rpc/gestisci_conto", { metodo: "POST", corpo: { p_richiesta: id } });
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Fatto" });
      return chiudi("✅ Conto gestito.");
    }
    if (tipo === "so" || tipo === "sx") {
      await db("rpc/decidi_ordine", { metodo: "POST", corpo: { p_ordine: id, p_conferma: tipo === "so", p_motivo: tipo === "sx" ? "Chiedi al personale al tavolo" : "" } });
    }
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Fatto" });
    return chiudi(tipo === "so" ? "✅ Ordine confermato." : "❌ Rifiutato.");
  } catch (e) {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Non riuscito" });
    return chiudi(`⚠️ ${e.message}`);
  }
}

export async function gestisciPulsante(q) {
  const [tipo, id, scelta] = String(q.data || "").split(":");
  if (["sa", "sr", "so", "sx", "sc"].includes(tipo)) return gestisciSala(q, tipo, id);
  const pend = inAttesa.get(id);
  inAttesa.delete(id);
  if (tipo === "cat" && pend && pend.scade >= Date.now()) {
    const categoria = scelta === "tutte" ? null : pend.catalogo.categorie[Number(scelta)] ?? null;
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    await tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id,
      text: `${q.message.text}\n→ ${categoria ? categoria.nome : "Tutto il menu"}` });
    const a = pend.azione;
    const per = a.per ?? "varia_prezzi";
    if (per !== "varia_prezzi" && !categoria) return invia(pend.chat, "Serve una categoria: richiesta annullata.");
    const azione = per === "varia_prezzi" ? { azione: "varia_prezzi", percentuale: a.percentuale, categoria }
      : per === "aggiungi_piatto" ? { azione: "aggiungi_piatto", nome: a.nome, euro: a.euro, descrizione: a.descrizione, foto: a.foto, categoria }
      : { azione: "importa", voci: a.voci.map((v) => ({ ...v, categoria: v.categoria ?? categoria })) };
    return chiediConferma(pend.chat, azione, pend.catalogo);
  }
  const chiudi = (testo) => tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: testo });
  if (!pend || pend.scade < Date.now()) {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Richiesta scaduta: inviala di nuovo." });
    return chiudi(`${q.message.text}\n\n⌛ Scaduta.`);
  }
  if (tipo === "no") {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Annullato" });
    return chiudi(`${q.message.text.replace(/\n\nConfermi\?$/, "")}\n\n❌ Annullato, nessuna modifica.`);
  }
  try {
    const { esito, annulla } = await esegui(pend.azione, pend.catalogo);
    ultimaModifica = annulla;
    aggiornaMenuPubblico();
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Fatto" });
    return chiudi(`${q.message.text.replace(/\n\nConfermi\?$/, "")}\n\n✅ ${esito} Scrivi /annulla per tornare indietro.`);
  } catch (e) {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Errore" });
    return chiudi(`${q.message.text.replace(/\n\nConfermi\?$/, "")}\n\n⚠️ Non applicata: ${e.message}`);
  }
}

// ---------------------------------------------------------------- Ciclo principale (long polling: nessuna porta aperta)
async function avvia() {
  const io = await tg("getMe");
  log(`Bot @${io.username} avviato. Utenti autorizzati: ${C.utenti.size}`);
  await aggiornaUtenti();
  setInterval(() => void aggiornaUtenti(), 30_000);
  // Controllo della sala ogni 5 secondi, in parallelo alla ricezione dei messaggi
  let inCorso = false;
  setInterval(async () => {
    if (inCorso) return;
    inCorso = true;
    try { await controllaSala(); erroreSalaSegnalato = false; }
    catch (e) { if (!erroreSalaSegnalato) { log(`Notifiche di sala non disponibili: ${e.message}`); erroreSalaSegnalato = true; } }
    finally { inCorso = false; }
  }, 5_000);
  // Menu in inglese: ogni minuto traduce con l'IA locale le voci nuove o cambiate, poi aggiorna il menu pubblico
  let traduzioneInCorso = false;
  setInterval(async () => {
    if (traduzioneInCorso) return;
    traduzioneInCorso = true;
    try { if (await traduciMenu({ db, chiediModello, locale: C.locale, log }) > 0) await aggiornaMenuPubblico(); }
    catch (e) { log(`Traduzione del menu non riuscita: ${e.message}`); }
    finally { traduzioneInCorso = false; }
  }, 60_000);
  await jwt();
  let offset = 0, attesa = 1000;
  for (;;) {
    try {
      const aggiornamenti = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      attesa = 1000;
      for (const u of aggiornamenti) {
        offset = u.update_id + 1;
        const da = u.message?.from?.id ?? u.callback_query?.from?.id;
        const privata = (u.message?.chat?.type ?? u.callback_query?.message?.chat?.type) === "private";
        if (!privata) continue;
        if (!autorizzato(da)) {
          // A chi non è autorizzato il bot dice solo il suo ID, da comunicare al titolare
          if (/^\/(id|start)\b/.test(u.message?.text ?? "")) {
            await invia(u.message.chat.id, `Il tuo ID Telegram è ${da}.\nComunicalo al titolare: lo aggiunge dal gestionale (Impostazioni).`).catch(() => {});
          }
          log(`Messaggio da utente non autorizzato ${da}`);
          continue;
        }
        try {
          if (u.message) await gestisciMessaggio(u.message);
          else if (u.callback_query) await gestisciPulsante(u.callback_query);
        } catch (e) {
          log("Errore:", e.message);
          const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
          if (chat) await invia(chat, `⚠️ ${e.message}`).catch(() => {});
        }
      }
      for (const [k, v] of inAttesa) if (v.scade < Date.now()) inAttesa.delete(k);
    } catch (e) {
      // Offline o Telegram irraggiungibile: riprova con attesa crescente fino a 1 minuto
      log("Collegamento a Telegram non riuscito:", e.message);
      await new Promise((r) => setTimeout(r, attesa));
      attesa = Math.min(attesa * 2, 60_000);
    }
  }
}

if (process.env.BOT_TEST !== "1") avvia();
