import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist-mobile",
    rollupOptions: {
      input: fileURLToPath(new URL("./mobile.html", import.meta.url)),
      output: {
        manualChunks: {
          terminal: ["@xterm/xterm", "@xterm/addon-fit"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
