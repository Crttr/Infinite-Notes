import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Keep the application shell independent from the larger canvas/editor libraries.
// Vite 8 uses Rolldown for production builds.
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/@xyflow/') || id.includes('\\@xyflow\\')) return 'canvas-vendor'
          if (id.includes('/@tiptap/') || id.includes('\\@tiptap\\') || id.includes('/prosemirror-') || id.includes('\\prosemirror-')) return 'editor-vendor'
        },
      },
    },
  },
})
