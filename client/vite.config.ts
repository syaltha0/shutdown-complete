import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Shared by the eager screens and every lazy screen; fetched with the app shell.
        manualChunks: (id) => id.includes('/node_modules/') ? 'vendor' : undefined,
      },
    },
  },
  server: {
    port: 5173,
    // keep the browser's Host (localhost:5173): the API checks that changes come from the page's own site, and
    // passkeys belong to that host too
    // (CalDAV for task apps lives at /dav and /.well-known/caldav)
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/dav': { target: 'http://localhost:3000', changeOrigin: false },
      '/.well-known/caldav': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
