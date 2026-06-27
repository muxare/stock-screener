import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser talks to the SAD#4.2 screening service over same-origin paths
// (/screen, /backtest, /instrument, /facts, /metrics). In dev we proxy those to
// the Node service (server/index.ts, default :8787) so the client never computes
// the full universe (SAD#2.5). Override the target with VITE_SCREEN_API.
const SCREEN_API = process.env.VITE_SCREEN_API || 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/screen': SCREEN_API,
      '/backtest': SCREEN_API,
      '/instrument': SCREEN_API,
      '/facts': SCREEN_API,
      '/metrics': SCREEN_API,
      // Dev-only EOD import surface (DEV_TOOLS); 404s when the flag is off.
      '/dev': SCREEN_API,
    },
  },
})
