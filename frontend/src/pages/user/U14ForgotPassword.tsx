/** U-14 비밀번호 찾기 — 가입 이메일로 재설정 링크 요청 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isEmail } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';

export default function U14ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError('이메일 형식을 확인해 주세요.');
    setError(null);
    setSubmitting(true);
    const res = await api.requestPasswordReset(email);
    setDemoToken(res.demoToken);
    setSent(true);
    setSubmitting(false);
  };

  return (
    <MobileShell screenId="U-14" title="비밀번호 찾기" back="/login">
      {!sent ? (
        <>
          <Lead title="비밀번호를 잊으셨나요?" desc="가입한 이메일을 입력하면 비밀번호 재설정 링크를 보내 드려요." />
          <form className="stack gap-16" onSubmit={onSubmit} noValidate>
            <Field
              label="이메일"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              placeholder="example@email.com"
            />
            <button className="btn primary block" type="submit" disabled={submitting}>
              {submitting ? '보내는 중…' : '재설정 링크 보내기'}
            </button>
          </form>
        </>
      ) : (
        <div className="sent-box">
          <span className="sent-icon">
            <Icon name="send" size={26} />
          </span>
          <h2>이메일을 확인해 주세요</h2>
          <p>
            <strong>{email}</strong>(으)로 가입된 계정이 있다면
            <br />
            비밀번호 재설정 링크를 보냈어요.
          </p>
          <p className="muted small">메일이 보이지 않으면 스팸함을 확인하거나 잠시 후 다시 요청해 주세요.</p>
          <Link className="btn outline block mt-24" to="/login">
            로그인으로 돌아가기
          </Link>
          {/* 목업 전용: 실제 메일 발송 대신 링크를 바로 보여 준다 */}
          {demoToken && (
            <Link className="demo-hint as-link" to={`/password/reset?token=${demoToken}`}>
              [데모] 메일 속 재설정 링크 열기
            </Link>
          )}
        </div>
      )}
    </MobileShell>
  );
}
