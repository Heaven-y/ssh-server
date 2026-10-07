import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发时只监听本机；API（含自动握手）与WebSocket保留Host/Origin交给后端校验。
const backend = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, ws: true },
      '/ws': { target: backend, ws: true },
    },
  },
});
