import { defineConfig } from "vitest/config";

// Vitest bundles its own Vite; esbuild's automatic JSX is all the tests need.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["test/setup.ts"],
  },
});
