/**
 * U-12 아트 영수증
 * - /receipt          : 방금 끝난 관람 결과 (로그인 사용자는 관람기록에 저장)
 * - /receipt/:visitId : U-13 관람기록에서 들어온 과거 기록 조회 모드
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { load, save } from '../../lib/storage';
import { TASTE_LABEL } from '../../data/mock';
import { useVisit, type VisitState } from '../../store/VisitContext';
import type { Artwork, TasteTag, VisitRecord } from '../../types';

export default function U12Receipt() {
  const { visitId } = useParams();
  return visitId ? <HistoryReceipt visitId={visitId} /> : <LiveReceipt />;
}

/** 현재 세션 상태로 영수증 데이터 만들기 */
function buildRecord(s: VisitState, artworks: Artwork[], exTitle: string, venue: string): Omit<VisitRecord, 'id'> {
  const byId = new Map(artworks.map((w) => [w.id, w]));
  const longest = Object.entries(s.dwell).sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.viewed[0] ?? null;

  // 취향 키워드: 선택한 취향 + 👍 누른 작품의 특성
  const liked = Object.entries(s.reactions)
    .filter(([, r]) => r === 'like')
    .flatMap(([id]) => byId.get(id)?.tags ?? []);
  const tags = [...new Set<TasteTag>([...s.tastes, ...liked])].slice(0, 4);

  return {
    userId: s.user?.id ?? null,
    exhibitionId: s.exhibitionId,
    exhibitionTitle: exTitle,
    venue,
    date: new Date().toISOString(),
    durationMin: s.startedAt ? Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)) : 0,
    viewedArtworkIds: s.viewed,
    recommendedCount: s.recommendations.length,
    reactions: s.reactions,
    longestViewedArtworkId: longest,
    keywords: tags.map((t) => TASTE_LABEL[t]),
  };
}

function LiveReceipt() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const { data } = useAsync(
    () => Promise.all([api.getExhibition(state.exhibitionId), api.listArtworks(state.exhibitionId)]),
    [state.exhibitionId],
  );

  const record = useMemo(
    () => (data ? buildRecord(state, data[1], data[0].title, data[0].venue) : null),
    // 영수증은 화면에 처음 들어온 시점 기준으로 고정
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  // 로그인 사용자: 관람기록에 한 번만 저장 (새로고침해도 중복 저장 방지)
  useEffect(() => {
    if (!record || !state.user || !state.startedAt) return;
    const flag = `arti.receipt.saved.${state.startedAt}`;
    if (load(flag, false, 'session')) {
      setSavedNote('관람기록에 저장되었어요.');
      return;
    }
    save(flag, true, 'session');
    api.saveVisit(record).then(() => setSavedNote('관람기록에 저장되었어요.'));
  }, [record, state.user, state.startedAt]);

  if (state.recommendations.length === 0) return <Navigate to="/" replace />;

  const finish = () => {
    dispatch({ type: 'resetVisit' });
    navigate('/', { replace: true });
  };

  return (
    <MobileShell
      screenId="U-12"
      title="아트 영수증"
      footer={
        <button className="btn primary block" onClick={finish}>
          관람 완료
        </button>
      }
    >
      <div className="lead center">
        <h2>오늘의 관람이 완성됐어요</h2>
        {record && (
          <p>
            {formatDate(record.date)} · 관람 {record.durationMin}분
          </p>
        )}
      </div>
      {!record || !data ? (
        <Spinner />
      ) : (
        <>
          <Receipt record={record} artworks={data[1]} />
          {state.user ? (
            <p className="center muted small mt-12">{savedNote ?? '저장 중…'}</p>
          ) : (
            <p className="center muted small mt-12">
              로그인하면 다음에도 이 영수증을 다시 볼 수 있어요.
            </p>
          )}
        </>
      )}
    </MobileShell>
  );
}

function HistoryReceipt({ visitId }: { visitId: string }) {
  const navigate = useNavigate();
  const { state } = useVisit();
  const { data, loading, error } = useAsync(
    () => Promise.all([api.getVisit(visitId), api.listArtworks()]),
    [visitId],
  );

  if (!state.user) return <Navigate to={`/login?redirect=/receipt/${visitId}`} replace />;

  return (
    <MobileShell
      screenId="U-12"
      title="아트 영수증"
      back="/history"
      footer={
        <button className="btn outline block" onClick={() => navigate('/history')}>
          관람기록으로
        </button>
      }
    >
      {loading && <Spinner />}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="lead center">
            <h2>{data[0].exhibitionTitle}</h2>
            <p>
              {formatDate(data[0].date)} · 관람 {data[0].durationMin}분
            </p>
          </div>
          <Receipt record={data[0]} artworks={data[1]} />
        </>
      )}
    </MobileShell>
  );
}

function Receipt({ record, artworks }: { record: Omit<VisitRecord, 'id'>; artworks: Artwork[] }) {
  const title = (id: string | null) => artworks.find((w) => w.id === id)?.title ?? '-';
  const likes = Object.values(record.reactions).filter((r) => r === 'like').length;

  return (
    <article className="receipt" aria-label="아트 영수증">
      <h3 className="receipt-head">ART RECEIPT</h3>
      <dl className="receipt-rows">
        <div>
          <dt>관람 작품</dt>
          <dd>{record.viewedArtworkIds.length}점</dd>
        </div>
        <div>
          <dt>추천 작품</dt>
          <dd>{record.recommendedCount}점</dd>
        </div>
        <div>
          <dt>선호 표시</dt>
          <dd>{likes}회</dd>
        </div>
        <div>
          <dt>가장 오래 본 작품</dt>
          <dd>{title(record.longestViewedArtworkId)}</dd>
        </div>
      </dl>

      <div className="receipt-section">
        <span className="muted small">오늘 본 작품</span>
        <ol className="receipt-works">
          {record.viewedArtworkIds.map((id, i) => (
            <li key={id}>
              <span>
                {i + 1}. {title(id)}
              </span>
              <span>{record.reactions[id] === 'like' ? '👍' : record.reactions[id] === 'dislike' ? '👎' : ''}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="receipt-section">
        <span className="muted small">오늘의 취향 키워드</span>
        <div className="chips wrap">
          {record.keywords.map((k) => (
            <span key={k} className="chip accent">
              {k}
            </span>
          ))}
        </div>
      </div>
      <p className="receipt-foot">오늘 본 작품을 기억해두세요.</p>
    </article>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
