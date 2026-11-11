/**
 * U-09 추천 관람 경로 (2D 지도)
 * - 최초 진입: "관람 시작하기" → U-10
 * - 작품 감상 후 "다음 작품 안내"로 다시 들어오면 같은 화면을 재사용해 다음 작품 위치를 보여 준다.
 * 실시간 실내 내비게이션이 아니라 위치와 순서를 시각적으로 안내하는 수준.
 */
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
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
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { recommendations, current, startedAt } = state;
  const [focusId, setFocusId] = useState<string | null>(null);

  const { data, loading } = useAsync(
    () => Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]),
    [exhibitionId],
  );

  if (recommendations.length === 0) return <Navigate to={to('/recommend')} replace />;
  if (current >= recommendations.length) return <Navigate to={to('/receipt')} replace />;

  if (loading || !data) {
    return (
      <MobileShell screenId="U-09" title="추천 관람 경로" back={to('/recommend')}>
        <Spinner />
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
      <MobileShell screenId="U-09" title="추천 관람 경로" back={to('/recommend')}>
        <p className="muted">추천 작품 정보를 찾지 못했어요. 추천을 다시 받아 주세요.</p>
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

  const go = () => {
    dispatch({ type: 'startVisit' });
    navigate(to('/artwork'));
  };

  return (
    <MobileShell
      screenId="U-09"
      title="추천 관람 경로"
      back={to('/recommend')}
      footer={
        <button className="btn primary block" onClick={go}>
          {isFirst ? '관람 시작하기' : `${current + 1}번 작품 감상하기`}
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

      <div className="map-card">
        <FloorMap
          exhibition={ex}
          markers={markers}
          route={[ex.entrance, ...markers.map((m) => m.point)]}
          activeLeg={target.position ? [from, target.position] : null}
          aspect={0.95}
          onMarkerClick={(id) => setFocusId((f) => (f === id ? null : id))}
        />

        <div className="next-card">
          {focus && focus.id !== target.id ? (
            <>
              <span className="eyebrow">{orderOf(focus.id)}번 작품</span>
              <div className="next-row">
                <strong>
                  {focus.title} · {roomName(focus)}
                </strong>
                <button className="text-btn" onClick={() => setFocusId(null)}>
                  다음 작품 보기
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">{isFirst ? '첫 번째 작품' : '다음 작품'}</span>
              <div className="next-row">
                <strong>
                  {target.title}
                  {target.year ? `(${target.year})` : ''}
                </strong>
                <span className="muted small">{target.position ? roomName(target) : '위치 미등록'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <ol className="route-list">
        {recommendations.map((r, i) => {
          const w = byId.get(r.artworkId);
          return (
            <li key={r.artworkId} className={i < current ? 'done' : i === current ? 'cur' : ''}>
              <span className="route-num">{i < current ? '✓' : i + 1}</span>
              <span className="route-title">{w ? `${w.title}${w.year ? `(${w.year})` : ''}` : '작품 정보 없음'}</span>
              <span className="muted small">{w ? (w.position ? roomName(w) : '위치 미등록') : ''}</span>
            </li>
          );
        })}
      </ol>
    </MobileShell>
  );
}
