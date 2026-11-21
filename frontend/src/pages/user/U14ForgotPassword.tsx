import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isEmail } from '../../components/Field';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { safeRedirect, withRedirect } from '../../store/ExhibitionRoute';

const RESEND_DELAY_MS = 30 * 1000;

/** 로그인 지원과 재설정 메일 제공 상태를 안내합니다. */
export default function U14ForgotPassword() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const login = redirect ? withRedirect('/login', redirect) : '/login';
  const status = useAsync(api.passwordResetStatus, []);
  const [email, setEmail] = useState('');
  const [requestedEmail, setRequestedEmail] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<'entry' | 'sent' | 'edit'>('entry');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  const requestLink = async (address: string) => {
    if (pending) return;
    setError('');
    if (address === requestedEmail && retryAt > Date.now()) {
      setStep('sent');
      return;
    }
    setPending(true);
    try {
      await api.requestPasswordReset(address);
      setRequestedEmail(address);
      setRetryAt(Date.now() + RESEND_DELAY_MS);
      setStep('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : '링크를 요청하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!isEmail(address)) { setError('이메일 형식을 확인해 주세요.'); return; }
    void requestLink(address);
  };

  const enabled = status.data?.enabled === true;
  return (
    <MobileShell screenId="U-14" back={login}>
      <Lead title={enabled ? '비밀번호 재설정' : '로그인 도움'} desc={enabled
        ? '가입할 때 사용한 이메일로 재설정 링크를 보내요.'
        : status.loading ? '비밀번호 재설정 가능 여부를 확인하고 있어요.' : '현재는 비밀번호 재설정 메일을 보낼 수 없어요.'} />
      {enabled && (step === 'sent' ? (
        <div className="stack gap-12">
          <p role="status">등록된 이메일이라면 재설정 링크가 도착해요. 받은 편지함과 스팸함을 확인해 주세요. 메일이 여러 통이라면 마지막으로 요청한 메일의 링크를 열어 주세요.</p>
          <button className="btn outline block" type="button" disabled={pending || Boolean(retryAt)}
            aria-describedby={retryAt ? 'reset-resend-delay' : undefined} onClick={() => void requestLink(requestedEmail)}>
            {pending ? '요청 중…' : '메일 다시 보내기'}
          </button>
          {retryAt !== 0 && <p className="muted small" id="reset-resend-delay">요청 후 30초 뒤에 다시 보낼 수 있어요.</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn ghost block" type="button" disabled={pending} onClick={() => { setError(''); setStep('edit'); }}>이메일 수정하기</button>
        </div>
      ) : (
        <form className="stack gap-16" onSubmit={submit} noValidate>
          <Field label="이메일" type="email" autoComplete="email" inputMode="email" maxLength={254}
            autoFocus={step === 'edit'} value={email} onChange={event => setEmail(event.target.value)} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary block" type="submit" disabled={pending}>{pending ? '요청 중…' : '재설정 링크 요청'}</button>
        </form>
      ))}
      <Link className="btn outline block" to={login}>로그인으로 돌아가기</Link>
    </MobileShell>
  );
}
