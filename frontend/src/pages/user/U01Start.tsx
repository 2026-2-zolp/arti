/**
 * U-01 서비스 시작 — 전시 입구 QR / 전시 URL 진입 화면
 * - 전시 URL(/exhibitions/:exhibitionId, 입구 QR)로 들어오면 그 전시로 바로 시작
 * - 루트(/)로 들어오면 진행 중인 전시 목록에서 고른다 (시연·테스트 때 주소를 바꾸지 않아도 되게)
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { DEFAULT_EXHIBITION_ID, useVisit } from '../../store/VisitContext';

export default function U01Start() {
  const { exhibitionId: fromUrl } = useParams();
  const { state, dispatch } = useVisit();
  const navigate = useNavigate();
  // 루트로 들어오면 지난번에 고른 전시를 먼저 고른 상태로 보여 준다
  const [picked, setPicked] = useState(state.exhibitionId || DEFAULT_EXHIBITION_ID);
  const exhibitionId = fromUrl ?? picked;
  const { data: all } = useAsync(() => (fromUrl ? Promise.resolve([]) : api.listExhibitions()), [fromUrl]);
  const running = (all ?? []).filter((e) => e.status === 'running');
  const { data: ex, loading, error } = useAsync(() => api.getExhibition(exhibitionId), [exhibitionId]);

  // 고른 전시가 목록에 없으면(종료·삭제) 첫 번째 진행 중 전시로
  useEffect(() => {
    if (!fromUrl && running.length && !running.some((e) => e.id === picked)) setPicked(running[0].id);
  }, [fromUrl, running, picked]);

  useEffect(() => {
    dispatch({ type: 'setExhibition', id: exhibitionId });
  }, [exhibitionId, dispatch]);

  return (
    <MobileShell
      screenId="U-01"
      title={<span className="brand">ARTI</span>}
      right={
        state.user ? (
          <Link className="text-btn" to="/history">
            내 기록
          </Link>
        ) : null
      }
      footer={
        <>
          <button className="btn primary block" disabled={!ex} onClick={() => navigate('/entry')}>
            관람 시작하기
          </button>
          <p className="footnote">입구 QR 또는 전시 URL로 접속</p>
        </>
      }
    >
      <div className="lead center">
        <h2>나만의 시선으로 만나는 미술관</h2>
        <p>AI가 추천하고, 작품을 보는 방법까지 안내합니다.</p>
      </div>

      <GalleryIllustration />

      {loading && <Spinner />}
      {error && <p className="error-text">{error}</p>}
      {!fromUrl && running.length > 1 ? (
        <div className="ex-picker" role="radiogroup" aria-label="관람할 전시">
          <span className="eyebrow">관람할 전시를 골라 주세요</span>
          {running.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={e.id === exhibitionId}
              className={`ex-option ${e.id === exhibitionId ? 'on' : ''}`}
              onClick={() => setPicked(e.id)}
            >
              <strong>{e.title}</strong>
              <span className="muted small">
                {e.venue} · {e.startDate.replaceAll('-', '.')} – {e.endDate.replaceAll('-', '.')}
              </span>
            </button>
          ))}
        </div>
      ) : (
        ex && (
          <div className="current-ex">
            <span className="eyebrow">현재 전시</span>
            <strong>{ex.title}</strong>
            <span className="muted small">
              {ex.venue} · {ex.startDate.replaceAll('-', '.')} – {ex.endDate.replaceAll('-', '.')}
            </span>
            {fromUrl && (
              <Link className="text-btn ex-change" to="/">
                다른 전시 보기
              </Link>
            )}
          </div>
        )
      )}
    </MobileShell>
  );
}

/** 목업의 "전시장에 선 사람" 일러스트를 SVG로 재현 */
function GalleryIllustration() {
  return (
    <svg className="hero-illust" viewBox="0 0 320 240" role="img" aria-label="작품 앞에 선 관람객 일러스트">
      <rect width="320" height="240" rx="18" fill="var(--surface-2)" />
      <rect x="26" y="48" width="84" height="88" fill="#DCD0C0" stroke="var(--ink)" strokeWidth="4" />
      <rect x="186" y="30" width="94" height="92" fill="#CED9E5" stroke="var(--ink)" strokeWidth="4" />
      <circle cx="138" cy="122" r="11" fill="var(--ink)" />
      <rect x="131" y="132" width="14" height="56" fill="var(--ink)" />
      <line x1="4" y1="210" x2="316" y2="210" stroke="#CBC5BC" strokeWidth="2" />
    </svg>
  );
}
