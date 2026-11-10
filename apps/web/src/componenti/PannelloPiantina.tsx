import { useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useAvviso } from "./Avviso";
import { messaggioErrore } from "../lib/errori";
import { preparaImmagine } from "../lib/immagini";
import { caricaImmagine, eliminaImmagine } from "../lib/archivio";
import { ARREDI, type Elemento, SOTTILI, type Sala, type Selezione, type Tavolo, type TipoElemento, W, altezza } from "../lib/piantina";

/** Misure dell'elemento in metri: lunghezza e spessore (muri) o larghezza e profondità; il centro resta fermo. */
function MisureElemento({ elemento, metri, onCambia }: { elemento: Elemento; metri: number; onCambia: (p: Partial<Elemento>) => void }) {
  const inMetri = (v: number) => (v * metri).toFixed(2);
  const daMetri = (t: string, max: number) => { const v = Number(t.replace(",", ".")); return v > 0 ? Math.min(max, Math.max(4, Math.round(v / metri))) : null; };
  const sottile = SOTTILI.has(elemento.tipo);
  // Muro verticale (più alto che largo): la lunghezza è l'altezza
  const [lungo, corto] = (sottile && elemento.h > elemento.w ? ["h", "w"] : ["w", "h"]) as ["w" | "h", "w" | "h"];
  const campo = (k: "w" | "h", etichetta: string) => (
    <label className="campo" style={{ flex: 1 }}>{etichetta}
      <input inputMode="decimal" defaultValue={inMetri(elemento[k])}
        onBlur={(e) => { const v = daMetri(e.target.value, k === "w" ? 1000 : 2000); if (v && v !== elemento[k]) onCambia({ [k]: v }); }} />
    </label>
  );
  return (
    <div className="riga-form" key={`${elemento.id}-${elemento.w}-${elemento.h}`}>
      {campo(lungo, sottile ? "Lunghezza (m)" : "Larghezza (m)")}
      {campo(corto, sottile ? "Spessore (m)" : "Profondità (m)")}
    </div>
  );
}

export function NuovaSala({ locale, onFatto }: { locale: string; onFatto: () => Promise<void> }) {
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

export function PannelloPiantina(props: {
  locale: string; sala: Sala; tavolo: Tavolo | null; elemento: Elemento | null; tavoli: Tavolo[];
  onFatto: () => Promise<void>; onSeleziona: (s: Selezione) => void;
}) {
  const avvisa = useAvviso();
  const { tavolo, elemento, sala } = props;
  const H = altezza(sala);

  const esito = async (r: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await r;
    if (error) { avvisa(messaggioErrore(error), "errore"); return false; }
    avvisa(ok); await props.onFatto(); return true;
  };

  async function aggiungiTavolo() {
    const usati = new Set(props.tavoli.map((t) => t.nome));
    let n = 1; while (usati.has(String(n))) n++;
    const quanti = props.tavoli.filter((t) => t.sala_id === sala.id).length;
    const { data, error } = await sb().from("tavoli").insert({
      locale_id: props.locale, sala_id: sala.id, nome: String(n), posti: 4, forma: "quadrato",
      x: Math.min(W - 60, 100 + (quanti % 8) * 110), y: Math.min(H - 60, 100 + Math.floor(quanti / 8) * 120),
    }).select().single();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(`Tavolo ${n} aggiunto: trascinalo nella posizione giusta`); await props.onFatto(); props.onSeleziona({ tipo: "tavolo", id: (data as Tavolo).id });
  }
  async function aggiungiElemento(tipo: TipoElemento, base?: Elemento) {
    const d = ARREDI[tipo];
    const { data, error } = await sb().from("elementi_sala").insert(base
      ? { locale_id: base.locale_id, sala_id: base.sala_id, tipo: base.tipo, x: Math.min(W, base.x + 30), y: Math.min(H, base.y + 30), w: base.w, h: base.h, rotazione: base.rotazione, etichetta: base.etichetta }
      : { locale_id: props.locale, sala_id: sala.id, tipo, x: W / 2, y: Math.round(H / 2), w: d.w, h: d.h, etichetta: d.etichetta ?? "" }).select().single();
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    await props.onFatto(); props.onSeleziona({ tipo: "elemento", id: (data as Elemento).id });
  }
  const aggiornaTavolo = (patch: Partial<Tavolo>) => tavolo && void esito(sb().from("tavoli").update(patch).eq("id", tavolo.id), "Salvato");
  const aggiornaElemento = (patch: Partial<Elemento>) => elemento && void esito(sb().from("elementi_sala").update(patch).eq("id", elemento.id), "Salvato");
  const aggiornaSala = (patch: Partial<Sala>) => void esito(sb().from("sale").update(patch).eq("id", sala.id), "Sala aggiornata");
  const ruota = (attuale: number, delta: number) => ((attuale + delta) % 360 + 360) % 360;

  async function caricaPlanimetria(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await preparaImmagine(file, { lato: 1600, limite: 1_000_000 });
      const percorso = await caricaImmagine(props.locale, "sale", blob);
      const precedente = sala.sfondo_path;
      aggiornaSala({ sfondo_path: percorso, sfondo_dati: null });
      void eliminaImmagine(precedente);
    } catch (e) { avvisa(e instanceof Error ? e.message : "Immagine non valida", "errore"); }
  }

  return (
    <div className="pannello-tavolo">
      <div className="barra-arredi">
        <button className="btn btn-pieno btn-piccolo" onClick={() => void aggiungiTavolo()}>+ Tavolo</button>
        {(Object.keys(ARREDI) as TipoElemento[]).map((t) => (
          <button key={t} className="btn btn-piccolo" onClick={() => void aggiungiElemento(t)}>+ {ARREDI[t].nome}</button>
        ))}
      </div>

      {tavolo && (
        <div className="campi-tavolo" key={tavolo.id}>
          <h2>Tavolo {tavolo.nome}</h2>
          <label className="campo">Nome / numero
            <input defaultValue={tavolo.nome} maxLength={20} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tavolo.nome) aggiornaTavolo({ nome: v }); }} />
          </label>
          <label className="campo">Posti
            <input type="number" min={1} max={30} defaultValue={tavolo.posti} onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 30 && v !== tavolo.posti) aggiornaTavolo({ posti: v }); }} />
          </label>
          <div className="scelte">
            {(["quadrato", "tondo", "rettangolo"] as const).map((f) => (
              <button key={f} className={`chip${tavolo.forma === f ? " attivo" : ""}`} onClick={() => aggiornaTavolo({ forma: f })}>{f[0]!.toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
          {tavolo.forma === "rettangolo" && (
            <div className="riga-form"><span>Rotazione {tavolo.rotazione}°</span>
              <button className="btn btn-icona" onClick={() => aggiornaTavolo({ rotazione: ruota(tavolo.rotazione, 90) })} aria-label="Ruota di 90 gradi">↻ 90°</button></div>
          )}
          <label className="interruttore"><input type="checkbox" checked={tavolo.attivo} onChange={(e) => aggiornaTavolo({ attivo: e.target.checked })} />In uso</label>
          <div className="riga-form">
            <button className="btn btn-piccolo" onClick={async () => {
              if (!confirm(`Rigenerare il QR del tavolo ${tavolo.nome}? Il cartoncino attuale smetterà di funzionare e andrà ristampato.`)) return;
              await esito(sb().rpc("rigenera_qr_tavolo", { p_tavolo: tavolo.id }), "Nuovo QR generato: ristampa il cartoncino");
            }}>Rigenera QR</button>
            <button className="btn btn-pericolo" onClick={async () => {
              if (!confirm(`Eliminare il tavolo ${tavolo.nome}? Il suo cartoncino QR smetterà di funzionare.`)) return;
              if (await esito(sb().from("tavoli").delete().eq("id", tavolo.id), "Tavolo eliminato")) props.onSeleziona(null);
            }}>Elimina</button>
          </div>
        </div>
      )}

      {elemento && (
        <div className="campi-tavolo" key={elemento.id}>
          <h2>{ARREDI[elemento.tipo].nome}</h2>
          {["bancone", "zona", "testo", "cassa", "bagni", "cucina", "vetrina", "scaffale"].includes(elemento.tipo) && (
            <label className="campo">Scritta
              <input defaultValue={elemento.etichetta} maxLength={40} onBlur={(e) => { if (e.target.value !== elemento.etichetta) aggiornaElemento({ etichetta: e.target.value.trim() }); }} />
            </label>
          )}
          <div className="riga-form"><span>Rotazione {elemento.rotazione}°</span>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, -15) })} aria-label="Ruota a sinistra">↺</button>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, 15) })} aria-label="Ruota a destra">↻</button>
            <button className="btn btn-icona" onClick={() => aggiornaElemento({ rotazione: ruota(elemento.rotazione, 90) })}>90°</button>
          </div>
          <MisureElemento elemento={elemento} metri={Number(sala.larghezza_m) / W} onCambia={aggiornaElemento} />
          <p className="muto piccolo">Trascina per spostare. Tira i pallini sui quattro lati per allungare, accorciare o ispessire solo da quella parte.</p>
          <div className="riga-form">
            <button className="btn btn-piccolo" onClick={() => void aggiungiElemento(elemento.tipo, elemento)}>Duplica</button>
            <button className="btn btn-pericolo" onClick={async () => {
              if (await esito(sb().from("elementi_sala").delete().eq("id", elemento.id), "Elemento eliminato")) props.onSeleziona(null);
            }}>Elimina</button>
          </div>
        </div>
      )}

      {!tavolo && !elemento && (
        <div className="campi-tavolo" key={sala.id}>
          <h2>Sala «{sala.nome}»</h2>
          <label className="campo">Nome
            <input defaultValue={sala.nome} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sala.nome) aggiornaSala({ nome: v }); }} />
          </label>
          <div className="riga-form">
            <label className="campo" style={{ flex: 1 }}>Larghezza (m)
              <input type="number" min={2} max={200} step={0.5} defaultValue={sala.larghezza_m} onBlur={(e) => { const v = Number(e.target.value); if (v >= 2 && v <= 200 && v !== Number(sala.larghezza_m)) aggiornaSala({ larghezza_m: v }); }} />
            </label>
            <label className="campo" style={{ flex: 1 }}>Profondità (m)
              <input type="number" min={2} max={200} step={0.5} defaultValue={sala.profondita_m} onBlur={(e) => { const v = Number(e.target.value); if (v >= 2 && v <= 200 && v !== Number(sala.profondita_m)) aggiornaSala({ profondita_m: v }); }} />
            </label>
          </div>
          <fieldset className="gruppo"><legend>Pavimento</legend>
            <div className="scelte">
              {([["parquet", "Parquet"], ["cotto", "Cotto"], ["marmo", "Marmo"], ["cemento", "Cemento"], ["nessuno", "Nessuno"]] as const).map(([v, n]) => (
                <button key={v} className={`chip pavimento-chip pav-${v}${sala.pavimento === v ? " attivo" : ""}`} onClick={() => aggiornaSala({ pavimento: v })}>{n}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="gruppo"><legend>Planimetria di sfondo</legend>
            <p className="muto piccolo">Carica una foto o una piantina del locale e ricalca sopra muri e tavoli.</p>
            <div className="riga-form">
              <label className="btn btn-piccolo">{sala.sfondo_path || sala.sfondo_dati ? "Sostituisci" : "Carica immagine"}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void caricaPlanimetria(e.target.files?.[0])} />
              </label>
              {(sala.sfondo_path || sala.sfondo_dati) && <button className="btn btn-pericolo" onClick={() => { const v = sala.sfondo_path; aggiornaSala({ sfondo_path: null, sfondo_dati: null }); void eliminaImmagine(v); }}>Rimuovi</button>}
            </div>
            {(sala.sfondo_path || sala.sfondo_dati) && (
              <label className="campo">Visibilità: {sala.sfondo_opacita}%
                <input type="range" min={5} max={100} defaultValue={sala.sfondo_opacita} onPointerUp={(e) => aggiornaSala({ sfondo_opacita: Number((e.target as HTMLInputElement).value) })} />
              </label>
            )}
          </fieldset>
          <button className="btn btn-pericolo" onClick={async () => {
            if (!confirm(`Eliminare la sala «${sala.nome}» con tutti i suoi tavoli e arredi?`)) return;
            await esito(sb().from("sale").delete().eq("id", sala.id), "Sala eliminata");
          }}>Elimina sala</button>
          <p className="muto piccolo">Tocca un tavolo o un elemento per modificarlo.</p>
        </div>
      )}
      <hr />
      <NuovaSala locale={props.locale} onFatto={props.onFatto} />
    </div>
  );
}
