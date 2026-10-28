import { useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { messaggioErrore } from "../lib/errori";

export function Accesso() {
  const [modo, setModo] = useState<"accedi" | "registra">("accedi");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  async function invia(e: FormEvent) {
    e.preventDefault();
    setErrore(null); setAttesa(true);
    const { error } = modo === "accedi"
      ? await sb().auth.signInWithPassword({ email: email.trim(), password })
      : await sb().auth.signUp({ email: email.trim(), password, options: { data: { nome: nome.trim() } } });
    setAttesa(false);
    if (error) setErrore(messaggioErrore(error));
    setPassword("");
  }

  return (
    <div className="centrato">
      <form className="scheda scheda-stretta" onSubmit={invia}>
        <h1 className="titolo">Gestionale</h1>
        <div className="schede-modo" role="tablist">
          <button type="button" role="tab" aria-selected={modo === "accedi"} onClick={() => setModo("accedi")}>Accedi</button>
          <button type="button" role="tab" aria-selected={modo === "registra"} onClick={() => setModo("registra")}>Crea account</button>
        </div>
        {modo === "registra" && (
          <label className="campo">Nome<input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required /></label>
        )}
        <label className="campo">Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="campo">Password
          <input type="password" autoComplete={modo === "accedi" ? "current-password" : "new-password"}
                 minLength={modo === "registra" ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {modo === "registra" && <p className="muto piccolo">Almeno 10 caratteri.</p>}
        {errore && <p className="errore">{errore}</p>}
        <button className="btn btn-pieno" disabled={attesa}>{attesa ? "Attendi…" : modo === "accedi" ? "Accedi" : "Crea account"}</button>
      </form>
    </div>
  );
}
