import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProviderSessione, useSessione } from "./lib/sessione";
import { ProviderCodice } from "./lib/codice";
import { ProviderAvvisi } from "./componenti/Avviso";
import { Guscio } from "./componenti/Guscio";
import { Accesso } from "./pagine/Accesso";
import { PrimoLocale } from "./pagine/PrimoLocale";

// Ogni pagina si scarica quando serve: il tablet apre prima e il cliente al tavolo scarica solo la sua pagina
const Catalogo = lazy(() => import("./pagine/Catalogo").then((m) => ({ default: m.Catalogo })));
const Aspetto = lazy(() => import("./pagine/Aspetto").then((m) => ({ default: m.Aspetto })));
const MenuPubblico = lazy(() => import("./pagine/MenuPubblico").then((m) => ({ default: m.MenuPubblico })));
const Sala = lazy(() => import("./pagine/Sala").then((m) => ({ default: m.Sala })));
const OrdinaTavolo = lazy(() => import("./pagine/OrdinaTavolo").then((m) => ({ default: m.OrdinaTavolo })));
const Impostazioni = lazy(() => import("./pagine/Impostazioni").then((m) => ({ default: m.Impostazioni })));
const Magazzino = lazy(() => import("./pagine/Magazzino").then((m) => ({ default: m.Magazzino })));
const Cassa = lazy(() => import("./pagine/Cassa").then((m) => ({ default: m.Cassa })));
const Enciclopedia = lazy(() => import("./pagine/Enciclopedia").then((m) => ({ default: m.Enciclopedia })));
const Fatture = lazy(() => import("./pagine/Fatture").then((m) => ({ default: m.Fatture })));
const Cucina = lazy(() => import("./pagine/Cucina").then((m) => ({ default: m.Cucina })));
const attesa = <p className="centrato muto">Caricamento…</p>;

function AreaRiservata() {
  const { pronta, sessione, locale, ruolo, puoModificare } = useSessione();
  if (!pronta) return <p className="centrato muto">Caricamento…</p>;
  if (!sessione) return <Accesso />;
  if (!locale) return <PrimoLocale />;
  // La cucina vede solo lo schermo delle comande
  const iniziale = ruolo === "cucina" ? "/cucina" : "/catalogo";
  return (
    <ProviderCodice>
    <Suspense fallback={attesa}>
    <Routes>
      <Route element={<Guscio />}>
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/sala" element={<Sala />} />
        <Route path="/ordini" element={<Navigate to="/sala" replace />} />
        <Route path="/impostazioni" element={<Impostazioni />} />
        <Route path="/magazzino" element={<Magazzino />} />
        <Route path="/cassa" element={<Cassa />} />
        <Route path="/enciclopedia" element={<Enciclopedia />} />
        <Route path="/fatture" element={<Fatture />} />
        <Route path="/cucina" element={<Cucina />} />
        {puoModificare && <Route path="/aspetto" element={<Aspetto />} />}
        <Route path="*" element={<Navigate to={iniziale} replace />} />
      </Route>
    </Routes>
    </Suspense>
    </ProviderCodice>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ProviderAvvisi>
        <Suspense fallback={attesa}>
        <Routes>
          {/* Menu clienti: pubblico, senza login */}
          <Route path="/m/:slug" element={<MenuPubblico />} />
          {/* Ordini dal tavolo: pubblico, protetto da QR + codice + conferma dello staff */}
          <Route path="/t/:token" element={<OrdinaTavolo />} />
          <Route path="*" element={<ProviderSessione><AreaRiservata /></ProviderSessione>} />
        </Routes>
        </Suspense>
      </ProviderAvvisi>
    </BrowserRouter>
  );
}
