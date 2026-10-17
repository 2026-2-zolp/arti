/**
 * 전시실 2D 평면도 (U-09 사용자 경로 / A-05 관리자 위치 지정에서 공통 사용)
 * 좌표는 모두 0~100 퍼센트로 저장하고, 그릴 때 SVG 좌표로 변환한다.
 * → 평면도 표시 크기가 화면마다 달라도 같은 데이터를 쓸 수 있다.
 */
import type { MouseEvent } from 'react';
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
  aspect?: number;       // 가로/세로
  onMapClick?: (p: MapPoint) => void;
  onMarkerClick?: (id: string) => void;
  showEntrance?: boolean;
}

export function FloorMap({
  exhibition,
  markers,
  route,
  activeLeg,
  aspect = 1,
  onMapClick,
  onMarkerClick,
  showEntrance = true,
}: Props) {
  const H = 100 / aspect;
  const sy = (y: number) => (y * H) / 100;
  const toPts = (ps: MapPoint[]) => ps.map((p) => `${p.x},${sy(p.y)}`).join(' ');

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!onMapClick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    onMapClick({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };

  return (
    <svg
      className={`floor-map ${onMapClick ? 'clickable' : ''}`}
      viewBox={`0 0 100 ${H}`}
      onClick={handleClick}
      role="img"
      aria-label={`${exhibition.title} 평면도`}
    >
      {exhibition.rooms.map((r) => (
        <g key={r.id}>
          <rect
            className="fm-room"
            x={r.rect.x}
            y={sy(r.rect.y)}
            width={r.rect.w}
            height={sy(r.rect.h)}
            rx={1.2}
          />
          <text className="fm-room-label" x={r.rect.x + 2} y={sy(r.rect.y) + 4.2}>
            {r.name}
          </text>
        </g>
      ))}

      {showEntrance && (
        <g className="fm-entrance">
          <rect x={exhibition.entrance.x - 6} y={sy(exhibition.entrance.y) - 2.6} width={12} height={2.6} rx={0.8} />
          <text x={exhibition.entrance.x + 7.5} y={sy(exhibition.entrance.y) - 0.3}>
            입구
          </text>
        </g>
      )}

      {route && route.length > 1 && <polyline className="fm-route" points={toPts(route)} />}
      {activeLeg && <polyline className="fm-route active" points={toPts(activeLeg)} />}

      {markers.map((m) => (
        <g
          key={m.id}
          className={`fm-marker ${m.state}`}
          transform={`translate(${m.point.x} ${sy(m.point.y)})`}
          onClick={(e) => {
            if (!onMarkerClick) return;
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
      ))}
    </svg>
  );
}
