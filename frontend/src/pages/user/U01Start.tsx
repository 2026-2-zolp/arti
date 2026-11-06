/**
 * U-01 서비스 시작
 * - /                            : 전시 ID 없이 들어온 경우 → 진행 중인 전시 목록에서 고른다
 * - /exhibitions/:exhibitionId   : 전시 입구 QR / 전시 URL 진입 → 그 전시로 관람 시작
 *   같은 전시를 감상하던 중(startedAt 있음)에 돌아오면 이어서 볼지 새로 시작할지 묻고,
 *   그 밖에는 들어오는 순간 이전 관람 진행 상태를 비운다.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import { exhibitionPath, useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Exhibition } from '../../types';

export default function U01Start() {
  const { exhibitionId } = useParams();
  return exhibitionId ? <ExhibitionStart exhibitionId={exhibitionId} /> : <ExhibitionPicker />;
}

/** 두 모드가 같이 쓰는 틀: 헤더(마이페이지) + 소개 문구 + 일러스트 */
function StartShell({ footer, children }: { footer?: ReactNode; children: ReactNode }) {
  const { state } = useVisit();
  return (
    <MobileShell
      screenId="U-01"
      title={<span className="brand">ARTI</span>}
      right={
        state.user ? (
          <Link className="text-btn" to="/mypage">
            마이페이지
          </Link>
        ) : null
      }
      footer={footer}
    >
      <div className="lead center">
        <h2>나만의 시선으로 만나는 미술관</h2>
        <p>AI가 추천하고, 작품을 보는 방법까지 안내합니다.</p>
      </div>

      <GalleryIllustration />
      {children}
    </MobileShell>
  );
}

const period = (ex: Exhibition) => `${ex.startDate.replaceAll('-', '.')} – ${ex.endDate.replaceAll('-', '.')}`;

function ExhibitionStart({ exhibitionId }: { exhibitionId: string }) {
  const { state, dispatch } = useVisit();
  const navigate = useNavigate();
  const to = useExhibitionPath();
  const { data: ex, loading, error } = useAsync(() => api.getExhibition(exhibitionId), [exhibitionId]);

  // 화면에 들어온 시점 기준으로 판단 (ExhibitionLayout이 전시를 맞춘 뒤라 같은 전시의 관람이다)
  const [resumable] = useState(() => state.startedAt !== null);
  useEffect(() => {
    if (!resumable) dispatch({ type: 'resetVisit' });
  }, [resumable, dispatch]);

  const restart = () => {
    dispatch({ type: 'resetVisit' });
    navigate(to('/entry'));
  };

  return (
    <StartShell
      footer={
        resumable ? (
          <div className="stack gap-10">
            <button className="btn primary block" onClick={() => navigate(to('/route'))}>
              이어서 관람
            </button>
            <button className="btn outline block" onClick={restart}>
              새로 시작
            </button>
          </div>
        ) : (
          <>
            <button className="btn primary block" disabled={!ex} onClick={() => navigate(to('/entry'))}>
              관람 시작하기
            </button>
            <p className="footnote">입구 QR 또는 전시 URL로 접속</p>
          </>
        )
      }
    >
      {loading && <Spinner />}
      {error && <p className="error-text">{error}</p>}
      {ex && (
        <div className="current-ex">
          <span className="eyebrow">현재 전시</span>
          <strong>{ex.title}</strong>
          <span className="muted small">
            {ex.venue} · {period(ex)}
          </span>
        </div>
      )}
      {resumable && (
        <div className="resume-card">
          <strong>진행 중인 관람이 있어요</strong>
          <span className="muted small">
            추천 작품 {state.recommendations.length}점 중 {state.viewed.length}점 감상
          </span>
        </div>
      )}
    </StartShell>
  );
}

function ExhibitionPicker() {
  const { data, loading, error } = useAsync(() => api.listExhibitions(), []);
  const running = (data ?? []).filter((ex) => ex.status === 'running');

  return (
    <StartShell footer={<p className="footnote">전시장 입구의 QR로 접속하면 바로 시작할 수 있어요</p>}>
      <span className="eyebrow ex-list-head">진행 중인 전시</span>
      {loading && <Spinner />}
      {error && <p className="error-text">{error}</p>}
      {data && running.length === 0 && <p className="muted center">지금 진행 중인 전시가 없어요.</p>}
      <ul className="history-list">
        {running.map((ex) => (
          <li key={ex.id}>
            <Link className="history-card" to={exhibitionPath(ex.id)}>
              <div className="history-top">
                <span className="muted small">
                  <Icon name="pin" size={15} /> {ex.venue}
                </span>
                <span className="muted small">{period(ex)}</span>
              </div>
              <strong>{ex.title}</strong>
              <span className="history-cta">
                이 전시 관람하기 <Icon name="chevron" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </StartShell>
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
