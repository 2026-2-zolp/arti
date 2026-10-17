import type { MouseEvent } from 'react';
import type { FloorMap } from '@/types/domain';
import styles from './FloorMapView.module.css';

/**
 * 합의 10. 지도 좌표 기준
 * A-05 관리자 지도와 U-09 사용자 지도가 공통으로 사용하는 평면도 컴포넌트.
 * 모든 좌표는 0~1 정규화 값(xRatio, yRatio)이며, 화면 크기와 무관하게 같은 위치에 표시된다.
 */

export type MarkerState = 'default' | 'current' | 'done' | 'selected' | 'draft';

export interface MapMarker {
  artworkId: string;
  label: string;
  xRatio: number;
  yRatio: number;
  state?: MarkerState;
  title?: string;
}

interface FloorMapViewProps {
  map: FloorMap;
  markers: MapMarker[];
  /** 마커 순서대로 경로 선을 그린다 */
  showRoute?: boolean;
  /** 강조할 구간 [fromIndex, toIndex] */
  highlightSegment?: [number, number] | null;
  onMapClick?: (pos: { xRatio: number; yRatio: number }) => void;
  onMarkerClick?: (artworkId: string) => void;
  variant?: 'user' | 'admin';
}

const VIEW_W = 1000;

export function FloorMapView({
  map,
  markers,
  showRoute = false,
  highlightSegment = null,
  onMapClick,
  onMarkerClick,
  variant = 'user',
}: FloorMapViewProps) {
  const viewH = VIEW_W / map.aspectRatio;

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onMapClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onMapClick({
      xRatio: clamp((e.clientX - rect.left) / rect.width),
      yRatio: clamp((e.clientY - rect.top) / rect.height),
    });
  };

  const points = markers.map((m) => `${m.xRatio * VIEW_W},${m.yRatio * viewH}`);

  return (
    <div
      className={`${styles.map} ${styles[variant]} ${onMapClick ? styles.clickable : ''}`}
      style={{ aspectRatio: String(map.aspectRatio) }}
      onClick={handleClick}
      role={onMapClick ? 'application' : 'img'}
      aria-label={`${map.floorName} 전시실 평면도`}
    >
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {map.rooms.map((room) => (
          <g key={room.roomId}>
            <rect
              className={styles.room}
              x={room.xRatio * VIEW_W}
              y={room.yRatio * viewH}
              width={room.widthRatio * VIEW_W}
              height={room.heightRatio * viewH}
              rx={variant === 'admin' ? 8 : 2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {showRoute && points.length > 1 && (
          <polyline
            className={styles.route}
            points={points.join(' ')}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {showRoute && highlightSegment && points[highlightSegment[1]] && (
          <polyline
            className={styles.routeActive}
            points={`${points[highlightSegment[0]]} ${points[highlightSegment[1]]}`}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {map.rooms.map((room) => (
        <span
          key={room.roomId}
          className={styles.roomLabel}
          style={{ left: `${(room.xRatio + 0.015) * 100}%`, top: `${(room.yRatio + 0.02) * 100}%` }}
        >
          {room.name}
        </span>
      ))}

      {markers.map((m) => (
        <button
          key={m.artworkId}
          type="button"
          className={`${styles.marker} ${styles[m.state ?? 'default']}`}
          style={{ left: `${m.xRatio * 100}%`, top: `${m.yRatio * 100}%` }}
          onClick={(e) => {
            e.stopPropagation();
            onMarkerClick?.(m.artworkId);
          }}
          title={m.title}
          aria-label={m.title ? `${m.label}번 ${m.title}` : `${m.label}번 작품`}
          tabIndex={onMarkerClick ? 0 : -1}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
