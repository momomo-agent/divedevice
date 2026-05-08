import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  base: process.env.BASE_URL ?? '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['@yume-chan/adb', '@yume-chan/adb-daemon-webusb'],
  },
})
