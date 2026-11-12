/** U-11 AI 자유 질문 — 현재 작품에 대한 질의응답 (답변은 등록된 작품 자료 근거) */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
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
  const { state } = useVisit();
  const to = useExhibitionPath();
  const rec = state.recommendations[state.current];
  const artworkId = rec?.artworkId ?? '';

  // 대화 내용은 작품별로 sessionStorage에 보관 → U-10에 갔다 와도 유지
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [failure, setFailure] = useState('');
  const generation = useRef(0);
  const [contentChanged, setContentChanged] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { data: w, error, reload } = useAsync(() => (artworkId ? api.getArtwork(artworkId) : Promise.resolve(null)), [artworkId]);

  const key = w ? scopeKey(state, artworkId, w.contentVersion ?? 1) : '';
  const reading = key ? load<ReadingState | null>(key + '.reading', null, 'session') : null;
  const canAsk = Boolean(w && key && !pending && !contentChanged);
  useEffect(() => {
    generation.current += 1; setPending(false);
    setMessages(key ? load<ChatMessage[]>(key + '.chat', [], 'session') : []);
    return () => { generation.current += 1; };
  }, [key]);
  useEffect(() => { bottomRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'}); }, [messages, pending]);
  if (!rec) return <Navigate to={to('/route')} replace />;
  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || q.length > 500 || pending || contentChanged || !w || !key) return;
    const active = generation.current; setPending(true); setFailure('');
    const eligible = messages.flatMap((m, i) => m.role === 'user' && messages[i+1]?.role === 'ai' && messages[i+1].mode === 'llm' ? [m, messages[i+1]] : []);
    const history = eligible.slice(-8).map(m => ({role: m.role === 'ai' ? 'assistant' as const : 'user' as const, text: m.text.slice(0,1000)}));
    try {
      const result = await api.askAI(artworkId, q, state.visitId, reading?.entry, history);
      if (generation.current !== active) return;
      const next: ChatMessage[] = [...messages, {id: newId(), role: 'user', text: q}, {id: newId(), role: 'ai', text: result.answer, mode: result.mode, sourceRefs: result.sourceRefs}];
      setMessages(next); save(key + '.chat', next, 'session'); setInput('');
    } catch (e) {
      if (generation.current !== active) return;
      setInput(q);
      if (e instanceof ApiError && e.code === 'CONTENT_CHANGED') { setContentChanged(true); setFailure('작품 자료가 변경됐어요. 해설로 돌아가 새 내용을 확인한 뒤 질문해 주세요.'); reload(); }
      else setFailure(e instanceof Error ? e.message : '답변을 가져오지 못했어요. 입력을 유지했으니 다시 보내 주세요.');
    } finally { if (generation.current === active) setPending(false); }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <MobileShell
      screenId="U-11"
      title="AI에게 질문하기"
      back={to('/artwork')}
      footer={
        <form className="chat-input" onSubmit={onSubmit}>
          <input
            disabled={pending || contentChanged}
            maxLength={500}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="작품에 대해 궁금한 점을 물어보세요"
            aria-label="질문 입력"
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || !canAsk} aria-label="보내기">
            <Icon name="send" size={20} />
          </button>
        </form>
      }
    >
      {w && (
        <div className="chat-artwork">
          <ArtImage className="chat-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={1} />
          <div>
            <strong>{w.title}</strong>
            <span className="muted small">
              {w.artist} · {w.year}
            </span>
          </div>
        </div>
      )}

      {error && <p className="error-text" role="alert">{error}<button onClick={reload}>다시 불러오기</button></p>}
      {failure && <p className="error-text" role="alert">{failure}</p>}
      {reading?.entry && <p className="muted">{reading.entry.tab === 'guided' ? '관람가이드에서 보던 질문' : '작품 해설에서 보던 내용'}을 이어서 이야기해요. 아직 말하지 않은 감상은 대신 추측하지 않아요.<br />{reading.entry.kind === 'guide' ? w?.guidedLooking[reading.entry.questionIndex ?? 0] : reading.entry.kind === 'generic_tip' ? BASIC_LOOKING_TIPS[reading.entry.questionIndex ?? 0] : reading.entry.kind === 'summary' ? w?.summary : w?.description}</p>}
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="bubble ai">작품을 보면서 궁금한 점을 편하게 물어보세요. 등록된 작품 자료를 바탕으로 답해 드려요.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.role === 'ai' && <small>{m.mode === 'fallback' ? '일반 관찰 안내 (AI 생성 아님)' : m.mode === 'refusal' ? '안내' : 'AI 도슨트'}</small>}{m.text}
          </div>
        ))}
        {pending && <div className="bubble ai typing">답변을 작성하고 있어요…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="suggested">
        <span className="eyebrow">추천 질문</span>
        <div className="chips wrap">
          {SUGGESTED.map((q) => (
            <button key={q} className="chip outline" onClick={() => ask(q)} disabled={!canAsk}>
              {q}
            </button>
          ))}
        </div>
      </div>
    </MobileShell>
  );
}
