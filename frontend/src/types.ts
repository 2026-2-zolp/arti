/**
 * ARTI 도메인 타입 정의
 * 백엔드 API 응답 형태를 이 타입에 맞춰 두면 화면 코드는 그대로 쓸 수 있다.
 */

/**
 * 취향 태그 8개: 사용자 취향 카드(U-05) = 관리자 태그(A-04) = AI 태그(ai-service/app/tags.py)
 * 그림의 겉모습(소재·형태·빛·색)만 나타낸다. 감정(평온·기쁨 …)은 설명용으로 따로 분석한다.
 */
export type TasteTag =
  | 'landscape'  // 풍경
  | 'people'     // 인물
  | 'abstract'   // 추상
  | 'light'      // 빛
  | 'vivid'      // 강렬한 색감
  | 'cool'       // 차가운 색감
  | 'warm'       // 따뜻한 색감
  | 'soft';      // 부드러운 색감

/** 태그별 강도 0~1 (태그마다 독립, 한 작품이 여러 태그에 해당할 수 있음) */
export type TagScores = Record<TasteTag, number>;

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
  /** 해설을 분석에 썼는지 (예전 분석 결과에는 없음) */
  usedText?: boolean;
  imageError: string | null;
  models: { image: string; text: string };
  analyzedAt: string;
  /** AI가 제안한 취향 태그 점수 (예전 분석 결과에는 없음) */
  tags?: TagScores | null;
  /** 태그를 그림으로 판단했는지, 그림이 없어 해설로 판단했는지 */
  tagSource?: 'image' | 'text' | null;
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
  /** 관리자가 켠 태그 (AI 태그를 확정하면 AI 제안을 반영해 관리자가 고친 결과) */
  tags: TasteTag[];
  /** AI 태그 확정 점수 (tagStatus가 'confirmed'일 때만, 서버가 계산) — 추천에 사용 */
  tagScores: TagScores | null;
  /** AI 태그 검수 상태. 확정 전에는 관리자가 켠 태그(1/0)로만 추천 */
  tagStatus: AiStatus;
  description: string;        // 작품 해설 (출처 확인된 기본 설명)
  guidedLooking: string[];    // 관람가이드 — 관찰 질문 (보통 3개)
  /** 관람가이드 — 질문마다 답을 찾을 곳 힌트 (guidedLooking과 같은 순서, 없으면 '') */
  guidedHints: string[];
  /** 관람가이드 — 그림을 보기 전에 읽는 쉬운 설명 (2~3문장) */
  guideIntro: string;
  /** 관람가이드 검수 상태. 사용자 화면에는 'confirmed'만 표시 (AI 제안 → 관리자 확정, 직접 써도 확정해야 보임) */
  guideStatus: AiStatus;
  source: string;             // 출처
  referenceUrl: string;       // 참고자료 URL
  reviewStatus: ReviewStatus;
  updatedAt: string;
  /** AI 분석 결과: 취향 태그 + 감정 (분석 전이면 null) */
  analysis: ArtworkAnalysis | null;
  /** 감정 분석 검수 상태. 'confirmed'만 작품 분위기 설명·아트 영수증에 사용 (추천에는 쓰지 않음) */
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
  /** 사용자가 고른 카드 중 이 작품에 해당하는 태그 (강한 순) */
  matchedTags: TasteTag[];
  /** 이 작품에서 가장 강한, 사용자가 고른 태그 (없으면 null) */
  matchedCard: TasteTag | null;
  /** 추천 점수 0~1 = 고른 카드의 태그 강도 평균 */
  score: number;
  /** 태그 강도가 AI 분석(관리자 확정)에서 왔는지, 관리자가 켠 태그(1/0)인지 */
  aiTags: boolean;
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
