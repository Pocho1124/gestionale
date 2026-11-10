// Test della logica del backoffice (moduli senza React: formati, piantina, fatture, traduzioni).
// Girano con il vitest di questo pacchetto, così il backoffice non ha dipendenze di test in più.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@gest/core": fileURLToPath(new URL("./src/index.ts", import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL("../../apps/web/src", import.meta.url)),
    include: ["**/*.test.ts"],
    globals: true,
  },
});
