import type { ApiResponse } from '@/api/types';

export interface MockRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  token: string | null;
}

export interface MockResult {
  status: number;
  body: ApiResponse<unknown>;
}

export type MockHandler = (req: MockRequest) => MockResult;
export type MockRoute = [method: string, path: string, handler: MockHandler];

export const ok = (data: unknown, status = 200): MockResult => ({
  status,
  body: { success: true, data },
});

export const fail = (status: number, code: string, message: string): MockResult => ({
  status,
  body: { success: false, error: { code, message } },
});
