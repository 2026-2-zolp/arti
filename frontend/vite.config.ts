import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { apiTarget, apiProxy } from './src/lib/apiTarget';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, root, 'VITE_');
  const target = apiTarget(env.VITE_API_TARGET);
  const proxy = apiProxy(target, env.VITE_API_PROXY);
  const base = env.VITE_API_BASE ?? '/api';
  return {
  root,
  envDir: root,
  define: {'import.meta.env.VITE_API_TARGET': JSON.stringify(target)},
  plugins: [react(), {
    name: 'arti-build-target',
    generateBundle() {
      this.emitFile({type: 'asset', fileName: 'arti-build.json', source: JSON.stringify({target, base})});
    },
    configurePreviewServer(server) {
      let built: {target?: string; base?: string};
      try {built = JSON.parse(readFileSync(path.resolve(server.config.root, server.config.build.outDir, 'arti-build.json'), 'utf8'));}
      catch {throw new Error('ARTI preview requires npm run build first.');}
      if (built.target !== target || built.base !== base) throw new Error('ARTI preview target/API base differs from build. Rebuild with the same settings.');
    },
  }],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  server: {
    // 폰 시연용 터널 주소 허용 (docs/실행-가이드-Windows.md 6장)
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
    // Default: Django. Legacy Express requires VITE_API_TARGET=express.
    proxy: { '/api': proxy },
  },
  preview: {
    proxy: { '/api': proxy },
  },
};
});
