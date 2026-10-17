/** U-08 개인화 작품 추천 — 취향+시간 기반 추천 목록과 추천 이유 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage } from '../../components/ArtImage';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import type { Artwork } from '../../types';

export default function U08Recommend() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const { exhibitionId, tastes, duration, recommendations } = state;
  const [error, setError] = useState<string | null>(null);
  const { data: artworks } = useAsync(() => api.listArtworks(exhibitionId), [exhibitionId]);

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

  if (!duration) return <Navigate to="/time" replace />;

  const byId = new Map<string, Artwork>((artworks ?? []).map((w) => [w.id, w]));
  const ready = recommendations.length > 0 && artworks;

  return (
    <MobileShell
      screenId="U-08"
      title="추천 작품"
      back="/time"
      footer={
        <button className="btn primary block" disabled={!ready} onClick={() => navigate('/route')}>
          2D 지도에서 경로 보기
        </button>
      }
    >
      <Lead
        title="오늘은 이 작품들을 만나보세요"
        desc={ready ? `취향과 관람 시간을 바탕으로 ${recommendations.length}개 작품을 골랐습니다.` : '추천 작품을 고르고 있어요…'}
      />
      {error && <p className="error-text">{error}</p>}
      {!ready && !error && <Spinner label="취향에 맞는 작품을 찾는 중…" />}

      {ready && (
        <ol className="rec-list">
          {recommendations.map((r) => {
            const w = byId.get(r.artworkId);
            if (!w) return null;
            return (
              <li key={r.artworkId} className="rec-card">
                <ArtImage className="rec-thumb" seed={w.id} palette={w.palette} imageUrl={w.imageUrl} alt={w.title} ratio={1.1} />
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
