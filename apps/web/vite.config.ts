import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发时只监听本机；接口、登录、WebSocket 转发给后端（保留 Host 与 Origin，后端按开发来源校验）
const backend = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/ws': { target: backend, ws: true },
    },
  },
});
