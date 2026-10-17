import type { Admin, SavedTaste, User, VisitRecord } from '@/types/domain';
import { apiClient, unwrap } from '../client';
import type { ApiResponse } from '../types';

export interface SignupInput {
  email: string;
  password: string;
  nickname?: string;
  agreeTerms: boolean;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient
      .post<ApiResponse<{ token: string; user: User }>>('/auth/login', { email, password })
      .then(unwrap),

  signup: (input: SignupInput) =>
    apiClient.post<ApiResponse<{ token: string; user: User }>>('/auth/signup', input).then(unwrap),

  me: () => apiClient.get<ApiResponse<User>>('/auth/me').then(unwrap),

  logout: () => apiClient.post<ApiResponse<null>>('/auth/logout').then(unwrap),

  requestPasswordReset: (email: string) =>
    apiClient
      .post<ApiResponse<{ sent: boolean; devResetToken?: string }>>('/auth/password/forgot', {
        email,
      })
      .then(unwrap),

  resetPassword: (token: string, password: string) =>
    apiClient.post<ApiResponse<null>>('/auth/password/reset', { token, password }).then(unwrap),

  adminLogin: (loginId: string, password: string) =>
    apiClient
      .post<ApiResponse<{ token: string; admin: Admin }>>('/admin/auth/login', {
        loginId,
        password,
      })
      .then(unwrap),

  adminMe: () => apiClient.get<ApiResponse<Admin>>('/admin/auth/me').then(unwrap),
};

export const meApi = {
  getTaste: () => apiClient.get<ApiResponse<SavedTaste | null>>('/me/taste').then(unwrap),

  saveTaste: (tasteIds: string[]) =>
    apiClient.put<ApiResponse<SavedTaste>>('/me/taste', { tasteIds }).then(unwrap),

  getVisits: () => apiClient.get<ApiResponse<VisitRecord[]>>('/me/visits').then(unwrap),

  getVisit: (visitId: string) =>
    apiClient.get<ApiResponse<VisitRecord>>(`/me/visits/${visitId}`).then(unwrap),

  saveVisit: (record: Omit<VisitRecord, 'visitId'>) =>
    apiClient.post<ApiResponse<VisitRecord>>('/me/visits', record).then(unwrap),
};
