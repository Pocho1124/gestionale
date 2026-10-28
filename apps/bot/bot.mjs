// Bot Telegram privato del gestionale.
// Interpreta le richieste (prima con regole, poi con il modello locale Ollama), mostra un'anteprima
// e applica la modifica solo dopo conferma, con l'account dedicato del bot (permessi RLS, audit).
// Nessuna dipendenza esterna: Node 22 (fetch nativo). Configurazione da variabili d'ambiente.

const C = {
  token: obbligatoria("TELEGRAM_TOKEN"),
  utenti: new Set(obbligatoria("TELEGRAM_UTENTI").split(",").map((s) => s.trim()).filter(Boolean)),
  url: obbligatoria("SUPABASE_URL").replace(/\/$/, ""),
  anon: obbligatoria("SUPABASE_ANON_KEY"),
  email: obbligatoria("BOT_EMAIL"),
  password: obbligatoria("BOT_PASSWORD"),
  locale: obbligatoria("LOCALE_ID"),
  ollama: (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, ""),
  modello: process.env.OLLAMA_MODELLO || "qwen2.5:3b",
};

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

async function db(percorso, { metodo = "GET", corpo } = {}) {
  const r = await fetch(`${C.url}/rest/v1/${percorso}`, {
    method: metodo,
    headers: {
      apikey: C.anon, Authorization: `Bearer ${await jwt()}`,
      "Content-Type": "application/json", Prefer: "return=representation",
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
  const [categorie, prodotti] = await Promise.all([
    db(`categorie?select=id,nome,posizione&locale_id=eq.${C.locale}&order=posizione,nome`),
    db(`prodotti?select=id,nome,prezzo_cent,disponibile,visibile,categoria_id,posizione&locale_id=eq.${C.locale}&order=posizione,nome`),
  ]);
  return { categorie, prodotti };
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
  const con = resto.match(/\s(?:con|:)\s+(.+)$/i);
  if (con) { descrizione = pulisci(con[1]); resto = resto.slice(0, con.index); }
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

export function interpretaConRegole(testo, cat) {
  const elenco = interpretaElenco(testo, cat);
  if (elenco) return elenco;
  const t = norm(testo);
  const prodotto = () => trova(testo, cat.prodotti);

  const via = testo.match(/^\s*(?:elimina|cancella|rimuovi|togli)\s+(?:la\s+|il\s+)?(categoria|piatto)?\s*(.+)$/i);
  if (via && !/\bdal menu\b/i.test(testo)) {
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
async function interpretaConModello(testo, cat) {
  // Prompt corto = risposta rapida: solo i piatti che somigliano alla richiesta
  const parole = new Set(radici(testo));
  const simili = cat.prodotti.filter((p) => radici(p.nome).some((r) => parole.has(r)));
  const piatti = (simili.length ? simili : cat.prodotti).slice(0, 40);
  const nomiCat = cat.categorie.map((c) => c.nome);
  const nomiPiatti = piatti.map((p) => p.nome);

  const schema = {
    type: "object",
    properties: {
      azione: { type: "string", enum: ["varia_prezzi", "imposta_prezzo", "disponibilita", "visibilita", "aggiungi_piatto", "aggiungi_categoria", "nessuna"] },
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
  const r = await fetch(`${C.ollama}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: C.modello, stream: false, format: schema, options: { temperature: 0 },
      messages: [
        { role: "system", content:
          "Converti la richiesta del ristoratore in UNA azione JSON. " +
          "varia_prezzi: percentuale (negativa per ridurre) e categoria ('tutte' per tutto il menu). " +
          "imposta_prezzo: prodotto ed euro. disponibilita: prodotto e valore (false = esaurito). " +
          "visibilita: prodotto e valore (false = nascosto dal menu). " +
          "aggiungi_piatto: nome del nuovo piatto, euro, categoria, descrizione facoltativa. aggiungi_categoria: nome. " +
          "Se non è una modifica, azione 'nessuna'." },
        { role: "user", content: `Categorie: ${nomiCat.join(", ") || "nessuna"}\nPiatti: ${nomiPiatti.join(", ") || "nessuno"}\nRichiesta: ${testo}` },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Modello non disponibile (${r.status})`);
  const out = JSON.parse((await r.json()).message.content);
  const p = cat.prodotti.find((x) => x.nome === out.prodotto);
  const c = cat.categorie.find((x) => x.nome === out.categoria) ?? null;
  switch (out.azione) {
    case "varia_prezzi": {
      if (!Number.isFinite(out.percentuale) || out.percentuale === 0) return null;
      if (c) return { azione: "varia_prezzi", percentuale: out.percentuale, categoria: c };
      return TUTTO.test(norm(testo)) ? { azione: "varia_prezzi", percentuale: out.percentuale, categoria: null }
                                    : { azione: "chiedi_categoria", percentuale: out.percentuale };
    }
    case "imposta_prezzo": return p && out.euro > 0 ? { azione: "imposta_prezzo", prodotto: p, euro: out.euro } : null;
    case "disponibilita": return p && typeof out.valore === "boolean" ? { azione: "disponibilita", prodotto: p, valore: out.valore } : null;
    case "visibilita": return p && typeof out.valore === "boolean" ? { azione: "visibilita", prodotto: p, valore: out.valore } : null;
    case "aggiungi_categoria": return out.nome?.trim() ? { azione: "aggiungi_categoria", nome: maiuscola(pulisci(out.nome)).slice(0, 80) } : null;
    case "aggiungi_piatto": {
      if (!out.nome?.trim() || !(out.euro > 0)) return null;
      const piatto = { nome: maiuscola(pulisci(out.nome)).slice(0, 120), euro: out.euro, descrizione: (out.descrizione ?? "").slice(0, 500) };
      return c ? { azione: "aggiungi_piatto", ...piatto, categoria: c } : { azione: "chiedi_categoria", per: "aggiungi_piatto", ...piatto };
    }
    default: return null;
  }
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
      return { testo: `Nuovo piatto in «${a.categoria.nome}»:\n• ${a.nome} — ${euro(c)}${a.descrizione ? `\n  ${a.descrizione}` : ""}\n\nAllergeni ed etichette si completano dal backoffice.` };
    }
    case "importa": {
      const valide = a.voci.filter((v) => v.euro > 0 && v.euro <= 100000);
      if (!valide.length) return { errore: "Nessun piatto con prezzo valido nell'elenco." };
      const nuoveCat = [...new Set(valide.filter((v) => v.categoria.nuova).map((v) => v.categoria.nome))];
      const righe = valide.slice(0, 25).map((v) => `• [${v.categoria.nome}] ${v.nome} — ${euro(Math.round(v.euro * 100))}`);
      if (valide.length > 25) righe.push(`… e altri ${valide.length - 25}`);
      const scartate = a.voci.length - valide.length;
      return { testo: `Importo ${valide.length} piatti${nuoveCat.length ? ` e creo ${nuoveCat.length} categorie (${nuoveCat.join(", ")})` : ""}:\n${righe.join("\n")}` +
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
      await db(`prodotti?id=eq.${a.prodotto.id}`, { metodo: "PATCH", corpo: { prezzo_cent: Math.round(a.euro * 100) } });
      return { esito: "Prezzo aggiornato.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { prezzo_cent: a.prodotto.prezzo_cent } }] };
    case "disponibilita":
      await db("rpc/imposta_disponibilita", { metodo: "POST", corpo: { p_prodotto: a.prodotto.id, p_disponibile: a.valore } });
      return { esito: "Disponibilità aggiornata.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { disponibile: a.prodotto.disponibile } }] };
    case "visibilita":
      await db(`prodotti?id=eq.${a.prodotto.id}`, { metodo: "PATCH", corpo: { visibile: a.valore } });
      return { esito: "Visibilità aggiornata.", annulla: [{ tabella: "prodotti", id: a.prodotto.id, patch: { visibile: a.prodotto.visibile } }] };
    case "elimina_piatto": {
      const [riga] = await db(`prodotti?id=eq.${a.prodotto.id}&select=*`);
      if (!riga) throw new Error("Il piatto non esiste più");
      await db(`prodotti?id=eq.${a.prodotto.id}`, { metodo: "DELETE" });
      return { esito: `«${a.prodotto.nome}» eliminato.`, annulla: [{ tabella: "prodotti", inserisci: [riga] }] };
    }
    case "elimina_categoria": {
      const [riga] = await db(`categorie?id=eq.${a.categoria.id}&select=*`);
      if (!riga) throw new Error("La categoria non esiste più");
      const piatti = await db(`prodotti?categoria_id=eq.${a.categoria.id}&select=*`);
      await db(`categorie?id=eq.${a.categoria.id}`, { metodo: "DELETE" });
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
      return { esito: `«${a.nome}» aggiunto al menu.`, annulla: [{ tabella: "prodotti", id: p.id, elimina: true }] };
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
      return { esito: `${creati.length} piatti importati.`, annulla: [...creati.map((p) => ({ tabella: "prodotti", id: p.id, elimina: true })), ...annulla] };
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
  "• oppure incolla un elenco, una riga per piatto:\n   Pizze rosse\n   Margherita - 6,50\n   Diavola - 8 | salame piccante\n\n" +
  "Comandi: /menu (prezzi), /esauriti, /annulla (annulla l'ultima modifica).\n" +
  "Prima di ogni modifica ti mostro un'anteprima da confermare.";

async function gestisciMessaggio(m) {
  const chat = m.chat.id;
  const testo = (m.text || "").trim();
  if (!testo) return;

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

  if (testo === "/annulla") {
    if (!ultimaModifica) return invia(chat, "Non c'è nessuna modifica da annullare.");
    for (const op of ultimaModifica) {
      if (op.inserisci) await db(op.tabella, { metodo: "POST", corpo: op.inserisci });
      else await db(`${op.tabella}?id=eq.${op.id}`, op.elimina ? { metodo: "DELETE" } : { metodo: "PATCH", corpo: op.patch });
    }
    ultimaModifica = null;
    return invia(chat, "↩️ Ultima modifica annullata.");
  }

  const cat = await catalogo();
  let azione = interpretaConRegole(testo, cat);
  if (!azione) {
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    try { azione = await interpretaConModello(testo, cat); }
    catch (e) { log("Modello:", e.message); }
  }
  if (!azione) return invia(chat, "Non ho capito quale modifica fare. Prova ad esempio: «la genovese è esaurita» oppure «aumenta del 5% le pizze».");

  if (azione.azione === "non_trovato") {
    return invia(chat, `Non trovo «${azione.cosa.trim()}» nel menu, quindi non elimino nulla. Controlla il nome con /menu.`);
  }
  if (azione.azione === "chiedi_categoria") {
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
  return chiediConferma(chat, azione, cat);
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

async function gestisciPulsante(q) {
  const [tipo, id, scelta] = String(q.data || "").split(":");
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
      : per === "aggiungi_piatto" ? { azione: "aggiungi_piatto", nome: a.nome, euro: a.euro, descrizione: a.descrizione, categoria }
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
        if (!privata || !C.utenti.has(String(da))) { log(`Ignorato messaggio da utente non autorizzato ${da}`); continue; }
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
