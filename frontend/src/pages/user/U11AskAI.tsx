/** U-11 AI 자유 질문 — 현재 작품에 대한 질의응답 (답변은 등록된 작품 자료 근거) */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MobileShell } from '../../components/MobileShell';
import { FinishedVisitPrompt } from '../../components/FinishedVisitPrompt';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { api, ApiError } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisitHistory } from '../../lib/appHistory';
import { errorDetail } from '../../lib/errorText';
import { load, remove, save } from '../../lib/storage';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath } from '../../store/ExhibitionRoute';
import { scopeKey, BASIC_LOOKING_TIPS, type ReadingState } from '../../lib/visitScope';
import type { ChatMessage } from '../../types';

const SUGGESTED = ['이 작품은 어디부터 보면 좋을까요?', '작가는 어떤 사람인가요?', '색은 어떤 의미가 있나요?', '왜 유명한 작품인가요?'];
// 요청 제한은 작품에서 나가거나 새로고침해도 같은 탭의 도슨트에 적용합니다.
const RETRY_WINDOW_KEY = 'arti.docent.retryWindow';

type AskFailure = {
  message: string;
  question?: string;
  retry?: { question: string; fromInput: boolean };
};
type RetryWindow = { expiresAt: number; seconds: number };

// crypto.randomUUID는 https에서만 동작해 휴대폰 LAN 테스트(http)에서 실패하므로 간단한 id 생성기를 쓴다
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
/** 현재 작품과 해설·질문 맥락을 이어 도슨트와 대화하는 화면 */
export default function U11AskAI() {
  const { state } = useVisit();
  const to = useExhibitionPath();
  const { key } = useLocation();
  const { pending, askFinished } = useVisitHistory();
  const rec = state.recommendations[state.current];
  if (pending) return null;
  if (askFinished) return <FinishedVisitPrompt key={key} />;
  if (!rec) return <Navigate to={to('/route')} replace />;

  // 보낸 대화는 자료 버전별로 나누고, 미전송 원문은 같은 관람·작품에서 다시 쓸 수 있게 둡니다.
  const draftKey = `${scopeKey(state, rec.artworkId, 0)}.questionDraft`;
  return <ArtworkChat key={draftKey} draftKey={draftKey} artworkId={rec.artworkId} />;
}

/** 맨 아래에서 이 거리 안이면 "최신 대화를 보는 중"으로 본다(새 답변 자동 따라가기·아래 화살표 숨김 기준) */
const NEAR_BOTTOM_PX = 96;

/** 대화 속 관찰 질문 카드의 자리(그 앞까지의 대화 수)와 질문 */
interface GuideMark { index: number; question: string }

function ArtworkChat({ artworkId, draftKey }: { artworkId: string; draftKey: string }) {
  const navigate = useNavigate();
  const { state: entryLocation, key: locationKey } = useLocation();
  const { state } = useVisit();
  const to = useExhibitionPath();

  // 대화 내용은 작품별로 sessionStorage에 보관 → U-10에 갔다 와도 유지
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedChatKey, setLoadedChatKey] = useState('');
  const [failure, setFailure] = useState<AskFailure | null>(null);
  const [retryWindow, setRetryWindow] = useState<RetryWindow | null>(() => {
    const saved = load<RetryWindow | null>(RETRY_WINDOW_KEY, null, 'session');
    return saved && saved.expiresAt > Date.now() ? saved : null;
  });
  useEffect(() => {
    if (!retryWindow) return;
    const timer = window.setTimeout(() => {
      remove(RETRY_WINDOW_KEY, 'session');
      setRetryWindow(null);
    }, Math.max(0, retryWindow.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryWindow]);
  const generation = useRef(0);
  const [artworkIssue, setArtworkIssue] = useState<'changed' | 'unavailable' | null>(null);
  const [input, setInput] = useState(() => load(draftKey, '', 'session'));
  useEffect(() => {
    if (input) save(draftKey, input, 'session');
    else remove(draftKey, 'session');
  }, [draftKey, input]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const pending = pendingQuestion !== null;
  const sending = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const syncViewportRef = useRef<(() => void) | null>(null);
  const resyncTimers = useRef<number[]>([]);
  // 키보드와 그 위 도우미 줄은 입력칸을 누른 뒤 조금 늦게 올라올 수 있어, 몇 번 나눠 다시 맞춘다.
  const resyncAfterKeyboard = () => {
    resyncTimers.current.forEach((id) => window.clearTimeout(id));
    resyncTimers.current = [100, 300, 600].map((delay) => window.setTimeout(() => syncViewportRef.current?.(), delay));
  };
  // 화면을 떠나면 남은 재측정을 멈춘다.
  useEffect(() => () => {
    resyncTimers.current.forEach((id) => window.clearTimeout(id));
    syncViewportRef.current = null;
  }, []);
  const [newOutput, setNewOutput] = useState(false);
  // 위쪽 대화를 보고 있으면(맨 아래에서 NEAR_BOTTOM_PX(96px) 이상 떨어짐) 새 답변이 없어도 맨 아래로 돌아가는 버튼을 보여 준다.
  const [readingAbove, setReadingAbove] = useState(false);
  const { data: w, error, reload } = useAsync(() => api.getArtwork(artworkId), [artworkId]);

  const key = w?.id === artworkId ? scopeKey(state, artworkId, w.contentVersion ?? 1) : '';
  const reading = key ? load<ReadingState | null>(key + '.reading', null, 'session') : null;
  const entry = reading?.entry;
  const questionIndex = entry?.questionIndex;
  const selectedQuestion = questionIndex === undefined ? undefined :
    entry?.kind === 'guide' ? w?.guidedLooking[questionIndex] :
    entry?.kind === 'generic_tip' ? BASIC_LOOKING_TIPS[questionIndex] : undefined;
  const chatReady = !!key && loadedChatKey === key && !artworkIssue;
  // 관람가이드에서 고른 관찰 질문은 "들어온 시점까지의 대화" 바로 뒤에 놓는다(이전 대화 → 질문 카드 → 새 대화).
  // 같은 이동(새로고침 포함)에서는 위치를 유지하고, 관람가이드에서 다시 들어오면 그때의 대화 끝으로 옮긴다.
  // 지난 관찰 질문 중 뒤에 대화(힌트·직접 쓴 답)가 이어진 것은 그 자리에 계속 남긴다. 아무것도 하지 않고 나간 질문은 남기지 않는다.
  const [guideAnchor, setGuideAnchor] = useState<number | null>(null);
  const [pastQuestions, setPastQuestions] = useState<GuideMark[]>([]);
  const questionCardRef = useRef<HTMLElement>(null);
  const [revealCard, setRevealCard] = useState(0);
  const [revealMessageId, setRevealMessageId] = useState<string | null>(null);
  useEffect(() => {
    if (!chatReady) { setGuideAnchor(null); setPastQuestions([]); return; }
    const anchorKey = key + '.guideAnchor';
    const historyKey = key + '.guideHistory';
    const chatLength = load<ChatMessage[]>(key + '.chat', [], 'session').length;
    let history = load<GuideMark[]>(historyKey, [], 'session');
    const saved = load<(GuideMark & { navKey: string }) | null>(anchorKey, null, 'session');
    const sameVisit = !!saved && saved.navKey === locationKey;
    // 다른 이동으로 들어왔으면 직전 질문 카드는 정리한다: 뒤에 대화가 있으면 지난 질문으로 남기고, 없으면 버린다.
    if (saved && !sameVisit) {
      if (saved.question && chatLength > saved.index
          && !history.some((h) => h.index === saved.index && h.question === saved.question)) {
        history = [...history, { index: saved.index, question: saved.question }];
        save(historyKey, history, 'session');
      }
      remove(anchorKey, 'session');
    }
    setPastQuestions(history);
    if (!selectedQuestion) { setGuideAnchor(null); return; }
    if (sameVisit && saved) { setGuideAnchor(saved.index); return; }
    save(anchorKey, { navKey: locationKey, index: chatLength, question: selectedQuestion }, 'session');
    setGuideAnchor(chatLength);
    setRevealCard((n) => n + 1);
  }, [chatReady, selectedQuestion, key, locationKey]);
  // 질문 카드·지난 질문이 자리 잡은 직후, 화면을 그리기 전에 맨 아래로 붙인다(최신 대화를 보던 중일 때만). 중간에서 멈칫하는 순간을 없앤다.
  useLayoutEffect(() => {
    const conversation = shellRef.current?.querySelector('main');
    if (conversation && followLatest.current) conversation.scrollTop = conversation.scrollHeight;
  }, [guideAnchor, pastQuestions]);
  const canAsk = chatReady && !pending && !retryWindow;
  const retry = failure?.retry;
  const sendError = retryWindow
    ? `AI 사용량이 많아요. 최대 ${retryWindow.seconds}초 뒤 다시 시도할 수 있어요.`
    : failure?.message;
  const attemptedQuestion = !artworkIssue && (pendingQuestion ?? failure?.question);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    const conversation = shell?.querySelector('main');
    if (!shell || !conversation) return;

    // 내용이 늦게 붙으면(질문 카드·그림·글꼴) 브라우저가 스크롤 위치를 스스로 옮기며 scroll 이벤트를 낸다.
    // 대화 높이가 바뀐 채 생긴 scroll은 사용자가 올린 것이 아니므로, 최신 대화를 보던 중이면 맨 아래에 다시 붙인다.
    let lastHeight = conversation.scrollHeight;
    const trackReadingPosition = () => {
      const heightChanged = conversation.scrollHeight !== lastHeight;
      lastHeight = conversation.scrollHeight;
      if (heightChanged && followLatest.current) {
        conversation.scrollTop = conversation.scrollHeight;
        return;
      }
      followLatest.current = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < NEAR_BOTTOM_PX;
      setReadingAbove(!followLatest.current);
      if (followLatest.current) setNewOutput(false);
    };

    // Android Chrome에서 키보드가 열린 동안 보이는 영역에 입력부를 맞춥니다.
    const syncViewport = () => {
      if (!viewport || viewport.scale !== 1) return;
      shell.style.setProperty('--docent-height', `${viewport.height}px`);
      shell.style.setProperty('--docent-top', `${viewport.offsetTop}px`);
      if (followLatest.current) conversation.scrollTop = conversation.scrollHeight;
    };
    syncViewport();
    syncViewportRef.current = syncViewport;
    // 들어온 뒤 늦게 붙는 내용(질문 카드·그림·글꼴)으로 대화 높이가 늘어도, 최신 대화를 보는 중이면 맨 아래에 붙어 있게 한다.
    const keepAtBottom = new ResizeObserver(() => {
      lastHeight = conversation.scrollHeight;
      if (followLatest.current) conversation.scrollTop = conversation.scrollHeight;
    });
    keepAtBottom.observe(conversation);
    // 대화 칸 밖(위쪽 작품 정보·오류 안내)도 늦게 생기거나 커질 수 있어, 본문의 모든 칸을 지켜본다.
    const watchChildren = () => Array.from(conversation.children).forEach((el) => keepAtBottom.observe(el));
    watchChildren();
    const newChildren = new MutationObserver(watchChildren);
    newChildren.observe(conversation, { childList: true });
    conversation.addEventListener('scroll', trackReadingPosition, { passive: true });
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    return () => {
      keepAtBottom.disconnect();
      newChildren.disconnect();
      conversation.removeEventListener('scroll', trackReadingPosition);
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
    };
  }, []);

  useEffect(() => {
    generation.current += 1; sending.current = false; setPendingQuestion(null);
    followLatest.current = true;
    setNewOutput(false);
    setMessages(key ? load<ChatMessage[]>(key + '.chat', [], 'session') : []);
    setLoadedChatKey(key);
    return () => { generation.current += 1; };
  }, [key]);
  useLayoutEffect(() => {
    if (!messages.length && !pending && !sendError) return;
    const conversation = shellRef.current?.querySelector('main');
    if (!conversation) return;
    if (followLatest.current || artworkIssue) {
      conversation.scrollTop = conversation.scrollHeight;
    } else if (!pending) {
      setNewOutput(true);
    }
  }, [messages, pending, sendError, artworkIssue]);
  const showLatest = () => {
    const conversation = shellRef.current?.querySelector('main');
    if (!conversation) return;
    followLatest.current = true;
    conversation.scrollTop = conversation.scrollHeight;
    chatRef.current?.focus({ preventScroll: true });
    setNewOutput(false);
    setReadingAbove(false);
  };
  const ask = async (question: string, fromInput = false) => {
    const q = question.trim();
    if (!q || q.length > 500 || !canAsk || !w || sending.current) return;
    sending.current = true;
    const active = generation.current; setPendingQuestion(q); setFailure(null);
    const eligible = messages.flatMap((m, i) => m.role === 'user' && messages[i+1]?.role === 'ai' && messages[i+1].mode === 'llm' ? [m, messages[i+1]] : []);
    const history = eligible.slice(-8).map(m => ({role: m.role === 'ai' ? 'assistant' as const : 'user' as const, text: m.text.slice(0,1000)}));
    try {
      const result = await api.askAI(artworkId, q, state.visitId, entry, history);
      if (generation.current !== active) return;
      const questionId = newId();
      const next: ChatMessage[] = [...messages, {id: questionId, role: 'user', text: q}, {id: newId(), role: 'ai', text: result.answer, mode: result.mode, sourceRefs: result.sourceRefs}];
      // 답변이 오면 (위쪽 대화를 읽던 중이어도) 답변 시작이 보이게 방금 질문을 화면 위쪽에 맞춘다.
      setRevealMessageId(questionId);
      setMessages(next); save(key + '.chat', next, 'session');
      if (fromInput) setInput((draft) => draft === question ? '' : draft);
    } catch (e) {
      if (generation.current !== active) return;
      if (e instanceof ApiError && e.status === 404 && e.code === 'NOT_FOUND') {
        setArtworkIssue('unavailable');
        setFailure({ message: '이 작품을 더 이상 볼 수 없어요. 작품 화면으로 돌아가 주세요.' });
      } else if (e instanceof ApiError && e.code === 'CONTENT_CHANGED') {
        setArtworkIssue('changed');
        setFailure({ message: '작품 자료가 변경됐어요. 작품 화면에서 새 내용을 확인해 주세요.' });
        reload();
      } else {
        const retryable = !(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500;
        if (e instanceof ApiError && e.status === 429 && e.retryAfterSeconds) {
          const nextWindow = { expiresAt: Date.now() + e.retryAfterSeconds * 1000, seconds: e.retryAfterSeconds };
          save(RETRY_WINDOW_KEY, nextWindow, 'session');
          setRetryWindow(nextWindow);
        }
        setFailure({
          question: q,
          message: e instanceof ApiError && e.status === 429 && e.retryAfterSeconds
            ? 'AI 사용량이 많아 질문을 보내지 못했어요.'
            : e instanceof Error ? e.message : '답변을 가져오지 못했어요.',
          retry: retryable ? { question, fromInput } : undefined,
        });
      }
    } finally {
      if (generation.current === active) {
        sending.current = false;
        setPendingQuestion(null);
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input, true);
  };
  // 관람가이드에서 새로 들어온 순간에는 이전 대화 아래에 놓인 질문 카드가 바로 보이게 스크롤한다.
  useEffect(() => {
    if (!revealCard) return;
    const frame = window.requestAnimationFrame(() => {
      const card = questionCardRef.current;
      const conversation = shellRef.current?.querySelector('main');
      if (!card || !conversation) return;
      if (!card.nextElementSibling) {
        // 카드가 대화의 마지막이면 맨 아래까지 내린다(아래 여백까지 보이게).
        conversation.scrollTop = conversation.scrollHeight;
      } else {
        card.scrollIntoView({ block: 'end' });
      }
      followLatest.current = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < NEAR_BOTTOM_PX;
      setReadingAbove(!followLatest.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [revealCard]);
  useEffect(() => {
    if (!revealMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      const conversation = shellRef.current?.querySelector('main');
      const question = conversation?.querySelector(`[data-msg-id="${revealMessageId}"]`);
      setRevealMessageId(null);
      if (!conversation || !question) return;
      followLatest.current = false; // 아래로 끌어내리는 처리보다 먼저 멈춘다. 스크롤 후 위치로 다시 판단된다.
      question.scrollIntoView({ block: 'start' });
      followLatest.current = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < NEAR_BOTTOM_PX;
      setReadingAbove(!followLatest.current);
      setNewOutput(false); // 답변을 바로 보여 줬으므로 "새 답변" 점은 띄우지 않는다.
    });
    return () => window.cancelAnimationFrame(frame);
  }, [revealMessageId]);
  // 자리가 정해지기 전(대화를 불러온 직후 한 순간)에는 카드를 그리지 않는다. 맨 위에 잠깐 그려졌다 옮겨지며 스크롤이 꼬였다.
  const anchorIndex = !selectedQuestion ? -1 : chatReady && guideAnchor === null ? -1 : Math.min(guideAnchor ?? 0, messages.length);
  // 질문 카드 뒤로 아직 대화가 없을 때만 "그림에서 본 것을 적어 보세요" 안내를 쓴다.
  const guidedStart = !!selectedQuestion && messages.length <= Math.max(anchorIndex, 0);
  const questionCard = selectedQuestion && !artworkIssue ? (
    <section ref={questionCardRef} className="docent-question bubble ai" aria-labelledby="docent-question-heading">
      <h2 id="docent-question-heading">고른 관찰 질문</h2>
      <p id="docent-question-text">{selectedQuestion}</p>
      {chatReady && (
        <button type="button" className="link-btn" disabled={!canAsk}
          onClick={() => ask('이 관찰 질문에 답할 수 있도록 작품에서 볼 지점 하나를 힌트로 알려 주세요.')}>힌트 받기</button>
      )}
    </section>
  ) : null;
  // 지난 관찰 질문: 질문 글만 보이고 [힌트 받기]는 없다(지금 고른 질문과 헷갈리지 않게).
  const pastCard = (h: GuideMark) => (
    <section key={`guide-${h.index}-${h.question}`} className="docent-question docent-question-past bubble ai" aria-label="지난 관찰 질문">
      <h2>관찰 질문</h2>
      <p>{h.question}</p>
    </section>
  );
  const backToArtwork = () => {
    if (entryLocation?.fromArtwork) navigate(-1);
    else navigate(to('/artwork'), { replace: true });
  };

  return (
    <MobileShell
      ref={shellRef}
      screenId="U-11"
      title="AI에게 질문하기"
      back={backToArtwork}
      footer={
        <>
          {/* 맨 아래로 돌아가는 원형 화살표: 위쪽 대화를 보고 있거나 새 답변이 왔을 때 입력칸 위 가운데에 뜬다 */}
          {(readingAbove || newOutput) && !artworkIssue && (
            <button type="button" className={`docent-latest-btn${newOutput ? ' has-new' : ''}`} onClick={showLatest}
              aria-label="최신 대화 보기" title={newOutput ? '새 답변이 있어요' : '최신 대화 보기'}>
              <Icon name="arrowDown" size={20} />
            </button>
          )}
          <form className="chat-input" onSubmit={onSubmit}>
            {/* 자동 완성을 꺼서 크롬 키보드 위 열쇠·주소 바로가기 줄이 덜 붙게 한다(그 줄이 입력칸·보내기를 가리던 문제). 키보드가 올라온 뒤에는 onFocus에서 화면 높이를 다시 맞춘다 */}
            <input
              type="text"
              name="docent-question"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="send"
              disabled={Boolean(artworkIssue)}
              maxLength={500}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={resyncAfterKeyboard}
              placeholder={guidedStart ? '그림에서 본 것을 적어 보세요' : '작품에 대해 궁금한 점을 물어보세요'}
              aria-label="질문 입력"
              aria-describedby={[
                guidedStart ? 'docent-question-text' : '',
                sendError ? 'docent-send-error' : '',
              ].filter(Boolean).join(' ') || undefined}
            />
            <button type="submit" className="send-btn" disabled={!input.trim() || !canAsk} aria-label="보내기">
              <Icon name="send" size={20} />
            </button>
          </form>
        </>
      }
    >
      {w && artworkIssue !== 'unavailable' && (
        <div className="chat-artwork">
          <ArtImage className="chat-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={1} fit="contain" />
          <div>
            <strong>{w.title}</strong>
            <span className="muted small">
              {w.artist} · {w.year}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="notice-card is-err notice-center" role="alert">
          <p className="notice-body">작품 정보를 불러오지 못했어요.{errorDetail(error)}</p>
          <button className="btn primary block" onClick={reload}>다시 시도하기</button>
        </div>
      )}
      <div ref={chatRef} className="chat-log" role="log" aria-label="도슨트 대화" tabIndex={-1}>
        {chatReady && messages.length === 0 && !selectedQuestion && !attemptedQuestion && !sendError && (
          <div className="bubble ai">작품을 보면서 궁금한 점을 편하게 물어보세요. 등록된 작품 자료를 바탕으로 답해 드려요.</div>
        )}
        {chatReady && messages.map((m, i) => (
          <Fragment key={m.id}>
            {pastQuestions.filter((h) => h.index === i).map((h) => pastCard(h))}
            {i === anchorIndex && questionCard}
            <div className={`bubble ${m.role}`} data-msg-id={m.id}>
              {m.role === 'ai' && <small>{m.mode === 'fallback' ? '일반 관찰 안내 (AI 생성 아님)' : m.mode === 'refusal' ? '안내' : 'AI 도슨트'}</small>}{m.text}
            </div>
          </Fragment>
        ))}
        {/* 대화를 다 불러오기 전이거나 질문 카드 뒤에 대화가 없으면 카드는 목록 끝(또는 처음)에 둔다 */}
        {chatReady && pastQuestions.filter((h) => h.index >= messages.length).map((h) => pastCard(h))}
        {(!chatReady || anchorIndex >= messages.length) && questionCard}
        {attemptedQuestion && <div className="bubble docent-attempt">{attemptedQuestion}</div>}
        {pending && <p className="bubble ai muted small" role="status">답변을 작성하고 있어요…</p>}
        {sendError && (
          <div className="bubble docent-error-card" role="alert">
            <p id="docent-send-error" className="error-text">{sendError}</p>
            {retry && (
              <button type="button" className="link-btn" disabled={!canAsk}
                onClick={() => ask(retry.question, retry.fromInput)}>
                {retry.fromInput && retry.question !== input ? '이전 질문 다시 시도' : '다시 시도'}
              </button>
            )}
            {artworkIssue && <button type="button" className="link-btn" onClick={backToArtwork}>작품으로 돌아가기</button>}
          </div>
        )}
      </div>

      {chatReady && !selectedQuestion && messages.length === 0 && !pending && !sendError && <div className="suggested">
        <span className="eyebrow">추천 질문</span>
        <div className="chips wrap">
          {SUGGESTED.map((q) => (
            <button key={q} className="chip outline" onClick={() => ask(q)} disabled={!canAsk}>
              {q}
            </button>
          ))}
        </div>
      </div>}
    </MobileShell>
  );
}
