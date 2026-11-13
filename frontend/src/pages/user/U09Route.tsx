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
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Artwork, MapPoint } from '../../types';

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
  const showFullMap = current === 0 || fromArtwork || entry?.showMap === true;
  const [mapOpen, setMapOpen] = useState(showFullMap);
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

  // 현재 구간은 바로 앞의 좌표가 있는 작품(없으면 입구)부터 표시합니다.
  const from: MapPoint = (() => {
    for (let i = current - 1; i >= 0; i--) {
      const prev = byId.get(recommendations[i].artworkId);
      if (prev?.position) return prev.position;
    }
    return ex.entrance;
  })();
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
      title={current > 0 && !showFullMap ? '다음 작품 안내' : '추천 관람 경로'}
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
        <span className="eyebrow">{current + 1}번 작품</span>
        <div className="next-row">
          <h2>{target.title}{target.year ? ` (${target.year})` : ''}</h2>
          <span className="muted small">{locationLabel(target)}</span>
        </div>
      </div>

      <details className="route-details" open={mapOpen} onToggle={(event) => setMapOpen(event.currentTarget.open)}>
        <summary>전체 지도와 관람 순서</summary>
        <p className="muted small route-note">선은 관람 순서를 이은 거예요. 실제 길과 다를 수 있어요.</p>
        <div className="map-card">
          <FloorMap
            exhibition={ex}
            markers={markers}
            route={[ex.entrance, ...markers.map((m) => m.point)]}
            activeLeg={target.position ? [from, target.position] : null}
            aspect={0.95}
            onMarkerClick={(id) => setFocusId((f) => (f === id ? null : id))}
          />
          {focus && focus.id !== target.id && (
            <div className="next-card">
              <span className="eyebrow">{orderOf(focus.id)}번 작품</span>
              <div className="next-row">
                <strong>
                  {focus.title} · {locationLabel(focus)}
                </strong>
                <button className="text-btn" onClick={() => setFocusId(null)}>
                  {current + 1}번 작품 정보 보기
                </button>
              </div>
            </div>
          )}
        </div>
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
