import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Node nie wczytuje modułów workerd; `workers-oauth-provider` wymaga `cloudflare:workers`.
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: {
    server: {
      // Zależność musi przejść przez Vite, inaczej alias nie obejmuje jej importu.
      deps: { inline: ["@cloudflare/workers-oauth-provider"] },
    },
  },
});
