/**
 * 합의 18. Query Key 는 기능 단위로 통일한다.
 * 데이터 수정 후에는 아래 키의 상위 키(all)로 invalidateQueries() 를 호출한다.
 */
export const queryKeys = {
  exhibitions: {
    all: ['exhibitions'] as const,
    detail: (exhibitionId: string) => ['exhibitions', 'detail', exhibitionId] as const,
    adminList: () => ['exhibitions', 'admin', 'list'] as const,
  },
  tastes: {
    all: ['tastes'] as const,
    options: (exhibitionId: string) => ['tastes', 'options', exhibitionId] as const,
    mine: () => ['tastes', 'mine'] as const,
  },
  recommendations: {
    all: ['recommendations'] as const,
    list: (exhibitionId: string, tasteIds: string[], timeOption: string) =>
      ['recommendations', exhibitionId, [...tasteIds].sort().join(','), timeOption] as const,
  },
  artworks: {
    all: ['artworks'] as const,
    detail: (exhibitionId: string, artworkId: string) =>
      ['artworks', 'detail', exhibitionId, artworkId] as const,
    adminList: (exhibitionId?: string) =>
      ['artworks', 'admin', 'list', exhibitionId ?? 'all'] as const,
    adminDetail: (artworkId: string) => ['artworks', 'admin', 'detail', artworkId] as const,
  },
  maps: {
    all: ['maps'] as const,
    exhibition: (exhibitionId: string) => ['maps', 'user', exhibitionId] as const,
    adminExhibition: (exhibitionId: string) => ['maps', 'admin', exhibitionId] as const,
  },
  ai: {
    all: ['ai'] as const,
    explanation: (artworkId: string, tasteIds: string[]) =>
      ['ai', 'explanation', artworkId, [...tasteIds].sort().join(',')] as const,
    suggestedQuestions: (artworkId: string) => ['ai', 'suggested', artworkId] as const,
  },
  auth: {
    all: ['auth'] as const,
    me: () => ['auth', 'me'] as const,
    adminMe: () => ['auth', 'admin', 'me'] as const,
  },
  visits: {
    all: ['visits'] as const,
    list: () => ['visits', 'list'] as const,
    detail: (visitId: string) => ['visits', 'detail', visitId] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: () => ['dashboard', 'summary'] as const,
  },
  members: {
    all: ['members'] as const,
    list: (keyword: string) => ['members', 'list', keyword] as const,
    detail: (userId: string) => ['members', 'detail', userId] as const,
  },
};
