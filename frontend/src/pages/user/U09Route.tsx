/**
 * U-09 추천 관람순서 (2D 지도)
 * - 최초 진입: "관람 시작하기" → U-10
 * - 작품 감상 후 "다음 작품 안내"로 다시 들어오면 같은 화면을 재사용해 다음 작품 위치를 보여 준다.
 * 실시간 실내 내비게이션이 아니라 위치와 순서를 시각적으로 안내하는 수준.
 */
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { FinishedVisitPrompt } from '../../components/FinishedVisitPrompt';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { api, ApiError } from '../../api/client';
import { GALAXY_MAP_EXHIBITION, galaxyMapLeg } from '../../lib/galaxyMapFixture';
import { exhibitionIndoorLayout } from '../../lib/indoorMapFixture';
import { indoorLeg, indoorSequence } from '../../lib/indoorRoute';
import { useAsync } from '../../lib/useAsync';
import { errorDetail } from '../../lib/errorText';
import { hasAppHistory, useVisitHistory, visitEntry } from '../../lib/appHistory';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Artwork } from '../../types';

/** 추천 작품의 위치·방문 순서를 안내하는 화면 */
export default function U09Route() {
  const navigate = useNavigate();
  const { state: entry, key: locationKey } = useLocation();
  const { pending, finished, askFinished, currentEntry } = useVisitHistory();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const isSpain = exhibitionId === 'spain500-sac-2026';
  const to = useExhibitionPath();
  const { recommendations, current, viewed, startedAt } = state;
  const isExhibitionOrder = state.visitMode === 'exhibition_order';
  const [focusId, setFocusId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    async () => {
      try {
        return await Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return 'unavailable' as const;
        throw err;
      }
    },
    [exhibitionId],
  );
  const returnToArtwork = entry?.returnToArtwork === true;
  const isNextGuide = current > 0 && !returnToArtwork && entry?.showMap !== true;
  const title = isNextGuide ? '다음 작품 안내' : isExhibitionOrder ? '전시 관람순서' : '추천 관람순서';
  const [mapChoice, setMapChoice] = useState<{ key: string; open: boolean } | null>(null);
  const mapOpen = mapChoice?.key === locationKey ? mapChoice.open : !isSpain && !isNextGuide;
  const openArtwork = () => {
    const navigation = { visitEntry: visitEntry(state) };
    // 직접 연 지도도 앞으로 오갈 수 있도록 이 기록이 가리키는 작품을 먼저 기록한다.
    if (!currentEntry && !returnToArtwork) {
      navigate(to('/route'), { replace: true, state: { ...entry, ...navigation } });
    }
    navigate(to('/artwork'), { replace: returnToArtwork, state: navigation });
  };
  const backToArtwork = () => (hasAppHistory() ? navigate(-1) : openArtwork());
  const back = () => {
    if (returnToArtwork) backToArtwork();
    else if (hasAppHistory()) navigate(-1);
    else navigate(to(isExhibitionOrder ? '' : '/recommend'), { replace: true });
  };

  if (askFinished) return <FinishedVisitPrompt key={locationKey} />;
  if (recommendations.length === 0) return <Navigate to={to('/recommend')} replace />;
  if (finished) return <Navigate to={to('/receipt')} replace />;
  if (pending) return null;

  if (data === 'unavailable') {
    const finish = () => {
      dispatch({ type: 'finishVisit', visitId: state.visitId, generation: state.requestGeneration });
      navigate(to('/receipt'), { replace: true });
    };
    return (
      <MobileShell screenId="U-09" title={title} back={back}>
        <div className="notice-card is-err notice-center screen-center" role="alert">
          <p className="notice-body">전시를 더 이상 관람할 수 없어요.</p>
          <button className="btn primary block" onClick={reload}>다시 시도하기</button>
          {!!viewed.length && <button className="btn ghost block" onClick={finish}>지금까지 관람으로 마치기</button>}
        </div>
      </MobileShell>
    );
  }

  if (error || loading || !data) {
    return (
      <MobileShell screenId="U-09" title={title} back={back}>
        {error ? (
          <div className="notice-card is-err notice-center screen-center" role="alert">
            <p className="notice-body">지도 정보를 불러오지 못했어요.{errorDetail(error)}</p>
            <button className="btn primary block" onClick={reload}>다시 시도하기</button>
            {isExhibitionOrder && <button className="btn ghost block" onClick={openArtwork}>작품 열기</button>}
          </div>
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
    const skip = () => {
      if (isExhibitionOrder && current + 1 === recommendations.length && !viewed.length) {
        dispatch({ type: 'resetVisit' });
        navigate(to(), { replace: true });
        return;
      }
      dispatch({ type: 'skipCurrent', visitId: state.visitId, generation: state.requestGeneration, artworkId: recommendations[current].artworkId });
      navigate(to(current + 1 === recommendations.length ? '/receipt' : '/route'), { replace: true, state: { visitEntry: visitEntry(state, current + 1) } });
    };
    return (
      <MobileShell screenId="U-09" title={title} back={back}>
        <div className="notice-card is-err notice-center screen-center" role="alert">
          <p className="notice-body">{isExhibitionOrder ? '이 작품을 현재 볼 수 없어요.' : '추천 작품 정보를 불러올 수 없어요.'}</p>
          <button className="btn primary block" onClick={reload}>다시 시도하기</button>
          <button className="btn ghost block" onClick={skip}>이 작품 건너뛰기</button>
        </div>
      </MobileShell>
    );
  }

  // 출발점: 현재 작품보다 앞 순서 중 실제로 본 마지막 작품(건너뛴 작품 제외). 되돌아와도 처음 본 경로와 같다.
  const previousId = recommendations.slice(0, current).reverse().find((r) => viewed.includes(r.artworkId))?.artworkId;
  const previous = previousId ? byId.get(previousId) : undefined;
  const from = previousId ? previous?.position : ex.entrance;
  const roomName = (w: Artwork) => ex.rooms.find((r) => r.id === w.roomId)?.name ?? '';
  const orderOf = (id: string) => recommendations.findIndex((r) => r.artworkId === id) + 1;

  const markers: MapMarker[] = recommendations.flatMap((r, i) => {
    const w = byId.get(r.artworkId);
    if (!w?.position || (i < current && !viewed.includes(r.artworkId))) return [];
    const markerState: MapMarker['state'] = i < current ? 'done' : i === current ? 'current' : focusId === w.id ? 'selected' : 'upcoming';
    return [{ id: w.id, label: String(i + 1), point: w.position, title: w.title, state: markerState }];
  });

  const focus = focusId ? byId.get(focusId) : null;
  const isFirst = current === 0 && !startedAt;
  const indoor = exhibitionIndoorLayout(ex);
  const verifiedSpainMap = !!(ex.floorPlan && ex.navigationLayout?.example === false && indoor);
  const locationLabel = (w: Artwork) => {
    const room = roomName(w);
    if (isSpain) return verifiedSpainMap && room ? room : '';
    if (w.position) return room || '전시실 미등록';
    return isExhibitionOrder && room ? `${room} · 지도 위치 미등록` : '위치 미등록';
  };
  const focusedMarkers = markers.filter((marker) => marker.id === previousId || marker.id === target.id);
  const isMapFixture = import.meta.env.VITE_GALAXY_MAP_FIXTURE === '1' && ex.id === GALAXY_MAP_EXHIBITION;
  const stops = recommendations.map((r) => byId.get(r.artworkId));
  const hasRouteLines = isSpain ? verifiedSpainMap : !!indoor || !isExhibitionOrder || isMapFixture;
  const baselineRoute = hasRouteLines && mapOpen && !indoor ? [ex.entrance, ...stops.flatMap((stop, i) => {
    if (i < current && !viewed.includes(recommendations[i].artworkId)) return [];
    if (!stop?.position) return [null];
    const prior = stops[i - 1];
    const start = i === 0 ? ex.entrance : prior?.position;
    return isMapFixture && start ? galaxyMapLeg(start, stop.position, prior?.roomId, stop.roomId).slice(1) : [stop.position];
  })] : undefined;
  const route = !isSpain && indoor && mapOpen ? indoorSequence(indoor, [ex.entrance, ...stops.flatMap((stop, i) => {
    if (i < current && !viewed.includes(recommendations[i].artworkId)) return [];
    return [stop?.position ?? null];
  })]) : baselineRoute;
  let activeLeg = null;
  if (hasRouteLines && from && target.position) {
    activeLeg = indoor ? indoorLeg(indoor, from, target.position)
      : isMapFixture ? galaxyMapLeg(from, target.position, previous?.roomId, target.roomId)
        : [from, target.position];
  }
  let routeNote = '선은 작품 위치를 이은 거예요. 실제 통로와 다를 수 있어요.';
  if (isMapFixture) routeNote = '검증용 도면이에요. 출입문과 복도를 따라 이동하는 예시입니다.';
  if (indoor) routeNote = activeLeg
    ? '도면에 등록된 이동 가능 구간이에요.'
    : '이어지는 통로를 확인할 수 없어요. 작품 번호와 전시실을 확인해 주세요.';
  else if (!hasRouteLines) routeNote = '번호는 감상 순서를 나타내요. 이동할 때는 전시실 안내를 따라가 주세요.';
  else if (!activeLeg) routeNote = '작품 위치 정보가 부족해 이번 구간을 표시할 수 없어요.';
  else if (!isMapFixture && route?.includes(null)) routeNote = '위치가 등록된 연속 구간만 이었어요. 실제 통로와 다를 수 있어요.';
  if (indoor?.example) {
    const exampleNote = '검수용 예시 배치예요. 실제 이동은 전시실 안내를 따라가 주세요.';
    routeNote = activeLeg ? exampleNote : `${exampleNote} ${routeNote}`;
  }
  const spainRouteNote = activeLeg ? '확인된 다음 작품까지의 구간이에요.'
    : '이동 경로는 현장 안내를 따라가 주세요.';
  const showMap = isSpain ? verifiedSpainMap && (!!activeLeg || mapOpen) : !isExhibitionOrder || !isNextGuide;
  const thumbnail = artworkImageSrc(target);

  const go = () => {
    if (returnToArtwork) {
      backToArtwork();
      return;
    }
    dispatch({ type: 'startVisit', exhibition: { id: ex.id, title: ex.title, venue: ex.venue } });
    openArtwork();
  };

  const mapCard = (
    <div className={`map-card route-map${isNextGuide ? ' route-map-next' : ''}`}>
      <p className="muted small route-note">{isSpain ? spainRouteNote : routeNote}</p>
      <FloorMap
        exhibition={ex}
        markers={mapOpen ? markers : focusedMarkers}
        route={route}
        activeLeg={activeLeg}
        showEntrance={mapOpen || !previousId}
        showCompletedNumbers={!mapOpen}
        aspect={0.95}
        onMarkerClick={mapOpen ? (id) => setFocusId((f) => f === id ? null : id) : undefined}
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
  );

  return (
    <MobileShell
      screenId="U-09"
      title={title}
      back={back}
      footer={
        <button className="btn primary block" onClick={go}>
          {returnToArtwork ? '감상으로 돌아가기' : isFirst ? '관람 시작하기' : `${current + 1}번 작품 감상하기`}
        </button>
      }
    >
      <div className="route-head">
        <span className="muted">
          {isExhibitionOrder ? '안내 작품' : '추천 작품'} {current + 1}/{recommendations.length}
        </span>
        <div className="progress-dots" aria-hidden="true">
          {recommendations.map((r, i) => (
            <span key={r.artworkId} className={i === current ? 'cur' : i < current && viewed.includes(r.artworkId) ? 'done' : ''} />
          ))}
        </div>
      </div>

      {/* 위쪽 박스는 다음 작품만 보여 준다(출발 작품 줄은 사용자 결정으로 뺌, 출발 위치는 지도 경로에 그대로 표시) */}
      <div className="next-card">
        <div className="next-artwork">
          {(!isSpain || (target.showImage && thumbnail)) && <ArtImage key={target.id} className="next-thumb" seed={target.id} palette={target.palette}
            imageUrl={thumbnail} alt="" ratio={1} fit="contain" />}
          <div className="next-artwork-info">
            <span className="eyebrow">{current > 0 ? '다음 · ' : ''}{current + 1}번 작품</span>
            <h2>{target.title}{target.year ? ` (${target.year})` : ''}</h2>
            {locationLabel(target) && <span className="muted small">{locationLabel(target)}</span>}
          </div>
        </div>
      </div>

      {showMap && mapCard}
      {isSpain && !showMap && <p className="muted small route-note">{spainRouteNote}</p>}
      <details className="route-details" open={mapOpen}
        onToggle={(event) => setMapChoice({ key: locationKey, open: event.currentTarget.open })}>
        <summary>{isSpain && !verifiedSpainMap ? '전체 관람 순서' : '전체 지도와 관람 순서'}</summary>
        {!isSpain && isExhibitionOrder && isNextGuide && mapOpen && mapCard}
        <ol className="route-list">
          {recommendations.map((r, i) => {
            const w = byId.get(r.artworkId);
            // 되돌아온 작품은 이미 본 작품이어도 '현재 작품'으로 먼저 표시한다.
            // 현재 작품보다 앞 순서만 완료(✓)로 표시한다. 뒤로가기로 돌아왔을 때 뒤 순서는 이미 봤어도 번호로 둔다(지도 표시와 같게).
            const completed = i < current && viewed.includes(r.artworkId);
            return (
              <li key={r.artworkId} aria-current={i === current ? 'step' : undefined} className={completed ? 'done' : i === current ? 'cur' : ''}>
                <span className="route-num" aria-hidden="true">{completed ? '✓' : i + 1}</span>
                {completed && <span className="sr-only">감상 완료</span>}
                <span className="route-title">{w ? `${w.title}${w.year ? `(${w.year})` : ''}` : '작품 정보 없음'}</span>
                <span className="muted small">{i < current && !completed ? '건너뜀' : w ? locationLabel(w) : ''}</span>
              </li>
            );
          })}
        </ol>
      </details>
    </MobileShell>
  );
}
