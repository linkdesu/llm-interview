import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the site works when served from a sub-path (GitHub Pages).
  base: './',
  plugins: [vue()],
})
