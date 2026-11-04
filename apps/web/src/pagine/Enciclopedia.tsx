import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { useSessione } from "../lib/sessione";
import { useAvviso } from "../componenti/Avviso";
import { messaggioErrore } from "../lib/errori";
import { puo } from "../lib/permessi";
import { CORPI_VINO, TIPI_VINO } from "../lib/tipi";

interface Voce { id: string; nome: string; cantina: string; tipo: keyof typeof TIPI_VINO; corpo: keyof typeof CORPI_VINO; regione: string; paese: string;
  vitigno: string; abbinamenti: string; fonte: "base" | "xwines" | "locale"; contenuto?: boolean }
const FONTI = { base: "Base curata", xwines: "X-Wines", locale: "Aggiunto dal locale" } as const;
const VUOTA = { nome: "", cantina: "", tipo: "rosso" as Voce["tipo"], corpo: "medio" as Voce["corpo"], regione: "", paese: "Italia", vitigno: "" };

/** Enciclopedia dei vini: ricerca nelle fonti e gestione dei vini aggiunti dal locale. */
export function Enciclopedia() {
  const { locale, ruolo } = useSessione();
  const avvisa = useAvviso();
  const [cerca, setCerca] = useState("");
  const [risultati, setRisultati] = useState<Voce[] | null>(null);
  const [nostri, setNostri] = useState<Voce[]>([]);
  const [nuova, setNuova] = useState(VUOTA);
  const [totali, setTotali] = useState<Record<string, number>>({});

  const caricaNostri = useCallback(async () => {
    if (!locale) return;
    const { data } = await sb().from("enciclopedia_vini").select("id, nome, cantina, tipo, corpo, regione, paese, vitigno, abbinamenti, fonte")
      .eq("locale_id", locale.id).order("nome");
    setNostri((data as Voce[]) ?? []);
    const conta = async (fonte: string) => (await sb().from("enciclopedia_vini").select("id", { count: "exact", head: true }).eq("fonte", fonte)).count ?? 0;
    setTotali({ base: await conta("base"), xwines: await conta("xwines"), locale: await conta("locale") });
  }, [locale]);
  useEffect(() => { void caricaNostri(); }, [caricaNostri]);

  if (!locale) return null;
  if (!puo(ruolo, "catalogo")) return <div className="pagina"><h1>Enciclopedia dei vini</h1><p className="muto">Riservata a titolare e responsabile.</p></div>;

  async function ricerca(e: FormEvent) {
    e.preventDefault();
    if (cerca.trim().length < 3) { avvisa("Scrivi almeno 3 lettere", "errore"); return; }
    const { data, error } = await sb().rpc("cerca_vino", { p_testo: cerca.trim(), p_limite: 30 });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    setRisultati(data as Voce[]);
    if (!(data as Voce[]).length) setNuova({ ...VUOTA, nome: cerca.trim() });
  }
  async function aggiungi(e: FormEvent) {
    e.preventDefault();
    const { error } = await sb().from("enciclopedia_vini").insert({ ...nuova, nome: nuova.nome.trim(), fonte: "locale", locale_id: locale!.id });
    if (error) { avvisa(messaggioErrore(error), "errore"); return; }
    avvisa(`«${nuova.nome.trim()}» aggiunto all'enciclopedia`); setNuova(VUOTA); await caricaNostri();
  }
  const riga = (v: Voce, modificabile: boolean) => (
    <tr key={v.id}>
      <td><b>{v.nome}</b>{v.cantina && <span className="muto piccolo"> · {v.cantina}</span>}</td>
      <td>{TIPI_VINO[v.tipo]}, {CORPI_VINO[v.corpo].toLowerCase()}</td>
      <td>{[v.regione, v.paese].filter(Boolean).join(", ")}</td>
      <td>{v.vitigno}</td>
      <td><span className="pill">{FONTI[v.fonte]}</span></td>
      <td>{modificabile && <button className="btn btn-pericolo btn-piccolo" onClick={async () => {
        if (!confirm(`Togliere «${v.nome}» dall'enciclopedia?`)) return;
        const { error } = await sb().from("enciclopedia_vini").delete().eq("id", v.id);
        if (error) avvisa(messaggioErrore(error), "errore"); else avvisa("Vino tolto");
        await caricaNostri();
      }}>Togli</button>}</td>
    </tr>
  );

  return (
    <div className="pagina">
      <div className="pagina-testa"><h1>Enciclopedia dei vini</h1></div>
      <p className="muto piccolo">Da qui il bot prende tipo, corpo, regione e vitigno quando compila le schede dei vini per il quiz «Trova il tuo vino».
        Voci: {totali.base ?? 0} della base curata · {(totali.xwines ?? 0).toLocaleString("it-IT")} da X-Wines · {totali.locale ?? 0} aggiunte dal locale.</p>

      <form className="riga-form" onSubmit={ricerca}>
        <input placeholder="Cerca un vino, una cantina o un vitigno" value={cerca} onChange={(e) => setCerca(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-pieno">Cerca</button>
      </form>
      {risultati && (risultati.length === 0
        ? <p className="ordina-avviso">Non presente nell'enciclopedia: puoi aggiungerlo qui sotto.</p>
        : <table className="tabella"><thead><tr><th>Vino</th><th>Tipo</th><th>Zona</th><th>Vitigno</th><th>Fonte</th><th /></tr></thead>
            <tbody>{risultati.map((v) => riga(v, false))}</tbody></table>)}

      <section className="gruppo">
        <legend>Aggiungi un vino</legend>
        <form className="vino-campi" onSubmit={aggiungi}>
          <label>Nome <input required maxLength={160} value={nuova.nome} onChange={(e) => setNuova({ ...nuova, nome: e.target.value })} /></label>
          <label>Cantina <input maxLength={160} value={nuova.cantina} onChange={(e) => setNuova({ ...nuova, cantina: e.target.value })} /></label>
          <label>Tipo <select value={nuova.tipo} onChange={(e) => setNuova({ ...nuova, tipo: e.target.value as Voce["tipo"] })}>
            {Object.entries(TIPI_VINO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label>Corpo <select value={nuova.corpo} onChange={(e) => setNuova({ ...nuova, corpo: e.target.value as Voce["corpo"] })}>
            {Object.entries(CORPI_VINO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label>Regione <input maxLength={120} value={nuova.regione} onChange={(e) => setNuova({ ...nuova, regione: e.target.value })} /></label>
          <label>Paese <input maxLength={60} value={nuova.paese} onChange={(e) => setNuova({ ...nuova, paese: e.target.value })} /></label>
          <label>Vitigno <input maxLength={200} value={nuova.vitigno} onChange={(e) => setNuova({ ...nuova, vitigno: e.target.value })} /></label>
          <button className="btn btn-pieno">Aggiungi</button>
        </form>
      </section>

      {nostri.length > 0 && (
        <section className="gruppo">
          <legend>Vini aggiunti dal locale</legend>
          <table className="tabella"><thead><tr><th>Vino</th><th>Tipo</th><th>Zona</th><th>Vitigno</th><th>Fonte</th><th /></tr></thead>
            <tbody>{nostri.map((v) => riga(v, true))}</tbody></table>
        </section>
      )}
      <p className="muto piccolo">Fonte dei dati X-Wines (licenza CC0): de Azambuja, R.X.; Morais, A.J.; Filipe, V. «X-Wines: A Wine Dataset for Recommender
        Systems and Machine Learning», Big Data Cogn. Comput. 2023, 7, 20. I dati sono stati raccolti sul web nel 2022: verificali prima di usarli.</p>
    </div>
  );
}
