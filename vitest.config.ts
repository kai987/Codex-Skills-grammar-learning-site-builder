import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mvl/shared": `${root}packages/shared/src/index.ts`,
      "@mvl/site-builder-core": `${root}packages/site-builder-core/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
