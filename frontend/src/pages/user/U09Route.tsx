/**
 * U-09 추천 관람 경로 (2D 지도)
 * - 최초 진입: "관람 시작하기" → U-10
 * - 작품 감상 후 "다음 작품 안내"로 다시 들어오면 같은 화면을 재사용해 다음 작품 위치를 보여 준다.
 * 실시간 실내 내비게이션이 아니라 위치와 순서를 시각적으로 안내하는 수준.
 */
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { api } from '../../api/client';
import { GALAXY_MAP_EXHIBITION, galaxyMapLeg } from '../../lib/galaxyMapFixture';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Artwork } from '../../types';

/** 추천 작품의 위치·방문 순서를 안내하는 화면 */
export default function U09Route() {
  const navigate = useNavigate();
  const { state: entry } = useLocation();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { recommendations, current, startedAt } = state;
  const [focusId, setFocusId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]),
    [exhibitionId],
  );
  const fromArtwork = entry?.fromArtwork === true;
  const fromRecommend = entry?.fromRecommend === true;
  const isNextGuide = current > 0 && !fromArtwork && entry?.showMap !== true;
  const [mapOpen, setMapOpen] = useState(!isNextGuide);
  const back = () => {
    if (fromArtwork || fromRecommend) navigate(-1);
    else navigate(to('/recommend'), { replace: true });
  };

  if (recommendations.length === 0) return <Navigate to={to('/recommend')} replace />;
  if (current >= recommendations.length) return <Navigate to={to('/receipt')} replace />;

  if (error || loading || !data) {
    return (
      <MobileShell screenId="U-09" title="추천 관람 경로" back={back}>
        {error ? (
          <p className="error-text" role="alert">
            {error} <button onClick={reload}>다시 불러오기</button>
          </p>
        ) : <Spinner />}
      </MobileShell>
    );
  }

  const [ex, artworks] = data;
  const byId = new Map<string, Artwork>(artworks.map((w) => [w.id, w]));
  // 번호·진행 순서는 추천 목록 순서 그대로 쓴다 (U-10도 recommendations[current]를 보여 줌).
  // 지도 위치가 없는 작품(관람 도중 위치가 지워진 경우 등)은 마커만 빼고 목록에는 '위치 미등록'으로 남긴다.
  const target = byId.get(recommendations[current].artworkId);
  if (!target) {
    return (
      <MobileShell screenId="U-09" title="추천 관람 경로" back={back}>
        <p className="error-text" role="alert">
          추천 작품 정보를 불러올 수 없어요. <button onClick={reload}>다시 불러오기</button>
        </p>
      </MobileShell>
    );
  }

  const previousId = recommendations[current - 1]?.artworkId;
  const previous = previousId ? byId.get(previousId) : undefined;
  const from = current === 0 ? ex.entrance : previous?.position;
  const roomName = (w: Artwork) => ex.rooms.find((r) => r.id === w.roomId)?.name ?? '';
  const orderOf = (id: string) => recommendations.findIndex((r) => r.artworkId === id) + 1;

  const markers: MapMarker[] = recommendations.flatMap((r, i) => {
    const w = byId.get(r.artworkId);
    if (!w?.position) return [];
    const state: MapMarker['state'] = i < current ? 'done' : i === current ? 'current' : focusId === w.id ? 'selected' : 'upcoming';
    return [{ id: w.id, label: String(i + 1), point: w.position, title: w.title, state }];
  });

  const focus = focusId ? byId.get(focusId) : null;
  const isFirst = current === 0 && !startedAt;
  const locationLabel = (w: Artwork) => w.position ? roomName(w) || '전시실 미등록' : '위치 미등록';
  const focusedMarkers = markers.filter((marker) => marker.id === previousId || marker.id === target.id);
  const isMapFixture = import.meta.env.VITE_GALAXY_MAP_FIXTURE === '1' && ex.id === GALAXY_MAP_EXHIBITION;
  const stops = recommendations.map((r) => byId.get(r.artworkId));
  const route = mapOpen ? [ex.entrance, ...stops.flatMap((stop, i) => {
    if (!stop?.position) return [null];
    const prior = stops[i - 1];
    const start = i === 0 ? ex.entrance : prior?.position;
    return isMapFixture && start ? galaxyMapLeg(start, stop.position, prior?.roomId, stop.roomId).slice(1) : [stop.position];
  })] : undefined;
  let activeLeg = from && target.position ? [from, target.position] : null;
  if (isMapFixture && from && target.position) activeLeg = galaxyMapLeg(from, target.position, previous?.roomId, target.roomId);
  let routeNote = '선은 작품 위치를 이은 거예요. 실제 통로와 다를 수 있어요.';
  if (isMapFixture) routeNote = '검증용 도면이에요. 출입문과 복도를 따라 이동하는 예시입니다.';
  if (!activeLeg) routeNote = '작품 위치 정보가 부족해 이번 구간을 표시할 수 없어요.';
  else if (!isMapFixture && route?.includes(null)) routeNote = '위치가 등록된 연속 구간만 이었어요. 실제 통로와 다를 수 있어요.';

  const go = () => {
    if (fromArtwork) {
      navigate(-1);
      return;
    }
    dispatch({ type: 'startVisit' });
    navigate(to('/artwork'), { replace: true, state: { fromRecommend } });
  };

  return (
    <MobileShell
      screenId="U-09"
      title={isNextGuide ? '다음 작품 안내' : '추천 관람 경로'}
      back={back}
      footer={
        <button className="btn primary block" onClick={go}>
          {fromArtwork ? '감상으로 돌아가기' : isFirst ? '관람 시작하기' : `${current + 1}번 작품 감상하기`}
        </button>
      }
    >
      <div className="route-head">
        <span className="muted">
          추천 작품 {current + 1}/{recommendations.length}
        </span>
        <div className="progress-dots" aria-hidden="true">
          {recommendations.map((r, i) => (
            <span key={r.artworkId} className={i < current ? 'done' : i === current ? 'cur' : ''} />
          ))}
        </div>
      </div>

      <div className="next-card">
        {current > 0 && (
          <p className="muted small">출발 · {current}번 {previous?.title ?? '직전 작품'}{previous ? ` · ${locationLabel(previous)}` : ''}</p>
        )}
        <div className="next-artwork">
          <ArtImage key={target.id} className="next-thumb" seed={target.id} palette={target.palette}
            imageUrl={artworkImageSrc(target)} alt="" ratio={1} fit="contain" />
          <div className="next-artwork-info">
            <span className="eyebrow">{current > 0 ? '다음 · ' : ''}{current + 1}번 작품</span>
            <h2>{target.title}{target.year ? ` (${target.year})` : ''}</h2>
            <span className="muted small">{locationLabel(target)}</span>
          </div>
        </div>
      </div>

      <div className={`map-card route-map${isNextGuide ? ' route-map-next' : ''}`}>
        <p className="muted small route-note">{routeNote}</p>
        <FloorMap
          exhibition={ex}
          markers={mapOpen ? markers : focusedMarkers}
          route={route}
          activeLeg={activeLeg}
          showEntrance={mapOpen || current === 0}
          showCompletedNumbers={!mapOpen}
          aspect={0.95}
          onMarkerClick={mapOpen ? (id) => setFocusId((f) => (f === id ? null : id)) : undefined}
        />
        {mapOpen && focus && focus.id !== target.id && (
          <div className="next-card">
            <span className="eyebrow">{orderOf(focus.id)}번 작품</span>
            <div className="next-row">
              <strong>{focus.title} · {locationLabel(focus)}</strong>
              <button className="text-btn" onClick={() => setFocusId(null)}>
                {current + 1}번 작품 정보 보기
              </button>
            </div>
          </div>
        )}
      </div>
      <details className="route-details" open={mapOpen} onToggle={(event) => setMapOpen(event.currentTarget.open)}>
        <summary>전체 지도와 관람 순서</summary>
        <ol className="route-list">
          {recommendations.map((r, i) => {
            const w = byId.get(r.artworkId);
            return (
              <li key={r.artworkId} aria-current={i === current ? 'step' : undefined} className={i < current ? 'done' : i === current ? 'cur' : ''}>
                <span className="route-num" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
                {i < current && <span className="sr-only">감상 완료</span>}
                <span className="route-title">{w ? `${w.title}${w.year ? `(${w.year})` : ''}` : '작품 정보 없음'}</span>
                <span className="muted small">{w ? locationLabel(w) : ''}</span>
              </li>
            );
          })}
        </ol>
      </details>
    </MobileShell>
  );
}
