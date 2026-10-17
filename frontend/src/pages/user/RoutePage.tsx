import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, QueryState, Skeleton } from '@/components/common';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { FloorMapView, type MapMarker } from '@/components/map/FloorMapView';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useExhibitionMap } from '@/hooks/queries/useUserQueries';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import type { ArtworkPosition, ExhibitionMapData, RecommendedArtwork } from '@/types/domain';
import styles from './RoutePage.module.css';

/** 입구 위치 (평면도 하단 중앙) — 첫 작품까지 예상 이동 시간 계산용 */
const ENTRANCE = { xRatio: 0.5, yRatio: 1 };

function estimateMinutes(
  from: { xRatio: number; yRatio: number },
  to: { xRatio: number; yRatio: number },
) {
  const distance = Math.hypot(from.xRatio - to.xRatio, from.yRatio - to.yRatio);
  return Math.max(1, Math.round(distance * 6));
}

/** U-09 추천 관람 경로 (2D 지도) — 작품 감상 후 다음 작품 안내에도 재사용 */
export function RoutePage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const { session } = useExhibitionSession(exhibitionId);
  const query = useExhibitionMap(exhibitionId);
  const recommendations = session?.recommendations ?? [];

  return (
    <MobileLayout
      title="추천 관람 경로"
      onBack={() => navigate(paths.recommendations(exhibitionId))}
    >
      {recommendations.length === 0 ? (
        <EmptyState
          icon="map"
          title="추천 작품이 아직 없어요"
          description="취향과 관람 시간을 선택하면 관람 경로를 만들어 드려요."
          action={
            <Button fullWidth onClick={() => navigate(paths.taste(exhibitionId))}>
              취향 선택하기
            </Button>
          }
        />
      ) : (
        <QueryState
          query={query}
          loading={<Skeleton height={460} radius={20} />}
          isEmpty={(data) => data.maps.length === 0}
          empty={
            <EmptyState
              icon="map"
              title="평면도가 아직 등록되지 않았어요"
              description="전시실 안내에 따라 관람을 시작해 주세요."
              action={
                <Button
                  fullWidth
                  onClick={() =>
                    navigate(
                      paths.artwork(exhibitionId, recommendations[session!.currentIndex].artworkId),
                    )
                  }
                >
                  작품 감상하기
                </Button>
              }
            />
          }
        >
          {(data) => (
            <RouteContent
              data={data}
              recommendations={recommendations}
              currentIndex={session!.currentIndex}
              viewedIds={session!.viewedArtworkIds}
              onStart={(artworkId) => navigate(paths.artwork(exhibitionId, artworkId))}
            />
          )}
        </QueryState>
      )}
    </MobileLayout>
  );
}

function RouteContent({
  data,
  recommendations,
  currentIndex,
  viewedIds,
  onStart,
}: {
  data: ExhibitionMapData;
  recommendations: RecommendedArtwork[];
  currentIndex: number;
  viewedIds: string[];
  onStart: (artworkId: string) => void;
}) {
  const current = recommendations[currentIndex];
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [floorId, setFloorId] = useState(current.floorId || data.maps[0].floorId);

  const positionMap = useMemo(
    () => new Map<string, ArtworkPosition>(data.positions.map((p) => [p.artworkId, p])),
    [data.positions],
  );

  const map = data.maps.find((m) => m.floorId === floorId) ?? data.maps[0];
  const focusIndex = previewIndex ?? currentIndex;
  const focus = recommendations[focusIndex];
  const focusPos = positionMap.get(focus.artworkId);
  const prevPos =
    focusIndex > 0 ? positionMap.get(recommendations[focusIndex - 1].artworkId) : undefined;

  // 같은 층에 있는 추천 작품만 마커로 표시 (order 순서 유지)
  const floorItems = recommendations
    .map((item, index) => ({ item, index, pos: positionMap.get(item.artworkId) }))
    .filter((v) => v.pos && v.pos.mapId === map.mapId);

  const markers: MapMarker[] = floorItems.map(({ item, index, pos }) => ({
    artworkId: item.artworkId,
    label: String(item.order),
    xRatio: pos!.xRatio,
    yRatio: pos!.yRatio,
    title: item.title,
    state:
      index === focusIndex
        ? 'current'
        : viewedIds.includes(item.artworkId) || index < currentIndex
          ? 'done'
          : 'default',
  }));

  const focusMarkerIndex = floorItems.findIndex((v) => v.index === focusIndex);
  const highlight: [number, number] | null =
    focusMarkerIndex > 0 ? [focusMarkerIndex - 1, focusMarkerIndex] : null;

  const isFirstStart = currentIndex === 0 && !viewedIds.includes(current.artworkId);
  const minutes = focusPos ? estimateMinutes(prevPos ?? ENTRANCE, focusPos) : null;

  return (
    <div className={styles.wrap}>
      <p className={styles.progress}>
        추천 작품 {currentIndex + 1}/{recommendations.length}
      </p>

      {data.maps.length > 1 && (
        <div className={styles.floors} role="tablist" aria-label="층 선택">
          {data.maps.map((m) => (
            <button
              key={m.mapId}
              type="button"
              role="tab"
              aria-selected={m.floorId === map.floorId}
              className={`${styles.floor} ${m.floorId === map.floorId ? styles.floorOn : ''}`}
              onClick={() => setFloorId(m.floorId)}
            >
              {m.floorName}
            </button>
          ))}
        </div>
      )}

      <div className={styles.mapCard}>
        <FloorMapView
          map={map}
          markers={markers}
          showRoute
          highlightSegment={highlight}
          onMarkerClick={(artworkId) => {
            const index = recommendations.findIndex((r) => r.artworkId === artworkId);
            setPreviewIndex(index === currentIndex ? null : index);
          }}
        />

        <Card padding="md" className={styles.nextCard}>
          <p className={styles.nextLabel}>
            {previewIndex !== null
              ? `선택한 작품 · ${focus.order}번`
              : isFirstStart
                ? '첫 번째 작품'
                : '다음 작품'}
          </p>
          <div className={styles.nextRow}>
            <p className={styles.nextTitle}>
              {focus.title} · {focus.roomName}
            </p>
            {minutes !== null && <span className={styles.nextTime}>약 {minutes}분</span>}
          </div>
          {!focusPos && (
            <p className={styles.noPos}>
              위치 정보가 아직 등록되지 않았어요. {focus.roomName || '전시실'} 안내를 참고해 주세요.
            </p>
          )}
          {focus.floorId && focus.floorId !== map.floorId && (
            <p className={styles.noPos}>다른 층에 있는 작품이에요.</p>
          )}
        </Card>
      </div>

      <ol className={styles.order} aria-label="관람 순서">
        {recommendations.map((item, index) => (
          <li
            key={item.artworkId}
            className={`${styles.orderItem} ${index === currentIndex ? styles.orderCurrent : ''} ${
              index < currentIndex ? styles.orderDone : ''
            }`}
          >
            <span className={styles.orderNo}>{item.order}</span>
            <span className={styles.orderTitle}>{item.title}</span>
            <span className={styles.orderRoom}>{item.roomName}</span>
          </li>
        ))}
      </ol>

      <div className={styles.footer}>
        <Button fullWidth onClick={() => onStart(current.artworkId)}>
          {isFirstStart ? '관람 시작하기' : `${current.order}번 작품 감상하기`}
        </Button>
      </div>
    </div>
  );
}
