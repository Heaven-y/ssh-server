import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发时只监听本机；API（含自动握手）与WebSocket保留Host/Origin交给后端校验。
const backendHost = process.env.AGENTDECK_HOST || '127.0.0.1';
const backendPort = process.env.AGENTDECK_PORT || '4317';
const backend = `http://${backendHost === '::1' ? '[::1]' : backendHost}:${backendPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: {
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'; frame-src 'self'",
    },
    proxy: {
      '/api': { target: backend, ws: true },
      '/ws': { target: backend, ws: true },
    },
  },
});
