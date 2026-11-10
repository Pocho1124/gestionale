import { useRef, useState, type CSSProperties, type PointerEvent as PE } from "react";
import { sorgenteImmagine } from "../lib/archivio";
import { oraBreve, type Prenotazione } from "./Prenotazioni";
import { A_TERRA, type Elemento, LATI, type Lato, type Sala, type Selezione, type SessioneT, type Tavolo, type TipoElemento, W, altezza, dimensioni, durata, durataBreve, minuti, scatto, sedie, stacco, stato } from "../lib/piantina";

export function Piantina(props: {
  sala?: Sala; inAttesa?: Set<string>; prenotate?: Map<string, Prenotazione>; conto?: (sessione: string) => number; tavoli: Tavolo[]; elementi: Elemento[]; sessionePer: (id: string) => SessioneT | undefined; modificabile: boolean;
  selezione: Selezione; onSeleziona: (s: Selezione) => void;
  onTavolo: (t: Tavolo, patch: Partial<Tavolo>) => void; onElemento: (e: Elemento, patch: Partial<Elemento>) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const H = altezza(props.sala);
  // Trascinamento o ridimensionamento in corso: posizione/misure provvisorie, salvate al rilascio
  const [azione, setAzione] = useState<{ modo: "sposta" | "ridimensiona"; lato?: Lato; tipo: "tavolo" | "elemento"; id: string; x: number; y: number; w?: number; h?: number } | null>(null);
  const punto = (e: PE) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) };
  };
  const selez = (tipo: "tavolo" | "elemento", id: string) => props.selezione?.tipo === tipo && props.selezione.id === id;

  function muovi(e: PE) {
    if (!azione) return;
    const p = punto(e);
    if (azione.modo === "sposta") { setAzione({ ...azione, x: scatto(p.x), y: scatto(p.y) }); return; }
    const el = props.elementi.find((z) => z.id === azione.id); if (!el) return;
    // Ridimensiona nel sistema dell'elemento (tiene conto della rotazione): si sposta solo il lato trascinato
    const a = (el.rotazione * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), dx = p.x - el.x, dy = p.y - el.y;
    // La maniglia di un lato sottile è staccata dal bordo: si toglie lo stacco, così l'elemento non salta alla presa
    const ox = stacco(el.w / 2), oy = stacco(el.h / 2);
    const lx0 = dx * cos + dy * sin, ly0 = -dx * sin + dy * cos;
    const lx = lx0 > 0 ? lx0 - ox : lx0 + ox, ly = ly0 > 0 ? ly0 - oy : ly0 + oy;
    let w = el.w, h = el.h, sx = 0, sy = 0;   // nuove misure e spostamento del centro (coordinate dell'elemento)
    if (azione.lato === "destra") { w = Math.min(1000, Math.max(10, scatto(lx + el.w / 2))); sx = (w - el.w) / 2; }
    if (azione.lato === "sinistra") { w = Math.min(1000, Math.max(10, scatto(el.w / 2 - lx))); sx = -(w - el.w) / 2; }
    if (azione.lato === "sotto") { h = Math.min(2000, Math.max(4, scatto(ly + el.h / 2))); sy = (h - el.h) / 2; }
    if (azione.lato === "sopra") { h = Math.min(2000, Math.max(4, scatto(el.h / 2 - ly))); sy = -(h - el.h) / 2; }
    const x = Math.round(Math.min(W, Math.max(0, el.x + sx * cos - sy * sin)));
    const y = Math.round(Math.min(H, Math.max(0, el.y + sx * sin + sy * cos)));
    setAzione({ ...azione, x, y, w, h });
  }
  function rilascia() {
    if (!azione) return;
    if (azione.tipo === "tavolo") {
      const t = props.tavoli.find((z) => z.id === azione.id);
      if (t && (t.x !== azione.x || t.y !== azione.y)) props.onTavolo(t, { x: azione.x, y: azione.y });
    } else {
      const el = props.elementi.find((z) => z.id === azione.id);
      if (el && azione.modo === "sposta" && (el.x !== azione.x || el.y !== azione.y)) props.onElemento(el, { x: azione.x, y: azione.y });
      if (el && azione.modo === "ridimensiona" && azione.w && azione.h && (azione.w !== el.w || azione.h !== el.h))
        props.onElemento(el, { x: azione.x, y: azione.y, w: azione.w, h: azione.h });
    }
    setAzione(null);
  }
  const inizia = (e: PE, modo: "sposta" | "ridimensiona", tipo: "tavolo" | "elemento", z: { id: string; x: number; y: number }, lato?: Lato) => {
    if (!props.modificabile) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    props.onSeleziona({ tipo, id: z.id });
    setAzione({ modo, lato, tipo, id: z.id, x: z.x, y: z.y });
  };

  return (
    <svg ref={svg} className="piantina" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Piantina della sala" style={{ "--rapporto": W / H } as CSSProperties}
      onPointerMove={muovi} onPointerUp={rilascia} onPointerCancel={() => setAzione(null)}
      onPointerDown={() => { if (props.modificabile) props.onSeleziona(null); }}>
      <defs>
        <pattern id="griglia" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" className="griglia" /></pattern>
        {/* Parquet a listoni sfalsati con venature e fughe */}
        <pattern id="pav-parquet" width="240" height="40" patternUnits="userSpaceOnUse">
          <rect width="240" height="20" fill="#C99A62" /><rect y="20" width="240" height="20" fill="#BF8F58" />
          <rect width="90" height="20" fill="#D0A36C" /><rect x="150" width="90" height="20" fill="#C4955D" />
          <rect x="40" y="20" width="110" height="20" fill="#CA9C65" /><rect x="200" y="20" width="40" height="20" fill="#C69860" />
          <path d="M0 5C50 3 110 8 240 4M0 13C70 15 150 11 240 14M0 26C60 24 140 29 240 25M0 34C90 37 170 32 240 35" stroke="#9E6F3E" strokeWidth=".7" fill="none" opacity=".35" />
          <path d="M18 9c6-2 10 2 16 0M120 30c5-2 9 1 14-1" stroke="#8A5E31" strokeWidth=".8" fill="none" opacity=".4" />
          <path d="M0 20H240M0 40H240M90 0V20M150 0V20M40 20V40M150 20V40M200 20V40" stroke="#7E5630" strokeWidth="1" opacity=".55" />
          <path d="M0 .6H240M0 20.6H240" stroke="#F0D2A2" strokeWidth=".8" opacity=".45" />
        </pattern>
        <pattern id="pav-cotto" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect width="44" height="44" fill="#D9C7B0" /><rect x="1.5" y="1.5" width="41" height="41" rx="2" fill="#C2734D" />
          <rect x="1.5" y="1.5" width="41" height="41" rx="2" fill="url(#cotto-sfumato)" /><circle cx="12" cy="30" r="1.2" fill="#A85E3C" opacity=".6" />
        </pattern>
        <radialGradient id="cotto-sfumato" cx=".3" cy=".25" r=".9"><stop offset="0" stopColor="#D88C64" stopOpacity=".7" /><stop offset="1" stopColor="#A85A38" stopOpacity=".5" /></radialGradient>
        <pattern id="pav-marmo" width="200" height="200" patternUnits="userSpaceOnUse">
          <rect width="200" height="200" fill="#F2EFEA" /><path d="M0 60C50 40 80 90 140 70S200 90 200 90M30 200C60 150 120 170 170 120M110 0C100 30 130 50 120 80" stroke="#CFC7BB" strokeWidth="1.6" fill="none" opacity=".8" />
          <path d="M0 62C50 44 80 92 140 72" stroke="#B9B0A2" strokeWidth=".6" fill="none" /><path d="M100 0V200M0 100H200" stroke="#E0DAD1" strokeWidth="1.5" />
        </pattern>
        <pattern id="pav-cemento" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#C9C6C0" /><circle cx="12" cy="18" r="1.2" fill="#B3AFA8" /><circle cx="44" cy="40" r="1" fill="#B3AFA8" /><circle cx="30" cy="8" r=".8" fill="#DEDCD8" /><circle cx="50" cy="12" r="1.4" fill="#BDB9B2" />
        </pattern>
        <pattern id="piastrelle" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#B9D3DE" /><rect x=".7" y=".7" width="14.6" height="14.6" rx="1" fill="#D3E5EC" />
        </pattern>
        {/* Luce: vignettatura ai bordi, luce calda dall'alto a sinistra, lampade sopra i tavoli */}
        <radialGradient id="vignetta" cx=".5" cy=".45" r=".78"><stop offset=".55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#1A0E04" stopOpacity=".38" /></radialGradient>
        <linearGradient id="luce-ambiente" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF1D0" stopOpacity=".28" /><stop offset=".55" stopColor="#FFF1D0" stopOpacity="0" /></linearGradient>
        <radialGradient id="lampada"><stop offset="0" stopColor="#FFE6B0" stopOpacity=".9" /><stop offset=".45" stopColor="#FFD488" stopOpacity=".38" /><stop offset="1" stopColor="#FFD488" stopOpacity="0" /></radialGradient>
        <radialGradient id="tovaglia" cx=".38" cy=".3" r=".95"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".7" stopColor="#F7F2E9" /><stop offset="1" stopColor="#E6DCCB" /></radialGradient>
        <radialGradient id="seduta" cx=".4" cy=".35" r=".8"><stop offset="0" stopColor="#9B7350" /><stop offset="1" stopColor="#5E3F27" /></radialGradient>
        <linearGradient id="legno" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9A6533" /><stop offset=".5" stopColor="#7A4A22" /><stop offset="1" stopColor="#5C3516" /></linearGradient>
        <linearGradient id="granito" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4B4643" /><stop offset=".45" stopColor="#2F2B29" /><stop offset=".5" stopColor="#5A5552" /><stop offset=".55" stopColor="#2F2B29" /><stop offset="1" stopColor="#1F1C1A" /></linearGradient>
        <linearGradient id="muro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#56504A" /><stop offset="1" stopColor="#2A2622" /></linearGradient>
        <linearGradient id="vetro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#DFF2FB" /><stop offset=".5" stopColor="#A9D4EA" /><stop offset="1" stopColor="#CFEAF6" /></linearGradient>
        <linearGradient id="luce-finestra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF6D8" stopOpacity=".55" /><stop offset="1" stopColor="#FFF6D8" stopOpacity="0" /></linearGradient>
        <linearGradient id="marmo-colonna" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F4F1EC" /><stop offset=".6" stopColor="#D8D2C8" /><stop offset="1" stopColor="#BDB5A9" /></linearGradient>
        <radialGradient id="terracotta" cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#D27A4A" /><stop offset="1" stopColor="#8A4322" /></radialGradient>
        <radialGradient id="foglia" cx=".5" cy=".2" r=".9"><stop offset="0" stopColor="#7FC46F" /><stop offset="1" stopColor="#2E6E2A" /></radialGradient>
        <linearGradient id="metallo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4A4D52" /><stop offset="1" stopColor="#222427" /></linearGradient>
        <linearGradient id="schermo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5FD0FF" /><stop offset="1" stopColor="#1C6E9C" /></linearGradient>
        <radialGradient id="botte" cx=".4" cy=".35" r=".8"><stop offset="0" stopColor="#B07A45" /><stop offset="1" stopColor="#6E4120" /></radialGradient>
        <linearGradient id="tessuto" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#97A884" /><stop offset="1" stopColor="#6E7F5E" /></linearGradient>
        <pattern id="trama" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#8E2E3A" /><path d="M7 1L13 7L7 13L1 7Z" fill="none" stroke="#D9B45A" strokeWidth=".8" opacity=".7" /></pattern>
        <linearGradient id="pietra" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#B4ACA0" /><stop offset="1" stopColor="#7E766B" /></linearGradient>
        <radialGradient id="fuoco" cx=".5" cy=".8" r=".8"><stop offset="0" stopColor="#FFF1A8" /><stop offset=".35" stopColor="#FFB43C" /><stop offset=".75" stopColor="#E8501C" stopOpacity=".9" /><stop offset="1" stopColor="#8A1E0A" stopOpacity="0" /></radialGradient>
        <linearGradient id="acciaio" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E6E9EC" /><stop offset=".5" stopColor="#B9BFC5" /><stop offset="1" stopColor="#D5D9DD" /></linearGradient>
        <filter id="ombra" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="6" stdDeviation="5" floodColor="#2A1606" floodOpacity=".38" /></filter>
        <filter id="ombra-lieve" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="1" dy="2" stdDeviation="1.6" floodColor="#2A1606" floodOpacity=".4" /></filter>
        <filter id="ombra-muro" x="-10%" y="-60%" width="120%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="3.5" floodColor="#000" floodOpacity=".45" /></filter>
        <filter id="sfoca" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <rect width={W} height={H} fill={props.sala && props.sala.pavimento !== "nessuno" ? `url(#pav-${props.sala.pavimento})` : "transparent"} />
      {props.sala && sorgenteImmagine(props.sala.sfondo_path, props.sala.sfondo_dati) && <image href={sorgenteImmagine(props.sala.sfondo_path, props.sala.sfondo_dati)!} width={W} height={H} preserveAspectRatio="xMidYMid meet" opacity={props.sala.sfondo_opacita / 100} />}
      <rect width={W} height={H} fill="url(#luce-ambiente)" pointerEvents="none" />
      {props.modificabile && <rect width={W} height={H} fill="url(#griglia)" pointerEvents="none" />}

      {[...props.elementi].sort((a, b) => Number(A_TERRA.has(b.tipo)) - Number(A_TERRA.has(a.tipo))).map((el) => {
        const pos = azione?.tipo === "elemento" && azione.id === el.id ? { ...el, x: azione.x, y: azione.y, w: azione.w ?? el.w, h: azione.h ?? el.h } : el;
        return (
          <g key={el.id} transform={`translate(${pos.x} ${pos.y}) rotate(${el.rotazione})`}
            className={`arredo arredo-${el.tipo}${selez("elemento", el.id) ? " selezionato" : ""}${props.modificabile ? "" : " fisso"}`}
            onPointerDown={(e) => inizia(e, "sposta", "elemento", el)}>
            <Arredo tipo={el.tipo} w={pos.w} h={pos.h} etichetta={el.etichetta} />
            {/* Una maniglia per lato: trascinandola si allunga solo da quella parte */}
            {props.modificabile && selez("elemento", el.id) && LATI.map((l) => {
              const mx = pos.w / 2 + stacco(pos.w / 2), my = pos.h / 2 + stacco(pos.h / 2);
              const cx = l === "sinistra" ? -mx : l === "destra" ? mx : 0, cy = l === "sopra" ? -my : l === "sotto" ? my : 0;
              return (
                <g key={l} className={`maniglia maniglia-${l === "sinistra" || l === "destra" ? "orizzontale" : "verticale"}`}
                  onPointerDown={(e) => inizia(e, "ridimensiona", "elemento", el, l)}>
                  <circle cx={cx} cy={cy} r={14} className="maniglia-presa" />
                  <circle cx={cx} cy={cy} r={8} className="maniglia-punto" />
                </g>
              );
            })}
          </g>
        );
      })}

      {props.tavoli.map((t) => {
        const s = props.sessionePer(t.id);
        const { w, h } = dimensioni(t);
        const pos = azione?.tipo === "tavolo" && azione.id === t.id ? azione : t;
        return (
          <g key={t.id} transform={`translate(${pos.x} ${pos.y})`} className={`tavolo${s ? " aperto" : ""}${selez("tavolo", t.id) ? " selezionato" : ""}${t.attivo ? "" : " spento"}`}
            tabIndex={0} role="button" aria-label={`Tavolo ${t.nome}${s ? ", aperto" : ", libero"}`}
            onClick={(e) => { e.stopPropagation(); props.onSeleziona({ tipo: "tavolo", id: t.id }); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onSeleziona({ tipo: "tavolo", id: t.id }); }}
            onPointerDown={(e) => { if (props.modificabile) inizia(e, "sposta", "tavolo", t); else e.stopPropagation(); }}>
            <circle r={Math.max(w, h) * 0.95} fill="url(#lampada)" className="luce-tavolo" />
            <g transform={`rotate(${t.rotazione})`} className={`tavolo-corpo stato-${stato(s)}`}>
              {s && (t.forma === "tondo"
                ? <circle r={w / 2 + 7} className="tavolo-alone" filter="url(#sfoca)" />
                : <rect x={-w / 2 - 7} y={-h / 2 - 7} width={w + 14} height={h + 14} rx={16} className="tavolo-alone" filter="url(#sfoca)" />)}
              {sedie(t, w, h).map((c, i) => (
                <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.a})`} filter="url(#ombra-lieve)">
                  <rect x={-9} y={-7} width={18} height={14} rx={5} className="sedia-seduta" />
                  <rect x={-9} y={-9.5} width={18} height={4.5} rx={2.2} className="sedia-schienale" />
                </g>
              ))}
              <g filter="url(#ombra)">
                {t.forma === "tondo"
                  ? <circle r={w / 2} className="tavolo-forma" />
                  : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={10} className="tavolo-forma" />}
              </g>
              {t.forma === "tondo"
                ? <circle r={w / 2 - 3.5} className="tovaglia-orlo" />
                : <rect x={-w / 2 + 3.5} y={-h / 2 + 3.5} width={w - 7} height={h - 7} rx={7} className="tovaglia-orlo" />}
              {/* Tavolo libero: apparecchiato (piatto, bicchiere e posate per ogni sedia) */}
              {!s && sedie(t, w, h).map((c, i) => <Coperto key={`c${i}`} {...c} />)}
            </g>
            {(() => {
              // Tavolo aperto: segnaposto colorato con nome, tempo e conto
              const euro = s && props.conto && h >= 44 ? props.conto(s.id) : 0;
              const pw = Math.min(w - 6, 72), ph = euro ? 44 : 34;
              return <>
                {s && <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph} rx={10} className={`segnaposto stato-${stato(s)}`} />}
                <text className="tavolo-nome" dy={s ? (euro ? -6 : -1) : 7}>{t.nome}</text>
                {s && <text className="tavolo-info" dy={euro ? 7 : 12}>{w < 70 ? durataBreve(minuti(s.aperta_at)) : durata(minuti(s.aperta_at))}</text>}
                {euro > 0 && <text className="tavolo-info tavolo-conto" dy={18}>{Math.round(euro / 100)} €</text>}
              </>;
            })()}
            {s && <g transform={`translate(${w / 2 + 6} ${-h / 2 - 6})`} className="tavolo-badge"><circle r={11} /><text dy={4}>{s.coperti}</text></g>}
            {props.inAttesa?.has(t.id) && <g transform={`translate(${-w / 2 - 6} ${-h / 2 - 6})`} className="tavolo-allerta"><circle r={13} /><text dy={5}>!</text></g>}
            {!s && props.prenotate?.get(t.id) && (
              <g transform={`translate(0 ${h / 2 + 30})`} className="tavolo-prenotato">
                <rect x={-34} y={-11} width={68} height={20} rx={10} /><text dy={4}>📅 {oraBreve(props.prenotate.get(t.id)!.data_ora)}</text>
              </g>
            )}
          </g>
        );
      })}
      {/* Vignettatura e cornice dentro il disegno: la sala resta sempre nei bordi */}
      <rect width={W} height={H} fill="url(#vignetta)" pointerEvents="none" />
      <rect x={6} y={6} width={W - 12} height={H - 12} rx={12} className="cornice-sala" />
      <rect x={12.5} y={12.5} width={W - 25} height={H - 25} rx={8} className="cornice-luce" />
    </svg>
  );
}

/** Coperto davanti a una sedia: piatto, bicchiere a destra e posate ai lati, verso il centro del tavolo. */
function Coperto({ x, y, a }: { x: number; y: number; a: number }) {
  const rad = (a * Math.PI) / 180, fuori = { x: Math.sin(rad), y: -Math.cos(rad) }, lato = { x: Math.cos(rad), y: Math.sin(rad) };
  const px = x - fuori.x * 23, py = y - fuori.y * 23;
  const punto = (l: number, f: number) => ({ x: px + lato.x * l - fuori.x * f, y: py + lato.y * l - fuori.y * f });
  const b = punto(8, 5), f1 = punto(-8.5, -3), f2 = punto(-8.5, 3), c1 = punto(8.5, -3), c2 = punto(8.5, 1);
  return (
    <g className="coperto" pointerEvents="none">
      <circle cx={px} cy={py} r={5.8} className="piatto" /><circle cx={px} cy={py} r={3.4} className="piatto-fondo" />
      <line x1={f1.x} y1={f1.y} x2={f2.x} y2={f2.y} className="posata" /><line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} className="posata" />
      <circle cx={b.x} cy={b.y} r={2.3} className="bicchiere" />
    </g>
  );
}

/** Disegno di un elemento d'arredo, centrato sull'origine. */
function Arredo({ tipo, w, h, etichetta }: { tipo: TipoElemento; w: number; h: number; etichetta: string }) {
  const r = { x: -w / 2, y: -h / 2, width: w, height: h };
  const scritta = etichetta ? <text className="arredo-testo" dy={5}>{etichetta}</text> : null;
  switch (tipo) {
    case "muro": return <g filter="url(#ombra-muro)"><rect {...r} rx={1.5} className="muro" /><rect x={-w / 2} y={-h / 2} width={w} height={Math.min(2.5, h / 3)} className="muro-luce" /></g>;
    case "porta": return <><rect {...r} className="porta-vano" /><path d={`M${-w / 2} ${-h / 2 - w} A ${w} ${w} 0 0 1 ${w / 2} ${-h / 2}`} className="porta-arco" /><line x1={-w / 2} y1={-h / 2} x2={-w / 2} y2={-h / 2 - w} className="porta-anta" /></>;
    case "finestra": return <>
      <path d={`M${-w / 2} ${h / 2} L${w / 2} ${h / 2} L${w / 2 + w * 0.25} ${h / 2 + w * 0.7} L${-w / 2 - w * 0.25} ${h / 2 + w * 0.7} Z`} className="luce-finestra" />
      <rect {...r} className="vetro" /><line x1={-w / 2 + 4} y1={-h / 6} x2={w / 2 - 4} y2={-h / 6} className="vetro-riflesso" />
    </>;
    case "colonna": return <rect {...r} rx={4} className="colonna" filter="url(#ombra)" />;
    case "pianta": {
      const r0 = Math.min(w, h) / 2;
      return <g filter="url(#ombra-lieve)"><circle r={r0 * 0.55} className="vaso" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
        <ellipse key={a} rx={r0 * 0.26} ry={r0 * (i % 2 ? 0.5 : 0.66)} transform={`rotate(${a}) translate(0 ${-r0 * 0.42})`} className="foglia" />
      ))}<circle r={r0 * 0.16} className="pianta-centro" /></g>;
    }
    case "bancone": {
      const m = Math.min(8, Math.min(w, h) / 5);
      return <g filter="url(#ombra)"><rect {...r} rx={8} className="bancone-piano" />
        <rect x={-w / 2 + m} y={-h / 2 + m} width={Math.max(0, w - 2 * m)} height={Math.max(0, h - 2 * m)} rx={4} className="bancone-top" />{scritta}</g>;
    }
    case "cassa": return <g filter="url(#ombra)"><rect {...r} rx={6} className="cassa-corpo" />
      <rect x={-w / 2 + 5} y={-h / 2 + 5} width={Math.max(0, w - 10)} height={Math.max(6, h * 0.32)} rx={3} className="cassa-schermo" />
      {etichetta && <text className="arredo-testo" y={h / 2 - 7}>{etichetta}</text>}</g>;
    case "bagni": return <><rect {...r} rx={6} className="bagni" />{scritta}</>;
    case "botte": return (
      <g filter="url(#ombra)">
        <ellipse rx={w / 2} ry={h / 2} className="botte" />
        {[0.82, 0.55].map((k) => <ellipse key={k} rx={(w / 2) * k} ry={(h / 2) * k} className="botte-cerchio" />)}
        {[-0.5, -0.25, 0, 0.25, 0.5].map((k) => <line key={k} x1={(w / 2) * k} y1={-(h / 2) * Math.sqrt(1 - k * k) * 0.95} x2={(w / 2) * k} y2={(h / 2) * Math.sqrt(1 - k * k) * 0.95} className="botte-doga" />)}
        <ellipse rx={w * 0.08} ry={h * 0.08} className="botte-tappo" />
      </g>
    );
    case "scaffale": {
      // Bottigliera vista dall'alto: fondi delle bottiglie in file, colori da vino rosso, bianco e rosato
      const col = Math.max(1, Math.min(60, Math.floor((w - 8) / 10))), righe = Math.max(1, Math.min(10, Math.floor((h - 6) / 10)));
      const colori = ["#4A1020", "#2F4A22", "#6B1A2A", "#C9B458", "#3B0F1A", "#B85C6E"];
      return <g filter="url(#ombra)"><rect {...r} rx={3} className="scaffale" />
        {Array.from({ length: col * righe }, (_, i) => (
          <circle key={i} cx={-w / 2 + 4 + ((w - 8) / col) * ((i % col) + 0.5)} cy={-h / 2 + 3 + ((h - 6) / righe) * (Math.floor(i / col) + 0.5)} r={3.6}
            fill={colori[(i * 7 + Math.floor(i / col) * 3) % colori.length]} className="bottiglia" />
        ))}{scritta}</g>;
    }
    case "divano": case "poltrona": {
      const sch = Math.min(16, h * 0.28), bracc = Math.min(14, w * 0.12), posti = tipo === "poltrona" ? 1 : Math.max(1, Math.round((w - 2 * bracc) / 55));
      return <g filter="url(#ombra)">
        <rect {...r} rx={10} className="divano" />
        <rect x={-w / 2} y={-h / 2} width={w} height={sch} rx={8} className="divano-schienale" />
        <rect x={-w / 2} y={-h / 2} width={bracc} height={h} rx={7} className="divano-schienale" /><rect x={w / 2 - bracc} y={-h / 2} width={bracc} height={h} rx={7} className="divano-schienale" />
        {Array.from({ length: posti }, (_, i) => {
          const lw = (w - 2 * bracc) / posti;
          return <rect key={i} x={-w / 2 + bracc + lw * i + 2} y={-h / 2 + sch + 2} width={lw - 4} height={h - sch - 6} rx={6} className="divano-cuscino" />;
        })}
      </g>;
    }
    case "sgabello": return <g filter="url(#ombra-lieve)"><circle r={Math.min(w, h) / 2} className="sgabello" /><circle r={Math.min(w, h) / 2 - 3} className="sgabello-seduta" /></g>;
    case "tappeto": return <g>
      <rect {...r} rx={4} className="tappeto" /><rect x={-w / 2 + 8} y={-h / 2 + 8} width={Math.max(0, w - 16)} height={Math.max(0, h - 16)} rx={3} className="tappeto-bordo" />
      <rect x={-w / 2 + 18} y={-h / 2 + 18} width={Math.max(0, w - 36)} height={Math.max(0, h - 36)} rx={2} className="tappeto-centro" />
      <path d={Array.from({ length: Math.max(0, Math.floor(h / 6)) }, (_, i) => { const y = -h / 2 + 3 + i * 6; return `M${-w / 2} ${y}h-5M${w / 2} ${y}h5`; }).join("")} className="tappeto-frange" />
    </g>;
    case "camino": return <g filter="url(#ombra)">
      <rect {...r} rx={3} className="camino-pietra" />
      <rect x={-w * 0.3} y={-h / 2 + 4} width={w * 0.6} height={h - 8} rx={4} className="camino-bocca" />
      <ellipse cx={0} cy={h * 0.08} rx={w * 0.24} ry={h * 0.32} className="camino-fuoco" />
      <ellipse cx={0} cy={h * 0.1} rx={w * 0.12} ry={h * 0.18} className="camino-brace" />
    </g>;
    case "scala": {
      const gradini = Math.max(3, Math.min(30, Math.floor(h / 14)));
      return <g filter="url(#ombra-lieve)"><rect {...r} rx={2} className="scala" />
        {Array.from({ length: gradini - 1 }, (_, i) => <line key={i} x1={-w / 2} x2={w / 2} y1={-h / 2 + (h / gradini) * (i + 1)} y2={-h / 2 + (h / gradini) * (i + 1)} className="scala-gradino" />)}
        <path d={`M0 ${h / 2 - 10}V${-h / 2 + 12}M-7 ${-h / 2 + 22}L0 ${-h / 2 + 12}L7 ${-h / 2 + 22}`} className="scala-freccia" /></g>;
    }
    case "cucina": {
      const fuochi = Math.max(1, Math.min(8, Math.floor(w / 50)));
      return <g filter="url(#ombra)"><rect {...r} rx={4} className="cucina" />
        <rect x={-w / 2 + 6} y={-h / 2 + 6} width={Math.max(0, w - 12)} height={Math.min(40, h * 0.4)} rx={3} className="cucina-piano" />
        {Array.from({ length: fuochi }, (_, i) => <circle key={i} cx={-w / 2 + 6 + ((w - 12) / fuochi) * (i + 0.5)} cy={-h / 2 + 6 + Math.min(40, h * 0.4) / 2} r={Math.min(11, h * 0.12)} className="fuoco" />)}
        {etichetta && <text className="arredo-testo" y={h / 4 + 8}>{etichetta}</text>}</g>;
    }
    case "vetrina": return <g filter="url(#ombra)">
      <rect {...r} rx={4} className="vetrina" /><rect x={-w / 2 + 4} y={-h / 2 + 4} width={Math.max(0, w - 8)} height={Math.max(0, h - 8)} rx={2} className="vetrina-vetro" />
      <line x1={-w / 2 + 10} y1={-h / 2 + 8} x2={-w / 2 + 30} y2={h / 2 - 8} className="vetro-riflesso" />{scritta}</g>;
    case "fioriera": {
      const n = Math.max(2, Math.min(20, Math.floor(w / 22)));
      return <g filter="url(#ombra-lieve)"><rect {...r} rx={4} className="fioriera" />
        {Array.from({ length: n }, (_, i) => <circle key={i} cx={-w / 2 + (w / n) * (i + 0.5)} cy={(i % 2 ? -1 : 1) * h * 0.12} r={Math.min(h * 0.42, w / n / 1.6)} className="foglia" />)}</g>;
    }
    case "zona": return <><rect {...r} rx={12} /><text className="arredo-testo zona-testo" y={-h / 2 + 22}>{etichetta}</text></>;
    case "testo": return <><rect {...r} className="testo-area" />{scritta}</>;
    default: return <><rect {...r} rx={4} />{scritta}</>;
  }
}
