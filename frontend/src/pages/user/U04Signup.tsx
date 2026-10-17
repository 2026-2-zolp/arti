/** U-04 회원가입 — 가입 완료 후 U-05 취향 파악으로 이동 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isEmail, isValidPassword } from '../../components/Field';
import { api } from '../../api/client';
import { useVisit } from '../../store/VisitContext';

type Errors = Partial<Record<'email' | 'password' | 'confirm' | 'terms' | 'form', string>>;

export default function U04Signup() {
  const navigate = useNavigate();
  const { dispatch } = useVisit();
  const [form, setForm] = useState({ email: '', password: '', confirm: '', nickname: '' });
  const [terms, setTerms] = useState({ service: false, privacy: false });
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // 입력 필드 공통 변경 함수: set("email")처럼 바꿀 항목 이름을 받아 onChange 함수를 만들어 준다
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = (): Errors => {
    const er: Errors = {};
    if (!isEmail(form.email)) er.email = '이메일 형식을 확인해 주세요.';
    if (!isValidPassword(form.password)) er.password = '8자 이상, 영문과 숫자를 함께 써 주세요.';
    if (form.confirm !== form.password) er.confirm = '비밀번호가 일치하지 않아요.';
    if (!terms.service || !terms.privacy) er.terms = '필수 약관에 동의해 주세요.';
    return er;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length) return;
    setSubmitting(true);
    try {
      const user = await api.signup({ email: form.email, password: form.password, nickname: form.nickname });
      dispatch({ type: 'login', user });
      dispatch({ type: 'setTastes', tastes: [] });
      navigate('/taste', { replace: true });
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : '가입에 실패했어요.' });
    } finally {
      setSubmitting(false);
    }
  };

  const allChecked = terms.service && terms.privacy;

  return (
    <MobileShell screenId="U-04" title="회원가입">
      <Lead title="취향과 기록을 저장해요" desc="다음 관람에서도 내 취향으로 바로 추천받을 수 있어요." />

      <form className="stack gap-16" onSubmit={onSubmit} noValidate>
        <Field label="이메일" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Field
          label="비밀번호"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="8자 이상, 영문+숫자"
        />
        <Field
          label="비밀번호 확인"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        <Field label="닉네임 (선택)" value={form.nickname} onChange={set('nickname')} maxLength={12} />

        <fieldset className="terms">
          <label className="check all">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => setTerms({ service: e.target.checked, privacy: e.target.checked })}
            />
            전체 동의
          </label>
          <label className="check">
            <input type="checkbox" checked={terms.service} onChange={(e) => setTerms((t) => ({ ...t, service: e.target.checked }))} />
            [필수] 서비스 이용약관
          </label>
          <label className="check">
            <input type="checkbox" checked={terms.privacy} onChange={(e) => setTerms((t) => ({ ...t, privacy: e.target.checked }))} />
            [필수] 개인정보 수집·이용 (취향·관람 기록)
          </label>
          {errors.terms && <span className="field-error">{errors.terms}</span>}
        </fieldset>

        {errors.form && <p className="error-text" role="alert">{errors.form}</p>}
        <button className="btn primary block" type="submit" disabled={submitting}>
          {submitting ? '가입 중…' : '회원가입'}
        </button>
      </form>
    </MobileShell>
  );
}
