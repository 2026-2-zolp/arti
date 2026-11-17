import type { MapPoint, NavigationLayoutInput } from '../types';
import { canWalkSegment, sharedPassage, type IndoorLayout, type MapRect } from './indoorRoute';

export const navigationShapeLimit = 32;

export function fitNavigationDraft(layout: NavigationLayoutInput, first: MapPoint, last: MapPoint): NavigationLayoutInput | null {
  const rectangles = [...layout.walkable, ...layout.walls, ...layout.pillars, ...layout.doors, ...layout.corridors];
  const points = rectangles.flatMap(rect => [rect, { x: rect.x + rect.w, y: rect.y + rect.h }]).concat(layout.waypoints);
  if (!points.length || first.x === last.x || first.y === last.y) return null;

  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const width = Math.max(...points.map(point => point.x)) - left;
  const height = Math.max(...points.map(point => point.y)) - top;
  if (!width || !height) return null;

  const xScale = Math.abs(last.x - first.x) / width;
  const yScale = Math.abs(last.y - first.y) / height;
  const targetLeft = Math.min(first.x, last.x);
  const targetTop = Math.min(first.y, last.y);
  const round = (coordinate: number) => Math.round(coordinate * 1e8) / 1e8;
  const move = (point: MapPoint) => ({
    x: round(targetLeft + (point.x - left) * xScale),
    y: round(targetTop + (point.y - top) * yScale),
  });
  const resize = (rect: MapRect) => {
    const start = move(rect);
    const end = move({ x: rect.x + rect.w, y: rect.y + rect.h });
    return { ...start, w: end.x - start.x, h: end.y - start.y };
  };
  if (rectangles.map(resize).some(rect => rect.w <= 0 || rect.h <= 0)) return null;
  return {
    walkable: layout.walkable.map(resize),
    walls: layout.walls.map(resize),
    pillars: layout.pillars.map(resize),
    doors: layout.doors.map(resize),
    corridors: layout.corridors.map(resize),
    waypoints: layout.waypoints.map(move),
  };
}

function overlapCenter(first: MapRect, second: MapRect): MapPoint | null {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.w, second.x + second.w);
  const bottom = Math.min(first.y + first.h, second.y + second.h);
  return left < right && top < bottom ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null;
}

/** 문 양쪽, 복도의 접점과 기둥을 돌아가는 데 쓸 수 있는 점을 편집기에 제안합니다. */
export function suggestNavigationWaypoints(layout: NavigationLayoutInput, indoor: IndoorLayout): MapPoint[] {
  const candidates: MapPoint[] = [];
  for (const door of layout.doors) {
    for (const room of layout.walkable) {
      const roomSide = overlapCenter(door, room);
      if (!roomSide) continue;
      for (const corridor of layout.corridors) {
        const corridorSide = overlapCenter(door, corridor);
        if (!corridorSide || !canWalkSegment(indoor, roomSide, corridorSide)) continue;
        candidates.push(roomSide, corridorSide);
        const middle = corridor.w >= corridor.h
          ? { x: corridorSide.x, y: corridor.y + corridor.h / 2 }
          : { x: corridor.x + corridor.w / 2, y: corridorSide.y };
        if (canWalkSegment(indoor, corridorSide, middle)) candidates.push(middle);
      }
    }
  }
  for (const [index, corridor] of layout.corridors.entries()) {
    for (const other of layout.corridors.slice(index + 1)) {
      const joint = sharedPassage(corridor, other);
      if (joint) candidates.push(joint);
    }
  }
  for (const pillar of layout.pillars) {
    // 벽·기둥 경계에 닿는 선을 피하도록 모서리 바깥에 좌표를 둡니다.
    const offset = 0.1;
    for (const x of [pillar.x - offset, pillar.x + pillar.w + offset]) {
      for (const y of [pillar.y - offset, pillar.y + pillar.h + offset]) candidates.push({ x, y });
    }
  }

  const suggestions: MapPoint[] = [];
  for (const point of candidates) {
    if (layout.waypoints.length + suggestions.length >= navigationShapeLimit) break;
    if (!canWalkSegment(indoor, point, point)) continue;
    const existing = [...layout.waypoints, ...suggestions];
    if (existing.some(peer => Math.hypot(point.x - peer.x, point.y - peer.y) < 0.05)) continue;
    suggestions.push(point);
  }
  return suggestions;
}

type RouteCheck = { departure?: MapPoint; destination?: MapPoint; outside: boolean };

const checkKinds = ['doors', 'corridors', 'waypoints'] as const;

/** A·B 쪽에서 가까운 문·통로·연결점 한 곳씩을 편집기에서 확인합니다. */
export function nearbyNavigationChecks(layout: NavigationLayoutInput, anchor: MapPoint, other: MapPoint, aspect: number) {
  const distance = (point: MapPoint, target: MapPoint) => Math.hypot(point.x - target.x, (point.y - target.y) / aspect);
  const closestPoint = (shape: MapPoint | MapRect): MapPoint => 'w' in shape ? {
    x: Math.max(shape.x, Math.min(shape.x + shape.w, anchor.x)),
    y: Math.max(shape.y, Math.min(shape.y + shape.h, anchor.y)),
  } : shape;
  return checkKinds.flatMap(kind => {
    let best: { kind: typeof kind; index: number; point: MapPoint } | undefined;
    let nearest = 12;
    for (const [index, shape] of layout[kind].entries()) {
      const point = closestPoint(shape);
      const gap = distance(point, anchor);
      if (gap >= nearest || gap > distance(point, other)) continue;
      best = { kind, index, point };
      nearest = gap;
    }
    return best ? [best] : [];
  });
}

/** 경로가 없는 경우 출발 쪽과 도착 쪽에서 각각 닿을 수 있는 가장 가까운 두 점을 찾습니다. */
export function navigationCheckLocations(layout: IndoorLayout, from: MapPoint, to: MapPoint): RouteCheck {
  const fromValid = canWalkSegment(layout, from, from);
  const toValid = canWalkSegment(layout, to, to);
  if (!fromValid || !toValid) {
    return { departure: fromValid ? undefined : from, destination: toValid ? undefined : to, outside: true };
  }

  const reachable = (start: MapPoint) => {
    const reached = [start];
    const unreached = new Set(layout.waypoints);
    for (let index = 0; index < reached.length; index++) {
      for (const candidate of unreached) {
        if (!canWalkSegment(layout, reached[index], candidate)) continue;
        reached.push(candidate);
        unreached.delete(candidate);
      }
    }
    return reached;
  };
  const departureSide = reachable(from);
  const destinationSide = reachable(to);
  let result: RouteCheck = { departure: from, destination: to, outside: false };
  let bestDistance = Infinity;
  for (const departure of departureSide) {
    for (const destination of destinationSide) {
      const distance = Math.hypot(departure.x - destination.x, (departure.y - destination.y) / layout.aspect);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      result = { departure, destination, outside: false };
    }
  }
  return result;
}
