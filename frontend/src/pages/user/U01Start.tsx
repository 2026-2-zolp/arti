/** U-01 서비스 시작 — 전시 입구 QR / 전시 URL 진입 화면 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { DEFAULT_EXHIBITION_ID, useVisit } from '../../store/VisitContext';

export default function U01Start() {
  // 전시 URL(/exhibitions/:exhibitionId)로 들어오면 그 전시로, 루트(/)로 들어오면 기본 전시로 시작
  const { exhibitionId = DEFAULT_EXHIBITION_ID } = useParams();
  const { state, dispatch } = useVisit();
  const navigate = useNavigate();
  const { data: ex, loading, error } = useAsync(() => api.getExhibition(exhibitionId), [exhibitionId]);

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
      {ex && (
        <div className="current-ex">
          <span className="eyebrow">현재 전시</span>
          <strong>{ex.title}</strong>
          <span className="muted small">
            {ex.venue} · {ex.startDate.replaceAll('-', '.')} – {ex.endDate.replaceAll('-', '.')}
          </span>
        </div>
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
