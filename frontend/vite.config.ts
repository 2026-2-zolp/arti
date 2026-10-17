import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    // /api 요청은 백엔드 서버(backend/, 기본 4000번 포트)로 전달
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000' },
  },
  preview: {
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000' },
  },
});
