import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Field, isValidPassword } from '../../components/Field';
import { Lead, MobileShell } from '../../components/MobileShell';

export default function U15ResetPassword() {
  const [token, setToken] = useState('');
  const activeLink = useRef(0);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const takeLink = () => {
      if (!window.location.hash) return;
      const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
      window.history.replaceState(window.history.state, '', '/password/reset');
      activeLink.current += 1;
      setToken(/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value) ? value : '');
      setPassword('');
      setConfirmation('');
      setError('');
      setComplete(false);
      setPending(false);
    };
    takeLink();
    window.addEventListener('hashchange', takeLink);
    return () => window.removeEventListener('hashchange', takeLink);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || complete || !token) return;
    if (!isValidPassword(password) || password.length > 128) {
      setError('비밀번호는 영문·숫자 포함 8~128자로 입력해 주세요.');
      return;
    }
    if (password !== confirmation) { setError('새 비밀번호가 서로 달라요.'); return; }
    setError('');
    setPending(true);
    const submittedLink = activeLink.current;
    try {
      await api.resetPassword(token, password);
      if (submittedLink !== activeLink.current) return;
      setPassword('');
      setConfirmation('');
      setToken('');
      setComplete(true);
    } catch (err) {
      if (submittedLink === activeLink.current) setError(err instanceof Error ? err.message : '비밀번호를 바꾸지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (submittedLink === activeLink.current) setPending(false);
    }
  };

  return (
    <MobileShell screenId="U-15" back="/login">
      <Lead title={complete ? '비밀번호를 바꿨어요' : '새 비밀번호 설정'} desc={complete
        ? '새 비밀번호로 다시 로그인해 주세요.' : token ? '영문·숫자를 포함해 8~128자로 입력해 주세요.' : '이메일로 받은 재설정 링크를 열어 주세요.'} />
      {token && (
        <form className="stack gap-16" onSubmit={submit} noValidate>
          <Field label="새 비밀번호" type="password" autoComplete="new-password" maxLength={128}
            value={password} onChange={event => setPassword(event.target.value)} />
          <Field label="새 비밀번호 확인" type="password" autoComplete="new-password" maxLength={128}
            value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary block" type="submit" disabled={pending}>{pending ? '저장 중…' : '비밀번호 바꾸기'}</button>
        </form>
      )}
      {!complete && <Link className="btn outline block" to="/password/forgot">새 링크 요청</Link>}
      <Link className="btn outline block" to="/login">로그인으로 돌아가기</Link>
    </MobileShell>
  );
}
