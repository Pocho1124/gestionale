import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as PE } from "react";
import QRCode from "qrcode";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import type { Aspetto } from "../lib/tipi";

interface Sala { id: string; locale_id: string; nome: string; posizione: number }
interface Tavolo { id: string; locale_id: string; sala_id: string; nome: string; posti: number; forma: "tondo" | "quadrato" | "rettangolo"; x: number; y: number; qr_token: string; attivo: boolean }
interface SessioneT { id: string; tavolo_id: string; coperti: number; codice: string; aperta_at: string }
interface Wifi { locale_id?: string; ssid: string; sicurezza: "WPA" | "WEP" | "nopass"; password: string; nascosta: boolean; url_ordini: string }

const W = 1000, H = 600;
const dimensioni = (t: Tavolo) => {
  const base = 34 + Math.min(t.posti, 12) * 3;
  return t.forma === "rettangolo" ? { w: base * 1.8, h: base } : { w: base, h: base };
};
const minuti = (da: string) => Math.max(0, Math.round((Date.now() - new Date(da).getTime()) / 60000));
const durata = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);

export function Sala() {
  const { locale, puoModificare } = useSessione();
  const avvisa = useAvviso();
  const [vista, setVista] = useState<"servizio" | "piantina" | "cartoncini">("servizio");
  const [sale, setSale] = useState<Sala[]>([]);
  const [tavoli, setTavoli] = useState<Tavolo[]>([]);
  const [sessioni, setSessioni] = useState<SessioneT[]>([]);
  const [salaId, setSalaId] = useState<string | null>(null);
  const [selezionato, setSelezionato] = useState<string | null>(null);
  const [, setOra] = useState(0);

  const carica = useCallback(async () => {
    if (!locale) return;
    const [s, t, x] = await Promise.all([
      sb().from("sale").select("*").eq("locale_id", locale.id).order("posizione").order("nome"),
      sb().from("tavoli").select("*").eq("locale_id", locale.id).order("nome"),
      sb().from("sessioni_tavolo").select("id, tavolo_id, coperti, codice, aperta_at").eq("locale_id", locale.id).is("chiusa_at", null),
    ]);
    const errore = s.error ?? t.error ?? x.error;
    if (errore) { avvisa(messaggioErrore(errore), "errore"); return; }
    setSale(s.data as Sala[]); setTavoli(t.data as Tavolo[]); setSessioni(x.data as SessioneT[]);
    setSalaId((cur) => cur && (s.data as Sala[]).some((z) => z.id === cur) ? cur : (s.data as Sala[])[0]?.id ?? null);
  }, [locale, avvisa]);

  useEffect(() => { void carica(); }, [carica]);

  // Tempo reale: aperture e chiusure fatte da altri tablet compaiono subito
  useEffect(() => {
    if (!locale) return;
    const canale = sb().channel(`sala-${locale.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessioni_tavolo", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .on("postgres_changes", { event: "*", schema: "public", table: "tavoli", filter: `locale_id=eq.${locale.id}` }, () => void carica())
      .subscribe();
    const t = setInterval(() => setOra((n) => n + 1), 30_000);
    return () => { void sb().removeChannel(canale); clearInterval(t); };
  }, [locale, carica]);

  const tavoliSala = tavoli.filter((t) => t.sala_id === salaId && (vista !== "servizio" || t.attivo));
  const sessionePer = (id: string) => sessioni.find((s) => s.tavolo_id === id);
  const tavoloSel = tavoli.find((t) => t.id === selezionato) ?? null;

  if (!locale) return null;
  return (
    <div className="pagina">
      <div className="pagina-testa riga-form" style={{ justifyContent: "space-between" }}>
        <h1>Sala</h1>
        <div className="schede-modo" role="tablist" style={{ maxWidth: 460 }}>
          <button role="tab" aria-selected={vista === "servizio"} onClick={() => setVista("servizio")}>Servizio</button>
          {puoModificare && <button role="tab" aria-selected={vista === "piantina"} onClick={() => setVista("piantina")}>Piantina</button>}
          {puoModificare && <button role="tab" aria-selected={vista === "cartoncini"} onClick={() => setVista("cartoncini")}>Cartoncini QR</button>}
        </div>
      </div>

      {vista !== "cartoncini" && (
        sale.length === 0 ? (
          <div className="vuoto">
            <p>Non ci sono ancora sale.</p>
            {puoModificare ? <p className="muto">Vai su «Piantina» e crea la prima sala, ad esempio «Interno».</p> : <p className="muto">Chiedi al titolare di disegnare la piantina.</p>}
            {puoModificare && vista === "piantina" && <NuovaSala locale={locale.id} onFatto={carica} />}
          </div>
        ) : (
          <>
            <div className="riga-form">
              {sale.map((s) => <button key={s.id} className={`chip${s.id === salaId ? " attivo" : ""}`} onClick={() => setSalaId(s.id)}>{s.nome}</button>)}
              {vista === "servizio" && <span className="muto piccolo">Aperti: {sessioni.length} · Coperti: {sessioni.reduce((n, s) => n + s.coperti, 0)}</span>}
            </div>
            <div className={`sala-layout${vista === "piantina" ? " modifica" : ""}`}>
              <Piantina tavoli={tavoliSala} sessionePer={sessionePer} modificabile={vista === "piantina"} selezionato={selezionato}
                onSeleziona={setSelezionato}
                onSposta={async (t, x, y) => {
                  setTavoli((ts) => ts.map((z) => (z.id === t.id ? { ...z, x, y } : z)));
                  const { error } = await sb().from("tavoli").update({ x, y }).eq("id", t.id);
                  if (error) { avvisa(messaggioErrore(error), "errore"); await carica(); }
                }} />
              <aside className="sala-pannello">
                {vista === "servizio"
                  ? <PannelloServizio tavolo={tavoloSel} sessione={tavoloSel ? sessionePer(tavoloSel.id) : undefined} onFatto={carica} />
                  : <PannelloPiantina locale={locale.id} sala={sale.find((s) => s.id === salaId)!} tavolo={tavoloSel} tavoli={tavoli}
                      onFatto={carica} onSeleziona={setSelezionato} />}
              </aside>
            </div>
          </>
        )
      )}

      {vista === "cartoncini" && <Cartoncini locale={locale} tavoli={tavoli.filter((t) => t.attivo)} sale={sale} />}
    </div>
  );
}

function Piantina(props: {
  tavoli: Tavolo[]; sessionePer: (id: string) => SessioneT | undefined; modificabile: boolean; selezionato: string | null;
  onSeleziona: (id: string) => void; onSposta: (t: Tavolo, x: number, y: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [trascina, setTrascina] = useState<{ id: string; x: number; y: number } | null>(null);
  const punto = (e: PE) => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.round(Math.min(W, Math.max(0, p.x)) / 10) * 10, y: Math.round(Math.min(H, Math.max(0, p.y)) / 10) * 10 };
  };
  return (
    <svg ref={svg} className="piantina" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Piantina della sala"
      onPointerMove={(e) => { if (trascina) setTrascina({ id: trascina.id, ...punto(e) }); }}
      onPointerUp={() => {
        if (!trascina) return;
        const t = props.tavoli.find((z) => z.id === trascina.id);
        if (t && (t.x !== trascina.x || t.y !== trascina.y)) props.onSposta(t, trascina.x, trascina.y);
        setTrascina(null);
      }}>
      {props.modificabile && <pattern id="griglia" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" className="griglia" /></pattern>}
      <rect width={W} height={H} className="piantina-fondo" fill={props.modificabile ? "url(#griglia)" : undefined} />
      {props.tavoli.map((t) => {
        const s = props.sessionePer(t.id);
        const { w, h } = dimensioni(t);
        const pos = trascina?.id === t.id ? trascina : t;
        return (
          <g key={t.id} transform={`translate(${pos.x} ${pos.y})`} className={`tavolo${s ? " aperto" : ""}${props.selezionato === t.id ? " selezionato" : ""}${t.attivo ? "" : " spento"}`}
            tabIndex={0} role="button" aria-label={`Tavolo ${t.nome}${s ? ", aperto" : ", libero"}`}
            onClick={() => props.onSeleziona(t.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onSeleziona(t.id); }}
            onPointerDown={(e) => {
              if (!props.modificabile) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              props.onSeleziona(t.id);
              setTrascina({ id: t.id, x: t.x, y: t.y });
            }}>
            {t.forma === "tondo"
              ? <circle r={w / 2} className="tavolo-forma" />
              : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={8} className="tavolo-forma" />}
            <text className="tavolo-nome" dy={s ? -4 : 6}>{t.nome}</text>
            {s && <text className="tavolo-info" dy={16}>{s.coperti}p · {durata(minuti(s.aperta_at))}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function PannelloServizio({ tavolo, sessione, onFatto }: { tavolo: Tavolo | null; sessione?: SessioneT; onFatto: () => Promise<void> }) {
  const avvisa = useAvviso();
  const [coperti, setCoperti] = useState(2);
  const [attesa, setAttesa] = useState(false);
  useEffect(() => { if (tavolo) setCoperti(Math.min(tavolo.posti, 2) || 2); }, [tavolo]);
  if (!tavolo) return <p className="muto">Tocca un tavolo per aprirlo o chiuderlo.</p>;

  async function esegui(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setAttesa(true);
    const { error } = await fn();
    setAttesa(false);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(ok); await onFatto();
  }

  return (
    <div className="pannello-tavolo">
      <h2>Tavolo {tavolo.nome}</h2>
      {sessione ? (
        <>
          <p>Aperto alle {new Date(sessione.aperta_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} · {durata(minuti(sessione.aperta_at))}</p>
          <p>{sessione.coperti} coperti</p>
          <div className="codice-tavolo"><span className="muto piccolo">Codice del tavolo</span><strong>{sessione.codice}</strong></div>
          <button className="btn btn-pericolo" disabled={attesa}
            onClick={() => { if (confirm(`Chiudere il tavolo ${tavolo.nome}?`)) void esegui(() => sb().rpc("chiudi_tavolo", { p_tavolo: tavolo.id }), `Tavolo ${tavolo.nome} chiuso`); }}>
            Chiudi tavolo
          </button>
        </>
      ) : (
        <>
          <p className="muto">Libero · {tavolo.posti} posti</p>
          <div className="riga-form">
            <span>Coperti</span>
            <button className="btn btn-icona" onClick={() => setCoperti((c) => Math.max(1, c - 1))} aria-label="Meno">−</button>
            <strong style={{ minWidth: 28, textAlign: "center" }}>{coperti}</strong>
            <button className="btn btn-icona" onClick={() => setCoperti((c) => Math.min(60, c + 1))} aria-label="Più">+</button>
          </div>
          <button className="btn btn-pieno" disabled={attesa}
            onClick={() => void esegui(() => sb().rpc("apri_tavolo", { p_tavolo: tavolo.id, p_coperti: coperti }), `Tavolo ${tavolo.nome} aperto`)}>
            Apri tavolo
          </button>
        </>
      )}
    </div>
  );
}

function NuovaSala({ locale, onFatto }: { locale: string; onFatto: () => Promise<void> }) {
  const avvisa = useAvviso();
  const [nome, setNome] = useState("");
  async function crea(e: FormEvent) {
    e.preventDefault();
    const { error } = await sb().from("sale").insert({ locale_id: locale, nome: nome.trim() });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setNome(""); avvisa("Sala creata"); await onFatto();
  }
  return (
    <form className="riga-form" onSubmit={crea}>
      <input placeholder="Nuova sala (es. Interno, Dehors)" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
      <button className="btn btn-pieno" disabled={!nome.trim()}>Crea sala</button>
    </form>
  );
}

function PannelloPiantina(props: { locale: string; sala: Sala; tavolo: Tavolo | null; tavoli: Tavolo[]; onFatto: () => Promise<void>; onSeleziona: (id: string | null) => void }) {
  const avvisa = useAvviso();
  const { tavolo } = props;

  async function aggiungi() {
    // Prossimo numero libero, a partire da 1
    const usati = new Set(props.tavoli.map((t) => t.nome));
    let n = 1; while (usati.has(String(n))) n++;
    const quanti = props.tavoli.filter((t) => t.sala_id === props.sala.id).length;
    const { data, error } = await sb().from("tavoli").insert({
      locale_id: props.locale, sala_id: props.sala.id, nome: String(n), posti: 4, forma: "quadrato",
      x: 100 + (quanti % 8) * 110, y: 100 + Math.floor(quanti / 8) * 120,
    }).select().single();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(`Tavolo ${n} aggiunto: trascinalo nella posizione giusta`); await props.onFatto(); props.onSeleziona((data as Tavolo).id);
  }
  async function aggiorna(patch: Partial<Tavolo>) {
    if (!tavolo) return;
    const { error } = await sb().from("tavoli").update(patch).eq("id", tavolo.id);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa("Salvato"); await props.onFatto();
  }
  async function elimina() {
    if (!tavolo || !confirm(`Eliminare il tavolo ${tavolo.nome}? Il suo cartoncino QR smetterà di funzionare.`)) return;
    const { error } = await sb().from("tavoli").delete().eq("id", tavolo.id);
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    props.onSeleziona(null); avvisa("Tavolo eliminato"); await props.onFatto();
  }
  async function rigeneraQr() {
    if (!tavolo || !confirm(`Rigenerare il QR del tavolo ${tavolo.nome}? Il cartoncino attuale smetterà di funzionare e andrà ristampato.`)) return;
    const { error } = await sb().rpc("rigenera_qr_tavolo", { p_tavolo: tavolo.id });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa("Nuovo QR generato: ristampa il cartoncino"); await props.onFatto();
  }

  return (
    <div className="pannello-tavolo">
      <button className="btn btn-pieno" onClick={() => void aggiungi()}>+ Aggiungi tavolo</button>
      {tavolo ? (
        <div className="campi-tavolo" key={tavolo.id}>
          <h2>Tavolo {tavolo.nome}</h2>
          <label className="campo">Nome / numero
            <input defaultValue={tavolo.nome} maxLength={20} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tavolo.nome) void aggiorna({ nome: v }); }} />
          </label>
          <label className="campo">Posti
            <input type="number" min={1} max={30} defaultValue={tavolo.posti} onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 30 && v !== tavolo.posti) void aggiorna({ posti: v }); }} />
          </label>
          <div className="scelte">
            {(["quadrato", "tondo", "rettangolo"] as const).map((f) => (
              <button key={f} className={`chip${tavolo.forma === f ? " attivo" : ""}`} onClick={() => void aggiorna({ forma: f })}>{f[0]!.toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
          <label className="interruttore"><input type="checkbox" checked={tavolo.attivo} onChange={(e) => void aggiorna({ attivo: e.target.checked })} />In uso</label>
          <div className="riga-form">
            <button className="btn btn-piccolo" onClick={() => void rigeneraQr()}>Rigenera QR</button>
            <button className="btn btn-pericolo" onClick={() => void elimina()}>Elimina</button>
          </div>
        </div>
      ) : <p className="muto">Trascina i tavoli nella posizione reale. Tocca un tavolo per modificarlo.</p>}
      <hr />
      <NuovaSala locale={props.locale} onFatto={props.onFatto} />
    </div>
  );
}

/** Testo del QR Wi-Fi standard (riconosciuto da Android e iPhone): i caratteri speciali vanno protetti. */
const qrWifi = (w: Wifi) => {
  const p = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:${w.sicurezza};S:${p(w.ssid)};${w.sicurezza === "nopass" ? "" : `P:${p(w.password)};`}${w.nascosta ? "H:true;" : ""};`;
};

function Cartoncini({ locale, tavoli, sale }: { locale: { id: string; nome: string; slug: string }; tavoli: Tavolo[]; sale: Sala[] }) {
  const avvisa = useAvviso();
  const [wifi, setWifi] = useState<Wifi | null>(null);
  const [salvato, setSalvato] = useState<Wifi | null>(null);
  const [aspetto, setAspetto] = useState<Aspetto | null>(null);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [mostraPw, setMostraPw] = useState(false);

  useEffect(() => {
    void (async () => {
      const [w, a] = await Promise.all([
        sb().from("wifi_ospiti").select("*").eq("locale_id", locale.id).maybeSingle(),
        sb().from("aspetto").select("*").eq("locale_id", locale.id).maybeSingle(),
      ]);
      const valore = (w.data as Wifi | null) ?? { ssid: "", sicurezza: "WPA", password: "", nascosta: false, url_ordini: "" };
      setWifi(valore); setSalvato(valore); setAspetto(a.data as Aspetto | null);
    })();
  }, [locale.id]);

  const base = (salvato?.url_ordini || `${window.location.origin}/m/${locale.slug}`).replace(/\/?$/, "/");
  const urlTavolo = useCallback((t: Tavolo) => `${base}?t=${encodeURIComponent(t.qr_token)}`, [base]);

  // QR generati sul dispositivo: nessun servizio esterno
  useEffect(() => {
    if (!salvato) return;
    void (async () => {
      const opz = { margin: 1, width: 320, errorCorrectionLevel: "M" as const };
      const voci: Record<string, string> = {};
      if (salvato.ssid) voci.wifi = await QRCode.toDataURL(qrWifi(salvato), opz);
      for (const t of tavoli) voci[t.id] = await QRCode.toDataURL(urlTavolo(t), opz);
      setQr(voci);
    })();
  }, [salvato, tavoli, urlTavolo]);

  const tavoliOrdinati = useMemo(() => [...tavoli].sort((a, b) =>
    (sale.findIndex((s) => s.id === a.sala_id) - sale.findIndex((s) => s.id === b.sala_id)) || a.nome.localeCompare(b.nome, "it", { numeric: true })), [tavoli, sale]);

  if (!wifi) return <p className="muto">Caricamento…</p>;

  async function salva(e: FormEvent) {
    e.preventDefault();
    if (!wifi) return;
    const { locale_id: _l, ...campi } = wifi;
    const { error } = await sb().from("wifi_ospiti").upsert({ ...campi, ssid: campi.ssid.trim(), url_ordini: campi.url_ordini.trim(), locale_id: locale.id });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setSalvato(wifi); avvisa("Impostazioni salvate");
  }

  const stile = aspetto ? { ["--c-primario" as string]: aspetto.colore_primario, ["--c-sfondo" as string]: aspetto.colore_sfondo, ["--c-testo" as string]: aspetto.colore_testo } : {};
  const logo = aspetto?.logo_dati || aspetto?.logo_url || null;

  return (
    <div className="pagina">
      <form className="gruppo nascondi-stampa" onSubmit={salva}>
        <legend>Wi-Fi ospiti e indirizzo degli ordini</legend>
        <label className="campo">Nome della rete (SSID)<input value={wifi.ssid} maxLength={32} required onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} /></label>
        <label className="campo">Protezione
          <select value={wifi.sicurezza} onChange={(e) => setWifi({ ...wifi, sicurezza: e.target.value as Wifi["sicurezza"] })}>
            <option value="WPA">WPA/WPA2/WPA3 (consigliata)</option><option value="WEP">WEP</option><option value="nopass">Rete aperta</option>
          </select>
        </label>
        {wifi.sicurezza !== "nopass" && (
          <label className="campo">Password
            <span className="riga-form"><input type={mostraPw ? "text" : "password"} value={wifi.password} maxLength={63} autoComplete="off"
              onChange={(e) => setWifi({ ...wifi, password: e.target.value })} />
              <button type="button" className="btn btn-piccolo" onClick={() => setMostraPw((m) => !m)}>{mostraPw ? "Nascondi" : "Mostra"}</button></span>
          </label>
        )}
        <label className="interruttore"><input type="checkbox" checked={wifi.nascosta} onChange={(e) => setWifi({ ...wifi, nascosta: e.target.checked })} />Rete nascosta</label>
        <label className="campo">Indirizzo per gli ordini (https://…)
          <input value={wifi.url_ordini} placeholder="Es. https://ordini.tuodominio.it — vuoto: menu interno" onChange={(e) => setWifi({ ...wifi, url_ordini: e.target.value })} />
        </label>
        <p className="muto piccolo">
          {salvato?.url_ordini ? "I QR dei tavoli puntano all'indirizzo impostato." : "⚠️ Senza indirizzo, il QR del tavolo apre il menu interno: funziona solo nella rete del locale. Stampa i cartoncini definitivi quando avrete il dominio."}
        </p>
        <div className="riga-form">
          <button className="btn btn-pieno" disabled={JSON.stringify(wifi) === JSON.stringify(salvato)}>Salva</button>
          <button type="button" className="btn" disabled={!tavoli.length || !salvato?.ssid} onClick={() => window.print()}>Stampa / salva PDF</button>
          {!salvato?.ssid && <span className="muto piccolo">Imposta e salva il Wi-Fi per stampare.</span>}
        </div>
      </form>

      {tavoli.length === 0 ? <p className="muto">Crea prima i tavoli nella piantina.</p> : (
        <div className="cartoncini" style={stile}>
          {tavoliOrdinati.map((t) => (
            <article key={t.id} className="cartoncino">
              <header>
                {logo ? <img src={logo} alt={locale.nome} /> : <strong className="cartoncino-nome">{locale.nome}</strong>}
                <p className="cartoncino-tavolo">Tavolo {t.nome}</p>
              </header>
              <div className="cartoncino-qr">
                <figure>
                  {qr.wifi ? <img src={qr.wifi} alt="QR Wi-Fi" /> : <div className="qr-vuoto" />}
                  <figcaption><b>1</b> Collegati al Wi-Fi</figcaption>
                </figure>
                <figure>
                  {qr[t.id] ? <img src={qr[t.id]} alt={`QR tavolo ${t.nome}`} /> : <div className="qr-vuoto" />}
                  <figcaption><b>2</b> Apri il menu e ordina</figcaption>
                </figure>
              </div>
              {salvato?.ssid && (
                <footer>Rete «{salvato.ssid}»{salvato.sicurezza !== "nopass" && salvato.password ? ` · password ${salvato.password}` : ""}</footer>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
