import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // base must match the GitHub Pages path: https://crashkeyz.github.io/resurrected-AI/
  base: '/resurrected-AI/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

