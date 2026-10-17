/** U-03 로그인 — 외부 로그인 URL(/login)로 직접 진입 가능, ?redirect= 로 인증 후 복귀 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isEmail } from '../../components/Field';
import { api } from '../../api/client';
import { useVisit } from '../../store/VisitContext';

export default function U03Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect');
  const { dispatch } = useVisit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault(); // form 기본 동작(페이지 새로고침) 막기
    if (!isEmail(email)) return setError('이메일 형식을 확인해 주세요.');
    if (!password) return setError('비밀번호를 입력해 주세요.');
    setSubmitting(true);
    setError(null);
    try {
      const user = await api.login(email, password);
      dispatch({ type: 'login', user });
      // 관람기록 URL 등에서 넘어온 경우 원래 화면으로, 아니면 U-06 저장 취향 확인
      navigate(redirect && redirect.startsWith('/') ? redirect : '/taste/saved', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileShell screenId="U-03" title="로그인" back="/entry">
      <Lead title="다시 오셨군요" desc="로그인은 선택사항이에요. 저장된 취향과 관람기록을 이어서 쓸 수 있어요." />

      <form className="stack gap-16" onSubmit={onSubmit} noValidate>
        <Field
          label="이메일"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@email.com"
        />
        <Field
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
        />
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary block" type="submit" disabled={submitting}>
          {submitting ? '로그인 중…' : '로그인'}
        </button>
      </form>

      <div className="row-links">
        <button className="link-btn" onClick={() => navigate('/password/forgot')}>
          비밀번호 찾기
        </button>
        <span className="divider-dot" />
        <button className="link-btn" onClick={() => navigate('/signup')}>
          회원가입
        </button>
      </div>

      <p className="demo-hint">데모 계정: demo@arti.app / arti1234</p>
    </MobileShell>
  );
}
