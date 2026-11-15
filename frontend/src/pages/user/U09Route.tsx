/**
 * U-09 추천 관람 경로 (2D 지도)
 * - 최초 진입: "관람 시작하기" → U-10
 * - 작품 감상 후 "다음 작품 안내"로 다시 들어오면 같은 화면을 재사용해 다음 작품 위치를 보여 준다.
 * 실시간 실내 내비게이션이 아니라 위치와 순서를 시각적으로 안내하는 수준.
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { FinishedVisitPrompt } from '../../components/FinishedVisitPrompt';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { api } from '../../api/client';
import { GALAXY_MAP_EXHIBITION, galaxyMapLeg } from '../../lib/galaxyMapFixture';
import { useAsync } from '../../lib/useAsync';
import { errorDetail } from '../../lib/errorText';
import { hasAppHistory } from '../../lib/appHistory';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Artwork } from '../../types';

/** 추천 작품의 위치·방문 순서를 안내하는 화면 */
export default function U09Route() {
  const navigate = useNavigate();
  const { state: entry, key: locationKey } = useLocation();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { recommendations, current, viewed, startedAt } = state;
  const [focusId, setFocusId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]),
    [exhibitionId],
  );
  const returnToArtwork = entry?.returnToArtwork === true;
  const fromRecommend = entry?.fromRecommend === true;
  const isNextGuide = current > 0 && !returnToArtwork && entry?.showMap !== true;
  const [mapOpen, setMapOpen] = useState(!isNextGuide);
  // 경로 → 작품은 기록을 쌓는다(앱 ←·휴대폰 뒤로가기 모두 이 경로로 돌아옴).
  // 작품에서 연 지도를 주소로 바로 열었을 때(돌아갈 기록 없음)만 작품으로 덮어쓴다.
  const openArtwork = () => navigate(to('/artwork'), {
    replace: returnToArtwork,
    state: { fromRecommend, visitStep: current },
  });
  // 작품에서 연 지도는 작품 위에 쌓인 기록이라, 돌아갈 때는 꺼내서(휴대폰 뒤로가기와 같음) 작품으로 간다.
  const backToArtwork = () => (hasAppHistory() ? navigate(-1) : openArtwork());
  const back = () => {
    if (returnToArtwork) backToArtwork();
    else if (hasAppHistory()) navigate(-1);
    else navigate(to('/recommend'), { replace: true });
  };

  // 뒤로가기로 지나온 구간(이 경로가 가리키던 작품)에 돌아오면 그 작품을 다시 현재 작품으로 둔다.
  const visitStep: number | undefined = typeof entry?.visitStep === 'number' ? entry.visitStep : undefined;
  const finished = recommendations.length > 0 && current >= recommendations.length;
  // 도착한 순간에 한 번만 판단한다. 이 화면에서 [다음]·[건너뛰기]로 현재 작품이 바뀌는 동안에는 되돌리지 않는다.
  const arrivalChecked = useRef<string | null>(null);
  const pendingRewind = arrivalChecked.current !== locationKey && !finished && visitStep !== undefined && visitStep < current;
  // 끝난 관람에 뒤로가기로 도착했다는 판단은 그 기록에 있는 동안 고정한다(데이터를 불러와 다시 그려져도 질문 화면 유지).
  const finishedArrival = useRef<string | null>(null);
  if (arrivalChecked.current !== locationKey && finished && visitStep !== undefined) finishedArrival.current = locationKey;
  const askFinished = finishedArrival.current === locationKey;
  useEffect(() => {
    if (arrivalChecked.current === locationKey) return;
    arrivalChecked.current = locationKey;
    if (finished || visitStep === undefined || visitStep >= current) return;
    dispatch({ type: 'rewindTo', visitId: state.visitId, generation: state.requestGeneration, index: visitStep });
  }, [locationKey, finished, visitStep, current, state.visitId, state.requestGeneration, dispatch]);

  // 끝난 관람 질문은 다른 이동보다 먼저 둔다([나가기]로 관람 상태가 지워지는 동안 추천·취향 화면으로 끌려가지 않게).
  if (askFinished) return <FinishedVisitPrompt />;
  if (recommendations.length === 0) return <Navigate to={to('/recommend')} replace />;
  // 영수증에서 휴대폰 뒤로가기로 돌아온 경우(영수증에서 미리 묻지 못하는 브라우저)는 끝난 관람을 다시 열지 않고 여기서 종료 여부를 묻는다.
  if (finished) return <Navigate to={to('/receipt')} replace />;
  if (pendingRewind) return null;

  if (error || loading || !data) {
    return (
      <MobileShell screenId="U-09" title="추천 관람 경로" back={back}>
        {error ? (
          <div className="notice-card is-err notice-center screen-center" role="alert">
            <p className="notice-body">지도 정보를 불러오지 못했어요.{errorDetail(error)}</p>
            <button className="btn primary block" onClick={reload}>다시 시도하기</button>
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
      dispatch({ type: 'skipCurrent', visitId: state.visitId, generation: state.requestGeneration, artworkId: recommendations[current].artworkId });
      navigate(to(current + 1 === recommendations.length ? '/receipt' : '/route'), { replace: true, state: { fromRecommend } });
    };
    return (
      <MobileShell screenId="U-09" title="추천 관람 경로" back={back}>
        <div className="notice-card is-err notice-center screen-center" role="alert">
          <p className="notice-body">추천 작품 정보를 불러올 수 없어요.</p>
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
  const locationLabel = (w: Artwork) => w.position ? roomName(w) || '전시실 미등록' : '위치 미등록';
  const focusedMarkers = markers.filter((marker) => marker.id === previousId || marker.id === target.id);
  const isMapFixture = import.meta.env.VITE_GALAXY_MAP_FIXTURE === '1' && ex.id === GALAXY_MAP_EXHIBITION;
  const stops = recommendations.map((r) => byId.get(r.artworkId));
  const route = mapOpen ? [ex.entrance, ...stops.flatMap((stop, i) => {
    if (i < current && !viewed.includes(recommendations[i].artworkId)) return [];
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
    if (returnToArtwork) {
      backToArtwork();
      return;
    }
    dispatch({ type: 'startVisit' });
    openArtwork();
  };

  return (
    <MobileShell
      screenId="U-09"
      title={isNextGuide ? '다음 작품 안내' : '추천 관람 경로'}
      back={back}
      footer={
        <button className="btn primary block" onClick={go}>
          {returnToArtwork ? '감상으로 돌아가기' : isFirst ? '관람 시작하기' : `${current + 1}번 작품 감상하기`}
        </button>
      }
    >
      <div className="route-head">
        <span className="muted">
          추천 작품 {current + 1}/{recommendations.length}
        </span>
        <div className="progress-dots" aria-hidden="true">
          {recommendations.map((r, i) => (
            <span key={r.artworkId} className={i === current ? 'cur' : viewed.includes(r.artworkId) ? 'done' : ''} />
          ))}
        </div>
      </div>

      {/* 위쪽 박스는 다음 작품만 보여 준다(출발 작품 줄은 사용자 결정으로 뺌, 출발 위치는 지도 경로에 그대로 표시) */}
      <div className="next-card">
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
          showEntrance={mapOpen || !previousId}
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
            // 되돌아온 작품은 이미 본 작품이어도 '현재 작품'으로 먼저 표시한다.
            const completed = i !== current && viewed.includes(r.artworkId);
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
