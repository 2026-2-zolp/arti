import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Field } from '../../components/Field';
import { useAsync } from '../../lib/useAsync';

export function KakaoAccountLink() {
  const { data } = useAsync(api.kakaoStatus, []);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (!data?.enabled) return null;
  if (data.linked) return <p className="muted small">카카오 계정 연결됨</p>;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const { authorizationUrl } = await api.startKakao({ mode: 'link', password });
      setPassword('');
      window.location.assign(authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '카카오 계정 연결을 시작하지 못했어요.');
      setPending(false);
    }
  };

  return (
    <details>
      <summary>카카오 계정 연결</summary>
      <form className="stack gap-16 mt-12" onSubmit={onSubmit}>
        <p className="muted small">카카오 회원번호를 이 계정에 저장해 다음 로그인에 사용해요.</p>
        <Field label="현재 ARTI 비밀번호" type="password" autoComplete="current-password"
          value={password} required maxLength={128} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn outline block" type="submit" disabled={pending}>
          {pending ? '카카오로 이동 중…' : '카카오에서 본인 확인'}
        </button>
      </form>
    </details>
  );
}
