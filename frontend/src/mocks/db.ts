import type { Artwork, ArtworkPosition, Exhibition, FloorMap, VisitRecord } from '@/types/domain';
import { safeStorage } from '@/utils/storage';
import {
  seedAdmins,
  seedArtworks,
  seedExhibitions,
  seedMaps,
  seedPositions,
  seedTasteOptions,
  seedUsers,
  seedVisits,
  type MockAdminRecord,
  type MockUserRecord,
} from './seed';

/**
 * 목 DB — localStorage 에 저장해서 새로고침/다른 탭(관리자 ↔ 사용자)에서도 같은 데이터를 본다.
 * (합의 20. "관리자 작품 위치 저장 → 서버 저장 → 사용자 지도 조회" 흐름 테스트용)
 */
const DB_KEY = 'arti.mockdb.v1';

export interface MockDb {
  exhibitions: Exhibition[];
  artworks: Artwork[];
  maps: FloorMap[];
  positions: ArtworkPosition[];
  users: MockUserRecord[];
  admins: MockAdminRecord[];
  visits: (VisitRecord & { userId: string })[];
  tasteOptions: typeof seedTasteOptions;
}

function createSeedDb(): MockDb {
  return structuredClone({
    exhibitions: seedExhibitions,
    artworks: seedArtworks,
    maps: seedMaps,
    positions: seedPositions,
    users: seedUsers,
    admins: seedAdmins,
    visits: seedVisits,
    tasteOptions: seedTasteOptions,
  });
}

let db: MockDb = safeStorage.get<MockDb>(DB_KEY) ?? createSeedDb();

export function getDb() {
  // 다른 탭에서 변경된 내용을 반영
  db = safeStorage.get<MockDb>(DB_KEY) ?? db;
  return db;
}

export function commit() {
  safeStorage.set(DB_KEY, db);
}

export function resetMockDb() {
  db = createSeedDb();
  commit();
}

if (import.meta.env.DEV) {
  // 개발 중 콘솔에서 window.__resetArtiMock() 으로 임시 데이터 초기화
  (window as unknown as Record<string, unknown>).__resetArtiMock = () => {
    resetMockDb();
    window.location.reload();
  };
}
