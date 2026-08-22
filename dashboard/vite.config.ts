import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // public/ holds session artifacts (model-generated code, served as-is).
  // Keep the dep-optimizer from crawling them as module-graph entries.
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
