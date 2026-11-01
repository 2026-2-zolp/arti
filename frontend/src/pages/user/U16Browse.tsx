/**
 * U-16 자유 관람 — 취향 추천 없이 전시 작품 전체를 보고 골라 감상한다
 * - 작품 목록은 입구에서 가까운 순서(추천 경로와 같은 방식)로 번호를 붙인다
 * - 작품을 누르면 U-10 작품 감상으로, 감상 후 「목록으로」 돌아온다
 * - 「관람 마치기」 → U-12 아트 영수증 (1점 이상 봤을 때)
 * 추천 화면(U-05~U-09)과 같은 관람 상태(recommendations·current·viewed)를 mode: 'free'로 재사용한다.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import type { Artwork, MapPoint, Recommendation } from '../../types';

const dist = (p: MapPoint, q: MapPoint) => Math.hypot(p.x - q.x, p.y - q.y);

/** 입구에서 시작해 가장 가까운 작품을 차례로 고르는 순서 (위치가 없는 작품은 맨 뒤) */
function walkingOrder(works: Artwork[], entrance: MapPoint): Artwork[] {
  const rest = works.filter((w) => w.position);
  const ordered: Artwork[] = [];
  let cur = entrance;
  while (rest.length) {
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (dist(cur, rest[i].position!) < dist(cur, rest[best].position!)) best = i;
    const [next] = rest.splice(best, 1);
    ordered.push(next);
    cur = next.position!;
  }
  return [...ordered, ...works.filter((w) => !w.position)];
}

const freeRec = (w: Artwork, i: number): Recommendation => ({
  artworkId: w.id,
  order: i + 1,
  reason: '',
  matchedTags: [],
  matchedCard: null,
  score: 0,
  aiTags: false,
});

export default function U16Browse() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const { data, loading, error } = useAsync(
    () => Promise.all([api.getExhibition(state.exhibitionId), api.listArtworks(state.exhibitionId)]),
    [state.exhibitionId],
  );

  // 사용자 화면에는 검수 완료 작품만 (추천과 같은 기준)
  const ordered = data ? walkingOrder(data[1].filter((w) => w.reviewStatus === 'approved'), data[0].entrance) : [];

  useEffect(() => {
    if (ordered.length) dispatch({ type: 'startFree', recs: ordered.map(freeRec) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dispatch]);

  const open = (i: number) => {
    dispatch({ type: 'openArtwork', index: i });
    navigate('/artwork');
  };

  const seen = new Set(state.mode === 'free' ? state.viewed : []);
  const ex = data?.[0];
  const roomName = (w: Artwork) => ex?.rooms.find((r) => r.id === w.roomId)?.name ?? '';
  const markers: MapMarker[] = ordered
    .filter((w) => w.position)
    .map((w, i) => ({ id: w.id, label: String(i + 1), point: w.position!, title: w.title, state: seen.has(w.id) ? 'done' : 'upcoming' }));

  return (
    <MobileShell
      screenId="U-16"
      title="자유 관람"
      back="/entry"
      footer={
        <>
          <button className="btn primary block" disabled={seen.size === 0} onClick={() => navigate('/receipt')}>
            관람 마치기 {seen.size > 0 && `(${seen.size}점 감상)`}
          </button>
          {seen.size === 0 && <p className="footnote">작품을 1점 이상 보면 아트 영수증을 받을 수 있어요.</p>}
        </>
      }
    >
      <Lead title="보고 싶은 작품을 골라 보세요" desc="추천 없이 전시 작품을 모두 보여 드려요. 번호는 입구에서 가까운 순서예요." />

      {loading && <Spinner />}
      {error && <p className="error-text">{error}</p>}
      {ex && ordered.length === 0 && <p className="muted">아직 공개된 작품이 없어요.</p>}

      {ex && markers.length > 0 && (
        <div className="map-card">
          <FloorMap exhibition={ex} markers={markers} aspect={0.95} onMarkerClick={(id) => open(ordered.findIndex((w) => w.id === id))} />
        </div>
      )}

      <ol className="rec-list mt-12">
        {ordered.map((w, i) => (
          <li key={w.id}>
            <button type="button" className="rec-card browse-card" onClick={() => open(i)}>
              <ArtImage className="rec-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={1.1} />
              <span className="rec-info">
                <strong>
                  {i + 1}. {w.title}
                </strong>
                <span className="muted small">
                  {w.artist} · {w.year}
                </span>
                <span className="muted small">{roomName(w)}</span>
                {seen.has(w.id) && <span className="rec-kind mine">✓ 감상함</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </MobileShell>
  );
}
