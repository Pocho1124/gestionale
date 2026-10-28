import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tipo = "ok" | "errore";
const Ctx = createContext<(testo: string, tipo?: Tipo) => void>(() => {});

/** Messaggi brevi in basso: "Salvato", errori leggibili. */
export function ProviderAvvisi({ children }: { children: ReactNode }) {
  const [avviso, setAvviso] = useState<{ testo: string; tipo: Tipo; id: number } | null>(null);
  const mostra = useCallback((testo: string, tipo: Tipo = "ok") => {
    const id = Date.now();
    setAvviso({ testo, tipo, id });
    setTimeout(() => setAvviso((a) => (a?.id === id ? null : a)), tipo === "errore" ? 6000 : 2500);
  }, []);
  return (
    <Ctx.Provider value={mostra}>
      {children}
      <div className="avviso-area" role="status" aria-live="polite">
        {avviso && <div className={`avviso avviso-${avviso.tipo}`}>{avviso.testo}</div>}
      </div>
    </Ctx.Provider>
  );
}

export const useAvviso = () => useContext(Ctx);
