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
import { api, ApiError } from '../../api/client';
import { Icon } from '../../components/Icon';
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
  /** 로그인 만료로 저장하지 못함 → 다시 저장해도 같은 결과라 '로그인하고 복구하기'만 보여 준다 */
  const [expired, setExpired] = useState(false);
  // 실패 안내는 영수증 아래에 생겨 하단 고정 버튼에 가려질 수 있으므로, 생기면 보이는 곳까지 스크롤한다.
  const saveStatusRef = useRef<HTMLDivElement>(null);
  const interpCardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (failure) saveStatusRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [failure]);
  useEffect(() => {
    if (interp === 'failed') interpCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [interp]);
  useEffect(() => {
    if (!data || record) return;
    const value = buildRecord(initial, data[1], data[0]); save(cacheKey, value, 'session'); setRecord(value);
  }, [data, record, initial, cacheKey]);
  useEffect(() => {
    if (!record || !initial.user || saved) return;
    let active = true;
    save(pendingKey, record, 'session'); setBusy(true); setFailure(''); setExpired(false);
    // Never silently retry a pending member receipt as a guest after token expiry.
    if (!load('arti.token', null)) { setBusy(false); setExpired(true); setFailure('로그인이 만료됐어요. 같은 계정으로 로그인한 뒤 마이페이지에서 미저장 기록을 복구해 주세요.'); return; }
    api.saveMemberVisit(record, initial.user.id, () => active && mounted.current && scope.current === initialScope).then(r => {
      if (!active || actor.current !== initial.user?.id) return;
      if (!r.persisted) throw new Error('회원 기록이 저장되지 않았어요.');
      setSaved(true); remove(pendingKey, 'session');
    }).catch(e => {
      if (!active) return;
      if (e instanceof ApiError && e.status === 401) setExpired(true);
      setFailure(e instanceof Error ? e.message : '기록 저장에 실패했어요.');
    }).finally(() => active && setBusy(false));
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
    // 영수증을 아예 만들지 못한 경우(전시·작품 불러오기 실패)는 미저장 사본도 없으므로 '남긴다'고 안내하지 않는다. 동작은 같다.
    const message = record
      ? '아직 저장되지 않았어요. 현재 탭의 미저장 기록을 남기고 나갈까요? 같은 계정으로 로그인 후 마이페이지에서 재시도할 수 있어요.'
      : '이번 관람기록은 저장되지 않아요. 나갈까요?';
    if (initial.user && !saved && !(await confirmAction(message))) return;
    dispatch({type: 'resetVisit'}); navigate(to(), {replace: true});
  };
  if (state.user && initial.user?.id !== state.user.id) return <Navigate to="/mypage" replace />;
  if (!initial.recommendations.length && !record) return <Navigate to={to()} replace />;
  return <MobileShell screenId="U-12" footer={<button className="btn primary block" onClick={finish}>관람 완료</button>}>
    <div className="lead center"><h2>오늘의 관람이 완성됐어요</h2></div>
    {error && (
      <div className="notice-card is-err" role="alert">
        <p className="notice-title"><Icon name="alert" size={18} />영수증을 불러오지 못했어요</p>
        <p className="notice-body">{error}</p>
        <button className="btn primary block" onClick={reload}>다시 불러오기</button>
        <button className="btn ghost block" onClick={finish}>나가기</button>
      </div>
    )}
    {!record || !data ? (!error && <Spinner />) : <>
      <div ref={captureRef}><Receipt record={record} artworks={data[1]} interpretation={interp && interp !== 'failed' ? interp.text : null} profile={interp && interp !== 'failed' ? interp.emotionProfile : null} /></div>

      {/* 관람기록 저장 상태: 회원은 저장 중 → 저장됨 / 실패(로그인 만료 구분), 비회원은 이 기기에서만 */}
      <div ref={saveStatusRef} className="above-footer">
        {!initial.user ? (
          <p className="save-status is-info" role="status"><Icon name="info" size={18} />이 관람은 이 기기에서만 볼 수 있어요 (서버에 저장되지 않아요)</p>
        ) : failure && !busy ? (
          <div className="save-status is-err" role="alert">
            <p className="save-status-line"><Icon name={expired ? 'lock' : 'alert'} size={18} />{expired ? '로그인이 만료돼 저장하지 못했어요' : '관람기록을 저장하지 못했어요'}</p>
            {/* 준억님 방식대로 실패 시 '다시 저장'과 '로그인 후 복구'를 항상 둘 다 둔다. 로그인 만료면 복구를 주 버튼으로 */}
            {expired ? <>
              <p className="save-status-sub">같은 계정으로 로그인하면 마이페이지에서 이 기록을 복구할 수 있어요.</p>
              <button className="btn primary block" onClick={() => navigate('/login?redirect=/mypage')}>로그인하고 복구하기</button>
              <button className="btn outline block" disabled={busy} onClick={() => setAttempt(n => n + 1)}>다시 저장</button>
            </> : <>
              <p className="save-status-sub">{failure}</p>
              <button className="btn primary block" disabled={busy} onClick={() => setAttempt(n => n + 1)}>다시 저장</button>
              <button className="link-btn" onClick={() => navigate('/login?redirect=/mypage')}>로그인 후 마이페이지에서 복구</button>
            </>}
          </div>
        ) : saved ? (
          <p className="save-status is-ok" role="status"><Icon name="check" size={18} />관람기록에 저장되었어요</p>
        ) : busy ? (
          <p className="save-status is-busy" role="status"><span className="spinner-dot" aria-hidden="true" />관람기록 저장 중…</p>
        ) : (
          <p className="save-status is-info" role="status"><Icon name="info" size={18} />아직 관람기록이 저장되지 않았어요</p>
        )}
      </div>

      {/* AI 취향 해석: 관람기록 저장과 별개. 회원은 저장된 뒤에만 요청 가능(서버도 저장 전 요청을 거절) */}
      <section ref={interpCardRef} className={`interp-card above-footer${interp === 'failed' ? ' is-err' : ''}`} aria-label="AI 취향 해석">
        {interp === 'failed' ? <>
          <p className="interp-title is-err"><Icon name="alert" size={18} />해석을 가져오지 못했어요</p>
          <p className="interp-desc" role="alert">{initial.user ? '관람기록은 저장돼 있어요. 해석만 다시 시도할 수 있어요.' : '잠시 후 다시 시도할 수 있어요.'}</p>
          <button className="btn outline block" disabled={interpretPending} onClick={interpret}>다시 시도</button>
        </> : <>
          <p className="interp-title"><Icon name="sparkle" size={18} />AI 취향 해석</p>
          {interp ? <>
            {/* 준억님 화면처럼 성공 후에도 다시 요청할 수 있다. 다시 하면 새 해석으로 바뀐다 */}
            <p className="interp-desc">영수증 안에 해석을 넣었어요. 다시 해석하면 새 내용으로 바뀌어요.</p>
            <button className="btn outline block" onClick={interpret}>다시 해석하기</button>
          </> : interpretPending ? (
            <p className="interp-desc"><span className="spinner-dot" aria-hidden="true" />해석하는 중…</p>
          ) : initial.user && !saved ? (
            <p className="interp-desc">관람기록이 저장되면 볼 수 있어요.</p>
          ) : <>
            <p className="interp-desc">오늘 본 작품으로 내 취향을 풀어 드려요.</p>
            <button className="btn outline block" onClick={interpret}>취향 해석 보기</button>
          </>}
        </>}
      </section>

      <ReceiptImageSave targetRef={captureRef} ready fileName={receiptFileName(record.date)} />
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
