/**
 * ARTI 도메인 타입 정의
 * 백엔드 API 응답 형태를 이 타입에 맞춰 두면 화면 코드는 그대로 쓸 수 있다.
 */

/** 취향 태그: U-05 취향 파악 카드 하나가 하나의 태그에 대응한다. */
export type TasteTag =
  | 'vivid'      // 강한 색감
  | 'calm'       // 고요한 풍경
  | 'abstract'   // 추상적 형태
  | 'soft'       // 부드러운 색감
  | 'emotion'    // 감정 표현
  | 'light';     // 빛

/** U-07 관람 시간 옵션 */
export type VisitDuration = '30m' | '60m' | 'relaxed';

/** A-04 검수 상태 */
export type ReviewStatus = 'pending' | 'source_check' | 'approved';

/** A-03 전시 운영 상태 */
export type ExhibitionStatus = 'draft' | 'running' | 'closed';

/** 2D 평면도 위 좌표 (0~100 퍼센트 기준, 평면도 크기와 무관하게 쓰기 위함) */
export interface MapPoint {
  x: number;
  y: number;
}

/** 전시실(평면도 위 사각 영역) */
export interface Room {
  id: string;
  name: string;            // 예: "2전시실"
  rect: { x: number; y: number; w: number; h: number }; // 퍼센트 단위
}

export interface Exhibition {
  id: string;
  title: string;
  subtitle: string;
  venue: string;
  startDate: string;       // YYYY-MM-DD
  endDate: string;
  status: ExhibitionStatus;
  rooms: Room[];
  entrance: MapPoint;      // 입구 위치 (경로 시작점)
}

export interface Artwork {
  id: string;
  exhibitionId: string;
  title: string;
  artist: string;
  year: string;
  roomId: string;
  position: MapPoint | null;  // 위치 미등록이면 null
  palette: string[];          // 목업용 이미지 생성 색상 (실제 구현에선 imageUrl 사용)
  imageUrl?: string;
  tags: TasteTag[];
  description: string;        // 작품 해설 (출처 확인된 기본 설명)
  guidedLooking: string[];    // 관찰 질문/포인트
  source: string;             // 출처
  referenceUrl: string;       // 참고자료 URL
  reviewStatus: ReviewStatus;
  updatedAt: string;
}

/** U-08에서 쓰는 추천 결과 한 건 */
export interface Recommendation {
  artworkId: string;
  order: number;              // 1부터 시작하는 관람 순서
  reason: string;             // 작품별 간단한 추천 이유
  matchedTags: TasteTag[];
}

export type Reaction = 'like' | 'dislike';

export interface User {
  id: string;
  email: string;
  nickname: string;
  tastes: TasteTag[];
  createdAt: string;
  status: 'active' | 'dormant';
}

/** 관람 1회 기록 (아트 영수증 데이터) */
export interface VisitRecord {
  id: string;
  userId: string | null;
  exhibitionId: string;
  exhibitionTitle: string;
  venue: string;
  date: string;               // ISO
  durationMin: number;
  viewedArtworkIds: string[];
  recommendedCount: number;
  reactions: Record<string, Reaction>;
  longestViewedArtworkId: string | null;
  keywords: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
}
