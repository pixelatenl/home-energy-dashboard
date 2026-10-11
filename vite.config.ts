import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": `${import.meta.dirname}/src`,
    },
  },
  server: {
    proxy: {
      // Forward API calls to the local data server (server/index.mjs),
      // which runs on its own port so it never collides with Vite.
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? 5273}`,
        changeOrigin: true,
      },
    },
  },
})
