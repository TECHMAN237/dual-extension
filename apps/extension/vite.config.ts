import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        options: "src/options/index.html",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
