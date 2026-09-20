import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
  build: {
    rolldownOptions: {
      output: {
        // React, Supabase and i18next change when their versions change —
        // which is to say, rarely. App code changes on every deploy. Kept in
        // one file they share a filename hash, so every deploy invalidates
        // the lot and a returning user re-downloads a React that has not
        // moved in months. Split, the vendor file keeps its hash across
        // deploys and comes from the browser's cache.
        //
        // This does not shrink the first visit — that was lazy loading's job,
        // in App.jsx. It shrinks every visit after a deploy, which for a tool
        // somebody opens several times a day is the number that adds up.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-markdown') || id.includes('micromark') || id.includes('mdast')) {
            // Only the agent chat imports these. Leave them in ITS lazy chunk
            // rather than hoisting them into a file the first paint waits for.
            return undefined
          }
          if (id.includes('/react') || id.includes('/scheduler/')) return 'vendor-react'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('i18next')) return 'vendor-i18n'
          return undefined
        },
      },
    },
  },
})
