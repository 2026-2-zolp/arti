import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    // 폰 시연용 터널 주소 허용 (docs/실행-가이드-Windows.md 6장)
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
    // /api 요청은 백엔드 서버(backend/, 기본 4000번 포트)로 전달
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000' },
  },
  preview: {
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000' },
  },
});
