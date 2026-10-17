import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { adminRoutes } from './handlers/admin';
import { userRoutes } from './handlers/user';
import { fail, type MockResult } from './http';

const routes = [...userRoutes, ...adminRoutes].map(([method, path, handler]) => {
  const keys: string[] = [];
  const pattern = path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, regex: new RegExp(`^${pattern}$`), keys, handler };
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockAdapter: AxiosAdapter = async (config) => {
  await delay(250 + Math.random() * 350);

  const method = (config.method ?? 'get').toUpperCase();
  const [path, search = ''] = (config.url ?? '').split('?');
  const query: Record<string, string> = Object.fromEntries(new URLSearchParams(search));
  Object.entries((config.params ?? {}) as Record<string, unknown>).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query[k] = String(v);
  });

  let body: Record<string, unknown> = {};
  if (typeof config.data === 'string' && config.data) {
    try {
      body = JSON.parse(config.data);
    } catch {
      body = {};
    }
  }

  const auth = new AxiosHeaders(config.headers).get('Authorization');
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : null;

  let result: MockResult = fail(404, 'NOT_FOUND', '요청한 API 를 찾을 수 없어요.');
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.regex.exec(path);
    if (!match) continue;
    const params = Object.fromEntries(
      route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]),
    );
    try {
      result = route.handler({ params, query, body, token });
    } catch (e) {
      console.error('[mock] handler error', e);
      result = fail(500, 'INTERNAL_ERROR', '서버 오류가 발생했어요.');
    }
    break;
  }

  if (import.meta.env.DEV) {
    console.debug(`[mock] ${method} ${path}`, result.status, result.body);
  }

  const response: AxiosResponse = {
    data: result.body,
    status: result.status,
    statusText: String(result.status),
    headers: {},
    config,
  };

  if (result.status >= 400) {
    throw new AxiosError(
      `Request failed with status code ${result.status}`,
      result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response,
    );
  }
  return response;
};
