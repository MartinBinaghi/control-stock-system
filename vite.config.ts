import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // ponytail: app strictly online — el SW existe solo para push e instalabilidad,
      // sin precache. Si algún día se quiere offline, agregar workbox-precaching.
      injectManifest: { injectionPoint: undefined },
      manifest: {
        name: 'Stockcito — Control de Stock',
        short_name: 'Stockcito',
        description: 'Control de stock multi-sucursal',
        display: 'standalone',
        start_url: '/',
        theme_color: '#b45309',
        background_color: '#fffbeb',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
