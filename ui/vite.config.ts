import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: path.join(import.meta.dirname, "dist"), emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:4800", "/ws": { target: "ws://127.0.0.1:4800", ws: true } },
  },
});
