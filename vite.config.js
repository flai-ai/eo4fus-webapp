import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    vue(),
    ...(mode !== 'production' ? [vueDevTools()] : []),
    basicSsl(),
  ],
  server: {
    https: true,
    host: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          ol: ['ol'],
          primevue: ['primevue', '@primevue/themes'],
          vendor: ['vue', '@tanstack/vue-query', '@vueuse/core', 'axios'],
        },
      },
    },
  },
}))
