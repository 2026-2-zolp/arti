/**
 * U-10 작품 감상 — 서비스의 핵심 화면
 * 추천 이유 · 작품 해설(원문 ↔ AI 요약) / 관람가이드 탭 · 음성 설명(TTS) · AI 질문 · 👍/👎 · 다음 작품 안내
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { FinishedVisitPrompt } from '../../components/FinishedVisitPrompt';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { ArtworkViewer } from '../../components/ArtworkViewer';
import { Icon } from '../../components/Icon';
import { api, ApiError } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { errorDetail } from '../../lib/errorText';
import { hasAppHistory, useCloseWatcher, useVisitHistory, visitEntry } from '../../lib/appHistory';
import { useSpeech } from '../../lib/useSpeech';
import { reasonSentence } from '../../lib/recommend';
import { topEmotionLabels } from '../../components/EmotionBars';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath } from '../../store/ExhibitionRoute';
import { load, save } from '../../lib/storage';
import { scopeKey, BASIC_LOOKING_TIPS, type ReadingState } from '../../lib/visitScope';
import type { Reaction, EntryContext } from '../../types';

const LIKE_REASONS = ['색감이 좋아요', '구도가 편해요', '분위기가 좋아요', '형태가 흥미로워요'];
const DISLIKE_REASONS = ['색감이 별로예요', '비율이 이상해요', '분위기가 맞지 않아요', '형태가 어색해요'];

type Tab = 'desc' | 'guided';
const TABS: { id: Tab; label: string }[] = [
  { id: 'desc', label: '작품 해설' },
  { id: 'guided', label: '관람가이드' },
];

/** 관리자가 확정한 관람가이드가 없는 작품에 보여 줄 기본 관찰 팁 (백엔드 BASIC_LOOKING_TIPS와 같은 내용) */
const BASIC_TIPS = BASIC_LOOKING_TIPS;

/** 작품해설·관람가이드와 감상 반응을 제공하는 화면 */
export default function U10Artwork() {
  const navigate = useNavigate();
  const { key: locationKey } = useLocation();
  const { pending, askFinished, currentEntry } = useVisitHistory();
  const { state, dispatch } = useVisit();
  const to = useExhibitionPath();
  const { recommendations, current, reactions, reactionReasons, exhibitionId, visitId, requestGeneration } = state;
  const isExhibitionOrder = state.visitMode === 'exhibition_order';
  const [ask, setAsk] = useState<Reaction | null>(null);
  const [customOn, setCustomOn] = useState(false);
  const [customText, setCustomText] = useState('');
  const rec = pending ? undefined : recommendations[current];

  const [tab, setTab] = useState<Tab>('desc');
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false); // 원문이 3줄을 넘는지 (넘을 때만 「더보기」)
  const [summaryOn, setSummaryOn] = useState(false); // 원문 자리에 AI 요약을 보여 주는 중
  const [openHints, setOpenHints] = useState<number[]>([]); // 관람가이드에서 힌트를 펼친 질문 번호
  const [fullscreen, setFullscreen] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const advancing = useRef(false);
  const tts = useSpeech();

  const { data, loading, error, reload } = useAsync(
    async () => {
      if (!rec) return null;
      try {
        const visit = exhibitionId ? { exhibitionId, visitId } : undefined;
        const artwork = await api.getArtwork(rec.artworkId, visit);
        return { artwork, unavailableId: null, visitId, generation: requestGeneration };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return { artwork: null, unavailableId: rec.artworkId };
        throw err;
      }
    },
    [rec?.artworkId, exhibitionId, visitId, requestGeneration, state.user?.id],
  );
  const w = data?.visitId === visitId && data.generation === requestGeneration ? data.artwork : null;
  const unavailable = !!rec && data?.unavailableId === rec.artworkId;

  const readingKey = w ? scopeKey(state, w.id, w.contentVersion ?? 1) + '.reading' : '';
  const restored = useRef('');
  const [hydratedKey, setHydratedKey] = useState('');
  useLayoutEffect(() => {
    if (!readingKey || restored.current === readingKey) return;
    const r = load<ReadingState | null>(readingKey, null, 'session');
    setTab(r?.tab ?? 'desc'); setSummaryOn(r?.summaryOn ?? false); setExpanded(r?.expanded ?? false); setOpenHints(r?.openHints ?? []);
    setAsk(null); setCustomOn(false); setCustomText(''); restored.current = readingKey; setHydratedKey(readingKey);
    const id = requestAnimationFrame(() => { const body = document.querySelector('.m-body'); if (body) body.scrollTop = r?.scroll ?? 0; });
    return () => cancelAnimationFrame(id);
  }, [readingKey]);
  useEffect(() => {
    if (!readingKey || hydratedKey !== readingKey) return;
    const persist = () => save(readingKey, {...load<ReadingState | null>(readingKey, null, 'session'), tab, summaryOn, expanded, openHints, scroll: document.querySelector('.m-body')?.scrollTop ?? 0}, 'session');
    const body = document.querySelector('.m-body'); persist(); body?.addEventListener('scroll', persist, {passive: true}); window.addEventListener('pagehide', persist);
    return () => {persist(); body?.removeEventListener('scroll', persist); window.removeEventListener('pagehide', persist);};
  }, [readingKey, hydratedKey, tab, summaryOn, expanded, openHints]);
  // 접힌 원문이 실제로 잘렸는지 측정 (펼친 상태에서는 「접기」를 위해 그대로 둔다)
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [w?.description, tab, summaryOn, expanded]);

  const recId = rec?.artworkId;
  const viewingId = !loading && !error && w?.id === recId ? recId : undefined;
  const enteredAt = useRef<number | null>(null);

  // 작품을 표시한 구간만 측정합니다. 지도·도슨트에서 돌아오면 새 구간을 시작합니다.
  useLayoutEffect(() => {
    if (!viewingId) return;
    enteredAt.current = performance.now();
    return () => {
      if (enteredAt.current === null) return;
      const seconds = Math.round((performance.now() - enteredAt.current) / 1000);
      enteredAt.current = null;
      if (seconds > 0) dispatch({ type: 'addDwell', visitId, generation: requestGeneration, artworkId: viewingId, seconds });
    };
  }, [viewingId, visitId, requestGeneration, dispatch]);

  // 이유를 고르면 이유 창이 닫히고 본문 아래에 "고른 이유" 줄이 생긴다.
  // 그 줄이 화면 밖이나 하단 버튼 뒤에 있으면 보이는 곳까지 스크롤한다(이미 보이면 그대로).
  const reasonRowRef = useRef<HTMLDivElement>(null);
  const [reasonSavedAt, setReasonSavedAt] = useState(0);
  useEffect(() => {
    if (!reasonSavedAt) return;
    reasonRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [reasonSavedAt]);
  // 이유 고르기 창이 열려 있으면 안드로이드 휴대폰 뒤로가기는 화면을 떠나지 않고 창만 닫는다(반응은 그대로).
  useCloseWatcher(ask !== null, () => setAsk(null));

  if (askFinished) return <FinishedVisitPrompt key={locationKey} />;
  if (pending) return null;
  if (!rec) return <Navigate to={to(recommendations.length ? '/receipt' : '/recommend')} replace />;

  const total = recommendations.length;
  const isLast = current === total - 1;
  const reaction = reactions[rec.artworkId];
  const savedReason = reactionReasons[rec.artworkId];

  const openReason = (r: Reaction, currentReason?: string) => {
    const presets = r === 'like' ? LIKE_REASONS : DISLIKE_REASONS;
    const custom = !!currentReason && !presets.includes(currentReason);
    setAsk(r);
    setCustomOn(custom);
    setCustomText(custom ? currentReason : '');
  };

  const setReaction = (r: Reaction) => {
    if (ask === r) {
      setAsk(null);
      return;
    }
    if (reaction === r && !ask) {
      dispatch({ type: 'react', artworkId: rec.artworkId, reaction: null });
      return;
    }
    const keepReason = reaction === r ? (savedReason ?? '') : '';
    dispatch({ type: 'react', artworkId: rec.artworkId, reaction: r, reason: keepReason });
    openReason(r, keepReason || undefined);
  };

  const confirmReason = (reason: string) => {
    const text = reason.trim();
    if (!ask || !text) return;
    dispatch({ type: 'react', artworkId: rec.artworkId, reaction: ask, reason: text });
    setAsk(null);
    setReasonSavedAt(Date.now());
  };

  const goNext = () => {
    if (advancing.current || loading || error || w?.id !== rec.artworkId) return;
    advancing.current = true;
    const seconds = enteredAt.current === null ? 0 : Math.round((performance.now() - enteredAt.current) / 1000);
    enteredAt.current = null;
    tts.stop();
    dispatch({
      type: 'completeCurrent', visitId, generation: requestGeneration, artworkId: rec.artworkId, seconds,
      exhibition: w.receiptExhibition,
      receiptArtwork: { snapshot: { id: w.id, title: w.title, tags: w.tags }, evidence: w.artworkReceiptEvidence },
    });
    // 다음 작품 안내는 기록을 쌓아 뒤로가기로 이 작품에 돌아올 수 있게 한다. 영수증은 끝이라 덮어쓴다.
    navigate(to(isLast ? '/receipt' : '/route'), {
      replace: isLast,
      state: { visitEntry: visitEntry(state, current + 1) },
    });
  };

  const skip = () => {
    if (advancing.current || loading || !unavailable) return;
    advancing.current = true;
    if (isExhibitionOrder && isLast && !state.viewed.length) {
      dispatch({ type: 'resetVisit' });
      navigate(to(), { replace: true });
      return;
    }
    dispatch({ type: 'skipCurrent', visitId, generation: requestGeneration, artworkId: rec.artworkId });
    navigate(to(isLast ? '/receipt' : '/route'), { replace: true, state: { visitEntry: visitEntry(state, current + 1) } });
  };

  const openMap = () => {
    tts.stop();
    const navigation = { visitEntry: visitEntry(state) };
    if (!currentEntry) navigate(to('/artwork'), { replace: true, state: navigation });
    navigate(to('/route'), { state: { ...navigation, returnToArtwork: true } });
  };

  // 원문을 먼저 보여 주고, 관리자가 확정한 AI 요약이 있을 때만 「AI 요약 보기」로 바꿔 볼 수 있다
  const hasSummary = !!w && w.summaryStatus === 'confirmed' && w.summary.trim() !== '';
  const showSummary = hasSummary && summaryOn;
  const mood = w?.emotionStatus === 'confirmed' && w.analysis ? topEmotionLabels(w.analysis.emotions) : [];

  // 관람가이드도 관리자가 확정한 것만 보여 주고, 없으면 어느 그림에나 쓸 수 있는 기본 관찰 팁
  const hasGuide = !!w && w.guideStatus === 'confirmed' && (w.guidedLooking.length > 0 || w.guideIntro.trim() !== '');
  const guideIntro = hasGuide ? w.guideIntro.trim() : '';
  const questions = hasGuide && w.guidedLooking.length ? w.guidedLooking : BASIC_TIPS;
  const hints = hasGuide && w.guidedLooking.length ? w.guidedHints : [];

  const tabText = (): string => {
    if (!w) return '';
    if (tab === 'desc') return showSummary ? w.summary : w.description;
    return [guideIntro, ...questions.map((q, i) => `${i + 1}. ${q}`)].filter(Boolean).join(' ');
  };

  const toggleHint = (i: number) => setOpenHints((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]));

  const toggleSummary = () => {
    tts.stop();
    setExpanded(false);
    setSummaryOn((v) => !v);
  };

  const goDocent = (questionIndex?: number) => {
    if (!w || !readingKey) return;
    const entry: EntryContext | undefined = tab === 'desc'
      ? {tab, kind: showSummary ? 'summary' : 'original', contentVersion: w.contentVersion ?? 1}
      : questionIndex === undefined ? undefined
        : {tab, kind: hasGuide && w.guidedLooking.length ? 'guide' : 'generic_tip', contentVersion: w.contentVersion ?? 1, questionIndex, ...(!(hasGuide && w.guidedLooking.length) ? {tipVersion: 'basic-v1' as const} : {})};
    save(readingKey, {tab, summaryOn, expanded, openHints, scroll: document.querySelector('.m-body')?.scrollTop ?? 0, entry}, 'session');
    navigate(to('/artwork/ask'), { state: { fromArtwork: true, visitEntry: visitEntry(state) } });
  };
  const toggleSpeech = () => (tts.speaking ? tts.stop() : tts.speak(`${w?.title}. ${tabText()}`));

  return (
    <MobileShell
      screenId="U-10"
      back={() => {
        tts.stop();
        // 경로에서 들어왔으면 그 경로 기록으로 돌아간다(휴대폰 뒤로가기와 같음). 바로 들어왔으면 경로로 덮어쓴다.
        if (hasAppHistory()) navigate(-1);
        else navigate(to('/route'), { replace: true, state: { showMap: true, visitEntry: visitEntry(state) } });
      }}
      title={
        <span className="progress-title">
          {current + 1} / {total}
          <span className="progress-bars" aria-hidden="true">
            {recommendations.map((r, i) => (
              <span key={r.artworkId} className={i <= current ? 'on' : ''} />
            ))}
          </span>
        </span>
      }
      right={
        <button className="pill-btn" onClick={openMap}>
          <Icon name="map" size={18} /> 지도 보기
        </button>
      }
      footer={error || unavailable ? undefined : (
        // 작품 정보를 못 불러온 동안에는 누를 수 없는 [다음 작품 안내]를 남기지 않는다(카드의 버튼으로 빠져나간다).
        <div className="footer-stack">
          {ask && (
            <ReasonPicker
              kind={ask}
              customOn={customOn}
              customText={customText}
              onPick={confirmReason}
              onCustom={() => setCustomOn(true)}
              onText={setCustomText}
              onClose={() => setAsk(null)}
            />
          )}
          <button className="btn primary block" onClick={goNext} disabled={loading || !!error || w?.id !== rec.artworkId}>
            {isLast ? '관람 마치기' : '다음 작품 안내'} <Icon name="arrow" size={20} />
          </button>
        </div>
      )}
    >
      {error || unavailable ? (
        <div className="notice-card is-err notice-center screen-center" role="alert">
          <p className="notice-body">작품 정보를 불러오지 못했어요.{errorDetail(error)}</p>
          <button className="btn primary block" onClick={reload}>다시 시도하기</button>
          {unavailable && <button className="btn ghost block" onClick={skip}>이 작품 건너뛰기</button>}
          <button className="btn ghost block" onClick={openMap}>지도 보기</button>
        </div>
      ) : loading || !w ? (
        <Spinner />
      ) : (
        <>
          {/* 작품이 잘리지 않게 전체를 보여 준다(U-05 취향 조사 카드와 같은 방식). 비율이 다른 작품은 틀 안에 여백이 생긴다. */}
          <div className="art-frame">
            <ArtImage seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={3 / 2} fit="contain" />
            <button className="frame-btn" aria-label="전체 화면" onClick={() => setFullscreen(true)}>
              <Icon name="expand" size={18} />
            </button>
          </div>
          {/* 크게 보기: 작품 전체를 보여 주고 확대·축소·이동할 수 있다(U-05 비교 카드와 공통 화면). */}
          {fullscreen && (
            <ArtworkViewer seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} onClose={() => setFullscreen(false)} />
          )}

          <div className="reaction-block under-image">
            <div className="reaction-row">
              <span className="muted small">이 작품, 어땠나요? (선택)</span>
              <button
                className={`round-btn ${reaction === 'like' ? 'on' : ''}`}
                aria-pressed={reaction === 'like'}
                aria-label="좋아요"
                onClick={() => setReaction('like')}
              >
                <Icon name="thumbUp" />
              </button>
              <button
                className={`round-btn down ${reaction === 'dislike' ? 'on' : ''}`}
                aria-pressed={reaction === 'dislike'}
                aria-label="별로예요"
                onClick={() => setReaction('dislike')}
              >
                <Icon name="thumbDown" />
              </button>
            </div>
            {reaction && savedReason && (
              <div ref={reasonRowRef} className="reaction-reason above-footer">
                <span className="muted small">고른 이유</span>
                <button
                  type="button"
                  className={`reason-chip saved ${reaction}`}
                  aria-label={`${savedReason}, 이유 바꾸기`}
                  onClick={() => openReason(reaction, savedReason)}
                >
                  {savedReason}
                </button>
              </div>
            )}
          </div>

          <h2 className="art-title">{w.title}</h2>
          <p className="art-meta">
            {w.artist}
            <span className="sep">|</span>
            {w.year}
          </p>

          {mood.length > 0 && (
            <div className="mood-row">
              이 작품의 분위기
              {mood.map((m) => (
                <span key={m} className="chip sm accent">
                  {m}
                </span>
              ))}
              <span className="small">(AI 감정 분석)</span>
            </div>
          )}

          {!isExhibitionOrder && <div className="reason-box">
            <Icon name="bulb" />
            <div>
              <strong>이 작품이 추천된 이유</strong>
              <p>{reasonSentence(rec.matchedTags, rec.aiTags ?? false)}</p>
            </div>
          </div>}

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab ${tab === t.id ? 'on' : ''}`}
                onClick={() => {
                  tts.stop();
                  setTab(t.id);
                }}
              >
                {tab === t.id && t.id === 'desc' && <Icon name="eye" size={18} />}
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-panel" role="tabpanel">
            {tab === 'desc' && (
              <>
                {showSummary ? (
                  <>
                    <span className="ai-label">AI 요약 · 검수된 작품 자료 기반</span>
                    <p className="artwork-prose">{w.summary}</p>
                  </>
                ) : (
                  <p ref={descRef} className={`artwork-prose${expanded ? '' : ' clamp-3'}`}>
                    {w.description}
                  </p>
                )}
                {((!showSummary && clamped) || hasSummary) && (
                  <div className="text-actions">
                    {!showSummary && clamped && (
                      <button className="link-btn inline" onClick={() => setExpanded((v) => !v)}>
                        {expanded ? '접기' : '더보기'}
                      </button>
                    )}
                    {hasSummary && (
                      <button className="link-btn" onClick={toggleSummary}>
                        {showSummary ? '원문 보기' : 'AI 요약 보기'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {tab === 'guided' && (
              <>
                {guideIntro && <p className="guide-intro">{guideIntro}</p>}
                <span className="ai-label">{hasGuide && w.guidedLooking.length ? '관찰 질문' : '기본 감상 팁'}</span>
                <ol className="guided-list">
                  {questions.map((q, i) => (
                    <li key={`${i}-${q}`}>
                      {q}
                      <div className="guide-question-actions">
                        <button className="link-btn" onClick={() => goDocent(i)} aria-label={`${i + 1}번 질문으로 대화하기`}>이 질문으로 대화하기</button>
                        {hints[i] && (
                          <button className="link-btn inline hint-btn" aria-expanded={openHints.includes(i)} onClick={() => toggleHint(i)}>
                            {openHints.includes(i) ? '힌트 닫기' : '힌트 보기'}
                          </button>
                        )}
                      </div>
                      {hints[i] && openHints.includes(i) && <span className="hint-text">💡 {hints[i]}</span>}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <div className="action-row">
            <button className="btn outline" onClick={toggleSpeech} disabled={!tts.supported}>
              <Icon name={tts.speaking ? 'stop' : 'speaker'} size={20} />
              {tts.speaking ? '재생 중지' : '음성 설명 듣기'}
            </button>
            <button className="btn outline" onClick={() => goDocent()}>
              <Icon name="chat" size={20} /> {tab === 'guided' ? '작품에 대해 질문하기' : '이 부분 더 알아보기'}
            </button>
          </div>
          {tts.error && <p className="muted small" role="status">{tts.error}</p>}

        </>
      )}
    </MobileShell>
  );
}

/** 감상 반응의 이유를 선택하도록 돕습니다. */
function ReasonPicker({
  kind,
  customOn,
  customText,
  onPick,
  onCustom,
  onText,
  onClose,
}: {
  kind: Reaction;
  customOn: boolean;
  customText: string;
  onPick: (reason: string) => void;
  onCustom: () => void;
  onText: (value: string) => void;
  /** 창만 닫기. 이미 저장된 좋아요·별로예요는 남고, 이유만 건너뛴다. */
  onClose: () => void;
}) {
  const presets = kind === 'like' ? LIKE_REASONS : DISLIKE_REASONS;
  return (
    <div className={`reason-sheet ${kind}`} role="group" aria-label={kind === 'like' ? '좋아요 이유' : '별로예요 이유'}>
      <div className="reason-sheet-head">
        <p className="muted small">{kind === 'like' ? '어떤 점이 좋았나요?' : '어떤 점이 아쉬웠나요?'}</p>
        <button type="button" className="text-btn" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="reason-options">
        {presets.map((label) => (
          <button key={label} type="button" className="reason-chip" onClick={() => onPick(label)}>
            {label}
          </button>
        ))}
        <button type="button" className={`reason-chip ${customOn ? 'on' : ''}`} onClick={onCustom}>
          기타
        </button>
      </div>
      {customOn && (
        <div className="reason-custom">
          <input
            value={customText}
            onChange={(e) => onText(e.target.value)}
            placeholder="이유를 적어 주세요"
            aria-label="직접 적은 이유"
          />
          <button type="button" className="btn primary" disabled={!customText.trim()} onClick={() => onPick(customText)}>
            남기기
          </button>
        </div>
      )}
    </div>
  );
}
