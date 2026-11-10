import { useCallback, useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { euro } from "../lib/formato";

interface Report {
  dal: string; al: string; conti: number; coperti: number; totale_cent: number; sconti_cent: number;
  scontrino_medio_cent: number; medio_coperto_cent: number;
  precedente: { conti: number; coperti: number; totale_cent: number };
  per_giorno: { giorno: string; conti: number; coperti: number; totale_cent: number }[];
  per_ora: { ora: number; conti: number; totale_cent: number }[];
  per_categoria: { categoria: string; quantita: number; totale_cent: number }[];
  piu_venduti: { nome: string; quantita: number; totale_cent: number }[];
  per_pagamento: Record<string, number>;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const giorniFa = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PERIODI: { nome: string; dal: () => string }[] = [
  { nome: "Oggi", dal: () => giorniFa(0) },
  { nome: "7 giorni", dal: () => giorniFa(6) },
  { nome: "30 giorni", dal: () => giorniFa(29) },
  { nome: "Questo mese", dal: () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); } },
  { nome: "Quest'anno", dal: () => `${new Date().getFullYear()}-01-01` },
];
const METODI: Record<string, string> = { contanti: "Contanti", carta: "Carta / POS", altro: "Altro" };

/** Variazione rispetto al periodo precedente di uguale durata. */
function Variazione({ ora, prima }: { ora: number; prima: number }) {
  if (!prima) return <small className="muto">nessun dato prima</small>;
  const v = Math.round(((ora - prima) / prima) * 100);
  return <small className={v >= 0 ? "variazione su" : "variazione giu"}>{v >= 0 ? "▲" : "▼"} {Math.abs(v)}% sul periodo prima</small>;
}

/** Barre orizzontali proporzionali al valore massimo (grafico semplice, leggibile anche su tablet). */
function Barre({ voci }: { voci: { etichetta: string; valore: number; testo: string }[] }) {
  const massimo = Math.max(1, ...voci.map((v) => v.valore));
  return (
    <ul className="barre">
      {voci.map((v) => (
        <li key={v.etichetta}>
          <span className="barre-etichetta">{v.etichetta}</span>
          <span className="barre-traccia"><i style={{ width: `${Math.max(2, (v.valore / massimo) * 100)}%` }} /></span>
          <span className="barre-valore">{v.testo}</span>
        </li>
      ))}
    </ul>
  );
}

/** Report degli incassi per periodo (solo titolare): i numeri li calcola il database. */
export function ReportIncassi({ locale }: { locale: string }) {
  const avvisa = useAvviso();
  const [dal, setDal] = useState(giorniFa(6));
  const [al, setAl] = useState(giorniFa(0));
  const [r, setR] = useState<Report | null>(null);

  const carica = useCallback(async () => {
    const { data, error } = await sb().rpc("report_incassi", { p_locale: locale, p_dal: dal, p_al: al });
    if (error) { avvisa(messaggioErrore(error), "errore"); setR(null); return; }
    setR(data as Report);
  }, [locale, dal, al, avvisa]);
  useEffect(() => { void carica(); }, [carica]);

  return (
    <section className="blocco report-incassi">
      <div className="blocco-testa">
        <h2>Report incassi</h2>
        <div className="riga-form">
          {PERIODI.map((p) => (
            <button key={p.nome} className={`chip${dal === p.dal() && al === giorniFa(0) ? " attivo" : ""}`} onClick={() => { setDal(p.dal()); setAl(giorniFa(0)); }}>{p.nome}</button>
          ))}
          <input type="date" value={dal} max={al} onChange={(e) => e.target.value && setDal(e.target.value)} aria-label="Dal giorno" />
          <input type="date" value={al} min={dal} onChange={(e) => e.target.value && setAl(e.target.value)} aria-label="Al giorno" />
        </div>
      </div>
      {!r ? <p className="muto">Caricamento…</p> : r.conti === 0 ? <p className="muto">Nessun conto chiuso in questo periodo.</p> : (
        <>
          <div className="cruscotto">
            <div className="cruscotto-voce"><span>Incasso</span><strong>{euro(r.totale_cent)}</strong><Variazione ora={r.totale_cent} prima={r.precedente.totale_cent} /></div>
            <div className="cruscotto-voce"><span>Conti</span><strong>{r.conti}</strong><Variazione ora={r.conti} prima={r.precedente.conti} /></div>
            <div className="cruscotto-voce"><span>Coperti</span><strong>{r.coperti}</strong><Variazione ora={r.coperti} prima={r.precedente.coperti} /></div>
            <div className="cruscotto-voce"><span>Scontrino medio</span><strong>{euro(r.scontrino_medio_cent)}</strong><small>{euro(r.medio_coperto_cent)} a coperto</small></div>
            {r.sconti_cent > 0 && <div className="cruscotto-voce"><span>Sconti</span><strong>{euro(r.sconti_cent)}</strong></div>}
          </div>
          <div className="report-griglia">
            {r.per_giorno.length > 1 && (
              <div><h3>Per giorno</h3>
                <Barre voci={r.per_giorno.map((g) => ({ etichetta: new Date(`${g.giorno}T12:00`).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }),
                  valore: g.totale_cent, testo: `${euro(g.totale_cent)} · ${g.coperti} cop.` }))} /></div>
            )}
            <div><h3>Per ora di arrivo</h3>
              <Barre voci={r.per_ora.map((h) => ({ etichetta: `${String(h.ora).padStart(2, "0")}:00`, valore: h.totale_cent, testo: `${euro(h.totale_cent)} · ${h.conti} conti` }))} /></div>
            <div><h3>Per categoria</h3>
              <Barre voci={r.per_categoria.map((c) => ({ etichetta: c.categoria, valore: c.totale_cent, testo: euro(c.totale_cent) }))} /></div>
            <div><h3>Più venduti</h3>
              <Barre voci={r.piu_venduti.map((p) => ({ etichetta: p.nome, valore: p.quantita, testo: `${p.quantita} · ${euro(p.totale_cent)}` }))} /></div>
            {Object.keys(r.per_pagamento).length > 0 && (
              <div><h3>Pagamenti</h3>
                <Barre voci={Object.entries(r.per_pagamento).map(([k, v]) => ({ etichetta: METODI[k] ?? k, valore: v, testo: euro(v) }))} /></div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
