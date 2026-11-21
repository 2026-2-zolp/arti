import { useRef, useState, type FormEvent } from 'react';
import { api, type AdminOpenAISettings } from '../../api/client';
import { useAsync } from '../../lib/useAsync';

const keyLabel: Record<AdminOpenAISettings['keyStatus'], string> = {
  saved: '관리자 설정에 저장됨',
  environment: '서버 환경 키 사용',
  missing: '등록된 키 없음',
  unreadable: '암호화 설정 또는 저장된 키 확인 필요',
};

function SettingsFields({ config, onSaved }: { config: AdminOpenAISettings; onSaved: (next: AdminOpenAISettings) => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const keyField = useRef<HTMLInputElement>(null);
  const secure = window.isSecureContext;
  const canSave = secure && config.editable;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSave) return;
    const data = new FormData(event.currentTarget);
    const model = String(data.get('model')).trim();
    const apiKey = keyField.current?.value.trim();
    if (keyField.current) keyField.current.value = '';
    setSaving(true);
    setError('');
    try {
      const next = await api.saveAdminOpenAISettings({
        model, enabled: data.has('enabled'), revision: config.revision, ...(apiKey ? { apiKey } : {}),
      });
      onSaved(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'AI 설정을 저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack gap-10" onSubmit={submit}>
      <label><input name="enabled" type="checkbox" defaultChecked={config.enabled} disabled={saving || !secure} /> OpenAI 텍스트 모델 사용</label>
      <label className="a-field">
        <span>OpenAI 모델 ID</span>
        <input name="model" list="openai-text-models" defaultValue={config.model} maxLength={200} required disabled={saving || !secure} />
        <datalist id="openai-text-models"><option value="gpt-6-luna" /></datalist>
      </label>
      <label className="a-field">
        <span>프로젝트 API 키 등록·교체</span>
        <input type="password" autoComplete="new-password" spellCheck={false} placeholder="sk-…" maxLength={503}
          ref={keyField} disabled={saving || !secure} />
      </label>
      <p className="muted small">{!secure ? 'HTTPS에서 프로젝트 키를 등록할 수 있어요.'
        : !config.editable ? '서버 암호화 설정이 준비되면 키를 등록·교체할 수 있어요.'
          : '새 키를 입력할 때만 저장된 키를 교체해요. 저장만으로 모델을 호출하지 않아요.'}</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="a-btn primary" disabled={saving || !canSave}>{saving ? '저장 중…' : 'AI 설정 저장'}</button>
    </form>
  );
}

export default function OpenAISettingsPanel({ refreshUsage }: { refreshUsage: () => void }) {
  const { data, loading, error, reload, setData } = useAsync(api.adminOpenAISettings, []);
  const [message, setMessage] = useState('');
  return (
    <section className="a-card pad stack gap-10" aria-label="OpenAI 연결 설정">
      <h2>OpenAI 연결 설정</h2>
      {loading && <p role="status">AI 설정을 불러오는 중…</p>}
      {error && <p role="alert">{error}</p>}
      {data && <>
        <p>프로젝트 키 {keyLabel[data.keyStatus]} · 텍스트 모델 {data.model || '미설정'}</p>
        {data.draftUsesSeparateProvider && <p className="muted small">별도 요약·가이드 제공자는 서버 환경 설정을 유지해요.</p>}
        <SettingsFields key={data.revision} config={data} onSaved={next => {
          setData(next);
          setMessage('AI 설정을 저장했어요. 첫 호출의 결과는 운영 로그에서 확인하세요.');
          refreshUsage();
        }} />
      </>}
      {message && <p role="status">{message}</p>}
      <button type="button" className="a-btn" onClick={() => { setMessage(''); reload(); }} disabled={loading}>AI 설정 다시 조회</button>
    </section>
  );
}
