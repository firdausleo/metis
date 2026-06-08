import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // Allow VITE_ prefixed env vars from wrangler.toml [vars] at build time
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
})
