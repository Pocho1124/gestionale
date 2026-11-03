import { useState, type FormEvent } from "react";
import { sb } from "../lib/supabase";
import { messaggioErrore } from "../lib/errori";

/** Solo accesso: la registrazione libera è chiusa, gli account li crea il titolare. */
export function Accesso() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  async function invia(e: FormEvent) {
    e.preventDefault();
    setErrore(null); setAttesa(true);
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
    setAttesa(false);
    if (error) setErrore(messaggioErrore(error));
    setPassword("");
  }

  return (
    <div className="centrato">
      <form className="scheda scheda-stretta" onSubmit={invia}>
        <h1 className="titolo">Gestionale</h1>
        <label className="campo">Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="campo">Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {errore && <p className="errore">{errore}</p>}
        <button className="btn btn-pieno" disabled={attesa}>{attesa ? "Attendi…" : "Accedi"}</button>
        <p className="muto piccolo">Non hai un account? Chiedilo al titolare del locale.</p>
      </form>
    </div>
  );
}
