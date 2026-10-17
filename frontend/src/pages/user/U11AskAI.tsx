/** U-11 AI 자유 질문 — 현재 작품에 대한 질의응답 (답변은 등록된 작품 자료 근거) */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { MobileShell } from '../../components/MobileShell';
import { ArtImage } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { load, save } from '../../lib/storage';
import { useVisit } from '../../store/VisitContext';
import type { ChatMessage } from '../../types';

const SUGGESTED = ['이 작품은 어디부터 보면 좋을까요?', '작가는 어떤 사람인가요?', '색은 어떤 의미가 있나요?', '왜 유명한 작품인가요?'];

// crypto.randomUUID는 https에서만 동작해 휴대폰 LAN 테스트(http)에서 실패하므로 간단한 id 생성기를 쓴다
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const chatKey = (artworkId: string) => `arti.chat.${artworkId}`;

export default function U11AskAI() {
  const { state } = useVisit();
  const rec = state.recommendations[state.current];
  const artworkId = rec?.artworkId ?? '';

  // 대화 내용은 작품별로 sessionStorage에 보관 → U-10에 갔다 와도 유지
  const [messages, setMessages] = useState<ChatMessage[]>(() => load(chatKey(artworkId), [], 'session'));
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { data: w } = useAsync(() => (artworkId ? api.getArtwork(artworkId) : Promise.resolve(null)), [artworkId]);

  useEffect(() => {
    if (artworkId) save(chatKey(artworkId), messages, 'session');
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, artworkId]);

  if (!rec) return <Navigate to="/route" replace />;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setInput('');
    setMessages((m) => [...m, { id: newId(), role: 'user', text: q }]);
    setPending(true);
    try {
      const answer = await api.askAI(artworkId, q);
      setMessages((m) => [...m, { id: newId(), role: 'ai', text: answer }]);
    } catch {
      setMessages((m) => [...m, { id: newId(), role: 'ai', text: '답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' }]);
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <MobileShell
      screenId="U-11"
      title="AI에게 질문하기"
      back="/artwork"
      footer={
        <form className="chat-input" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="작품에 대해 궁금한 점을 물어보세요"
            aria-label="질문 입력"
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || pending} aria-label="보내기">
            <Icon name="send" size={20} />
          </button>
        </form>
      }
    >
      {w && (
        <div className="chat-artwork">
          <ArtImage className="chat-thumb" seed={w.id} palette={w.palette} imageUrl={w.imageUrl} alt={w.title} ratio={1} />
          <div>
            <strong>{w.title}</strong>
            <span className="muted small">
              {w.artist} · {w.year}
            </span>
          </div>
        </div>
      )}

      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="bubble ai">작품을 보면서 궁금한 점을 편하게 물어보세요. 등록된 작품 자료를 바탕으로 답해 드려요.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {pending && <div className="bubble ai typing">답변을 작성하고 있어요…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="suggested">
        <span className="eyebrow">추천 질문</span>
        <div className="chips wrap">
          {SUGGESTED.map((q) => (
            <button key={q} className="chip outline" onClick={() => ask(q)} disabled={pending}>
              {q}
            </button>
          ))}
        </div>
      </div>
    </MobileShell>
  );
}
