import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['athena-icon.svg', 'athena-icon-192.png', 'athena-icon-512.png'],
      manifest: {
        name: 'Athena HRMS',
        short_name: 'Athena',
        description: 'HR Management System by Ewards',
        theme_color: '#361963',
        background_color: '#0f172a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        orientation: 'portrait',
        icons: [
          {
            src: 'athena-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'athena-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache all app assets so it loads fast on mobile
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Don't cache API calls — always fetch fresh data
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        // Lets you test PWA features during local development
        enabled: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
