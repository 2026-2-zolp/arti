import type { MapPoint } from '../types';

export const GALAXY_MAP_EXHIBITION = 'fixture-galaxy-route';

// 검증 도면의 출입문 중심을 복도 중앙선에 연결합니다. 좌표는 도면 기준 퍼센트입니다.
const CORRIDOR_Y = 50;
const doorByRoom: Record<string, MapPoint> = {
  'gallery-a': { x: 22, y: 38 },
  'gallery-b': { x: 50, y: 62 },
  'gallery-c': { x: 78, y: 38 },
};

export function galaxyMapLeg(from: MapPoint, to: MapPoint, fromRoom: string | undefined, toRoom: string): MapPoint[] {
  if (fromRoom && fromRoom === toRoom) return [from, to];
  const exit = fromRoom ? doorByRoom[fromRoom] : undefined;
  const entry = doorByRoom[toRoom];
  const corridorStart = { x: exit?.x ?? from.x, y: CORRIDOR_Y };
  const corridorEnd = { x: entry?.x ?? to.x, y: CORRIDOR_Y };
  return [from, ...(exit ? [exit] : []), corridorStart, corridorEnd, ...(entry ? [entry] : []), to];
}
