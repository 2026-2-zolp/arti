import type { MapPoint } from '../types';

export type MapRect = { x: number; y: number; w: number; h: number };
export type IndoorLayout = {
  walkable: readonly MapRect[];
  barriers: readonly MapRect[];
  waypoints: readonly MapPoint[];
  aspect: number;
};

// 구간이 사각형 안에 있는 매개변수 범위 [0, 1]을 계산합니다.
function insideInterval(from: MapPoint, to: MapPoint, rect: MapRect): [number, number] | null {
  let start = 0;
  let end = 1;
  for (const [origin, delta, low, high] of [
    [from.x, to.x - from.x, rect.x, rect.x + rect.w],
    [from.y, to.y - from.y, rect.y, rect.y + rect.h],
  ]) {
    if (delta === 0) {
      if (origin < low || origin > high) return null;
      continue;
    }
    const first = (low - origin) / delta;
    const last = (high - origin) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
    if (start > end) return null;
  }
  return [start, end];
}

export function canWalkSegment(layout: IndoorLayout, from: MapPoint, to: MapPoint): boolean {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return false;
  // 모서리 접촉도 차단합니다. 입력 도면에서 보행 여유를 둔 연결점을 사용합니다.
  if (layout.barriers.some(rect => insideInterval(from, to, rect))) return false;
  const intervals = layout.walkable.flatMap(rect => {
    const interval = insideInterval(from, to, rect);
    return interval ? [interval] : [];
  }).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, end] of intervals) {
    if (start > covered) return false;
    covered = Math.max(covered, end);
    if (covered >= 1) return true;
  }
  return false;
}

/** 등록된 공간과 연결점으로 갈 수 있는 경우에만 목표까지의 최단 구간을 반환합니다. */
export function indoorLeg(layout: IndoorLayout, from: MapPoint, to: MapPoint): MapPoint[] | null {
  if (canWalkSegment(layout, from, to)) return [from, to];
  const points = [from, ...layout.waypoints, to];
  const goal = points.length - 1;
  const distances = points.map(() => Infinity);
  const predecessor = points.map(() => -1);
  const unsettled = new Set(points.map((_, index) => index));
  distances[0] = 0;

  while (unsettled.size) {
    const current = [...unsettled].reduce((best, index) => distances[index] < distances[best] ? index : best);
    if (!Number.isFinite(distances[current])) return null;
    if (current === goal) {
      const path: MapPoint[] = [];
      for (let index = goal; index !== -1; index = predecessor[index]) path.push(points[index]);
      return path.reverse();
    }
    unsettled.delete(current);
    for (const next of unsettled) {
      const a = points[current];
      const b = points[next];
      const distance = distances[current] + Math.hypot(a.x - b.x, (a.y - b.y) / layout.aspect);
      if (distance >= distances[next] || !canWalkSegment(layout, a, b)) continue;
      distances[next] = distance;
      predecessor[next] = current;
    }
  }
  return null;
}

export function indoorSequence(layout: IndoorLayout, stops: readonly (MapPoint | null)[]): (MapPoint | null)[] {
  const path: (MapPoint | null)[] = [];
  let previous: MapPoint | null = null;
  for (const stop of stops) {
    if (previous && stop) {
      const leg = indoorLeg(layout, previous, stop);
      path.push(...(leg ? leg.slice(1) : [null, stop]));
    } else {
      path.push(stop);
    }
    previous = stop;
  }
  return path;
}
