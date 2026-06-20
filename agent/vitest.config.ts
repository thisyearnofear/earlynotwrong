import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      include: ["lib/**/*.ts"],
      exclude: ["lib/config.ts", "lib/constants.ts"],
    },
  },
});
