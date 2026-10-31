import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { sb } from "../lib/supabase";
import type { Aspetto, MenuPubblico as Menu } from "../lib/tipi";
import { MenuVista } from "../componenti/MenuVista";

export const ASPETTO_PREDEFINITO: Aspetto = {
  colore_primario: "#1F4FA8", colore_accento: "#F2C230", colore_sfondo: "#F2F5F8", colore_testo: "#13233A",
  font_titoli: "Young Serif", font_testo: "Figtree", logo_url: null, logo_dati: null, mostra_nome: true, layout: "lista",
  mostra_allergeni: true, mostra_descrizioni: true, testo_piede: "",
  sfondo_dati: null, sfondo_opacita: 22, sfondo_sfocatura: 3, sfondo_bn: false,
};

/** Pagina aperta dal QR: legge solo i dati pubblici e si aggiorna da sola ogni 15 secondi. */
export function MenuPubblico() {
  const { slug = "" } = useParams();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [stato, setStato] = useState<"carico" | "ok" | "assente" | "errore">("carico");

  useEffect(() => {
    let attivo = true;
    async function carica() {
      const { data, error } = await sb().rpc("menu_pubblico", { p_slug: slug });
      if (!attivo) return;
      if (error) { setStato((s) => (s === "ok" ? s : "errore")); return; }
      if (!data) { setStato("assente"); return; }
      setMenu(data as Menu); setStato("ok");
      document.title = `Menu · ${(data as Menu).locale.nome}`;
    }
    void carica();
    const t = setInterval(() => void carica(), 15_000);
    const vis = () => { if (document.visibilityState === "visible") void carica(); };
    document.addEventListener("visibilitychange", vis);
    return () => { attivo = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [slug]);

  if (stato === "carico") return <p className="centrato muto">Caricamento del menu…</p>;
  if (stato === "assente") return <p className="centrato muto">Questo menu non esiste o non è più pubblicato.</p>;
  if (stato === "errore" || !menu) return <p className="centrato muto">Menu momentaneamente non raggiungibile. Riprova tra poco.</p>;
  return <MenuVista menu={menu} aspetto={menu.aspetto ?? ASPETTO_PREDEFINITO} />;
}
