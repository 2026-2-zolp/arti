/** 도메인 타입 — 서버 API 스키마가 확정되면 이 파일만 맞춰 수정한다. */

export type ExhibitionStatus = 'scheduled' | 'active' | 'closed';

export interface Exhibition {
  exhibitionId: string;
  title: string;
  /** U-01 "현재 전시" 아래에 표시되는 부제 */
  subtitle: string;
  venue: string;
  place: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  status: ExhibitionStatus;
  artworkCount: number;
  updatedAt: string;
}

export type ReviewStatus = 'pending' | 'source_check' | 'approved';

export interface Artwork {
  artworkId: string;
  exhibitionId: string;
  title: string;
  artist: string;
  year: string;
  imageUrl: string;
  floorId: string;
  roomName: string;
  description: string;
  guidedLooking: string[];
  source: string;
  referenceUrl: string;
  reviewStatus: ReviewStatus;
  /** 추천 계산용 취향 태그 (TasteOption.tasteId) */
  tasteTags: string[];
  updatedAt: string;
}

export interface TasteOption {
  tasteId: string;
  label: string;
  /** 저장 취향/영수증 등에 표시할 키워드 */
  keywords: string[];
  imageUrl: string;
}

export type VisitTimeOption = '30m' | '1h' | 'free';

/** 합의 9. U-08 → U-09 추천 데이터 최소 필드 (+ 화면 표시용 artist/roomName) */
export interface RecommendedArtwork {
  artworkId: string;
  title: string;
  imageUrl: string;
  recommendationReason: string;
  order: number;
  floorId: string;
  artist: string;
  roomName: string;
}

export interface RecommendationResult {
  items: RecommendedArtwork[];
  tasteKeywords: string[];
}

export interface Room {
  roomId: string;
  name: string;
  /** 0~1 정규화 좌표/크기 */
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface FloorMap {
  mapId: string;
  exhibitionId: string;
  floorId: string;
  floorName: string;
  /** 평면도 가로/세로 비율 (width / height) */
  aspectRatio: number;
  rooms: Room[];
}

/** 합의 10. 지도 좌표 기준 */
export interface ArtworkPosition {
  artworkId: string;
  mapId: string;
  floorId: string;
  xRatio: number;
  yRatio: number;
}

export interface ExhibitionMapData {
  maps: FloorMap[];
  positions: ArtworkPosition[];
}

export type Reaction = 'like' | 'dislike';

export interface User {
  userId: string;
  email: string;
  nickname: string;
}

export interface SavedTaste {
  tasteIds: string[];
  keywords: string[];
}

export interface VisitRecordArtwork {
  artworkId: string;
  title: string;
  imageUrl: string;
  reaction: Reaction | null;
  viewedSeconds: number;
}

export interface VisitRecord {
  visitId: string;
  sessionId: string;
  exhibitionId: string;
  exhibitionTitle: string;
  venue: string;
  visitedAt: string; // ISO
  durationMinutes: number;
  viewedCount: number;
  recommendedCount: number;
  reactionCount: number;
  longestViewedTitle: string | null;
  tasteKeywords: string[];
  thumbnailUrl: string;
  artworks: VisitRecordArtwork[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ---- 관리자 ----

export interface Admin {
  adminId: string;
  name: string;
}

export interface DashboardSummary {
  activeExhibitionCount: number;
  artworkCount: number;
  approvedArtworkCount: number;
  positionedArtworkCount: number;
  unpositionedArtworkCount: number;
  pendingReviewCount: number;
  recent: {
    id: string;
    category: '작품' | '전시' | '지도';
    name: string;
    status: string;
    updatedAt: string;
    manager: string;
  }[];
}

export type MemberStatus = 'active' | 'suspended';

export interface Member {
  userId: string;
  memberCode: string;
  email: string;
  nickname: string;
  joinedAt: string;
  visitCount: number;
  lastVisitAt: string | null;
  status: MemberStatus;
}

export interface MemberDetail extends Member {
  visits: Pick<
    VisitRecord,
    'visitId' | 'exhibitionTitle' | 'visitedAt' | 'viewedCount' | 'durationMinutes'
  >[];
}

export type ExhibitionInput = Omit<Exhibition, 'exhibitionId' | 'artworkCount' | 'updatedAt'>;
export type ArtworkInput = Omit<Artwork, 'artworkId' | 'updatedAt'>;
