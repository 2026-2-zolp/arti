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

/** AI 감정 분석 항목 (ai-service/app/emotions.py 와 같은 키) */
export type EmotionKey = 'calm' | 'joy' | 'sadness' | 'tension' | 'awe' | 'nostalgia';

/** 감정별 상대 점수 0~1 (가장 강한 감정 = 1) */
export type EmotionScores = Record<EmotionKey, number>;

/** AI 결과 검수 상태: 없음 / AI 제안(관리자 확인 전) / 확정 */
export type AiStatus = 'none' | 'suggested' | 'confirmed';

/** A-04 「AI 분석」 결과 (감정 분석 서버) */
export interface ArtworkAnalysis {
  emotions: EmotionScores;
  usedImage: boolean;
  imageError: string | null;
  models: { image: string; text: string };
  analyzedAt: string;
}

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

/** 전시실. rect는 기본 평면도(사각형)에 그릴 영역 — 평면도 이미지를 쓰면 이름만 있어도 된다 */
export interface Room {
  id: string;
  name: string;            // 예: "2전시실"
  rect?: { x: number; y: number; w: number; h: number }; // 퍼센트 단위
}

/** 관리자가 올린 미술관 평면도(안내도) 이미지. 좌표는 이미지 기준 퍼센트로 저장한다 */
export interface FloorPlan {
  file: string;            // /api/uploads/<file>
  width: number;           // 원본 픽셀 크기 (화면 비율 계산용)
  height: number;
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
  floorPlan: FloorPlan | null; // 없으면 rooms 사각형으로 기본 평면도를 그린다
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
  imageUrl?: string;          // 외부 이미지 주소 (선택)
  /** 관리자가 업로드한 이미지 파일 이름 (/api/uploads/<파일>로 제공). 있으면 imageUrl보다 우선 */
  imageFile: string | null;
  /** 사용자 화면에 이미지를 보여 줄지 (false면 AI 분석에만 사용) */
  showImage: boolean;
  tags: TasteTag[];
  description: string;        // 작품 해설 (출처 확인된 기본 설명)
  guidedLooking: string[];    // 관찰 질문/포인트
  source: string;             // 출처
  referenceUrl: string;       // 참고자료 URL
  reviewStatus: ReviewStatus;
  updatedAt: string;
  /** AI 감정 분석 결과 (분석 전이면 null) */
  analysis: ArtworkAnalysis | null;
  /** 추천에는 'confirmed'(관리자가 확인한) 감정 분석만 사용 */
  emotionStatus: AiStatus;
  /** AI가 만든 초보자용 해설 요약 (공식 해설 description과 별도 보관) */
  summary: string;
  summaryKeywords: string[];
  /** 사용자 화면에는 'confirmed' 요약만 표시 */
  summaryStatus: AiStatus;
}

/** U-08에서 쓰는 추천 결과 한 건 */
export interface Recommendation {
  artworkId: string;
  order: number;              // 1부터 시작하는 관람 순서
  reason: string;             // 작품별 간단한 추천 이유
  matchedTags: TasteTag[];
  /** 감정 분석 기반으로 추천됐을 때, 취향과 가장 많이 겹친 감정 (태그 기반이면 빈 배열) */
  matchedEmotions: EmotionKey[];
  /** 취향과 작품 감정의 유사도 0~1 (감정 분석이 확정되지 않은 작품은 null) */
  similarity: number | null;
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
  /** 아트 영수증의 AI 취향 해석 (없으면 null) */
  interpretation?: string | null;
  /** 이번 관람의 감정 프로필 (감정 분석이 확정된 작품 기준) */
  emotionProfile?: EmotionScores | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
}
