import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Proxy /api/* to the Next.js dev server so the session cookie (httpOnly,
// SameSite=Lax) stays same-origin to the page. Start both servers for dev:
//   - repo root:   npm run dev   (Next on :3000)
//   - BetOnMe/:    npm run dev   (Vite on :5173)
// Visit http://localhost:5173 and fetch('/api/...') will reach Next.
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
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
})
