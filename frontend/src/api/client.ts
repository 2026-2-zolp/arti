/**
 * ARTI API 클라이언트 — 백엔드(backend/) REST API 호출
 *
 * 함수 이름·인자·반환 타입은 목업 시절과 같아서 화면 코드는 그대로 쓴다.
 * 개발 중에는 Vite 프록시가 /api 요청을 http://localhost:4000 으로 넘긴다(vite.config.ts).
 * 다른 주소의 서버를 쓰려면 VITE_API_BASE 환경 변수를 지정한다.
 *
 * 로그인 토큰
 * - 사용자: localStorage 'arti.token'  → Authorization: Bearer <token>
 * - 관리자: localStorage 'arti.adminToken' → X-Admin-Token: <token>
 */
import type { Artwork, Exhibition, Recommendation, TasteTag, User, VisitDuration, VisitRecord } from '../types';
import { load, remove, save } from '../lib/storage';

export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/api';
const USER_TOKEN = 'arti.token';
const ADMIN_TOKEN = 'arti.adminToken';
/** 관리자 화면 로그인 여부 표시용 키 (pages/admin/AdminLayout.tsx의 ADMIN_KEY와 같은 값) */
const ADMIN_INFO = 'arti.admin';
/** 사용자 정보 저장 키 (store/VisitContext.tsx의 USER_KEY와 같은 값) */
const USER_INFO = 'arti.user';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const userToken = load<string | null>(USER_TOKEN, null);
  const adminToken = load<string | null>(ADMIN_TOKEN, null);
  if (userToken) headers.Authorization = `Bearer ${userToken}`;
  if (adminToken) headers['X-Admin-Token'] = adminToken;

  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 네트워크 상태를 확인해 주세요.');
  }

  if (res.status === 401) {
    // 만료되었거나 무효한 토큰은 지워서 다음 화면 이동 때 다시 로그인하도록 한다
    if (path.startsWith('/admin')) {
      remove(ADMIN_TOKEN);
      remove(ADMIN_INFO);
    } else if (userToken) {
      remove(USER_TOKEN);
      remove(USER_INFO);
    }
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? '요청을 처리하지 못했어요.', res.status);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  // ───────────────────────── 전시 ─────────────────────────
  getExhibition: (id: string) => request<Exhibition>('GET', `/exhibitions/${enc(id)}`),

  listExhibitions: () => request<Exhibition[]>('GET', '/exhibitions'),

  saveExhibition: (ex: Exhibition) =>
    ex.id
      ? request<Exhibition>('PUT', `/admin/exhibitions/${enc(ex.id)}`, ex)
      : request<Exhibition>('POST', '/admin/exhibitions', ex),

  // ───────────────────────── 작품 ─────────────────────────
  listArtworks: (exhibitionId?: string) =>
    request<Artwork[]>('GET', exhibitionId ? `/artworks?exhibitionId=${enc(exhibitionId)}` : '/artworks'),

  getArtwork: (id: string) => request<Artwork>('GET', `/artworks/${enc(id)}`),

  saveArtwork: (w: Artwork) =>
    w.id
      ? request<Artwork>('PUT', `/admin/artworks/${enc(w.id)}`, w)
      : request<Artwork>('POST', '/admin/artworks', w),

  // ───────────────────────── 회원 ─────────────────────────
  async login(email: string, password: string): Promise<User> {
    const { user, token } = await request<{ user: User; token: string }>('POST', '/auth/login', { email, password });
    save(USER_TOKEN, token);
    return user;
  },

  async signup(input: { email: string; password: string; nickname: string }): Promise<User> {
    const { user, token } = await request<{ user: User; token: string }>('POST', '/auth/signup', input);
    save(USER_TOKEN, token);
    return user;
  },

  async logout(): Promise<void> {
    await request<void>('POST', '/auth/logout').catch(() => undefined);
    remove(USER_TOKEN);
  },

  updateTastes: (userId: string, tastes: TasteTag[]) =>
    request<void>('PUT', `/users/${enc(userId)}/tastes`, { tastes }),

  /** U-14: 재설정 링크 요청. 서버가 데모 모드일 때만 demoToken이 들어 있다. */
  requestPasswordReset: (email: string) =>
    request<{ demoToken: string | null }>('POST', '/auth/password-reset/request', { email }),

  resetPassword: (token: string, password: string) =>
    request<void>('POST', '/auth/password-reset/confirm', { token, password }),

  // ───────────────────────── 추천 / AI ─────────────────────────
  recommend: (exhibitionId: string, tastes: TasteTag[], duration: VisitDuration) =>
    request<Recommendation[]>('POST', '/recommendations', { exhibitionId, tastes, duration }),

  /** U-10 AI 맞춤 설명 */
  async personalizedExplanation(artworkId: string, tastes: TasteTag[]): Promise<string> {
    const { text } = await request<{ text: string }>('POST', `/artworks/${enc(artworkId)}/explanation`, { tastes });
    return text;
  },

  /** U-11 AI 자유 질문 (서버에서 작품 자료만 근거로 답변) */
  async askAI(artworkId: string, question: string): Promise<string> {
    const { answer } = await request<{ answer: string }>('POST', `/artworks/${enc(artworkId)}/ask`, { question });
    return answer;
  },

  // ───────────────────────── 관람 기록 ─────────────────────────
  /** 로그인 상태면 서버에 저장되고, 비회원이면 저장 없이 영수증만 돌려받는다 */
  saveVisit: (v: Omit<VisitRecord, 'id'>) => request<VisitRecord>('POST', '/visits', v),

  listVisits: (userId: string) => request<VisitRecord[]>('GET', `/users/${enc(userId)}/visits`),

  getVisit: (id: string) => request<VisitRecord>('GET', `/visits/${enc(id)}`),

  // ───────────────────────── 관리자 ─────────────────────────
  async adminLogin(id: string, password: string): Promise<{ name: string }> {
    const { name, token } = await request<{ name: string; token: string }>('POST', '/admin/login', { id, password });
    save(ADMIN_TOKEN, token);
    return { name };
  },

  async adminLogout(): Promise<void> {
    await request<void>('POST', '/admin/logout').catch(() => undefined);
    remove(ADMIN_TOKEN);
  },

  listMembers: (query = '') =>
    request<(User & { visitCount: number; lastVisit: string | null })[]>(
      'GET',
      `/admin/members${query.trim() ? `?q=${enc(query.trim())}` : ''}`,
    ),
};
