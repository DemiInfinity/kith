import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// In development the Kith server runs on :8787; the app is served from Vite and proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787", "/auth": "http://localhost:8787", "/manifest.webmanifest": "http://localhost:8787" },
  },
  build: {
    outDir: "dist", sourcemap: false,
    // Two pages: the app, and the public welcome page as real HTML that search engines can read
    // (the server sends welcome.html for "/" when nobody's signed in).
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), welcome: resolve(import.meta.dirname, "welcome.html"),
      terms: resolve(import.meta.dirname, "terms.html"), privacy: resolve(import.meta.dirname, "privacy.html"), setup: resolve(import.meta.dirname, "setup.html") } },
  },
});
