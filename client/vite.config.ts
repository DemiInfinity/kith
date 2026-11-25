import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Kith server runs on :8787; the app is served from Vite and proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787", "/auth": "http://localhost:8787" },
  },
  build: { outDir: "dist", sourcemap: false },
});
