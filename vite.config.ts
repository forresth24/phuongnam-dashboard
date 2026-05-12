import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))
  }
})
