import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '@/api/types';
import { Card, Icon, QueryState, Skeleton, Spinner } from '@/components/common';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { useArtwork, useAskAi, useSuggestedQuestions } from '@/hooks/queries/useUserQueries';
import { useArtworkId, useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import type { ChatMessage } from '@/types/domain';
import styles from './AskAiPage.module.css';

const chatKey = (artworkId: string) => `arti.chat.${artworkId}`;

function loadChat(artworkId: string): ChatMessage[] {
  try {
    return JSON.parse(sessionStorage.getItem(chatKey(artworkId)) ?? '[]') as ChatMessage[];
  } catch {
    return [];
  }
}

/** U-11 AI 자유 질문 */
export function AskAiPage() {
  const exhibitionId = useExhibitionId();
  const artworkId = useArtworkId();
  const navigate = useNavigate();
  const artworkQuery = useArtwork(exhibitionId, artworkId);
  const suggested = useSuggestedQuestions(artworkId);
  const ask = useAskAi(artworkId);

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(artworkId));
  const [input, setInput] = useState('');
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(chatKey(artworkId), JSON.stringify(messages));
    } catch {
      /* 저장 실패 무시 */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, artworkId]);

  const send = (question: string, appendUser = true) => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    const history = appendUser ? [...messages, userMessage] : messages;
    if (appendUser) setMessages(history);
    setInput('');
    setFailedQuestion(null);
    ask.mutate(
      { question: text, history },
      {
        onSuccess: (answer) => setMessages((prev) => [...prev, answer]),
        onError: () => setFailedQuestion(text),
      },
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <MobileLayout
      title="AI에게 질문하기"
      onBack={() => navigate(paths.artwork(exhibitionId, artworkId))}
      footer={
        <form className={styles.inputBar} onSubmit={handleSubmit}>
          <label htmlFor="ai-question" className="sr-only">
            질문 입력
          </label>
          <input
            id="ai-question"
            className={styles.input}
            placeholder="질문을 입력하세요"
            value={input}
            maxLength={300}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            className={styles.send}
            disabled={!input.trim() || ask.isPending}
            aria-label="질문 보내기"
          >
            <Icon name="arrowUp" size={20} strokeWidth={2.2} />
          </button>
        </form>
      }
    >
      <QueryState query={artworkQuery} loading={<Skeleton height={96} radius={16} />}>
        {(artwork) => (
          <Card tone="muted" padding="md" className={styles.artwork}>
            <p className={styles.artworkTitle}>{artwork.title}</p>
            <p className={styles.artworkMeta}>
              {artwork.artist} · {artwork.year}
            </p>
          </Card>
        )}
      </QueryState>

      <p className={styles.lead}>작품을 보면서 궁금한 점을 물어보세요.</p>

      <div className={styles.messages} aria-live="polite">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}
          >
            {m.content}
          </div>
        ))}
        {ask.isPending && (
          <div className={`${styles.bubble} ${styles.assistant} ${styles.typing}`}>
            <Spinner size={16} tone="accent" label="답변을 만드는 중" /> 답변을 만들고 있어요
          </div>
        )}
        {failedQuestion && (
          <div className={styles.failed} role="alert">
            <span>{getErrorMessage(ask.error)}</span>
            <button type="button" onClick={() => send(failedQuestion, false)}>
              다시 시도
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={styles.suggested}>
        <p className={styles.suggestedLabel}>추천 질문</p>
        <QueryState
          query={suggested}
          loading={
            <div className={styles.suggestedList}>
              <Skeleton height={52} radius={16} />
              <Skeleton height={52} radius={16} />
            </div>
          }
          empty={null}
        >
          {(questions) => (
            <div className={styles.suggestedList}>
              {questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={styles.suggestion}
                  onClick={() => send(q)}
                  disabled={ask.isPending}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </QueryState>
      </div>
    </MobileLayout>
  );
}
