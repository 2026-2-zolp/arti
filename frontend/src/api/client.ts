/**
 * ARTI API 클라이언트 — 기본 Django, 명시 선택 시 legacy Express.
 *
 * 함수 이름·인자·반환 타입은 목업 시절과 같아서 화면 코드는 그대로 쓴다.
 * 개발 기본 프록시는 Django4018이며 자동 fallback은 없다(vite.config.ts).
 * 다른 주소의 서버를 쓰려면 VITE_API_BASE 환경 변수를 지정한다.
 *
 * 로그인 토큰
 * - 사용자: localStorage 'arti.token'  → Authorization: Bearer <token>
 * - 관리자: localStorage 'arti.adminToken' → X-Admin-Token: <token>
 */
import type {
  Artwork, TasteProfile, EntryContext, DocentAnswer,
  EmotionScores,
  Exhibition,
  Reaction,
  Recommendation,
  TasteTag,
  User,
  VisitDuration,
  VisitRecord,
} from '../types';
import { load, remove, save } from '../lib/storage';
import { apiTarget } from '../lib/apiTarget';
import type { TasteMutation, TastePreview } from '../lib/tasteFlow';

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = '', public retryAfterSeconds?:number) {
    super(message);
  }
}

const BASE = (import.meta.env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/api';
// W04: explicit target selection, never retry/fall back to another API automatically.
const ADMIN_READ = apiTarget(import.meta.env?.VITE_API_TARGET) === 'django' ? '/admin' : '';
const USER_TOKEN = 'arti.token';
const ADMIN_TOKEN = 'arti.adminToken';
/** 관리자 화면 로그인 여부 표시용 키 (pages/admin/AdminLayout.tsx의 ADMIN_KEY와 같은 값) */
const ADMIN_INFO = 'arti.admin';
/** 사용자 정보 저장 키 (store/VisitContext.tsx의 USER_KEY와 같은 값) */
const USER_INFO = 'arti.user';

type KakaoResult =
  | { status: 'logged_in'; user: User; returnTo: string }
  | { status: 'linked' | 'unlinked' | 'conflict' | 'cancelled' | 'failed'; returnTo: string };
type KakaoFinish = Exclude<KakaoResult, { status: 'logged_in' }>
  | { status: 'logged_in'; user: User; token: string; returnTo: string };

/** 업로드한 이미지 파일(작품 이미지·평면도)의 주소 */
export const uploadedImageUrl = (file: string, forAdmin = false) =>
  `${BASE}${forAdmin ? ADMIN_READ : ''}/uploads/${encodeURIComponent(file)}`;

export const isProtectedImageUrl = (url: string) =>
  ADMIN_READ === '/admin' && url.startsWith(`${BASE}/admin/uploads/`);

/** Admin tokens stay in request headers, never in image URLs or external-image requests. */
export async function fetchProtectedImage(url: string, signal: AbortSignal): Promise<Blob> {
  if (!isProtectedImageUrl(url)) throw new ApiError('허용되지 않은 이미지 경로예요.');
  const token = load<string | null>(ADMIN_TOKEN, null);
  if (!token) throw new ApiError('관리자 로그인이 필요해요.', 401);
  const res = await fetch(url, { headers: { 'X-Admin-Token': token }, signal });
  if (!res.ok) throw new ApiError('이미지를 불러올 수 없어요.', res.status);
  return res.blob();
}

/** body가 Blob(파일)이면 그대로, 아니면 JSON으로 보낸다 */
const versions = new Map<string, number>();
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const isFile = body instanceof Blob;
  const entityPath = path.split('?')[0].replace(/\/(image|floor-plan)$/, '');
  if ((isFile || method === 'DELETE') && versions.has(entityPath)) headers['If-Match'] = `"${versions.get(entityPath)}"`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path.endsWith('/analyze') ? 90000 : 35000);
  if (body !== undefined) headers['Content-Type'] = isFile ? body.type : 'application/json';
  const userToken = load<string | null>(USER_TOKEN, null);
  const adminToken = load<string | null>(ADMIN_TOKEN, null);
  if (userToken) headers.Authorization = `Bearer ${userToken}`;
  if (adminToken) headers['X-Admin-Token'] = adminToken;

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      signal: controller.signal,
      headers,
      body: body === undefined ? undefined : isFile ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('연결이 끊기거나 응답 시간이 초과됐어요. 다시 시도해 주세요.');
  } finally { clearTimeout(timer); }

  if (res.status === 401 && !['/auth/login', '/auth/signup', '/admin/login'].includes(path)) {
    // 만료되었거나 무효한 토큰은 지워서 다음 화면 이동 때 다시 로그인하도록 한다
    if (path.startsWith('/admin') && load(ADMIN_TOKEN, null) === adminToken) {
      remove(ADMIN_TOKEN);
      remove(ADMIN_INFO);
    } else if (!path.startsWith('/admin') && userToken && load(USER_TOKEN, null) === userToken) {
      remove(USER_TOKEN);
      remove(USER_INFO);
      window.dispatchEvent(new Event('arti:expired'));
    }
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const wait=Number(res.headers.get('Retry-After'));
    throw new ApiError(data?.error ?? '요청을 처리하지 못했어요.', res.status, data?.code,
      Number.isInteger(wait) && wait>0 && wait<=300 ? wait : undefined);
  }
  const remember = (item: { id?: string; version?: number; exhibitionId?: string }) => {
    if (item?.id && item.version) versions.set(`/admin/${item.exhibitionId ? 'artworks' : 'exhibitions'}/${enc(item.id)}`, item.version);
  };
  if (Array.isArray(data)) data.forEach(remember); else if (data) { remember(data); if (data.artwork) remember(data.artwork); }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  // Admin preview must not consume filtered public catalog data on the Django target.
  listAdminExhibitions: () => request<Exhibition[]>('GET', `${ADMIN_READ}/exhibitions`),
  listAdminArtworks: (exhibitionId?: string) =>
    request<Artwork[]>('GET', `${ADMIN_READ}/artworks${exhibitionId ? `?exhibitionId=${enc(exhibitionId)}` : ''}`),
  getAdminArtwork: (id: string) => request<Artwork>('GET', `${ADMIN_READ}/artworks/${enc(id)}`),
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

  kakaoStatus: () => request<{ enabled: boolean; linked: boolean }>('GET', '/auth/kakao/status'),

  startKakao: (input: { mode: 'link'; password: string } | { mode: 'login'; returnTo: string }) =>
    request<{ authorizationUrl: string }>('POST', '/auth/kakao/start', input),

  async finishKakao(state: string): Promise<KakaoResult> {
    const result = await request<KakaoFinish>('POST', '/auth/kakao/finish', { state });
    if (result.status !== 'logged_in') return result;
    if (load(USER_TOKEN, null)) throw new ApiError('로그인한 계정이 바뀌었어요. 다시 시도해 주세요.');
    save(USER_TOKEN, result.token);
    return { status: result.status, user: result.user, returnTo: result.returnTo };
  },

  async signup(input: { email: string; password: string; nickname: string; termsAccepted: boolean; termsVersion: string }): Promise<User> {
    const { user, token } = await request<{ user: User; token: string }>('POST', '/auth/signup', input);
    save(USER_TOKEN, token);
    return user;
  },

  async logout(): Promise<boolean> {
    const token = load(USER_TOKEN, null);
    try {
      await request<void>('POST', '/auth/logout');
    } catch (error) {
      const current = load(USER_TOKEN, null);
      if (current !== null && current !== token) return false;
      // 만료된 세션은 서버에서 이미 사용할 수 없습니다.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    const current = load(USER_TOKEN, null);
    if (current !== null && current !== token) return false;
    remove(USER_TOKEN);
    return true;
  },

  me: () => request<User>('GET', '/auth/me'),
  tastePool: () => request<{
    poolId: string | null; revision: number | null; ready: boolean; poolVersion: string;
    pairs: {leftId: string; rightId: string}[]; artworks: Artwork[];
    supportedTasteProfileVersions?: number[]; tasteTieV2Enabled?: boolean;
    tieContext?: { policyVersion: string; tieContextVersion: string | null };
  }>('GET', '/taste-pool'),
  resolveTaste: (tasteProfile: TasteProfile, visitId: string, exhibitionId: string) =>
    request<TastePreview>('POST', '/taste-profiles/resolve', { tasteProfile, visitId, exhibitionId }),
  updateTastes: (userId: string, tastes: TasteTag[], tasteProfile?: TasteProfile, exhibitionId?: string, mutation?: TasteMutation) =>
    request<void>('PUT', `/users/${enc(userId)}/tastes`, { tastes, tasteProfile, exhibitionId, ...mutation }),

  /** 현재 Django에서는 FEATURE_DISABLED. 실제 메일 발송 성공으로 표시하지 않는다. */
  requestPasswordReset: (email: string) =>
    request<{ demoToken: string | null }>('POST', '/auth/password-reset/request', { email }),

  resetPassword: (token: string, password: string) =>
    request<void>('POST', '/auth/password-reset/confirm', { token, password }),

  // ───────────────────────── 추천 / AI ─────────────────────────
  /** 승인·위치 준비를 마친 현재 추천 후보의 태그별 수. 전시 전체 소재 부재를 뜻하지 않는다. */
  tagCoverage: (exhibitionId: string) =>
    request<Record<TasteTag, number>>('GET', `/exhibitions/${enc(exhibitionId)}/tag-coverage`),

  recommend: (exhibitionId: string, tastes: TasteTag[], duration: VisitDuration, tasteProfile?: TasteProfile) =>
    request<Recommendation[]>('POST', '/recommendations', { exhibitionId, tastes, duration, tasteProfile }),

  /** U-10 AI 맞춤 설명 */
  async personalizedExplanation(artworkId: string, tastes: TasteTag[]): Promise<string> {
    const { text } = await request<{ text: string }>('POST', `/artworks/${enc(artworkId)}/explanation`, { tastes });
    return text;
  },

  /** U-11 AI 자유 질문 (서버에서 작품 자료만 근거로 답변) */
  askAI: (artworkId: string, question: string, visitId: string, entryContext?: EntryContext, history: {role: 'user' | 'assistant'; text: string}[] = []) =>
    request<DocentAnswer>('POST', `/artworks/${enc(artworkId)}/ask`, { question, visitId, entryContext, history }),

  /** U-12 아트 영수증의 AI 취향 해석 (오늘 본 작품의 감정 분석 + 반응 + 감상 시간) */
  interpretVisit: (input: { exhibitionId: string; visitId: string; viewedArtworkIds: string[]; reactions: Record<string, Reaction>; dwell: Record<string, number> }) =>
    request<{ text: string; source: 'claude' | 'fallback'; emotionProfile: EmotionScores | null }>(
      'POST',
      '/visits/interpret',
      input,
    ),

  // ───────────────────────── 관람 기록 ─────────────────────────
  /** 로그인 상태면 서버에 저장되고, 비회원이면 저장 없이 영수증만 돌려받는다 */
  saveVisit: (v: Omit<VisitRecord, 'id'>) => request<VisitRecord>('POST', '/visits', v),
  async saveMemberVisit(v: Omit<VisitRecord, 'id'>, expectedActor: string, isCurrent = () => true) {
    const token = load<string | null>(USER_TOKEN, null);
    const user = await request<User>('GET', '/auth/me');
    if (!token || load(USER_TOKEN, null) !== token || user.id !== expectedActor || !isCurrent()) throw new ApiError('원래 계정과 관람에서 다시 시도해 주세요.', 401);
    return request<VisitRecord>('POST', '/visits', v);
  },

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

  /** 저장된 원문으로 분석하고 새로 만든 산출물만 AI 제안으로 반영합니다. */
  analyzeArtwork: (id: string, useImage = true) =>
    request<{
      artwork: Artwork;
      tag?: {ok:boolean; made?:boolean};
      emotion: ({ ok: true } | { ok: false; error: string }) & {made?:boolean};
      /** claude = Claude API, kanana = 로컬 모델(ai-service), fallback = 원문 앞 2문장, kept = 이미 확정이라 그대로 둠 */
      summary: ({ ok: true; source: 'provider' | 'claude' | 'kanana' | 'fallback' | 'kept' } | { ok: false; error: string }) & {made?:boolean};
      /** 관람가이드를 새로 제안했는지 (만들 수 없거나 이미 확정이면 false) */
      guide?: { made: boolean };
    }>('POST', `/admin/artworks/${enc(id)}/analyze`, { useImage, version: versions.get(`/admin/artworks/${enc(id)}`) }),

  /** A-04 작품 이미지 파일 업로드 (캡처 이미지 등, PNG·JPG·WEBP 최대 10MB) */
  uploadArtworkImage: (id: string, file: File) => request<Artwork>('POST', `/admin/artworks/${enc(id)}/image`, file),

  deleteArtworkImage: (id: string) => request<Artwork>('DELETE', `/admin/artworks/${enc(id)}/image`),

  /** A-05 미술관 평면도 이미지 업로드 (width·height = 원본 픽셀 크기) */
  uploadFloorPlan: (exhibitionId: string, file: File, width: number, height: number) =>
    request<Exhibition>('POST', `/admin/exhibitions/${enc(exhibitionId)}/floor-plan?width=${width}&height=${height}`, file),

  deleteFloorPlan: (exhibitionId: string) => request<Exhibition>('DELETE', `/admin/exhibitions/${enc(exhibitionId)}/floor-plan`),

  /** 전시 작품 전체 AI 분석 (확정된 작품은 건너뜀) */
  analyzeExhibition: (exhibitionId: string, useImage = true) =>
    request<{ total: number; analyzed: number; errors: string[] }>(
      'POST',
      `/admin/exhibitions/${enc(exhibitionId)}/analyze`,
      { useImage },
    ),

  /** 전시의 「AI 제안」을 모두 확정 */
  confirmExhibitionAi: (exhibitionId: string, items: {id: string; version: number; fields: string[]}[]) =>
    request<{ confirmed: number }>('POST', `/admin/exhibitions/${enc(exhibitionId)}/confirm-ai`, { items }),

  listReactions: () => request<{total: number; items: {artworkId: string; reaction: Reaction; reason: string; date: string; visitId: string}[]}>('GET', '/admin/reactions'),
  listMembers: (query = '') =>
    request<(User & { visitCount: number; lastVisit: string | null })[]>(
      'GET',
      `/admin/members${query.trim() ? `?q=${enc(query.trim())}` : ''}`,
    ),
};
