import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    build: {
      outDir: "dist/client",
      emptyOutDir: true
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: parseAllowedHosts(env.DEV_ALLOWED_HOSTS)
    },
    test: {
      globals: true,
      environment: "jsdom",
      testTimeout: 40000,
      setupFiles: "./vitest.setup.ts",
      include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"]
    }
  };
});

function parseAllowedHosts(value: string | undefined): string[] {
  const parsed = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed?.length ? parsed : ["lsla.mangezi.xyz", ".replit.dev", ".picard.replit.dev"];
}
