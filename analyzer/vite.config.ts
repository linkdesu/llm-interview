import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the site works when served from a sub-path.
  base: './',
  plugins: [vue()],
  server: {
    proxy: {
      // Forward the JSON API to the Bun server started by "bun run dev".
      '/sessions': 'http://localhost:3090',
      '/session': 'http://localhost:3090',
      '/health': 'http://localhost:3090',
    },
  },
})
