import { useId, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { analysisFieldLabels, type AnalysisScope, type AnalysisSelection, type ArtworkAnalysisField } from '../../lib/adminAnalysis';
import { useAsync } from '../../lib/useAsync';

export function AnalysisTargetsDialog({ scope, onClose, onStart }: {
  scope: AnalysisScope;
  onClose: () => void;
  onStart: (selections: AnalysisSelection[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const { data, loading, error, reload } = useAsync(() => api.analysisTargets(scope), [scope]);
  const [excluded, setExcluded] = useState<Record<string, ArtworkAnalysisField[]>>({});
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const selections = (data?.exhibitions ?? []).flatMap(group => group.items).flatMap(({ artworkId, fields }) => {
    const kept = fields.filter(field => !excluded[artworkId]?.includes(field));
    return kept.length ? [{ artworkId, fields: kept }] : [];
  });

  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  async function start() {
    if (starting || !selections.length) return;
    setStarting(true);
    setStartError('');
    try {
      await onStart(selections);
      dialog.current?.close();
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : '작업을 등록하지 못했어요.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <dialog ref={dialog} className="a-member-dialog a-analysis-targets-dialog" aria-labelledby={title}
      onClose={onClose} onCancel={event => { if (starting) event.preventDefault(); }}>
      <form className="a-member-dialog-card" onSubmit={event => { event.preventDefault(); void start(); }}>
        <header><h2 id={title}>{'scope' in scope ? '전체 전시 일괄 분석' : '전시 일괄 분석'}</h2></header>
        <div className="a-analysis-targets-body">
          {loading && <p role="status">분석 대상을 확인하는 중이에요.</p>}
          {error && <p role="alert" className="error-text">{error} <button type="button" className="a-btn sm" onClick={reload}>다시 확인</button></p>}
          {data?.exhibitions.length === 0 && <p>대기열에 추가할 미확정 항목이 없어요.</p>}
          {!!data?.exhibitions.length && <p>검수 완료 작품의 미확정 항목이에요. 제외할 작품이나 항목은 체크를 해제하세요.</p>}
          {data?.exhibitions.map(group => (
            <section key={group.exhibitionId}>
              <h3>{group.exhibitionTitle}</h3>
              {group.items.map(({ artworkId, title: artworkTitle, fields }) => {
                const excludedFields = excluded[artworkId] ?? [];
                return (
                <fieldset key={artworkId} disabled={starting}>
                  <legend>
                    <label>
                      <input type="checkbox" checked={excludedFields.length === 0} disabled={starting}
                        ref={element => { if (element) element.indeterminate = excludedFields.length > 0 && excludedFields.length < fields.length; }}
                        onChange={event => {
                          const checked = event.currentTarget.checked;
                          setExcluded(current => ({ ...current, [artworkId]: checked ? [] : fields }));
                        }} />
                      {artworkTitle}
                    </label>
                  </legend>
                  <div className="a-analysis-target-fields">
                    {fields.map(field => (
                      <label key={field}>
                        <input type="checkbox" checked={!excludedFields.includes(field)} onChange={event => {
                          const checked = event.currentTarget.checked;
                          setExcluded(current => {
                            const previous = current[artworkId] ?? [];
                            return { ...current, [artworkId]: checked ? previous.filter(key => key !== field) : [...previous, field] };
                          });
                        }} />
                        {analysisFieldLabels[field]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                );
              })}
            </section>
          ))}
        </div>
        <footer>
          {startError && <p role="alert" className="error-text">{startError}</p>}
          <span aria-live="polite">{selections.length}점 선택</span>
          <button type="button" className="a-btn" disabled={starting} onClick={() => dialog.current?.close()}>취소</button>
          <button type="submit" className="a-btn primary" disabled={starting || !selections.length}>
            {starting ? '등록 중…' : '분석 시작'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
