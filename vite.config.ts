import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  },
  test: {
    globals: true,
    environment: "jsdom",
    testTimeout: 20000,
    setupFiles: "./vitest.setup.ts",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"]
  }
});
