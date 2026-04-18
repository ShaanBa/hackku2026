import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Proxy /api/* to a Next.js backend so the session cookie (httpOnly,
// SameSite=Lax) stays same-origin to the page.
//
// Two supported workflows:
//
//   A) Full local stack (default):
//        - repo root:  npm run dev   (Next on :3000)
//        - BetOnMe/:   npm run dev   (Vite on :5173)
//        Needs MONGODB_URI / SESSION_SECRET / XRPL_HOT_SEED in
//        ../.env.local. Best for backend work.
//
//   B) Frontend-only against the live deployed backend (no secrets,
//      no local Mongo, login + goals + proofs all work):
//        Create BetOnMe/.env.local containing:
//          VITE_API_PROXY_TARGET=https://hackku2026.vercel.app
//        Then just `npm run dev` in BetOnMe/. Login, goal creation,
//        proof uploads, XRPL — everything talks to the live backend.
//        Ideal for designers / teammates doing visual polish.
//
// changeOrigin: true rewrites the upstream Host header so the
// production server doesn't reject the request as cross-origin.
const API_TARGET =
  process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000'
const PROXYING_REMOTE = !API_TARGET.startsWith('http://localhost')

// eslint-disable-next-line no-console
console.log(`[vite] proxying /api → ${API_TARGET}`)

export default defineConfig({
  // Served from /app on the unified Next.js deployment so all generated
  // asset URLs (e.g. /app/assets/index-xxx.js) match where the files
  // actually live inside Next's public/ folder.
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
    }
  },
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        // When proxying to the live deployment, rewrite Host so the
        // server treats the request as same-origin to itself. Local
        // Next.js dev doesn't need this.
        changeOrigin: PROXYING_REMOTE,
        // The session cookie comes back from Vercel with
        // SameSite=Lax + Secure. Vite's proxy passes it through, but
        // we strip Domain= so the browser scopes it to localhost
        // instead of vercel.app (otherwise the browser drops it).
        cookieDomainRewrite: PROXYING_REMOTE ? '' : undefined,
      },
    },
  },
})
