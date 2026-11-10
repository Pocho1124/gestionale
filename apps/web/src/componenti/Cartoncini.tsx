import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import type { Aspetto } from "../lib/tipi";
import { sorgenteImmagine } from "../lib/archivio";
import { type Sala, type Tavolo, type Wifi } from "../lib/piantina";

/** Testo del QR Wi-Fi standard (riconosciuto da Android e iPhone): i caratteri speciali vanno protetti. */
const qrWifi = (w: Wifi) => {
  const p = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:${w.sicurezza};S:${p(w.ssid)};${w.sicurezza === "nopass" ? "" : `P:${p(w.password)};`}${w.nascosta ? "H:true;" : ""};`;
};

export function Cartoncini({ locale, tavoli, sale }: { locale: { id: string; nome: string; slug: string }; tavoli: Tavolo[]; sale: Sala[] }) {
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

  // Senza indirizzo degli ordini si usa il server del locale in HTTP: i telefoni dei clienti non hanno
  // il certificato interno, e la pagina del tavolo resta apposta raggiungibile anche in HTTP
  const base = (salvato?.url_ordini || `http://${window.location.hostname}`).replace(/\/?$/, "/");
  const urlTavolo = useCallback((t: Tavolo) => `${base}t/${encodeURIComponent(t.qr_token)}`, [base]);

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
  const logo = sorgenteImmagine(aspetto?.logo_path, aspetto?.logo_dati, aspetto?.logo_url);

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
          {salvato?.url_ordini ? "I QR dei tavoli puntano all'indirizzo impostato." : "⚠️ Senza indirizzo, il QR del tavolo apre la pagina per ordinare sul server del locale: funziona solo nella stessa rete. Va bene per le prove; stampa i cartoncini definitivi quando avrete il dominio."}
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
              <a className="nascondi-stampa piccolo" href={urlTavolo(t)} target="_blank" rel="noreferrer">Apri la pagina del tavolo ↗</a>
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
