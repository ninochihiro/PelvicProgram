import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const serialProxy = {
  '/serial-ws': {
    target: 'http://127.0.0.1:8080',
    ws: true,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/serial-ws/, '')
  }
}

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true
  }
}

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      ...apiProxy,
      ...serialProxy
    }
  },
  preview: {
    proxy: {
      ...apiProxy,
      ...serialProxy
    }
  }
})
