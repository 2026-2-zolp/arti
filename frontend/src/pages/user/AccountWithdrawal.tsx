import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useConfirm } from '../../components/Confirmation';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { clearPrivateCaches } from '../../lib/visitScope';
import { useVisit } from '../../store/VisitContext';

export function AccountWithdrawal({ userId }: { userId: string }) {
  const { dispatch } = useVisit();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    if (!await confirm('계정에 저장한 취향, 관람기록, 대화를 삭제하고 모든 기기에서 로그아웃해요.', {
      title: '회원 탈퇴를 진행할까요?', confirm: '회원 탈퇴', tone: 'danger',
    })) return;
    setSubmitting(true);
    setError('');
    try {
      if (!await api.withdrawAccount(userId, password)) return;
      clearPrivateCaches();
      dispatch({ type: 'logout' });
      navigate('/', { replace: true });
    } catch (cause) {
      setPassword('');
      setError(cause instanceof ApiError ? cause.message : '탈퇴를 완료하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="account-disclosure">
      <summary><span>회원 탈퇴</span><Icon name="chevron" size={16} /></summary>
      <form className="account-disclosure-body" onSubmit={submit}>
        <p>계정에 저장한 취향, 관람기록, 대화가 삭제되고 모든 기기에서 로그아웃돼요.</p>
        <Field label="현재 비밀번호" type="password" autoComplete="current-password" maxLength={128}
          required value={password} disabled={submitting} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="account-danger-link" disabled={!password || submitting}>
          {submitting ? '탈퇴 처리 중…' : '계정 탈퇴 완료'}
        </button>
      </form>
    </details>
  );
}
