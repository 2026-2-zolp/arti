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
import { walkMinutes } from '../../lib/recommend';
import { useVisit } from '../../store/VisitContext';
import type { Artwork, MapPoint } from '../../types';

export default function U09Route() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const { exhibitionId, recommendations, current, startedAt } = state;
  const [focusId, setFocusId] = useState<string | null>(null);

  const { data, loading } = useAsync(
    () => Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]),
    [exhibitionId],
  );

  if (recommendations.length === 0) return <Navigate to="/recommend" replace />;
  if (current >= recommendations.length) return <Navigate to="/receipt" replace />;

  if (loading || !data) {
    return (
      <MobileShell screenId="U-09" title="추천 관람 경로" back="/recommend">
        <Spinner />
      </MobileShell>
    );
  }

  const [ex, artworks] = data;
  const byId = new Map<string, Artwork>(artworks.map((w) => [w.id, w]));
  const ordered = recommendations.map((r) => byId.get(r.artworkId)).filter((w): w is Artwork => !!w?.position);

  const target = ordered[current];
  const from: MapPoint = current === 0 ? ex.entrance : ordered[current - 1].position!;
  const roomName = (w: Artwork) => ex.rooms.find((r) => r.id === w.roomId)?.name ?? '';

  const markers: MapMarker[] = ordered.map((w, i) => ({
    id: w.id,
    label: String(i + 1),
    point: w.position!,
    title: w.title,
    state: i < current ? 'done' : i === current ? 'current' : focusId === w.id ? 'selected' : 'upcoming',
  }));

  const focus = focusId ? byId.get(focusId) : null;
  const isFirst = current === 0 && !startedAt;

  const go = () => {
    dispatch({ type: 'startVisit' });
    navigate('/artwork');
  };

  return (
    <MobileShell
      screenId="U-09"
      title="추천 관람 경로"
      back="/recommend"
      footer={
        <button className="btn primary block" onClick={go}>
          {isFirst ? '관람 시작하기' : `${current + 1}번 작품 감상하기`}
        </button>
      }
    >
      <div className="route-head">
        <span className="muted">
          추천 작품 {current + 1}/{ordered.length}
        </span>
        <div className="progress-dots" aria-hidden="true">
          {ordered.map((w, i) => (
            <span key={w.id} className={i < current ? 'done' : i === current ? 'cur' : ''} />
          ))}
        </div>
      </div>

      <div className="map-card">
        <FloorMap
          exhibition={ex}
          markers={markers}
          route={[ex.entrance, ...ordered.map((w) => w.position!)]}
          activeLeg={[from, target.position!]}
          aspect={0.95}
          onMarkerClick={(id) => setFocusId((f) => (f === id ? null : id))}
        />

        <div className="next-card">
          {focus && focus.id !== target.id ? (
            <>
              <span className="eyebrow">{ordered.findIndex((w) => w.id === focus.id) + 1}번 작품</span>
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
                  {target.title} · {roomName(target)}
                </strong>
                <span className="muted small">약 {walkMinutes(from, target.position!)}분</span>
              </div>
            </>
          )}
        </div>
      </div>

      <ol className="route-list">
        {ordered.map((w, i) => (
          <li key={w.id} className={i < current ? 'done' : i === current ? 'cur' : ''}>
            <span className="route-num">{i < current ? '✓' : i + 1}</span>
            <span className="route-title">{w.title}</span>
            <span className="muted small">{roomName(w)}</span>
          </li>
        ))}
      </ol>
    </MobileShell>
  );
}
