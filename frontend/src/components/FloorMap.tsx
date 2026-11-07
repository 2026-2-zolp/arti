/**
 * 전시실 2D 평면도 (U-09 사용자 경로 / A-05 관리자 위치 지정에서 공통 사용)
 * 좌표는 모두 0~100 퍼센트로 저장하고, 그릴 때 SVG 좌표로 변환한다.
 * → 평면도 표시 크기가 화면마다 달라도 같은 데이터를 쓸 수 있다.
 *
 * 전시에 평면도 이미지(floorPlan)가 있으면 그 이미지를 원래 비율대로 바탕에 깔고,
 * 없으면 전시실 사각형(rooms[].rect)으로 기본 평면도를 그린다.
 * onMarkerMove·onEntranceMove를 넘기면 마커와 입구를 끌어서 옮길 수 있다(관리자 화면).
 */
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { uploadedImageUrl } from '../api/client';
import { useProtectedImage } from '../lib/useProtectedImage';
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
  forAdmin?: boolean;
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
  forAdmin = false,
}: Props) {
  const plan = exhibition.floorPlan;
  const { src: planSrc } = useProtectedImage(plan ? uploadedImageUrl(plan.file, forAdmin) : undefined);
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
        <image href={planSrc} x={0} y={0} width={100} height={H} preserveAspectRatio="none" />
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

      {route && route.length > 1 && <polyline className="fm-route" points={toPts(route)} />}
      {activeLeg && <polyline className="fm-route active" points={toPts(activeLeg)} />}

      {markers.map((m) => {
        const point = drag?.kind === 'marker' && drag.id === m.id ? drag.point : m.point;
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
            <circle r={3.4} />
            <text textAnchor="middle" dy="1.25">
              {m.state === 'done' ? '✓' : m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
