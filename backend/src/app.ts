/** Express 앱 구성 (테스트에서도 같은 앱을 띄울 수 있도록 index.ts와 분리) */
import express from 'express';
import type { DB } from './db.js';
import { config } from './config.js';
import { authenticate, errorHandler, HttpError } from './http.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { visitRoutes } from './routes/visits.js';

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '200kb' }));

  // 프론트를 다른 주소에서 띄울 때만 CORS 허용 (Vite 프록시를 쓰면 필요 없음)
  if (config.corsOrigin) {
    app.use((req, res, next) => {
      res.set('Access-Control-Allow-Origin', config.corsOrigin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      if (req.method === 'OPTIONS') return void res.status(204).end();
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ai: config.ai.enabled ? config.ai.model : 'rule-based', demoMode: config.demoMode });
  });

  const api = express.Router();
  api.use(authenticate(db));
  api.use(catalogRoutes(db));
  api.use(authRoutes(db));
  api.use(visitRoutes(db));
  api.use(adminRoutes(db));
  api.use((_req, _res, next) => next(new HttpError(404, '존재하지 않는 API예요.')));
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}
