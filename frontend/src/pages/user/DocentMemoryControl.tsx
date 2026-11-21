import { useState } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/Confirmation';
import { Icon } from '../../components/Icon';
import { useAsync } from '../../lib/useAsync';

export function DocentMemoryControl({ userId }: { userId: string }) {
  const { data, error, reload, loading, setData } = useAsync(() => api.getDocentMemorySettings(userId), [userId]);
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState('');

  const update = async (change: { enabled: boolean } | { reset: true }) => {
    setBusy(true);
    setResult('');
    setFailure('');
    try {
      const updated = await api.updateDocentMemorySettings(userId, change);
      setData(updated);
      setResult('reset' in change ? '지난 전시 기억을 지웠어요.' :
        updated.enabled ? '지난 전시 기억을 켰어요.' : '지난 전시 기억을 껐어요.');
    } catch (e) {
      setFailure(e instanceof Error ? e.message : '기억 설정을 변경하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    const accepted = await confirmAction('도슨트가 참고하는 감상 주제를 지웁니다. 영수증과 작품별 대화 요약은 계속 볼 수 있어요.',
      { title: '지난 전시 기억을 지울까요?', confirm: '기억 지우기', tone: 'danger' });
    if (accepted) await update({ reset: true });
  };

  return <details className="account-disclosure">
    <summary><span>지난 전시 기억</span>{data && <small>{data.enabled ? '켜짐' : '꺼짐'}</small>}<Icon name="chevron" size={16} /></summary>
    <div className="account-disclosure-body">
    {loading && <p role="status">기억 설정을 불러오고 있어요.</p>}
    {error && <p role="alert">{error} <button className="link-btn" type="button" onClick={reload}>다시 불러오기</button></p>}
    {data && <>
      <p className="muted small">도슨트가 최근 {data.retentionDays}일 동안 저장한 다른 전시의 감상 주제를 참고해요.</p>
      <div className="action-row">
        <button className="btn outline" type="button" disabled={busy}
          onClick={() => update({ enabled: !data.enabled })}>{data.enabled ? '기억 끄기' : '기억 켜기'}</button>
        <button className="btn outline" type="button" disabled={busy} onClick={reset}>지난 전시 기억 지우기</button>
      </div>
    </>}
    {result && <p role="status">{result}</p>}
    {failure && <p className="error-text" role="alert">{failure}</p>}
    </div>
  </details>;
}
