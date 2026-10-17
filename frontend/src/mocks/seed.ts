import type {
  Artwork,
  ArtworkPosition,
  Exhibition,
  FloorMap,
  SavedTaste,
  TasteOption,
  VisitRecord,
} from '@/types/domain';
import { createArtImage } from './artImage';

/**
 * 임시 데이터(시드). 서버 연동 전까지 목 어댑터가 이 데이터를 localStorage 에 복사해 DB 처럼 사용한다.
 *
 * 테스트 계정 (목 서버 전용)
 * - 사용자: test@arti.com / password123
 * - 관리자: admin / admin1234
 */

export interface MockUserRecord {
  userId: string;
  memberCode: string;
  email: string;
  password: string;
  nickname: string;
  joinedAt: string;
  status: 'active' | 'suspended';
  taste: SavedTaste | null;
}

export interface MockAdminRecord {
  adminId: string;
  loginId: string;
  password: string;
  name: string;
}

export const DEFAULT_EXHIBITION_ID = 'mvp-2026';

const img = createArtImage;

export const seedExhibitions: Exhibition[] = [
  {
    exhibitionId: DEFAULT_EXHIBITION_ID,
    title: 'MVP 대상 전시',
    subtitle: '미술 초보자를 위한 맞춤형 관람',
    venue: '국립현대미술관',
    place: '2층 전시실',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    status: 'active',
    artworkCount: 0,
    updatedAt: '2026-10-05T10:00:00.000Z',
  },
  {
    exhibitionId: 'test-2026-09',
    title: '테스트 전시',
    subtitle: '개인화 관람 테스트',
    venue: '서울시립미술관',
    place: '테스트 공간',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    status: 'closed',
    artworkCount: 0,
    updatedAt: '2026-09-30T10:00:00.000Z',
  },
];

export const seedTasteOptions: TasteOption[] = [
  {
    tasteId: 'strong-color',
    label: '강한 색감',
    keywords: ['강렬한 색채', '감정 표현'],
    imageUrl: img('taste-strong', 'mint'),
  },
  {
    tasteId: 'calm-landscape',
    label: '고요한 풍경',
    keywords: ['풍경화', '고요한 분위기'],
    imageUrl: img('taste-calm', 'red'),
  },
  {
    tasteId: 'abstract-form',
    label: '추상적 형태',
    keywords: ['추상 형태', '구성'],
    imageUrl: img('taste-abstract', 'sand'),
  },
  {
    tasteId: 'soft-color',
    label: '부드러운 색감',
    keywords: ['부드러운 색조', '두꺼운 붓질'],
    imageUrl: img('taste-soft', 'pop'),
  },
];

const base = {
  exhibitionId: DEFAULT_EXHIBITION_ID,
  floorId: 'floor-2f',
  source: '국립현대미술관 소장품 설명 자료 (임시)',
  referenceUrl: 'https://example.com/reference',
  updatedAt: '2026-10-06T09:00:00.000Z',
};

export const seedArtworks: Artwork[] = [
  {
    ...base,
    artworkId: 'aw-starry-night',
    title: '별이 빛나는 밤',
    artist: '빈센트 반 고흐',
    year: '1889',
    imageUrl: img('starry-night', 'night'),
    roomName: '2전시실',
    description:
      '고흐는 프랑스의 한 시골 마을에서 밤하늘을 바라보며 이 작품을 그렸습니다. 휘몰아치는 별빛과 소용돌이치는 하늘은 그의 내면 세계를 표현한 걸작입니다. 화면 왼쪽의 사이프러스 나무는 땅과 하늘을 잇는 듯 솟아 있고, 아래의 작은 마을은 고요하게 잠들어 있어 하늘의 격렬한 움직임과 대비를 이룹니다.',
    guidedLooking: [
      '하늘에서 가장 크게 소용돌이치는 부분을 찾아보세요.',
      '별 주변의 붓질 방향을 손가락으로 따라가 보세요.',
      '하늘과 마을, 어느 쪽이 더 조용하게 느껴지나요?',
    ],
    reviewStatus: 'approved',
    tasteTags: ['strong-color', 'calm-landscape'],
  },
  {
    ...base,
    artworkId: 'aw-water-lilies',
    title: '수련',
    artist: '클로드 모네',
    year: '1906',
    imageUrl: img('water-lilies', 'mint'),
    roomName: '2전시실',
    description:
      '모네는 지베르니 정원의 연못을 수백 번 그렸습니다. 하늘과 구름이 물에 비치고, 그 위에 수련이 떠 있어 어디까지가 물이고 어디부터가 하늘인지 경계가 흐려집니다. 빛이 시간에 따라 어떻게 변하는지를 붙잡으려 한 작품입니다.',
    guidedLooking: [
      '물에 비친 하늘을 찾아보세요.',
      '수련 잎의 색이 모두 같은 초록인지 살펴보세요.',
      '한 걸음 물러서서 보면 무엇이 달라지나요?',
    ],
    reviewStatus: 'source_check',
    tasteTags: ['calm-landscape', 'soft-color'],
  },
  {
    ...base,
    artworkId: 'aw-red-room',
    title: '붉은 방',
    artist: '앙리 마티스',
    year: '1908',
    imageUrl: img('red-room', 'red'),
    roomName: '3전시실',
    description:
      '마티스는 방 안의 벽과 식탁보를 같은 붉은색과 덩굴 무늬로 채워 공간의 깊이를 평평하게 만들었습니다. 창밖 풍경의 초록과 대비되며 색 자체가 화면의 주인공이 됩니다.',
    guidedLooking: [
      '벽과 식탁의 경계를 찾을 수 있나요?',
      '창밖 풍경과 방 안의 색을 비교해 보세요.',
      '덩굴 무늬가 어디로 이어지는지 따라가 보세요.',
    ],
    reviewStatus: 'approved',
    tasteTags: ['strong-color', 'abstract-form'],
  },
  {
    ...base,
    artworkId: 'aw-landscape-study',
    title: '풍경 연구',
    artist: '전시 작품',
    year: '1910년대',
    imageUrl: img('landscape-study', 'sand'),
    roomName: '3전시실',
    description:
      '부드러운 흙빛과 크림색으로 언덕과 집을 단순한 형태로 나눈 풍경 연구입니다. 형태를 단순화하면서도 따뜻한 색조로 차분한 분위기를 유지합니다.',
    guidedLooking: ['가장 밝은 부분은 어디인가요?', '집과 언덕을 이루는 기본 도형을 찾아보세요.'],
    reviewStatus: 'pending',
    tasteTags: ['soft-color', 'calm-landscape'],
  },
  {
    ...base,
    artworkId: 'aw-composition-8',
    title: '구성 VIII',
    artist: '바실리 칸딘스키',
    year: '1923',
    imageUrl: img('composition-8', 'pop'),
    roomName: '4전시실',
    description:
      '원, 삼각형, 선이 음악의 리듬처럼 화면 위에 배치되어 있습니다. 칸딘스키는 색과 형태가 소리처럼 감정을 불러일으킬 수 있다고 믿었습니다.',
    guidedLooking: [
      '가장 큰 원은 어디에 있나요?',
      '선들이 모이는 지점을 찾아보세요.',
      '이 그림이 음악이라면 어떤 소리일까요?',
    ],
    reviewStatus: 'approved',
    tasteTags: ['abstract-form', 'strong-color'],
  },
  {
    ...base,
    artworkId: 'aw-sunflowers',
    title: '해바라기',
    artist: '빈센트 반 고흐',
    year: '1888',
    imageUrl: img('sunflowers', 'sun'),
    roomName: '1전시실',
    description:
      '노란색의 여러 단계를 사용해 해바라기가 피고 시드는 시간을 한 화면에 담았습니다. 두껍게 올린 물감 덕분에 꽃잎의 질감이 손에 잡힐 듯 느껴집니다.',
    guidedLooking: [
      '노란색이 몇 가지로 나뉘는지 세어 보세요.',
      '가장 시들어 보이는 꽃을 찾아보세요.',
    ],
    reviewStatus: 'approved',
    tasteTags: ['strong-color', 'soft-color'],
  },
  {
    ...base,
    artworkId: 'aw-impression-sunrise',
    title: '인상, 해돋이',
    artist: '클로드 모네',
    year: '1872',
    imageUrl: img('impression-sunrise', 'dawn'),
    roomName: '1전시실',
    description:
      '안개 낀 항구 위로 떠오르는 주황빛 해를 빠른 붓질로 그렸습니다. 이 작품의 제목에서 ‘인상주의’라는 이름이 시작되었습니다.',
    guidedLooking: ['해의 주황색이 주변 색과 얼마나 다른지 보세요.', '배는 몇 척이 보이나요?'],
    reviewStatus: 'approved',
    tasteTags: ['calm-landscape', 'soft-color'],
  },
  {
    ...base,
    artworkId: 'aw-mondrian',
    title: '빨강, 파랑, 노랑의 구성',
    artist: '피트 몬드리안',
    year: '1930',
    imageUrl: img('mondrian', 'grid'),
    roomName: '4전시실',
    description:
      '검은 수직·수평선과 세 가지 원색만으로 화면의 균형을 만든 작품입니다. 커다란 빨강 면과 작은 파랑·노랑 면의 크기 차이가 긴장감을 만듭니다.',
    guidedLooking: ['가장 큰 색 면은 무엇인가요?', '선이 모두 같은 두께인지 살펴보세요.'],
    reviewStatus: 'pending',
    tasteTags: ['abstract-form'],
  },
  {
    ...base,
    exhibitionId: 'test-2026-09',
    floorId: 'floor-test',
    artworkId: 'aw-test-1',
    title: '테스트 작품 A',
    artist: '테스트 작가',
    year: '2026',
    imageUrl: img('test-a', 'mint'),
    roomName: 'A구역',
    description: '테스트 전시용 작품입니다.',
    guidedLooking: ['색의 대비를 살펴보세요.'],
    reviewStatus: 'approved',
    tasteTags: ['soft-color'],
  },
];

/** 평면도: 0~1 정규화 좌표. A-05 관리자 지도와 U-09 사용자 지도가 같은 데이터를 사용한다. */
export const seedMaps: FloorMap[] = [
  {
    mapId: 'map-mvp-2f',
    exhibitionId: DEFAULT_EXHIBITION_ID,
    floorId: 'floor-2f',
    floorName: '2층',
    aspectRatio: 1.25,
    rooms: [
      {
        roomId: 'room-1',
        name: '1전시실',
        xRatio: 0.04,
        yRatio: 0.05,
        widthRatio: 0.36,
        heightRatio: 0.42,
      },
      {
        roomId: 'room-2',
        name: '2전시실',
        xRatio: 0.44,
        yRatio: 0.05,
        widthRatio: 0.52,
        heightRatio: 0.42,
      },
      {
        roomId: 'room-4',
        name: '4전시실',
        xRatio: 0.04,
        yRatio: 0.53,
        widthRatio: 0.46,
        heightRatio: 0.42,
      },
      {
        roomId: 'room-3',
        name: '3전시실',
        xRatio: 0.54,
        yRatio: 0.53,
        widthRatio: 0.42,
        heightRatio: 0.42,
      },
    ],
  },
  {
    mapId: 'map-test',
    exhibitionId: 'test-2026-09',
    floorId: 'floor-test',
    floorName: '1층',
    aspectRatio: 1.5,
    rooms: [
      {
        roomId: 'room-a',
        name: 'A구역',
        xRatio: 0.05,
        yRatio: 0.08,
        widthRatio: 0.9,
        heightRatio: 0.84,
      },
    ],
  },
];

export const seedPositions: ArtworkPosition[] = [
  {
    artworkId: 'aw-sunflowers',
    mapId: 'map-mvp-2f',
    floorId: 'floor-2f',
    xRatio: 0.14,
    yRatio: 0.22,
  },
  {
    artworkId: 'aw-starry-night',
    mapId: 'map-mvp-2f',
    floorId: 'floor-2f',
    xRatio: 0.55,
    yRatio: 0.2,
  },
  {
    artworkId: 'aw-water-lilies',
    mapId: 'map-mvp-2f',
    floorId: 'floor-2f',
    xRatio: 0.82,
    yRatio: 0.3,
  },
  { artworkId: 'aw-red-room', mapId: 'map-mvp-2f', floorId: 'floor-2f', xRatio: 0.8, yRatio: 0.7 },
  {
    artworkId: 'aw-landscape-study',
    mapId: 'map-mvp-2f',
    floorId: 'floor-2f',
    xRatio: 0.64,
    yRatio: 0.86,
  },
  {
    artworkId: 'aw-composition-8',
    mapId: 'map-mvp-2f',
    floorId: 'floor-2f',
    xRatio: 0.34,
    yRatio: 0.82,
  },
  {
    artworkId: 'aw-mondrian',
    mapId: 'map-mvp-2f',
    floorId: 'floor-2f',
    xRatio: 0.16,
    yRatio: 0.66,
  },
  // aw-impression-sunrise 는 일부러 미등록 상태로 둔다 (A-05 위치 지정 테스트용)
  { artworkId: 'aw-test-1', mapId: 'map-test', floorId: 'floor-test', xRatio: 0.5, yRatio: 0.5 },
];

export const seedUsers: MockUserRecord[] = [
  {
    userId: 'u-1',
    memberCode: 'user001',
    email: 'test@arti.com',
    password: 'password123',
    nickname: 'artlover',
    joinedAt: '2026-09-20T09:00:00.000Z',
    status: 'active',
    taste: {
      tasteIds: ['strong-color', 'calm-landscape', 'soft-color'],
      keywords: ['강렬한 색채', '풍경화', '감정 표현', '두꺼운 붓질'],
    },
  },
  {
    userId: 'u-2',
    memberCode: 'user002',
    email: 'museum@arti.com',
    password: 'password123',
    nickname: 'museumday',
    joinedAt: '2026-09-25T09:00:00.000Z',
    status: 'active',
    taste: null,
  },
];

export const seedAdmins: MockAdminRecord[] = [
  { adminId: 'admin-1', loginId: 'admin', password: 'admin1234', name: '관리자' },
];

export const seedVisits: (VisitRecord & { userId: string })[] = [
  {
    userId: 'u-1',
    visitId: 'v-1',
    sessionId: 'seed-1',
    exhibitionId: DEFAULT_EXHIBITION_ID,
    exhibitionTitle: 'MVP 대상 전시',
    venue: '국립현대미술관',
    visitedAt: '2026-10-07T13:00:00.000Z',
    durationMinutes: 58,
    viewedCount: 5,
    recommendedCount: 5,
    reactionCount: 3,
    longestViewedTitle: '별이 빛나는 밤',
    tasteKeywords: ['강렬한 색채', '감정 표현', '풍경'],
    thumbnailUrl: img('starry-night', 'night'),
    artworks: [
      {
        artworkId: 'aw-starry-night',
        title: '별이 빛나는 밤',
        imageUrl: img('starry-night', 'night'),
        reaction: 'like',
        viewedSeconds: 540,
      },
      {
        artworkId: 'aw-water-lilies',
        title: '수련',
        imageUrl: img('water-lilies', 'mint'),
        reaction: 'like',
        viewedSeconds: 300,
      },
      {
        artworkId: 'aw-red-room',
        title: '붉은 방',
        imageUrl: img('red-room', 'red'),
        reaction: null,
        viewedSeconds: 280,
      },
      {
        artworkId: 'aw-landscape-study',
        title: '풍경 연구',
        imageUrl: img('landscape-study', 'sand'),
        reaction: 'dislike',
        viewedSeconds: 200,
      },
      {
        artworkId: 'aw-sunflowers',
        title: '해바라기',
        imageUrl: img('sunflowers', 'sun'),
        reaction: null,
        viewedSeconds: 260,
      },
    ],
  },
  {
    userId: 'u-1',
    visitId: 'v-2',
    sessionId: 'seed-2',
    exhibitionId: 'test-2026-09',
    exhibitionTitle: '테스트 전시',
    venue: '서울시립미술관',
    visitedAt: '2026-09-28T13:00:00.000Z',
    durationMinutes: 43,
    viewedCount: 4,
    recommendedCount: 4,
    reactionCount: 2,
    longestViewedTitle: '테스트 작품 A',
    tasteKeywords: ['부드러운 색조', '풍경화'],
    thumbnailUrl: img('water-lilies', 'mint'),
    artworks: [],
  },
  {
    userId: 'u-1',
    visitId: 'v-3',
    sessionId: 'seed-3',
    exhibitionId: 'test-2026-09',
    exhibitionTitle: '개인화 관람 테스트',
    venue: '개인화 관람 테스트',
    visitedAt: '2026-09-21T13:00:00.000Z',
    durationMinutes: 31,
    viewedCount: 3,
    recommendedCount: 3,
    reactionCount: 1,
    longestViewedTitle: null,
    tasteKeywords: ['강렬한 색채'],
    thumbnailUrl: img('red-room', 'red'),
    artworks: [],
  },
  {
    userId: 'u-2',
    visitId: 'v-4',
    sessionId: 'seed-4',
    exhibitionId: DEFAULT_EXHIBITION_ID,
    exhibitionTitle: 'MVP 대상 전시',
    venue: '국립현대미술관',
    visitedAt: '2026-10-03T13:00:00.000Z',
    durationMinutes: 35,
    viewedCount: 3,
    recommendedCount: 3,
    reactionCount: 0,
    longestViewedTitle: '수련',
    tasteKeywords: ['풍경화'],
    thumbnailUrl: img('water-lilies', 'mint'),
    artworks: [],
  },
];
