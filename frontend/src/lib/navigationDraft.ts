import type { MapPoint, NavigationLayoutInput } from '../types';
import { canWalkSegment, type IndoorLayout, type MapRect } from './indoorRoute';

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

/** 문을 통해 실제로 맞닿는 구역에서만 출입점과 복도 중앙의 후보를 만듭니다. */
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

  const suggestions: MapPoint[] = [];
  for (const point of candidates) {
    if (layout.waypoints.length + suggestions.length >= navigationShapeLimit) break;
    const existing = [...layout.waypoints, ...suggestions];
    if (existing.some(peer => Math.hypot(point.x - peer.x, point.y - peer.y) < 0.05)) continue;
    suggestions.push(point);
  }
  return suggestions;
}
