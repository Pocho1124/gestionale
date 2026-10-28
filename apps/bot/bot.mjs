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
    db(`categorie?select=id,nome&locale_id=eq.${C.locale}&order=posizione,nome`),
    db(`prodotti?select=id,nome,prezzo_cent,disponibile,visibile,categoria_id&locale_id=eq.${C.locale}&order=posizione,nome`),
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

export function interpretaConRegole(testo, cat) {
  const t = norm(testo);
  const prodotto = () => trova(testo, cat.prodotti);

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

  const prezzo = t.match(/(\d+(?:[.,]\d{1,2})?)\s*(€|euro|eur)\b/)
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
      azione: { type: "string", enum: ["varia_prezzi", "imposta_prezzo", "disponibilita", "visibilita", "nessuna"] },
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
          "visibilita: prodotto e valore (false = nascosto dal menu). Se non è una modifica, azione 'nessuna'." },
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
      return { testo: `Variazione ${a.percentuale > 0 ? "+" : ""}${a.percentuale}% su ${dove} (${coinvolti.length} piatti, arrotondati a 0,10 €):\n${righe.join("\n")}` };
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
      return { esito: `${n} prezzi aggiornati.`, annulla: prima.map((x) => ({ id: x.id, patch: { prezzo_cent: x.prezzo_cent } })) };
    }
    case "imposta_prezzo":
      await db(`prodotti?id=eq.${a.prodotto.id}`, { metodo: "PATCH", corpo: { prezzo_cent: Math.round(a.euro * 100) } });
      return { esito: "Prezzo aggiornato.", annulla: [{ id: a.prodotto.id, patch: { prezzo_cent: a.prodotto.prezzo_cent } }] };
    case "disponibilita":
      await db("rpc/imposta_disponibilita", { metodo: "POST", corpo: { p_prodotto: a.prodotto.id, p_disponibile: a.valore } });
      return { esito: "Disponibilità aggiornata.", annulla: [{ id: a.prodotto.id, patch: { disponibile: a.prodotto.disponibile } }] };
    case "visibilita":
      await db(`prodotti?id=eq.${a.prodotto.id}`, { metodo: "PATCH", corpo: { visibile: a.valore } });
      return { esito: "Visibilità aggiornata.", annulla: [{ id: a.prodotto.id, patch: { visibile: a.prodotto.visibile } }] };
    default:
      throw new Error("Azione non riconosciuta");
  }
}

// ---------------------------------------------------------------- Conversazione
const inAttesa = new Map();   // id -> { azione, catalogo, chat, scade }
let ultimaModifica = null;    // operazioni per /annulla

const AIUTO =
  "Scrivimi cosa vuoi cambiare nel menu, ad esempio:\n" +
  "• aumenta del 5% le pizze\n• la genovese è esaurita\n• la margherita costa 7 euro\n• nascondi la marinara\n\n" +
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
    for (const op of ultimaModifica) await db(`prodotti?id=eq.${op.id}`, { metodo: "PATCH", corpo: op.patch });
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

  if (azione.azione === "chiedi_categoria") {
    const id = Math.random().toString(36).slice(2, 10);
    inAttesa.set(id, { azione, catalogo: cat, chat, scade: Date.now() + 10 * 60_000 });
    const pulsanti = cat.categorie.map((c, i) => [{ text: c.nome, callback_data: `cat:${id}:${i}` }]);
    pulsanti.push([{ text: "Tutto il menu", callback_data: `cat:${id}:tutte` }]);
    return invia(chat, `Variazione ${azione.percentuale > 0 ? "+" : ""}${azione.percentuale}%: su quale categoria?`, { reply_markup: { inline_keyboard: pulsanti } });
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
    return chiediConferma(pend.chat, { azione: "varia_prezzi", percentuale: pend.azione.percentuale, categoria }, pend.catalogo);
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
