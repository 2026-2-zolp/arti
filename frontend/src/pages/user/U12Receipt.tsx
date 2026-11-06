/**
 * U-12 아트 영수증
 * - 전시/receipt      : 방금 끝난 관람 결과 (로그인 사용자는 관람기록에 저장)
 * - /receipt/:visitId : U-13 마이페이지(관람기록)에서 들어온 과거 기록 조회 모드
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { load, save } from '../../lib/storage';
import { TASTE_LABEL } from '../../data/mock';
import { useVisit, type VisitState } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import { EmotionBars } from '../../components/EmotionBars';
import { ReceiptImageSave } from '../../components/ReceiptImageSave';
import type { Artwork, EmotionScores, Exhibition, TasteTag, VisitRecord } from '../../types';

type Interpretation = { text: string; emotionProfile: EmotionScores | null };

export default function U12Receipt() {
  const { visitId } = useParams();
  return visitId ? <HistoryReceipt visitId={visitId} /> : <LiveReceipt />;
}

/** 현재 세션 상태로 영수증 데이터 만들기 */
function buildRecord(s: VisitState, artworks: Artwork[], ex: Exhibition): Omit<VisitRecord, 'id'> {
  const byId = new Map(artworks.map((w) => [w.id, w]));
  const longest = Object.entries(s.dwell).sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.viewed[0] ?? null;

  // 취향 키워드: 선택한 취향 + 👍 누른 작품의 특성
  const liked = Object.entries(s.reactions)
    .filter(([, r]) => r === 'like')
    .flatMap(([id]) => byId.get(id)?.tags ?? []);
  // 화면 이름표(TASTE_LABEL)가 없는 예전 태그(calm·emotion 등)는 뺀다.
  // 빼지 않으면 키워드에 null이 들어가 서버 입력 검사에서 관람기록 전체가 거부됨 (태그 통일 전 임시 처리)
  const tags = [...new Set<TasteTag>([...s.tastes, ...liked])].filter((t) => TASTE_LABEL[t]).slice(0, 4);

  return {
    userId: s.user?.id ?? null,
    exhibitionId: ex.id,
    exhibitionTitle: ex.title,
    venue: ex.venue,
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
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  /** 관람기록 저장 상태: 저장되면 완료 문구를 3초 보여 주고 지운다(hidden). 새로고침 등으로 이미 저장된 경우는 바로 hidden */
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'failed' | 'hidden'>('saving');
  useEffect(() => {
    if (saveState !== 'saved') return;
    const id = setTimeout(() => setSaveState('hidden'), 3000);
    return () => clearTimeout(id);
  }, [saveState]);
  const captureRef = useRef<HTMLDivElement>(null);
  const { data } = useAsync(
    () => Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]),
    [exhibitionId],
  );

  const record = useMemo(
    () => (data ? buildRecord(state, data[1], data[0]) : null),
    // 영수증은 화면에 처음 들어온 시점 기준으로 고정
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  // AI 취향 해석: 관람당 한 번만 요청하고 결과를 세션에 보관 (새로고침해도 다시 호출하지 않음)
  const interpKey = `arti.receipt.interp.${state.startedAt}`;
  const [interp, setInterp] = useState<Interpretation | 'failed' | null>(() => load<Interpretation | null>(interpKey, null, 'session'));
  useEffect(() => {
    if (!record || interp) return;
    let cancelled = false;
    api
      .interpretVisit({ viewedArtworkIds: state.viewed, reactions: state.reactions, dwell: state.dwell })
      .then((r) => {
        if (cancelled) return;
        const v = { text: r.text, emotionProfile: r.emotionProfile };
        save(interpKey, v, 'session');
        setInterp(v);
      })
      .catch(() => !cancelled && setInterp('failed'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  // 로그인 사용자: AI 해석까지 받은 뒤 관람기록에 한 번만 저장 (새로고침해도 중복 저장 방지)
  useEffect(() => {
    if (!record || !state.user || !state.startedAt || interp === null) return;
    const flag = `arti.receipt.saved.${state.startedAt}`;
    if (load(flag, false, 'session')) {
      setSaveState('hidden');
      return;
    }
    save(flag, true, 'session');
    const ai = interp === 'failed' ? { interpretation: null, emotionProfile: null } : { interpretation: interp.text, emotionProfile: interp.emotionProfile };
    api
      .saveVisit({ ...record, ...ai })
      .then(() => setSaveState('saved'))
      .catch(() => {
        save(flag, false, 'session'); // 새로고침하면 다시 저장을 시도하도록
        setSaveState('failed');
      });
  }, [record, state.user, state.startedAt, interp]);

  if (state.recommendations.length === 0) return <Navigate to={to()} replace />;

  // 관람기록은 서버에 이미 저장됐으니 진행 상태만 비우고, 방금 관람한 전시의 첫 화면으로
  const finish = () => {
    dispatch({ type: 'resetVisit' });
    navigate(to(), { replace: true });
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
      </div>
      {!record || !data ? (
        <Spinner />
      ) : (
        <>
          <div ref={captureRef}>
            <Receipt
              record={record}
              artworks={data[1]}
              interpretation={interp === null ? undefined : interp === 'failed' ? null : interp.text}
              profile={interp && interp !== 'failed' ? interp.emotionProfile : null}
            />
          </div>
          {/* AI 해석을 받는 동안은 비활성, 받거나 실패하면 이미지를 만든다 */}
          <ReceiptImageSave targetRef={captureRef} ready={interp !== null} fileName={receiptFileName(record.date)} />
          {state.user ? (
            saveState === 'saving' ? (
              <p className="center muted small mt-12">관람기록 저장 중…</p>
            ) : saveState === 'saved' ? (
              <p className="center muted small mt-12">관람기록에 저장되었어요.</p>
            ) : saveState === 'failed' ? (
              <p className="center small mt-12 error-text">관람기록을 저장하지 못했어요.</p>
            ) : null
          ) : (
            <p className="center muted small mt-12">
              로그인하고 관람하면 영수증을 마이페이지에서 다시 볼 수 있어요.
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
  const captureRef = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useAsync(
    () => Promise.all([api.getVisit(visitId), api.listArtworks()]),
    [visitId],
  );

  if (!state.user) return <Navigate to={`/login?redirect=/receipt/${visitId}`} replace />;

  return (
    <MobileShell
      screenId="U-12"
      title="아트 영수증"
      back="/mypage"
      footer={
        <button className="btn outline block" onClick={() => navigate('/mypage')}>
          마이페이지로
        </button>
      }
    >
      {loading && <Spinner />}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="lead center">
            <h2>{data[0].exhibitionTitle}</h2>
          </div>
          <div ref={captureRef}>
            <Receipt
              record={data[0]}
              artworks={data[1]}
              interpretation={data[0].interpretation ?? null}
              profile={data[0].emotionProfile ?? null}
            />
          </div>
          <ReceiptImageSave targetRef={captureRef} ready fileName={receiptFileName(data[0].date)} />
        </>
      )}
    </MobileShell>
  );
}

/**
 * interpretation: undefined = AI 해석 받는 중, null = 없음(실패·과거 기록), 문자열 = 해석
 */
function Receipt({
  record,
  artworks,
  interpretation,
  profile,
}: {
  record: Omit<VisitRecord, 'id'>;
  artworks: Artwork[];
  interpretation: string | null | undefined;
  profile: EmotionScores | null;
}) {
  const title = (id: string | null) => artworks.find((w) => w.id === id)?.title ?? '-';
  const likes = Object.values(record.reactions).filter((r) => r === 'like').length;

  return (
    <article className="receipt" aria-label="아트 영수증">
      <header className="receipt-head">
        <h3>ART RECEIPT</h3>
        <p className="receipt-title">{record.exhibitionTitle}</p>
        {record.venue && <p className="receipt-venue">{record.venue}</p>}
      </header>
      <dl className="receipt-rows">
        <div>
          <dt>관람 날짜</dt>
          <dd>{formatDateWithDay(record.date)}</dd>
        </div>
        <div>
          <dt>관람 시간</dt>
          <dd>{record.durationMin}분</dd>
        </div>
      </dl>
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

      {interpretation !== null && (
        <div className="receipt-section">
          <span className="muted small">AI 취향 해석</span>
          {interpretation === undefined ? (
            <Spinner label="오늘의 관람을 해석하는 중…" />
          ) : (
            <p className="receipt-ai">{interpretation}</p>
          )}
          {profile && <EmotionBars scores={profile} />}
        </div>
      )}

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

/** 예: 2026.11.04 (수) */
function formatDateWithDay(iso: string): string {
  return `${formatDate(iso)} (${'일월화수목금토'[new Date(iso).getDay()]})`;
}

/** 저장 파일명 (확장자 제외). 예: arti-receipt-20261104 */
function receiptFileName(iso: string): string {
  return `arti-receipt-${formatDate(iso).replace(/\./g, '')}`;
}
