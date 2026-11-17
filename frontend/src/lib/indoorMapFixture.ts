import type { Exhibition } from '../types';
import type { IndoorLayout, MapRect } from './indoorRoute';
import { twoRoomNavigationPreset } from './navigationPresets';

type FixtureLayout = IndoorLayout & {
  corridors: readonly MapRect[]; doors: readonly MapRect[]; rooms?: readonly MapRect[];
};

const pillarLayout: FixtureLayout = {
  aspect: 360 / 640,
  walkable: [{ x: 4, y: 4, w: 92, h: 92 }],
  barriers: [{ x: 40, y: 35, w: 20, h: 30 }],
  waypoints: [{ x: 36, y: 31 }, { x: 64, y: 31 }, { x: 36, y: 69 }, { x: 64, y: 69 }],
  corridors: [],
  doors: [],
};

const roomLayout: FixtureLayout = {
  aspect: 640 / 360,
  walkable: [
    ...twoRoomNavigationPreset.walkable, ...twoRoomNavigationPreset.corridors, ...twoRoomNavigationPreset.doors,
  ],
  barriers: twoRoomNavigationPreset.walls,
  waypoints: twoRoomNavigationPreset.waypoints,
  corridors: twoRoomNavigationPreset.corridors,
  doors: twoRoomNavigationPreset.doors,
};

/** 동일한 합성 배치와 명시적으로 연결한 구조만 사용합니다. 도면 교체 시 파일명이 바뀝니다. */
export function indoorMapFixture(exhibition: Pick<Exhibition, 'id' | 'subtitle' | 'floorPlan'>): FixtureLayout | undefined {
  if (exhibition.id !== 'fixture-ex01' || exhibition.subtitle !== 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION') return;
  const plan = exhibition.floorPlan;
  if (plan?.file === 'fixture-map-pillar.png' && plan.width === 360 && plan.height === 640) return pillarLayout;
  if (plan?.file === 'fixture-map-two-rooms.png' && plan.width === 640 && plan.height === 360) return roomLayout;
}

export function exhibitionIndoorLayout(exhibition: Exhibition): FixtureLayout | undefined {
  const layout = exhibition.navigationLayout;
  if (layout && layout.floorPlanRevision === exhibition.floorPlanRevision) {
    return {
      ...layout,
      rooms: layout.walkable,
      walkable: [...layout.walkable, ...layout.doors, ...layout.corridors],
      barriers: [...layout.walls, ...layout.pillars],
    };
  }
  return indoorMapFixture(exhibition);
}
