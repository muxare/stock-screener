import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser talks to the screening service over same-origin paths
// (/screen, /instrument, /facts, /metrics). In dev we proxy those to
// the Node service (server/index.ts, default :8787). Override with VITE_SCREEN_API.
const SCREEN_API = process.env.VITE_SCREEN_API || 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/screen': SCREEN_API,
      '/signals': SCREEN_API,
      '/backtest': SCREEN_API,
      '/instrument': SCREEN_API,
      '/facts': SCREEN_API,
      '/metrics': SCREEN_API,
      // Dev-only EOD import surface (DEV_TOOLS); 404s when the flag is off.
      '/dev': SCREEN_API,
    },
  },
})
