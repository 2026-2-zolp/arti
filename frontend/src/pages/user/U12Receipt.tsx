/** 현재·과거 관람의 영수증을 표시하는 화면 */
import {useConfirm} from '../../components/Confirmation';
/**
 * U-12 아트 영수증
 * - 전시/receipt      : 방금 끝난 관람 결과 (로그인 사용자는 관람기록에 저장)
 * - /receipt/:visitId : U-13 마이페이지(관람기록)에서 들어온 과거 기록 조회 모드
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { load, save, remove } from '../../lib/storage';
import {buildRecord} from '../../lib/receiptPayload';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import { EmotionBars } from '../../components/EmotionBars';
import { ReceiptImageSave } from '../../components/ReceiptImageSave';
import type { Artwork, EmotionScores, VisitRecord } from '../../types';

type Interpretation = { text: string; emotionProfile: EmotionScores | null };

/** 현재·과거 관람의 영수증을 표시하는 화면 */
export default function U12Receipt() {
  const { visitId } = useParams();
  return visitId ? <HistoryReceipt visitId={visitId} /> : <LiveReceipt />;
}

/** 현재 세션 상태로 영수증 데이터 만들기 */

function LiveReceipt() {
  const confirmAction = useConfirm();
  const navigate = useNavigate(); const {state, dispatch} = useVisit();
  const initial = useRef(state).current;
  const actor = useRef(state.user?.id); actor.current = state.user?.id;
  const currentScope = `${state.user?.id ?? 'guest'}.${state.visitId}.${state.exhibitionId}`;
  const scope = useRef(currentScope); scope.current = currentScope;
  const initialScope = `${initial.user?.id ?? 'guest'}.${initial.visitId}.${initial.exhibitionId}`;
  const mounted = useRef(true); const interpreting = useRef(false);
  const [interpretPending, setInterpretPending] = useState(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const exhibitionId = useExhibitionId(); const to = useExhibitionPath();
  const captureRef = useRef<HTMLDivElement>(null);
  const cacheKey = `arti.receipt.${initial.user?.id ?? 'guest'}.${initial.visitId}`;
  const pendingKey = `arti.pendingReceipt.${initial.user?.id}.${initial.visitId}`;
  const {data, error, reload} = useAsync(() => Promise.all([api.getExhibition(exhibitionId), api.listArtworks(exhibitionId)]), [exhibitionId]);
  const [record, setRecord] = useState<Omit<VisitRecord, 'id'> | null>(() =>
    load(pendingKey, load(cacheKey, null, 'session'), 'session'));
  const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState('');
  const [interp, setInterp] = useState<Interpretation | 'failed' | null>(() => load(cacheKey + '.interpretation', null, 'session'));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!data || record) return;
    const value = buildRecord(initial, data[1], data[0]); save(cacheKey, value, 'session'); setRecord(value);
  }, [data, record, initial, cacheKey]);
  useEffect(() => {
    if (!record || !initial.user || saved) return;
    let active = true;
    save(pendingKey, record, 'session'); setBusy(true); setFailure('');
    // Never silently retry a pending member receipt as a guest after token expiry.
    if (!load('arti.token', null)) { setBusy(false); setFailure('로그인이 만료됐어요. 같은 계정으로 로그인한 뒤 마이페이지에서 미저장 기록을 복구해 주세요.'); return; }
    api.saveMemberVisit(record, initial.user.id, () => active && mounted.current && scope.current === initialScope).then(r => {
      if (!active || actor.current !== initial.user?.id) return;
      if (!r.persisted) throw new Error('회원 기록이 저장되지 않았어요.');
      setSaved(true); remove(pendingKey, 'session');
    }).catch(e => active && setFailure(e instanceof Error ? e.message : '기록 저장에 실패했어요.')).finally(() => active && setBusy(false));
    return () => {active = false;};
  }, [record, initial.user, saved, attempt, pendingKey]);
  const interpret = async () => {
    if (!record || interpreting.current || scope.current !== initialScope || (initial.user && (!saved || actor.current !== initial.user.id))) return;
    interpreting.current = true; setInterpretPending(true);
    setInterp(null);
    try {
      const r = await api.interpretVisit({exhibitionId: record.exhibitionId, visitId: initial.visitId, viewedArtworkIds: record.viewedArtworkIds, reactions: record.reactions, dwell: record.dwell ?? {}});
      if (!mounted.current || scope.current !== initialScope) return;
      const value = {text: r.text, emotionProfile: r.emotionProfile}; setInterp(value); save(cacheKey + '.interpretation', value, 'session');
    } catch {if (mounted.current && scope.current === initialScope) setInterp('failed');}
    finally {interpreting.current = false; if (mounted.current && scope.current === initialScope) setInterpretPending(false);}
  };
  const finish = async () => {
    if (initial.user && !saved && !(await confirmAction('아직 저장되지 않았어요. 현재 탭의 미저장 기록을 남기고 나갈까요? 같은 계정으로 로그인 후 마이페이지에서 재시도할 수 있어요.'))) return;
    dispatch({type: 'resetVisit'}); navigate(to(), {replace: true});
  };
  if (state.user && initial.user?.id !== state.user.id) return <Navigate to="/mypage" replace />;
  if (!initial.recommendations.length && !record) return <Navigate to={to()} replace />;
  return <MobileShell screenId="U-12" title="아트 영수증" footer={<button className="btn primary block" onClick={finish}>관람 완료</button>}>
    <h2>오늘의 관람이 완성됐어요</h2>
    {error && <p role="alert">{error}<button onClick={reload}>다시 불러오기</button><button onClick={finish}>나가기</button></p>}
    {!record || !data ? (!error && <Spinner />) : <>
      <div ref={captureRef}><Receipt record={record} artworks={data[1]} interpretation={interp && interp !== 'failed' ? interp.text : null} profile={interp && interp !== 'failed' ? interp.emotionProfile : null} /></div>
      <ReceiptImageSave targetRef={captureRef} ready fileName={receiptFileName(record.date)} />
      {initial.user ? <p role="status">{busy ? '관람기록 저장 중…' : saved ? '관람기록에 저장되었어요.' : '아직 관람기록이 저장되지 않았어요.'}</p> : <p>비회원 기록은 서버에 저장하지 않아요. 이 기기의 현재 관람에서만 확인할 수 있어요.</p>}
      {failure && <p role="alert">{failure}<button disabled={busy} onClick={() => setAttempt(n => n+1)}>저장 재시도</button><button onClick={() => navigate('/login?redirect=/mypage')}>로그인 후 미저장 기록 복구</button></p>}
      <button disabled={busy || interpretPending || (!!initial.user && !saved)} onClick={interpret}>취향 해석 {interp === 'failed' ? '다시 시도' : '보기'}</button>
      {interp === 'failed' && <p>해석을 가져오지 못했어요. 관람기록 저장과는 별개이며 다시 시도할 수 있어요.</p>}
    </>}
  </MobileShell>;
}

/** 저장된 관람 기록의 영수증을 조회합니다. */
function HistoryReceipt({ visitId }: { visitId: string }) {
  const navigate = useNavigate();
  const { state } = useVisit();
  const captureRef = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useAsync(
    () => api.getVisit(visitId).then(record => [record, record.artworkSnapshots ?? []] as const),
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
