/** U-11 AI 자유 질문 — 현재 작품에 대한 질의응답 (답변은 등록된 작품 자료 근거) */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MobileShell } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { api, ApiError } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { load, save } from '../../lib/storage';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath } from '../../store/ExhibitionRoute';
import { scopeKey, BASIC_LOOKING_TIPS, type ReadingState } from '../../lib/visitScope';
import type { ChatMessage } from '../../types';

const SUGGESTED = ['이 작품은 어디부터 보면 좋을까요?', '작가는 어떤 사람인가요?', '색은 어떤 의미가 있나요?', '왜 유명한 작품인가요?'];

// crypto.randomUUID는 https에서만 동작해 휴대폰 LAN 테스트(http)에서 실패하므로 간단한 id 생성기를 쓴다
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
/** 현재 작품과 해설·질문 맥락을 이어 도슨트와 대화하는 화면 */
export default function U11AskAI() {
  const navigate = useNavigate();
  const { state: entryLocation } = useLocation();
  const { state } = useVisit();
  const to = useExhibitionPath();
  const rec = state.recommendations[state.current];
  const artworkId = rec?.artworkId ?? '';

  // 대화 내용은 작품별로 sessionStorage에 보관 → U-10에 갔다 와도 유지
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedChatKey, setLoadedChatKey] = useState('');
  const [failure, setFailure] = useState('');
  const generation = useRef(0);
  const [contentChanged, setContentChanged] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const { data: w, error, reload } = useAsync(() => (artworkId ? api.getArtwork(artworkId) : Promise.resolve(null)), [artworkId]);

  const key = w?.id === artworkId ? scopeKey(state, artworkId, w.contentVersion ?? 1) : '';
  const reading = key ? load<ReadingState | null>(key + '.reading', null, 'session') : null;
  const entry = reading?.entry;
  const questionIndex = entry?.questionIndex;
  const selectedQuestion = questionIndex === undefined ? undefined :
    entry?.kind === 'guide' ? w?.guidedLooking[questionIndex] :
    entry?.kind === 'generic_tip' ? BASIC_LOOKING_TIPS[questionIndex] : undefined;
  const chatReady = !!key && loadedChatKey === key;
  const canAsk = chatReady && !pending && !contentChanged;
  const hasArtwork = !!artworkId;
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;

    // Android Chrome에서 키보드가 열린 동안 보이는 영역에 입력부를 맞춥니다.
    const syncViewport = () => {
      if (viewport.scale !== 1) return;
      shell.style.setProperty('--docent-height', `${viewport.height}px`);
      shell.style.setProperty('--docent-top', `${viewport.offsetTop}px`);
    };
    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
    };
  }, [hasArtwork]);

  useEffect(() => {
    generation.current += 1; sending.current = false; setPending(false);
    setMessages(key ? load<ChatMessage[]>(key + '.chat', [], 'session') : []);
    setLoadedChatKey(key);
    return () => { generation.current += 1; };
  }, [key]);
  useLayoutEffect(() => {
    if (!messages.length && !failure && !pending) return;
    const conversation = shellRef.current?.querySelector('main');
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, failure, pending]);
  if (!rec) return <Navigate to={to('/route')} replace />;
  const ask = async (question: string, fromInput = false) => {
    const q = question.trim();
    if (!q || q.length > 500 || !canAsk || !w || sending.current) return;
    sending.current = true;
    const active = generation.current; setPending(true); setFailure('');
    const eligible = messages.flatMap((m, i) => m.role === 'user' && messages[i+1]?.role === 'ai' && messages[i+1].mode === 'llm' ? [m, messages[i+1]] : []);
    const history = eligible.slice(-8).map(m => ({role: m.role === 'ai' ? 'assistant' as const : 'user' as const, text: m.text.slice(0,1000)}));
    try {
      const result = await api.askAI(artworkId, q, state.visitId, entry, history);
      if (generation.current !== active) return;
      const next: ChatMessage[] = [...messages, {id: newId(), role: 'user', text: q}, {id: newId(), role: 'ai', text: result.answer, mode: result.mode, sourceRefs: result.sourceRefs}];
      setMessages(next); save(key + '.chat', next, 'session');
      if (fromInput) setInput((draft) => draft === question ? '' : draft);
    } catch (e) {
      if (generation.current !== active) return;
      if (e instanceof ApiError && e.code === 'CONTENT_CHANGED') { setContentChanged(true); setFailure('작품 자료가 변경됐어요. 해설로 돌아가 새 내용을 확인한 뒤 질문해 주세요.'); reload(); }
      else setFailure(e instanceof Error ? e.message : '답변을 가져오지 못했어요. 입력을 유지했으니 다시 보내 주세요.');
    } finally {
      if (generation.current === active) {
        sending.current = false;
        setPending(false);
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input, true);
  };
  const guidedStart = !!selectedQuestion && !messages.length;

  return (
    <MobileShell
      ref={shellRef}
      screenId="U-11"
      title="AI에게 질문하기"
      back={() => {
        if (entryLocation?.fromArtwork) navigate(-1);
        else navigate(to('/artwork'), { replace: true });
      }}
      footer={
        <form className="chat-input" onSubmit={onSubmit}>
          <input
            type="text"
            enterKeyHint="send"
            disabled={contentChanged}
            maxLength={500}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={guidedStart ? '그림에서 본 것을 적어 보세요' : '작품에 대해 궁금한 점을 물어보세요'}
            aria-label="질문 입력"
            aria-describedby={guidedStart ? 'docent-question-text' : undefined}
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || !canAsk} aria-label="보내기">
            <Icon name="send" size={20} />
          </button>
        </form>
      }
    >
      {w && (
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

      {error && <p className="error-text" role="alert">{error}<button onClick={reload}>다시 불러오기</button></p>}
      {selectedQuestion && (
        <section className="docent-question bubble ai" aria-labelledby="docent-question-heading">
          <h2 id="docent-question-heading">고른 관찰 질문</h2>
          <p id="docent-question-text">{selectedQuestion}</p>
          {chatReady && (
            <button type="button" className="link-btn" disabled={!canAsk}
              onClick={() => ask('이 관찰 질문에 답할 수 있도록 작품에서 볼 지점 하나를 힌트로 알려 주세요.')}>힌트 받기</button>
          )}
        </section>
      )}
      <div className="chat-log" role="log" aria-label="도슨트 대화">
        {chatReady && messages.length === 0 && !selectedQuestion && (
          <div className="bubble ai">작품을 보면서 궁금한 점을 편하게 물어보세요. 등록된 작품 자료를 바탕으로 답해 드려요.</div>
        )}
        {chatReady && messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.role === 'ai' && <small>{m.mode === 'fallback' ? '일반 관찰 안내 (AI 생성 아님)' : m.mode === 'refusal' ? '안내' : 'AI 도슨트'}</small>}{m.text}
          </div>
        ))}
      </div>
      {pending && <p className="muted small" role="status">답변을 작성하고 있어요…</p>}
      {failure && <p className="error-text" role="alert">{failure}</p>}

      {chatReady && !selectedQuestion && messages.length === 0 && <div className="suggested">
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
