import axios, { AxiosError, type AxiosResponse } from 'axios';
import { mockAdapter } from '@/mocks/adapter';
import { tokenStorage } from './tokenStorage';
import { ApiError, DEFAULT_ERROR_MESSAGE, type ApiFailure, type ApiResponse } from './types';

/**
 * 서버 통신 전 단계: VITE_USE_MOCK !== 'false' 이면 axios adapter 를 목(mock) 어댑터로 교체한다.
 * 화면·서비스 코드는 실제 서버와 같은 경로(인터셉터, 응답 봉투 해제, 에러 정규화)를 그대로 탄다.
 */
const useMock = import.meta.env.VITE_USE_MOCK !== 'false';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
  ...(useMock ? { adapter: mockAdapter } : {}),
});

apiClient.interceptors.request.use((config) => {
  const isAdminApi = config.url?.startsWith('/admin');
  const token = isAdminApi ? tokenStorage.getAdmin() : tokenStorage.getUser();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiFailure>) => {
    const status = error.response?.status ?? 0;
    const body = error.response?.data;
    if (body && body.success === false) {
      return Promise.reject(new ApiError(status, body.error.code, body.error.message));
    }
    if (!error.response) {
      return Promise.reject(
        new ApiError(0, 'NETWORK_ERROR', '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'),
      );
    }
    return Promise.reject(new ApiError(status, 'UNKNOWN_ERROR', DEFAULT_ERROR_MESSAGE));
  },
);

/** { success, data } 봉투를 벗겨 data 만 반환 */
export function unwrap<T>(response: AxiosResponse<ApiResponse<T>>): T {
  const body = response.data;
  if (body.success) return body.data;
  throw new ApiError(response.status, body.error.code, body.error.message);
}
