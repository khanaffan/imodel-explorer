import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const nodeModules = resolve(__dirname, "node_modules");

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  publicDir: "public",
  server: { port: 3000, strictPort: true },
  css: {
    preprocessorOptions: {
      scss: {
        // AppUI stylesheets use webpack-style `~package/...` imports.
        importers: [{
          findFileUrl(url: string) {
            return url.startsWith("~") ? pathToFileURL(resolve(nodeModules, url.slice(1))) : null;
          },
        }],
        silenceDeprecations: ["import", "global-builtin", "mixed-decls", "color-functions"],
      },
    },
  },
  build: {
    outDir: "dist/frontend",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 12000,
    sourcemap: true,
  },
  worker: { format: "es" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
