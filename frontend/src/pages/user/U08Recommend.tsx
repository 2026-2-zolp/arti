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

export default function U08Recommend() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { tastes, duration, recommendations } = state;
  const [error, setError] = useState<string | null>(null);
  const { data: artworks } = useAsync(() => api.listArtworks(exhibitionId), [exhibitionId]);
  // 태그별로 이 전시에서 추천할 수 있는 작품 수 — 고른 취향 중 0점인 태그는 안내만 한다 (다른 태그로 바꿔 넣지 않음)
  const { data: coverage } = useAsync(() => api.tagCoverage(exhibitionId), [exhibitionId]);
  const missing = coverage ? tastes.filter((t) => !coverage[t]) : [];

  // 추천 목록이 비어 있을 때만 요청 (U-09에서 뒤로 돌아온 경우 진행 상태 유지)
  const needFetch = recommendations.length === 0;
  useEffect(() => {
    if (!needFetch || !duration || tastes.length === 0) return;
    let cancelled = false;
    api
      .recommend(exhibitionId, tastes, duration)
      .then((recs) => {
        if (cancelled) return;
        if (recs.length === 0) setError('지금 추천할 수 있는 작품이 없어요. 전시 데이터를 확인해 주세요.');
        else dispatch({ type: 'setRecommendations', recs });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [needFetch, exhibitionId, tastes, duration, dispatch]);

  if (!duration) return <Navigate to={to('/time')} replace />;

  // 취향 태그가 없으면 추천을 요청하지 않으므로, 계속 기다리게 두지 않고 안내한다
  if (tastes.length === 0 && needFetch) {
    return (
      <MobileShell screenId="U-08" title="추천 작품" back={to('/time')}>
        <Lead title="취향 태그가 없어요" desc="고른 작품에서 취향 태그를 만들지 못해 추천할 수 없어요." />
        <button className="btn primary block mt-24" onClick={() => navigate(to('/taste'))}>
          취향 다시 고르기
        </button>
      </MobileShell>
    );
  }

  const byId = new Map<string, Artwork>((artworks ?? []).map((w) => [w.id, w]));
  const ready = recommendations.length > 0 && artworks;

  return (
    <MobileShell
      screenId="U-08"
      title="추천 작품"
      back={to('/time')}
      footer={
        <button className="btn primary block" disabled={!ready} onClick={() => navigate(to('/route'))}>
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
          이 전시에는 {missing.map((t) => `「${TASTE_LABEL[t]}」`).join(' · ')} 작품이 없어요.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      {!ready && !error && <Spinner label="취향에 맞는 작품을 찾는 중…" />}

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
