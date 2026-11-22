import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Icon } from '../../components/Icon';
import { apiTarget } from '../../lib/apiTarget';
import { analysisFieldLabels, type AnalysisQueue, type AnalysisQueueItem, type AnalysisScope, type AnalysisSelection } from '../../lib/adminAnalysis';
import { formatDateTime } from '../../lib/adminDate';
import { useConfirm } from '../../components/Confirmation';

const stateLabels: Record<AnalysisQueueItem['state'], string> = {
  queued: '대기', running: '분석 중', emotion: '감정 분석 대기·진행 중', completed: '완료', failed: '실패', canceled: '취소됨',
};
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
  start: (scope: AnalysisScope, selections: AnalysisSelection[]) => Promise<void>;
};
const QueueContext = createContext<QueueControls | null>(null);
export const useAnalysisQueue = () => useContext(QueueContext);

function progressFor(items: AnalysisQueueItem[]) {
  const failed = items.filter(item => item.state === 'failed').length;
  const canceled = items.filter(item => item.state === 'canceled').length;
  const processed = items.filter(item => item.state === 'completed').length + failed + canceled;
  const total = items.length;
  const text = `${processed}/${total}점 처리${failed ? ` · 실패 ${failed}점` : ''}${canceled ? ` · 취소 ${canceled}점` : ''}`;
  return { failed, processed, total, text };
}

function ProgressRing({ progress, label }: { progress: ReturnType<typeof progressFor>; label: string }) {
  const sweep = progress.total ? progress.processed / progress.total * 360 : 0;
  return <span className="a-analysis-queue-ring" role="progressbar" aria-label={label}
    aria-valuenow={progress.processed} aria-valuemax={progress.total || 1}
    style={{ background: `conic-gradient(var(--accent) ${sweep}deg, var(--a-line) 0deg)` }} />;
}

export function AnalysisQueueProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm();
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

  async function apply(send: () => Promise<AnalysisQueue>, fromDialog = false) {
    if (sending.current) {
      if (fromDialog) throw new Error('다른 분석 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    sending.current = true;
    change.current += 1;
    if (!fromDialog) setOpen(true);
    setPending(true);
    setError('');
    try {
      setQueue(await send());
      setOpen(true);
      setDisconnected(false);
    } catch (cause) {
      if (fromDialog) throw cause;
      setError(cause instanceof Error ? cause.message : '분석 작업을 요청하지 못했어요.');
    } finally {
      sending.current = false;
      change.current += 1;
      setPending(false);
    }
  }

  async function cancelAnalysis(send: () => Promise<AnalysisQueue>, message: string) {
    if (await confirm(message)) await apply(send);
  }

  const latest = queue.batches[0];
  const latestRun = latest?.runId ? queue.batches.filter(batch => batch.runId === latest.runId) : latest ? [latest] : [];
  const overall = progressFor(latestRun.flatMap(batch => batch.items));
  const active = latestRun.some(batch => batch.active);
  function cancelLatest(batch: NonNullable<typeof latest>) {
    return cancelAnalysis(() => batch.runId ? api.cancelAnalysisRun(batch.runId) : api.cancelAnalysisBatch(batch.id),
      batch.runId ? '이 전체 전시 분석을 취소할까요? 저장된 제안은 유지돼요.' : '이 전시 분석을 취소할까요? 저장된 제안은 유지돼요.');
  }

  return (
    <QueueContext.Provider value={{
      queue, busy: pending, show: () => setOpen(true),
      start: (scope, selections) => apply(() => api.startAnalysisBatch(scope, selections), true),
    }}>
      {children}
      {latest || pending || error ? (
        <section className="a-analysis-queue" aria-label="분석 작업">
          <header className="a-analysis-queue-header">
            <button type="button" className="a-analysis-queue-toggle" aria-expanded={open} aria-controls={content}
              aria-label={overall.total ? `분석 작업 ${overall.text}` : '분석 작업'}
              onClick={() => setOpen(value => !value)}>
              <ProgressRing progress={overall} label="분석 처리 작품" />
              <span>분석 작업</span>
              {!!overall.total && <small>{overall.text}</small>}
              <Icon name="chevron" size={16} />
            </button>
            {latest && active && (
              <button type="button" className="a-analysis-item-retry a-analysis-cancel" aria-label="진행 중인 분석 취소"
                title={latest.runId ? '전체 전시 분석 취소' : '전시 분석 취소'} disabled={pending}
                onClick={() => void cancelLatest(latest)}>
                <Icon name="close" size={18} />
              </button>
            )}
            {latest && !active && overall.failed > 0 && (
              <button type="button" className="a-analysis-item-retry" aria-label="실패한 작품 모두 재시도"
                title="실패한 작품 모두 재시도" disabled={pending}
                onClick={() => void apply(() => latest.runId ? api.retryAnalysisRun(latest.runId) : api.retryAnalysisBatch(latest.id))}>
                <Icon name="retry" size={18} />
              </button>
            )}
          </header>
          <div id={content} className="a-analysis-queue-content" hidden={!open}>
            {pending && <p role="status">작업을 등록하고 있어요.</p>}
            {error && <p className="error-text" role="alert">{error}</p>}
            {disconnected && <p role="status">연결을 다시 확인하고 있어요.</p>}
            {queue.batches.map(batch => {
              const progress = progressFor(batch.items);
              return <section className="a-analysis-batch" key={batch.id} aria-label={batch.exhibitionTitle}>
                <header className="a-analysis-batch-heading">
                  <ProgressRing progress={progress} label={`${batch.exhibitionTitle} 처리 작품`} />
                  <div>
                    <h3>{batch.exhibitionTitle}</h3>
                    <small>{progress.text} · {formatDateTime(batch.createdAt)}</small>
                  </div>
                  {batch.active ? (
                    <button type="button" className="a-analysis-item-retry a-analysis-cancel"
                      aria-label={`${batch.exhibitionTitle} 분석 취소`} title="이 전시 분석 취소" disabled={pending}
                      onClick={() => void cancelAnalysis(() => api.cancelAnalysisBatch(batch.id), '이 전시 분석을 취소할까요? 저장된 제안은 유지돼요.')}>
                      <Icon name="close" size={18} />
                    </button>
                  ) : progress.failed > 0 && (
                    <button type="button" className="a-analysis-item-retry"
                      aria-label={`${batch.exhibitionTitle} 실패작 재시도`} title="이 전시 실패작 재시도" disabled={pending}
                      onClick={() => void apply(() => api.retryAnalysisBatch(batch.id))}>
                      <Icon name="retry" size={18} />
                    </button>
                  )}
                </header>
                <ul>
                  {batch.items.map(item => (
                    <li key={item.artworkId}>
                      <span className={`a-analysis-item a-analysis-${item.state}`} role="img"
                        aria-label={stateLabels[item.state]} title={stateLabels[item.state]}>
                        {item.state === 'completed' ? '○' : item.state === 'failed' ? '×' : item.state === 'canceled' ? '−' : ''}
                      </span>
                      <div className="a-analysis-item-title">
                        {item.reviewReady ? (
                          <Link to={`/admin/artworks/${encodeURIComponent(item.artworkId)}`} aria-label={`${item.title} 검수`}>{item.title}</Link>
                        ) : item.title}
                        {item.state === 'emotion' && <small>감정 분석 중</small>}
                        {item.state === 'failed' && <small>{Object.entries(item.failures).map(([field, code]) =>
                          `${analysisFieldLabels[field as keyof typeof analysisFieldLabels]} ${failureLabel(code)}`).join(' · ')}</small>}
                      </div>
                      {item.state === 'failed' && <button type="button" className="a-analysis-item-retry"
                        aria-label={`${item.title} 재시도`} title="이 작품 다시 분석" disabled={pending}
                        onClick={() => void apply(() => api.retryAnalysisBatch(batch.id, item.artworkId))}>
                        <Icon name="retry" size={18} />
                      </button>}
                    </li>
                  ))}
                </ul>
              </section>;
            })}
          </div>
        </section>
      ) : null}
    </QueueContext.Provider>
  );
}
