/** 합의 4. API 응답 기준 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 화면에서 사용하는 정규화된 에러 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_ERROR_MESSAGE = '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return DEFAULT_ERROR_MESSAGE;
}
