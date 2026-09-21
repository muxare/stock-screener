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
    // A gitignored folder is invisible to git and perfectly visible to this dev
    // server, which serves anything under the project root: without this rule a
    // screenshot of a brokerage account parked in the tree is one GET away at
    // http://localhost:5173/.local-screenshots/<name>.png, from the dev app's own
    // origin. Ignoring a file and not serving it are two different decisions and
    // both have to be made.
    fs: { deny: ['.env', '.env.*', '**/.local-screenshots/**'] },
    proxy: {
      '/screen': SCREEN_API,
      '/signals': SCREEN_API,
      '/backtest': SCREEN_API,
      '/instrument': SCREEN_API,
      '/facts': SCREEN_API,
      '/metrics': SCREEN_API,
      // Portfolio screenshot reader (hardening stage 3). Answers 503 rather
      // than 404 when the service has no ANTHROPIC_API_KEY.
      '/portfolio': SCREEN_API,
      // Dev-only EOD import surface (DEV_TOOLS); 404s when the flag is off.
      '/dev': SCREEN_API,
    },
  },
})
