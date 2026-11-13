/** U-08 개인화 작품 추천 — 취향+시간 기반 추천 목록과 추천 이유 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import { TASTE_LABEL } from '../../data/mock';
import type { Artwork } from '../../types';

/** 취향·시간에 따른 추천 작품을 확인하는 화면 */
export default function U08Recommend() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { tastes, duration, recommendations } = state;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { data: artworks, error: artworkError, reload: reloadArtworks } = useAsync(() => api.listArtworks(exhibitionId), [exhibitionId]);
  // 태그별로 이 전시에서 추천할 수 있는 작품 수 — 고른 취향 중 0점인 태그는 안내만 한다 (다른 태그로 바꿔 넣지 않음)
  const { data: coverage, error: coverageError, reload: reloadCoverage } = useAsync(() => api.tagCoverage(exhibitionId), [exhibitionId]);
  const missing = coverage ? tastes.filter((t) => !coverage[t]) : [];

  // 추천 목록이 비어 있을 때만 요청 (U-09에서 뒤로 돌아온 경우 진행 상태 유지)
  const needFetch = recommendations.length === 0;
  useEffect(() => {
    if (!needFetch || !duration) return;
    setError(null);
    let cancelled = false;
    api
      .recommend(exhibitionId, tastes, duration, state.tasteProfile)
      .then((recs) => {
        if (cancelled) return;
        if (recs.length === 0) setError('지금 추천할 수 있는 태그 후보가 없어요. 미검수·위치 미등록·태그 준비 여부에 따라 달라질 수 있어요. 전시 데이터를 확인해 주세요.');
        else dispatch({ type: 'setRecommendations', recs, generation: state.requestGeneration });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [needFetch, exhibitionId, tastes, duration, dispatch, state.tasteProfile, state.requestGeneration, attempt]);

  if (!duration) return <Navigate to={to('/time')} replace />;

  const byId = new Map<string, Artwork>((artworks ?? []).map((w) => [w.id, w]));
  const ready = recommendations.length > 0 && artworks;

  return (
    <MobileShell
      screenId="U-08"
      back={to('/time')}
      footer={
        <button className="btn primary block" disabled={!ready} onClick={() => navigate(to('/route'), { state: { fromRecommend: true } })}>
          2D 지도에서 경로 보기
        </button>
      }
    >
      <Lead
        title="오늘은 이 작품들을 만나보세요"
        desc={ready ? `취향과 관람 시간을 바탕으로 ${recommendations.length}개 작품을 골랐습니다.` : '추천 작품을 고르고 있어요…'}
      />
      {missing.length > 0 && (
        <p className="missing-note" role="note">
          현재 추천 가능한 작품 중 {missing.map((t) => `「${TASTE_LABEL[t]}」`).join(' · ')} 태그 후보가 없어요. 미검수·위치 미등록·태그 준비 여부에 따라 달라질 수 있어요.
        </p>
      )}
      {artworkError && <p className="error-text" role="alert">작품 목록을 불러오지 못했어요. {artworkError}<button onClick={reloadArtworks}>작품 목록 다시 불러오기</button></p>}
      {coverageError && <p className="error-text" role="alert">태그별 추천 후보 수를 확인하지 못했어요.<button onClick={reloadCoverage}>후보 수 다시 확인</button></p>}
      {error && <p className="error-text" role="alert">{error}<button onClick={() => setAttempt(n => n + 1)}>다시 시도</button><button onClick={() => navigate(to('/taste'))}>취향 다시 선택</button></p>}
      {ready && recommendations.length < (duration === '30m' ? 3 : duration === '60m' ? 5 : 7) && <p>준비된 추천 후보가 적어 가능한 작품만 안내해요.</p>}
      {!ready && !error && !artworkError && <Spinner label="취향에 맞는 작품을 찾는 중…" />}

      {ready && (
        <ol className="rec-list">
          {recommendations.map((r) => {
            const w = byId.get(r.artworkId);
            if (!w) return null;
            return (
              <li key={r.artworkId} className="rec-card">
                <ArtImage className="rec-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={1.1} />
                <div className="rec-info">
                  <strong>
                    {r.order}. {w.title}
                  </strong>
                  <span className="muted small">
                    {w.artist} · {w.year}
                  </span>
                  <span className="chip accent sm">{r.reason}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </MobileShell>
  );
}
