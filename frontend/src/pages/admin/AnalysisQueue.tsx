import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Icon } from '../../components/Icon';
import { apiTarget } from '../../lib/apiTarget';
import type { AnalysisQueue, AnalysisQueueItem } from '../../lib/adminAnalysis';
import { formatDateTime } from '../../lib/adminDate';

const stateLabels: Record<AnalysisQueueItem['state'], string> = {
  queued: '대기', running: '분석 중', emotion: '감정 분석 대기·진행 중', completed: '완료', failed: '실패',
};
const fieldLabels = { summary: '요약', guide: '가이드', tag: '태그', emotion: '감정', analysis: '분석' };
const failureLabel = (code: string) => {
  if (code === 'VERSION_CONFLICT') return '작품 변경됨';
  if (code === 'AI_TIMEOUT') return '응답 시간 초과';
  if (code === 'RATE_LIMITED' || code === 'TEMPORARY_UNAVAILABLE') return '다른 분석 진행 중';
  return '결과를 받지 못했어요';
};

const EMPTY: AnalysisQueue = { enabled: false, batches: [] };
type QueueControls = {
  queue: AnalysisQueue;
  busy: boolean;
  show: () => void;
  start: (exhibitionId: string) => Promise<void>;
};
const QueueContext = createContext<QueueControls | null>(null);
export const useAnalysisQueue = () => useContext(QueueContext);

export function AnalysisQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [disconnected, setDisconnected] = useState(false);
  const change = useRef(0);
  const sending = useRef(false);
  const content = useId();

  useEffect(() => {
    if (apiTarget(import.meta.env.VITE_API_TARGET) !== 'django') return;
    let stopped = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (checking || stopped) return;
      clearTimeout(timer);
      checking = true;
      const observed = change.current;
      let delay = 5000;
      try {
        const latest = await api.analysisQueue();
        if (stopped) return;
        if (observed === change.current && !sending.current) {
          setQueue(latest);
          setDisconnected(false);
        }
        if (!latest.enabled) return;
        delay = latest.batches.some(batch => batch.active) ? 1500 : 5000;
      } catch (cause) {
        if (stopped || (cause instanceof ApiError && cause.status === 401)) return;
        setDisconnected(true);
      } finally {
        checking = false;
      }
      if (!stopped) timer = setTimeout(refresh, delay);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  async function apply(send: () => Promise<AnalysisQueue>) {
    if (sending.current) return;
    sending.current = true;
    change.current += 1;
    setOpen(true);
    setPending(true);
    setError('');
    try {
      setQueue(await send());
      setDisconnected(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '분석 작업을 요청하지 못했어요.');
    } finally {
      sending.current = false;
      change.current += 1;
      setPending(false);
    }
  }

  const latest = queue.batches[0];
  const failed = latest?.items.filter(item => item.state === 'failed').length ?? 0;
  const processed = (latest?.items.filter(item => item.state === 'completed').length ?? 0) + failed;
  const total = latest?.items.length ?? 0;
  const sweep = total ? processed / total * 360 : 0;
  const progress = total ? `${processed}/${total}점 처리${failed ? ` · 실패 ${failed}점` : ''}` : '';

  return (
    <QueueContext.Provider value={{
      queue, busy: pending, show: () => setOpen(true),
      start: exhibitionId => apply(() => api.startAnalysisBatch(exhibitionId)),
    }}>
      {children}
      {latest || pending || error ? (
        <section className="a-analysis-queue" aria-label="분석 작업">
          <header className="a-analysis-queue-header">
            <button type="button" className="a-analysis-queue-toggle" aria-expanded={open} aria-controls={content}
              aria-label={progress ? `분석 작업 ${progress}` : '분석 작업'}
              onClick={() => setOpen(value => !value)}>
              <span className="a-analysis-queue-ring" role="progressbar" aria-label="전시 분석 처리 작품"
                aria-valuenow={processed} aria-valuemax={total || 1}
                style={{ background: `conic-gradient(var(--accent) ${sweep}deg, var(--a-line) 0deg)` }} />
              <span>분석 작업</span>
              {progress && <small>{progress}</small>}
              <Icon name="chevron" size={16} />
            </button>
            {latest && !latest.active && failed > 0 && (
              <button type="button" className="a-analysis-item-retry" aria-label="실패한 작품 모두 재시도"
                title="실패한 작품 모두 재시도" disabled={pending}
                onClick={() => void apply(() => api.retryAnalysisBatch(latest.id))}>
                <Icon name="retry" size={18} />
              </button>
            )}
          </header>
          <div id={content} className="a-analysis-queue-content" hidden={!open}>
            {pending && <p role="status">작업을 등록하고 있어요.</p>}
            {error && <p className="error-text" role="alert">{error}</p>}
            {disconnected && <p role="status">연결을 다시 확인하고 있어요.</p>}
            {queue.batches.map(batch => (
              <section className="a-analysis-batch" key={batch.id}>
                <h3>{batch.exhibitionTitle}</h3>
                <small>{formatDateTime(batch.createdAt)}</small>
                <ul>
                  {batch.items.map(item => (
                    <li key={item.artworkId}>
                      <span className={`a-analysis-item a-analysis-${item.state}`} role="img"
                        aria-label={stateLabels[item.state]} title={stateLabels[item.state]}>
                        {item.state === 'completed' ? '○' : item.state === 'failed' ? '×' : ''}
                      </span>
                      <div className="a-analysis-item-title">
                        {item.reviewReady ? (
                          <Link to={`/admin/artworks/${encodeURIComponent(item.artworkId)}`} aria-label={`${item.title} 검수`}>{item.title}</Link>
                        ) : item.title}
                        {item.state === 'emotion' && <small>감정 분석 중</small>}
                        {item.state === 'failed' && <small>{Object.entries(item.failures).map(([field, code]) =>
                          `${fieldLabels[field as keyof typeof fieldLabels]} ${failureLabel(code)}`).join(' · ')}</small>}
                      </div>
                      {item.state === 'failed' && <button type="button" className="a-analysis-item-retry"
                        aria-label={`${item.title} 재시도`} title="이 작품 다시 분석" disabled={pending}
                        onClick={() => void apply(() => api.retryAnalysisBatch(batch.id, item.artworkId))}>
                        <Icon name="retry" size={18} />
                      </button>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ) : null}
    </QueueContext.Provider>
  );
}
