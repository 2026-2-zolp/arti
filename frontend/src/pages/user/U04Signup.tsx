/** U-04 회원가입 — 가입 완료 후 ?redirect= 로 받은 전시의 U-05 취향 파악으로 이동 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Field, isEmail, isValidPassword } from '../../components/Field';
import { SignupDocument } from '../../components/SignupDocument';
import { ApiError, api } from '../../api/client';
import { SIGNUP_TERMS_VERSION, signupPrivacy, signupTerms } from '../../data/signupDocuments';
import { useVisit } from '../../store/VisitContext';
import { safeRedirect } from '../../store/ExhibitionRoute';

type Errors = Partial<Record<'email' | 'password' | 'confirm' | 'terms' | 'form', string>>;

/** 회원 가입 화면 */
export default function U04Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { dispatch } = useVisit();
  const [form, setForm] = useState({ email: '', password: '', confirm: '', nickname: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);
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
    if (!termsAccepted) er.terms = '서비스 이용약관에 동의해 주세요.';
    return er;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length) return;
    setSubmitting(true);
    try {
      const user = await api.signup({
        email: form.email,
        password: form.password,
        nickname: form.nickname,
        termsAccepted,
        termsVersion: SIGNUP_TERMS_VERSION,
      });
      dispatch({ type: 'login', user });
      dispatch({ type: 'setTastes', tastes: [] });
      // 새 계정은 저장된 취향이 없으니, 로그인 화면에서 넘어온 「저장 취향 확인」 주소는 취향 파악으로 바꾼다
      const redirect = safeRedirect(params.get('redirect'))?.replace(/\/taste\/saved$/, '/taste');
      navigate(redirect ?? '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TERMS_VERSION_CHANGED') setTermsAccepted(false);
      setErrors({ form: err instanceof Error ? err.message : '가입에 실패했어요.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileShell screenId="U-04">
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
        <Field label="닉네임 (선택)" value={form.nickname} onChange={set('nickname')} maxLength={100} />

        <fieldset className="terms">
          <legend className="sr-only">가입 안내</legend>
          <label className="check">
            <input
              type="checkbox"
              required
              checked={termsAccepted}
              disabled={submitting}
              aria-invalid={Boolean(errors.terms)}
              aria-describedby={errors.terms ? 'signup-terms-error' : undefined}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            [필수] 서비스 이용약관에 동의합니다
          </label>
          {errors.terms && <span id="signup-terms-error" className="field-error" role="alert">{errors.terms}</span>}
          <p className="muted small">이메일과 비밀번호는 가입과 로그인에 사용해요. 회원의 관람기록과 직접 저장한 취향은 계정에 남아요.</p>
          <div className="signup-document-links">
            <SignupDocument title="서비스 이용약관" version={SIGNUP_TERMS_VERSION} sections={signupTerms} />
            <SignupDocument title="개인정보 처리방침" sections={signupPrivacy} />
          </div>
        </fieldset>

        {errors.form && <p className="error-text" role="alert">{errors.form}</p>}
        <button className="btn primary block" type="submit" disabled={submitting}>
          {submitting ? '가입 중…' : '회원가입'}
        </button>
      </form>
    </MobileShell>
  );
}
