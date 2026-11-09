import { centesimi, formatta } from "@gest/core";

/** Fattura come la restituisce il database (importi e scorporo IVA già calcolati lì). */
export interface Fattura {
  id: string; anno: number; numero: number; data: string; sessione_id: string | null; creato_at: string;
  cedente: { denominazione: string; partita_iva: string; codice_fiscale: string; regime_fiscale: string; indirizzo: string; cap: string; comune: string; provincia: string };
  cliente: {
    denominazione: string; nome: string; cognome: string; partita_iva: string; codice_fiscale: string; indirizzo: string; cap: string;
    comune: string; provincia: string; nazione: string; codice_destinatario: string; pec: string;
  };
  righe: { descrizione: string; quantita: number; prezzo_cent: number; aliquota: number; prezzo_unitario: string; totale_netto_cent: number }[];
  riepilogo: { aliquota: number; imponibile_cent: number; imposta_cent: number }[];
  imponibile_cent: number; imposta_cent: number; totale_cent: number; modalita: "MP01" | "MP08" | null;
}

const euro = (c: number) => formatta(centesimi(c));
const importo = (c: number) => (c / 100).toFixed(2);
const aliquota = (a: number) => Number(a).toFixed(2);
export const nomeCliente = (f: Fattura) => f.cliente.denominazione || `${f.cliente.nome} ${f.cliente.cognome}`.trim();

/** Il formato FatturaPA ammette solo caratteri latini di base: apostrofi e trattini tipografici diventano semplici. */
function latino(t: string) {
  return t.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^ -~ -ÿ]/g, "");
}
const xml = (t: string) => latino(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tag = (nome: string, valore: string | number) => `<${nome}>${xml(String(valore))}</${nome}>`;
const seC = (nome: string, valore: string) => (valore ? tag(nome, valore) : "");

/** Progressivo di invio (5 caratteri): ultime due cifre dell'anno + numero in base 36. */
const progressivo = (f: Fattura) => `${String(f.anno).slice(-2)}${f.numero.toString(36).toUpperCase().padStart(3, "0")}`;
export const nomeFileXml = (f: Fattura) => `IT${f.cedente.partita_iva}_${progressivo(f)}.xml`;

const sede = (s: { indirizzo: string; cap: string; comune: string; provincia: string }, nazione = "IT") =>
  `<Sede>${tag("Indirizzo", s.indirizzo)}${tag("CAP", s.cap)}${tag("Comune", s.comune)}${seC("Provincia", s.provincia)}${tag("Nazione", nazione)}</Sede>`;

/** XML FatturaPA 1.2 (FPR12, fattura TD01) da caricare sul portale «Fatture e Corrispettivi» o da dare all'intermediario. */
export function xmlFattura(f: Fattura): string {
  const c = f.cliente, e = f.cedente;
  const destinatario = c.codice_destinatario || "0000000";
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
<FatturaElettronicaHeader>
<DatiTrasmissione><IdTrasmittente>${tag("IdPaese", "IT")}${tag("IdCodice", e.codice_fiscale || e.partita_iva)}</IdTrasmittente>${tag("ProgressivoInvio", progressivo(f))}${tag("FormatoTrasmissione", "FPR12")}${tag("CodiceDestinatario", destinatario)}${destinatario === "0000000" ? seC("PECDestinatario", c.pec) : ""}</DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA>${tag("IdPaese", "IT")}${tag("IdCodice", e.partita_iva)}</IdFiscaleIVA>${seC("CodiceFiscale", e.codice_fiscale)}<Anagrafica>${tag("Denominazione", e.denominazione)}</Anagrafica>${tag("RegimeFiscale", e.regime_fiscale)}</DatiAnagrafici>${sede(e)}</CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici>${c.partita_iva ? `<IdFiscaleIVA>${tag("IdPaese", c.nazione || "IT")}${tag("IdCodice", c.partita_iva)}</IdFiscaleIVA>` : ""}${seC("CodiceFiscale", c.codice_fiscale)}<Anagrafica>${c.denominazione ? tag("Denominazione", c.denominazione) : tag("Nome", c.nome) + tag("Cognome", c.cognome)}</Anagrafica></DatiAnagrafici>${sede(c, c.nazione || "IT")}</CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
<DatiGenerali><DatiGeneraliDocumento>${tag("TipoDocumento", "TD01")}${tag("Divisa", "EUR")}${tag("Data", f.data)}${tag("Numero", f.numero)}${tag("ImportoTotaleDocumento", importo(f.totale_cent))}</DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi>
${f.righe.map((r, i) => `<DettaglioLinee>${tag("NumeroLinea", i + 1)}${tag("Descrizione", r.descrizione)}${tag("Quantita", Number(r.quantita).toFixed(2))}${tag("PrezzoUnitario", r.prezzo_unitario)}${tag("PrezzoTotale", importo(r.totale_netto_cent))}${tag("AliquotaIVA", aliquota(r.aliquota))}</DettaglioLinee>`).join("\n")}
${f.riepilogo.map((x) => `<DatiRiepilogo>${tag("AliquotaIVA", aliquota(x.aliquota))}${tag("ImponibileImporto", importo(x.imponibile_cent))}${tag("Imposta", importo(x.imposta_cent))}${tag("EsigibilitaIVA", "I")}</DatiRiepilogo>`).join("\n")}
</DatiBeniServizi>
${f.modalita ? `<DatiPagamento>${tag("CondizioniPagamento", "TP02")}<DettaglioPagamento>${tag("ModalitaPagamento", f.modalita)}${tag("ImportoPagamento", importo(f.totale_cent))}</DettaglioPagamento></DatiPagamento>` : ""}
</FatturaElettronicaBody>
</p:FatturaElettronica>
`;
}

/** Scarica l'XML sul dispositivo (nessun invio: lo trasmette chi gestisce la fatturazione). */
export function scaricaXml(f: Fattura) {
  const url = URL.createObjectURL(new Blob([xmlFattura(f)], { type: "application/xml" }));
  const a = document.createElement("a");
  a.href = url; a.download = nomeFileXml(f);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STILE = `
  @page { size: A4; margin: 16mm; }
  body { font: 12px/1.45 system-ui, sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: .05em; }
  .blocco { border: 1px solid #bbb; border-radius: 6px; padding: 10px 12px; flex: 1; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; } th, td { padding: 5px 6px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f1f1f1; font-size: 11px; text-transform: uppercase; } td.n, th.n { text-align: right; white-space: nowrap; }
  .totale td { font-weight: 700; font-size: 14px; border-bottom: 0; } .nota { font-size: 10px; color: #555; margin-top: 18px; }`;

/** Copia di cortesia in A4. Come per il preconto: solo nodi DOM e textContent, CSP che vieta gli script. */
export function stampaFattura(f: Fattura): string | null {
  const finestra = window.open("", "_blank", "width=820,height=900");
  if (!finestra) return "Il browser ha bloccato la finestra di stampa: consenti i popup per questo indirizzo.";
  const d = finestra.document;
  d.open(); d.write("<!doctype html><html lang=\"it\"><head></head><body></body></html>"); d.close();
  const el = <K extends keyof HTMLElementTagNameMap>(nome: K, testo?: string, classe?: string) => {
    const x = d.createElement(nome); if (testo !== undefined) x.textContent = testo; if (classe) x.className = classe; return x;
  };
  const csp = el("meta"); csp.httpEquiv = "Content-Security-Policy"; csp.content = "default-src 'none'; style-src 'unsafe-inline'";
  const charset = el("meta"); charset.setAttribute("charset", "utf-8");
  d.head.append(charset, csp, el("style", STILE));
  d.title = `Fattura ${f.numero}/${f.anno}`;

  const e = f.cedente, c = f.cliente;
  const anagrafica = (titolo: string, righe: string[]) => { const b = el("div", undefined, "blocco"); b.append(el("h2", titolo), ...righe.filter(Boolean).map((r) => el("div", r))); return b; };
  const testata = el("header");
  testata.append(
    anagrafica("Emittente", [e.denominazione, `${e.indirizzo}, ${e.cap} ${e.comune}${e.provincia ? ` (${e.provincia})` : ""}`, `P. IVA ${e.partita_iva}`, e.codice_fiscale ? `C.F. ${e.codice_fiscale}` : ""]),
    anagrafica("Cliente", [nomeCliente(f), `${c.indirizzo}, ${c.cap} ${c.comune}${c.provincia ? ` (${c.provincia})` : ""}`, c.partita_iva ? `P. IVA ${c.partita_iva}` : "",
      c.codice_fiscale ? `C.F. ${c.codice_fiscale}` : "", c.codice_destinatario !== "0000000" ? `Cod. destinatario ${c.codice_destinatario}` : c.pec ? `PEC ${c.pec}` : ""]),
  );
  const tabella = el("table");
  const intestazione = el("tr");
  for (const [t, n] of [["Descrizione", false], ["Q.tà", true], ["Prezzo unit. netto", true], ["IVA", true], ["Importo netto", true]] as const) intestazione.append(el("th", t, n ? "n" : undefined));
  tabella.append(intestazione);
  for (const r of f.righe) {
    const tr = el("tr");
    tr.append(el("td", r.descrizione), el("td", String(r.quantita), "n"), el("td", `${Number(r.prezzo_unitario).toFixed(4).replace(".", ",")} €`, "n"),
      el("td", `${Number(r.aliquota)}%`, "n"), el("td", euro(r.totale_netto_cent), "n"));
    tabella.append(tr);
  }
  const riepilogo = el("table");
  const ri = el("tr"); for (const t of ["Aliquota", "Imponibile", "Imposta"]) ri.append(el("th", t, t === "Aliquota" ? undefined : "n"));
  riepilogo.append(ri);
  for (const x of f.riepilogo) { const tr = el("tr"); tr.append(el("td", `${Number(x.aliquota)}%`), el("td", euro(x.imponibile_cent), "n"), el("td", euro(x.imposta_cent), "n")); riepilogo.append(tr); }
  const tot = el("tr", undefined, "totale"); tot.append(el("td", "TOTALE DOCUMENTO"), el("td", ""), el("td", euro(f.totale_cent), "n")); riepilogo.append(tot);

  d.body.append(
    testata,
    el("h1", `Fattura n. ${f.numero} del ${new Date(`${f.data}T12:00:00`).toLocaleDateString("it-IT")}`),
    tabella, riepilogo,
    el("p", f.modalita === "MP01" ? "Pagamento: contanti" : f.modalita === "MP08" ? "Pagamento: carta" : "", "nota"),
    el("p", "Copia di cortesia: il documento fiscale è il file XML trasmesso al Sistema di Interscambio.", "nota"),
  );
  finestra.focus(); finestra.print(); finestra.close();
  return null;
}
