/**
 * 전시실 2D 평면도 (U-09 사용자 경로 / A-05 관리자 위치 지정에서 공통 사용)
 * 좌표는 모두 0~100 퍼센트로 저장하고, 그릴 때 SVG 좌표로 변환한다.
 * → 평면도 표시 크기가 화면마다 달라도 같은 데이터를 쓸 수 있다.
 *
 * 전시에 평면도 이미지(floorPlan)가 있으면 그 이미지를 원래 비율대로 바탕에 깔고,
 * 없으면 전시실 사각형(rooms[].rect)으로 기본 평면도를 그린다.
 * onMarkerMove·onEntranceMove를 넘기면 마커와 입구를 끌어서 옮길 수 있다(관리자 화면).
 * 사용자 화면에서는 너무 가까운 마커를 살짝 떨어뜨려 그린다(번호가 겹쳐 순서를 잘못 읽지 않게). 경로 선도 같이 옮긴다.
 */
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { uploadedImageUrl } from '../api/client';
import type { Exhibition, MapPoint } from '../types';

export type MarkerState = 'done' | 'current' | 'upcoming' | 'plain' | 'selected';

export interface MapMarker {
  id: string;
  label: string;         // 마커 안에 표시할 번호
  point: MapPoint;
  state: MarkerState;
  title?: string;        // 접근성/툴팁용 작품명
}

interface Props {
  exhibition: Exhibition;
  markers: MapMarker[];
  /** 관람 경로 (입구 → 1 → 2 → …) */
  route?: MapPoint[];
  /** 강조할 다음 이동 구간 */
  activeLeg?: [MapPoint, MapPoint] | null;
  aspect?: number;       // 가로/세로 (평면도 이미지가 있으면 이미지 비율을 쓴다)
  onMapClick?: (p: MapPoint) => void;
  onMarkerClick?: (id: string) => void;
  /** 마커를 끌어다 놓았을 때 */
  onMarkerMove?: (id: string, p: MapPoint) => void;
  /** 입구를 끌어다 놓았을 때 */
  onEntranceMove?: (p: MapPoint) => void;
  showEntrance?: boolean;
}

const MARKER_R = 3.4;
const MIN_GAP = MARKER_R * 3; // 번호 원 사이에 선이 보일 만큼 띄운다

/**
 * 겹치는 마커를 떨어뜨린 표시 위치 (SVG 좌표). 앞 번호 마커는 제자리에 두고, 뒤 번호 마커를 겹친 마커 반대쪽으로 민다.
 * 실제 저장된 위치는 바꾸지 않는다 — 그릴 때만 쓴다.
 */
function spreadMarkers(points: { x: number; y: number }[], height: number) {
  const placed: { x: number; y: number }[] = [];
  for (const p of points) {
    let q = { ...p };
    for (let tries = 0; tries < 12; tries++) {
      const hit = placed.find((o) => Math.hypot(q.x - o.x, q.y - o.y) < MIN_GAP);
      if (!hit) break;
      const d = Math.hypot(q.x - hit.x, q.y - hit.y);
      // 같은 자리면 오른쪽 아래로, 아니면 겹친 마커에서 멀어지는 방향으로
      const [ux, uy] = d < 0.01 ? [Math.SQRT1_2, Math.SQRT1_2] : [(q.x - hit.x) / d, (q.y - hit.y) / d];
      q = {
        x: Math.min(100 - MARKER_R, Math.max(MARKER_R, hit.x + ux * MIN_GAP)),
        y: Math.min(height - MARKER_R, Math.max(MARKER_R, hit.y + uy * MIN_GAP)),
      };
    }
    placed.push(q);
  }
  return placed;
}

/** origin = 끌기 시작 때 마커 위치, start = 그때 포인터 위치 (마커가 포인터 쪽으로 튀지 않게 차이만큼 옮긴다) */
type Drag = { kind: 'marker' | 'entrance'; id: string; origin: MapPoint; start: MapPoint; point: MapPoint; moved: boolean };

export function FloorMap({
  exhibition,
  markers,
  route,
  activeLeg,
  aspect = 1,
  onMapClick,
  onMarkerClick,
  onMarkerMove,
  onEntranceMove,
  showEntrance = true,
}: Props) {
  const plan = exhibition.floorPlan;
  const ratio = plan ? plan.width / plan.height : aspect;
  const H = 100 / ratio;
  const sy = (y: number) => (y * H) / 100;
  const toPts = (ps: MapPoint[]) => ps.map((p) => `${p.x},${sy(p.y)}`).join(' ');

  const [drag, setDrag] = useState<Drag | null>(null);
  // 끌기가 끝난 직후 svg에 발생하는 click을 무시하기 위한 표시
  const skipClick = useRef(false);

  const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
  const toPoint = (e: { clientX: number; clientY: number; currentTarget: Element }): MapPoint => {
    const r = e.currentTarget.closest('svg')!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  };

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    onMapClick?.(toPoint(e));
  };

  const startDrag = (e: PointerEvent<SVGGElement>, kind: Drag['kind'], id: string, point: MapPoint) => {
    e.stopPropagation();
    e.currentTarget.closest('svg')!.setPointerCapture(e.pointerId);
    setDrag({ kind, id, origin: point, start: toPoint(e), point, moved: false });
  };

  const moveDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toPoint(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    // 살짝 떨린 정도는 클릭으로 본다
    const moved = drag.moved || Math.hypot(dx, dy) > 0.8;
    if (moved) setDrag({ ...drag, point: { x: clamp(drag.origin.x + dx), y: clamp(drag.origin.y + dy) }, moved });
  };

  const endDrag = () => {
    if (!drag) return;
    skipClick.current = true;
    if (!drag.moved) {
      if (drag.kind === 'marker') onMarkerClick?.(drag.id);
    } else if (drag.kind === 'marker') onMarkerMove?.(drag.id, drag.point);
    else onEntranceMove?.(drag.point);
    setDrag(null);
  };

  const entrance = drag?.kind === 'entrance' ? drag.point : exhibition.entrance;

  // 끌어서 옮기는 관리자 지도는 실제 위치 그대로, 사용자 지도는 겹친 마커를 떨어뜨려 그린다
  const spread = onMarkerMove ? null : spreadMarkers(markers.map((m) => ({ x: m.point.x, y: sy(m.point.y) })), H);
  const shown = (i: number, p: MapPoint) => (spread ? { x: spread[i].x, y: (spread[i].y * 100) / H } : p);
  // 경로 점 중 마커 위치와 같은 점은 마커를 따라 옮긴다 (앞에서부터 차례로 짝지음)
  const moveAlong = (ps: MapPoint[]) => {
    if (!spread) return ps;
    const used = new Set<number>();
    return ps.map((p) => {
      const i = markers.findIndex((m, j) => !used.has(j) && m.point.x === p.x && m.point.y === p.y);
      if (i < 0) return p;
      used.add(i);
      return shown(i, p);
    });
  };

  return (
    <svg
      className={`floor-map ${onMapClick ? 'clickable' : ''} ${plan ? 'has-plan' : ''} ${drag?.moved ? 'dragging' : ''}`}
      viewBox={`0 0 100 ${H}`}
      onClick={handleClick}
      onPointerDown={() => (skipClick.current = false)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={() => setDrag(null)}
      role="img"
      aria-label={`${exhibition.title} 평면도`}
    >
      {plan ? (
        <image href={uploadedImageUrl(plan.file)} x={0} y={0} width={100} height={H} preserveAspectRatio="none" />
      ) : (
        exhibition.rooms.map(
          (r) =>
            r.rect && (
              <g key={r.id}>
                <rect className="fm-room" x={r.rect.x} y={sy(r.rect.y)} width={r.rect.w} height={sy(r.rect.h)} rx={1.2} />
                <text className="fm-room-label" x={r.rect.x + 2} y={sy(r.rect.y) + 4.2}>
                  {r.name}
                </text>
              </g>
            ),
        )
      )}

      {showEntrance && (
        <g
          className={`fm-entrance ${onEntranceMove ? 'draggable' : ''}`}
          onPointerDown={onEntranceMove ? (e) => startDrag(e, 'entrance', 'entrance', entrance) : undefined}
        >
          {onEntranceMove && <title>끌어서 입구 위치를 옮길 수 있어요</title>}
          <rect x={entrance.x - 6} y={sy(entrance.y) - 2.6} width={12} height={2.6} rx={0.8} />
          <text x={entrance.x + 7.5} y={sy(entrance.y) - 0.3}>
            입구
          </text>
        </g>
      )}

      {route && route.length > 1 && <polyline className="fm-route" points={toPts(moveAlong(route))} />}
      {activeLeg && <polyline className="fm-route active" points={toPts(moveAlong(activeLeg))} />}

      {markers.map((m, i) => {
        const point = drag?.kind === 'marker' && drag.id === m.id ? drag.point : shown(i, m.point);
        return (
          <g
            key={m.id}
            className={`fm-marker ${m.state} ${onMarkerMove ? 'draggable' : ''}`}
            transform={`translate(${point.x} ${sy(point.y)})`}
            onPointerDown={onMarkerMove ? (e) => startDrag(e, 'marker', m.id, m.point) : undefined}
            onClick={(e) => {
              if (onMarkerMove || !onMarkerClick) return; // 끌기 가능한 지도는 endDrag에서 처리
              e.stopPropagation();
              onMarkerClick(m.id);
            }}
          >
            {m.title && <title>{m.title}</title>}
            {m.state === 'current' && <circle className="fm-pulse" r={5.5} />}
            <circle r={MARKER_R} />
            <text textAnchor="middle" dy="1.25">
              {m.state === 'done' ? '✓' : m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
