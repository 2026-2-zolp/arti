import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isEmail } from '../../components/Field';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { safeRedirect, withRedirect } from '../../store/ExhibitionRoute';

/** 로그인 지원과 재설정 메일 제공 상태를 안내합니다. */
export default function U14ForgotPassword() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const login = redirect ? withRedirect('/login', redirect) : '/login';
  const status = useAsync(api.passwordResetStatus, []);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || sent) return;
    if (!isEmail(email)) { setError('이메일 형식을 확인해 주세요.'); return; }
    setError('');
    setPending(true);
    try {
      await api.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '링크를 요청하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  };

  const enabled = status.data?.enabled === true;
  return (
    <MobileShell screenId="U-14" back={login}>
      <Lead title={enabled ? '비밀번호 재설정' : '로그인 도움'} desc={enabled
        ? '가입할 때 사용한 이메일로 재설정 링크를 보내요.'
        : status.loading ? '비밀번호 재설정 가능 여부를 확인하고 있어요.' : '현재는 비밀번호 재설정 메일을 보낼 수 없어요.'} />
      {enabled && (sent ? <p role="status">등록된 이메일이라면 재설정 링크가 도착해요. 받은 편지함을 확인해 주세요.</p> : (
        <form className="stack gap-16" onSubmit={submit} noValidate>
          <Field label="이메일" type="email" autoComplete="email" inputMode="email" maxLength={254}
            value={email} onChange={event => setEmail(event.target.value)} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary block" type="submit" disabled={pending}>{pending ? '요청 중…' : '재설정 링크 요청'}</button>
        </form>
      ))}
      <Link className="btn outline block" to={login}>로그인으로 돌아가기</Link>
    </MobileShell>
  );
}
