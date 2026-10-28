import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./stile.css";
import { inizializzaSupabase } from "./lib/supabase";
import { caricaFont } from "./lib/font";
import { App } from "./App";

const radice = createRoot(document.getElementById("root")!);
caricaFont("Figtree");
caricaFont("Young Serif");

inizializzaSupabase()
  .then(() => radice.render(<StrictMode><App /></StrictMode>))
  .catch((e: unknown) => {
    radice.render(<p className="centrato errore">{e instanceof Error ? e.message : "Errore di avvio"}</p>);
  });
