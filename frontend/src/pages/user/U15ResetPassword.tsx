/** U-15 새 비밀번호 설정 — 이메일 재설정 링크(/password/reset?token=...)로 직접 진입 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isValidPassword } from '../../components/Field';
import { api } from '../../api/client';

export default function U15ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ pw?: string; confirm?: string; form?: string }>({});
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const er: typeof errors = {};
    if (!isValidPassword(pw)) er.pw = '8자 이상, 영문과 숫자를 함께 써 주세요.';
    if (pw !== confirm) er.confirm = '비밀번호가 일치하지 않아요.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSubmitting(true);
    try {
      await api.resetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : '설정에 실패했어요.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <MobileShell screenId="U-15" title="새 비밀번호 설정" back={false}>
        <div className="sent-box">
          <h2>비밀번호가 변경되었어요</h2>
          <p>새 비밀번호로 다시 로그인해 주세요.</p>
          <button className="btn primary block mt-24" onClick={() => navigate('/login', { replace: true })}>
            로그인하기
          </button>
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell screenId="U-15" title="새 비밀번호 설정" back="/login">
      <Lead title="새 비밀번호를 설정해 주세요" desc="8자 이상, 영문과 숫자를 함께 사용해 주세요." />
      {!token && <p className="error-text">재설정 링크가 올바르지 않아요. 비밀번호 찾기를 다시 진행해 주세요.</p>}
      <form className="stack gap-16" onSubmit={onSubmit} noValidate>
        <Field label="새 비밀번호" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errors.pw} />
        <Field
          label="새 비밀번호 확인"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        {errors.form && <p className="error-text" role="alert">{errors.form}</p>}
        <button className="btn primary block" type="submit" disabled={submitting || !token}>
          {submitting ? '저장 중…' : '비밀번호 설정'}
        </button>
        <button className="btn ghost block" type="button" onClick={() => navigate('/login')}>
          취소
        </button>
      </form>
    </MobileShell>
  );
}
