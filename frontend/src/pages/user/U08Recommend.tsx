/** U-08 개인화 작품 추천 — 취향+시간 기반 추천 목록과 추천 이유 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { api } from '../../api/client';
import { countForDuration } from '../../lib/recommend';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import { TASTE_LABEL } from '../../data/mock';
import type { Artwork } from '../../types';

type RecommendationIssue = { kind: 'empty' } | { kind: 'error'; message: string };

/** 취향·시간에 따른 추천 작품을 확인하는 화면 */
export default function U08Recommend() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { tastes, duration, recommendations } = state;
  const [issue, setIssue] = useState<RecommendationIssue | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { data: artworks, error: artworkError, reload: reloadArtworks } = useAsync(() => api.listArtworks(exhibitionId), [exhibitionId]);
  // 태그별로 이 전시에서 추천할 수 있는 작품 수 — 고른 취향 중 0점인 태그는 안내만 한다 (다른 태그로 바꿔 넣지 않음)
  const { data: coverage, error: coverageError, reload: reloadCoverage } = useAsync(() => api.tagCoverage(exhibitionId), [exhibitionId]);
  const missing = coverage ? tastes.filter((t) => !coverage[t]) : [];

  // 추천 목록이 비어 있을 때만 요청 (U-09에서 뒤로 돌아온 경우 진행 상태 유지)
  const needFetch = recommendations.length === 0;
  useEffect(() => {
    if (!needFetch || !duration) return;
    setIssue(null);
    let cancelled = false;
    api
      .recommend(exhibitionId, tastes, duration, state.tasteProfile)
      .then((recs) => {
        if (cancelled) return;
        if (recs.length === 0) setIssue({ kind: 'empty' });
        else dispatch({ type: 'setRecommendations', recs, generation: state.requestGeneration });
      })
      .catch((e: Error) => !cancelled && setIssue({ kind: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [needFetch, exhibitionId, tastes, duration, dispatch, state.tasteProfile, state.requestGeneration, attempt]);

  if (!duration) return <Navigate to={to('/time')} replace />;

  const byId = new Map<string, Artwork>((artworks ?? []).map((w) => [w.id, w]));
  const ready = recommendations.length > 0 && artworks;
  const requestedCount = countForDuration(duration);
  const retry = () => {
    setAttempt((n) => n + 1);
    reloadArtworks();
    reloadCoverage();
  };
  let title = '오늘은 이 작품들을 만나보세요';
  let desc = '추천 작품을 고르고 있어요…';
  if (ready) {
    desc = `오늘의 관람 작품은 ${recommendations.length}점이에요.`;
  } else if (issue?.kind === 'empty') {
    title = '지금 추천할 수 있는 작품이 없어요';
    desc = '공개된 작품과 위치 정보가 준비되면 추천을 받을 수 있어요.';
  } else if (issue || artworkError) {
    title = '추천 작품을 표시할 수 없어요';
    desc = '다시 불러오면 선택한 취향과 관람 시간을 그대로 사용할 수 있어요.';
  }

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
      <Lead title={title} desc={desc} />
      {missing.length > 0 && (
        <p className="missing-note" role="note">
          현재 추천 가능한 작품 중 {missing.map((t) => `「${TASTE_LABEL[t]}」`).join(' · ')} 태그 후보가 없어요. 미검수·위치 미등록·태그 준비 여부에 따라 달라질 수 있어요.
        </p>
      )}
      {artworkError && <p className="error-text" role="alert">작품 목록을 불러오지 못했어요. {artworkError}<button onClick={reloadArtworks}>작품 목록 다시 불러오기</button></p>}
      {coverageError && <p className="error-text" role="alert">태그별 추천 후보 수를 확인하지 못했어요.<button onClick={reloadCoverage}>후보 수 다시 확인</button></p>}
      {issue && (
        <div className="stack gap-12">
          {issue.kind === 'error' && <p className="error-text" role="alert">{issue.message}</p>}
          <button className="btn ghost" onClick={retry}>다시 시도</button>
          {issue.kind === 'error' && <button className="text-btn" onClick={() => navigate(to('/taste'))}>취향 다시 선택</button>}
        </div>
      )}
      {ready && recommendations.length < requestedCount && <p>선택한 시간의 기준은 {requestedCount}점이에요. 지금 추천할 수 있는 작품만 안내해요.</p>}
      {!ready && !issue && !artworkError && <Spinner label="추천 작품을 불러오는 중…" />}

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
                  <span className={r.matchedTags.length ? 'chip accent sm' : 'muted small'}>
                    {r.matchedTags.length ? r.reason : '선택한 취향 태그와 일치하는 항목 없음'}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </MobileShell>
  );
}
