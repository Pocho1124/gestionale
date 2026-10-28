import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProviderSessione, useSessione } from "./lib/sessione";
import { ProviderAvvisi } from "./componenti/Avviso";
import { Guscio } from "./componenti/Guscio";
import { Accesso } from "./pagine/Accesso";
import { PrimoLocale } from "./pagine/PrimoLocale";
import { Catalogo } from "./pagine/Catalogo";
import { Aspetto } from "./pagine/Aspetto";
import { MenuPubblico } from "./pagine/MenuPubblico";

function AreaRiservata() {
  const { pronta, sessione, locale, puoModificare } = useSessione();
  if (!pronta) return <p className="centrato muto">Caricamento…</p>;
  if (!sessione) return <Accesso />;
  if (!locale) return <PrimoLocale />;
  return (
    <Routes>
      <Route element={<Guscio />}>
        <Route path="/catalogo" element={<Catalogo />} />
        {puoModificare && <Route path="/aspetto" element={<Aspetto />} />}
        <Route path="*" element={<Navigate to="/catalogo" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ProviderAvvisi>
        <Routes>
          {/* Menu clienti: pubblico, senza login */}
          <Route path="/m/:slug" element={<MenuPubblico />} />
          <Route path="*" element={<ProviderSessione><AreaRiservata /></ProviderSessione>} />
        </Routes>
      </ProviderAvvisi>
    </BrowserRouter>
  );
}
