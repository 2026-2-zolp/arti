/**
 * 라우트 경로 정의 — 화면에서 문자열 경로를 직접 쓰지 말고 이 헬퍼를 사용한다.
 * 전시 관련 화면은 모두 /exhibition/:exhibitionId 하위에 두어 전시관이 늘어나도 그대로 확장된다.
 */
const ex = (exhibitionId: string) => `/exhibition/${encodeURIComponent(exhibitionId)}`;

export const paths = {
  root: '/',

  // ---- 사용자 (모바일 웹) ----
  exhibition: ex, // U-01
  start: (id: string) => `${ex(id)}/start`, // U-02
  taste: (id: string) => `${ex(id)}/taste`, // U-05
  savedTaste: (id: string) => `${ex(id)}/taste/saved`, // U-06 (로그인 필요)
  visitTime: (id: string) => `${ex(id)}/time`, // U-07
  recommendations: (id: string) => `${ex(id)}/recommendations`, // U-08
  route: (id: string) => `${ex(id)}/route`, // U-09
  artwork: (id: string, artworkId: string) => `${ex(id)}/artworks/${artworkId}`, // U-10
  askAi: (id: string, artworkId: string) => `${ex(id)}/artworks/${artworkId}/ask`, // U-11
  receipt: (id: string) => `${ex(id)}/receipt`, // U-12 (현재 관람)

  login: '/login', // U-03
  signup: '/signup', // U-04
  history: '/history', // U-13 (로그인 필요)
  historyDetail: (visitId: string) => `/history/${visitId}`, // U-12 조회 모드 (로그인 필요)
  forgotPassword: '/password/forgot', // U-14
  resetPassword: '/password/reset', // U-15 (?token=)

  // ---- 관리자 (데스크톱 웹) ----
  adminLogin: '/admin/login', // A-01
  adminDashboard: '/admin', // A-02
  adminExhibitions: '/admin/exhibitions', // A-03
  adminArtworks: '/admin/artworks', // A-04 목록
  adminArtworkNew: '/admin/artworks/new', // A-04 등록
  adminArtworkEdit: (artworkId: string) => `/admin/artworks/${artworkId}/edit`, // A-04 수정
  adminMap: '/admin/map', // A-05 (?exhibitionId=&artworkId=)
  adminMembers: '/admin/members', // A-06
};

export function withQuery(path: string, query: Record<string, string | undefined | null>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
