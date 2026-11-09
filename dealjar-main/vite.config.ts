import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const r = (p: string) => path.resolve(import.meta.dirname, p);

// The API (server/) runs as its own process; in dev Vite proxies /api to it so the browser talks to one origin.
// In production the Hono server serves the built app itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": r("src"), "@shared": r("shared"), "@srv": r("server/lib") } },
  server: {
    host: true, // reachable from a phone on the same Wi-Fi (for testing inside Nimiq Pay)
    port: 5174,
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8788}`, changeOrigin: false } },
  },
  build: { target: "es2022" },
  test: {
    environment: "node",
    // DOM tests opt in with a `// @vitest-environment jsdom` comment at the top of the file.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
