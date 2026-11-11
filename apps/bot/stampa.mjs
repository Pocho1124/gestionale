// Servizio di stampa dei reparti: prende dalla coda le comande da stampare e le invia alle stampanti termiche
// di rete (ESC/POS, porta 9100). Solo connessioni in uscita verso la rete del locale; nessuna porta aperta.
import net from "node:net";

const obbligatoria = (n) => { const v = process.env[n]; if (!v) { console.error(`Manca ${n}`); process.exit(1); } return v; };
const C = {
  url: obbligatoria("SUPABASE_URL").replace(/\/$/, ""),
  // Token del ruolo «servizio_stampa»: legge la coda di stampa e ne aggiorna lo stato, nient'altro
  token: obbligatoria("STAMPA_TOKEN"),
  anon: obbligatoria("SUPABASE_ANON_KEY"),
  intervallo: Math.max(1, Number(process.env.INTERVALLO_SECONDI || 2)) * 1000,
};
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Stesse regole del database: solo reti private del locale (192.168/16, 10/8), mai loopback o reti di Docker; porte 9100-9109
const OTTETTO = "(25[0-5]|2[0-4]\\d|1?\\d?\\d)";
export const IP = new RegExp(`^(192\\.168|10\\.${OTTETTO})\\.${OTTETTO}\\.${OTTETTO}$`);
export const porta = (p) => Number.isInteger(p) && p >= 9100 && p <= 9109;

async function db(percorso, opz = {}) {
  const r = await fetch(`${C.url}/rest/v1/${percorso}`, {
    method: opz.metodo ?? "GET", body: opz.corpo ? JSON.stringify(opz.corpo) : undefined, signal: AbortSignal.timeout(10_000),
    headers: { apikey: C.anon, Authorization: `Bearer ${C.token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 || opz.metodo === "PATCH" ? null : r.json();
}

// ---------------------------------------------------------------- ESC/POS
const ESC = 0x1b, GS = 0x1d;
// Code page 858 (Europa occidentale con €): lettere accentate italiane e simboli comuni
const CP858 = { "€": 0xd5, "à": 0x85, "è": 0x8a, "é": 0x82, "ì": 0x8d, "ò": 0x95, "ù": 0x97, "À": 0xb7, "È": 0xd4, "É": 0x90, "Ì": 0xde, "Ò": 0xe3, "Ù": 0xeb, "°": 0xf8, "«": 0xae, "»": 0xaf, "ç": 0x87, "ñ": 0xa4 };
export function codifica(testo) {
  const out = [];
  for (const ch of testo.normalize("NFC").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")) {
    const c = ch.codePointAt(0);
    if (c === 10 || (c >= 32 && c < 127)) out.push(c);
    else out.push(CP858[ch] ?? 0x3f);   // carattere non stampabile: «?»
  }
  return Buffer.from(out);
}
// Niente comandi di stampa nei testi e niente a capo: una nota del cliente non può simulare una riga dell'ordine sul biglietto
const pulisci = (t) => String(t ?? "").replace(/[\x00-\x1f\x7f]/g, " ");
const tronca = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}.` : t);

export function biglietto(lavoro, righe, colonne) {
  const parti = [Buffer.from([ESC, 0x40, ESC, 0x74, 19])];   // inizializza, code page 858
  const testo = (t) => parti.push(codifica(t));
  const grande = (on) => parti.push(Buffer.from([GS, 0x21, on ? 0x11 : 0x00]));   // doppia altezza e larghezza
  const alto = (on) => parti.push(Buffer.from([GS, 0x21, on ? 0x01 : 0x00]));     // solo doppia altezza: righe intere leggibili
  const centro = (on) => parti.push(Buffer.from([ESC, 0x61, on ? 1 : 0]));
  const linea = () => testo(`${"-".repeat(colonne)}\n`);
  const ora = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/Rome" });
  centro(true);
  if (lavoro.tipo === "prova") {
    grande(true); testo("PROVA DI STAMPA\n"); grande(false);
    testo(`${pulisci(lavoro.stampanti?.nome)}\n${ora}\nàèéìòù € ok\n`);
  } else {
    grande(true);
    testo(`${lavoro.tipo === "annullo" ? "*** ANNULLATO ***\n" : ""}TAVOLO ${tronca(pulisci(lavoro.ordini?.tavoli?.nome ?? "?"), 10)}\n`);
    grande(false);
    testo(`${pulisci(lavoro.reparti?.nome ?? "")} - ${ora}\n`);
    centro(false); linea();
    for (const r of righe) {
      alto(true); testo(`${r.quantita} x ${tronca(pulisci(r.nome), colonne - 5)}\n`); alto(false);
      // Scelte del piatto componibile, una per riga e raggruppate (es. Salumi: …)
      for (const o of Array.isArray(r.opzioni) ? r.opzioni : []) testo(`   - ${tronca(pulisci(o.nome), colonne - 5)}\n`);
      if (r.nota) testo(`   > ${tronca(pulisci(r.nota), colonne - 5)}\n`);
    }
    if (lavoro.ordini?.nota) { linea(); testo(`NOTA: ${tronca(pulisci(lavoro.ordini.nota), colonne * 3)}\n`); }
    linea();
    testo(`${lavoro.ordini?.origine === "cliente" ? "Ordine dal tavolo" : "Comanda di sala"}\n`);
  }
  parti.push(Buffer.from("\n\n\n\n"), Buffer.from([GS, 0x56, 0x42, 0x00]));   // avanzamento e taglio
  return Buffer.concat(parti);
}

function invia(indirizzo, porta, dati) {
  return new Promise((ok, ko) => {
    const s = net.createConnection({ host: indirizzo, port: porta, timeout: 5000 }, () => s.end(dati, () => ok()));
    s.on("timeout", () => { s.destroy(); ko(new Error("stampante non raggiungibile (timeout)")); });
    s.on("error", (e) => ko(new Error(`stampante non raggiungibile (${e.code ?? e.message})`)));
  });
}

async function giro() {
  const lavori = await db("comande_stampa?select=id,tipo,tentativi,ordine_id,reparto_id,stampanti(nome,indirizzo,porta,colonne,attiva),reparti(nome),ordini(nota,origine,tavoli(nome))"
    + "&stato=in.(da_stampare,errore)&tentativi=lt.5&order=creata_at&limit=20");
  for (const l of lavori) {
    try {
      const s = l.stampanti;
      if (!s?.attiva) throw new Error("stampante disattivata");
      if (!IP.test(s.indirizzo) || !porta(s.porta)) throw new Error("indirizzo o porta della stampante non ammessi");
      let righe = [];
      if (l.tipo !== "prova") {
        if (!UUID.test(l.ordine_id) || !UUID.test(l.reparto_id)) throw new Error("comanda non valida");
        righe = await db(`righe_ordine?select=nome,quantita,nota,opzioni&ordine_id=eq.${l.ordine_id}&reparto_id=eq.${l.reparto_id}`);
      }
      await invia(s.indirizzo, s.porta, biglietto(l, righe, s.colonne));
      await db(`comande_stampa?id=eq.${l.id}`, { metodo: "PATCH", corpo: { stato: "stampata", stampata_at: new Date().toISOString(), errore: "" } });
      log(`Stampata ${l.tipo} su ${s.nome}`);
    } catch (e) {
      await db(`comande_stampa?id=eq.${l.id}`, { metodo: "PATCH", corpo: { stato: "errore", tentativi: l.tentativi + 1, errore: String(e.message).slice(0, 200) } }).catch(() => {});
      log(`Errore di stampa: ${e.message}`);
    }
  }
}

if (!process.env.STAMPA_TEST) {
  log("Servizio di stampa avviato");
  for (;;) {
    try { await giro(); } catch (e) { log(`Coda non raggiungibile: ${e.message}`); }
    await new Promise((r) => setTimeout(r, C.intervallo));
  }
}
