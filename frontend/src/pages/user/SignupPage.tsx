import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError, getErrorMessage } from '@/api/types';
import { Button, Input, useToast } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useVisitSession } from '@/contexts/VisitSessionContext';
import { paths } from '@/routes/paths';
import { sanitizeReturnUrl } from '@/utils/returnUrl';
import common from './common.module.css';
import styles from './SignupPage.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Errors {
  email?: string;
  password?: string;
  terms?: string;
}

/** U-04 회원가입 — 가입 완료 → U-05 취향 파악 */
export function SignupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const returnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'));
  const { signup } = useAuth();
  const { session } = useVisitSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const mutation = useMutation({
    mutationFn: () =>
      signup({ email: email.trim(), password, nickname: nickname.trim(), agreeTerms: agree }),
    onSuccess: () => {
      toast.success('가입이 완료되었어요');
      const next =
        returnUrl ??
        (session?.status === 'in_progress' ? paths.taste(session.exhibitionId) : paths.root);
      navigate(next, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'EMAIL_DUPLICATED') {
        setErrors({ email: error.message });
      }
    },
  });

  const validate = (): Errors => {
    const next: Errors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = '올바른 이메일 형식으로 입력해 주세요.';
    if (password.length < 8) next.password = '비밀번호는 8자 이상 입력해 주세요.';
    if (!agree) next.terms = '약관에 동의해 주세요.';
    return next;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length === 0) mutation.mutate();
  };

  const serverError =
    mutation.isError &&
    !(mutation.error instanceof ApiError && mutation.error.code === 'EMAIL_DUPLICATED')
      ? getErrorMessage(mutation.error)
      : null;

  return (
    <MobileLayout title="회원가입" backFallback={paths.root}>
      <PageIntro
        title="관람 기록을 저장해보세요"
        description="가입 후 취향과 아트 영수증을 다음 관람에도 이어서 활용합니다."
      />

      <form className={common.form} onSubmit={handleSubmit} noValidate>
        <Input
          label="이메일"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="비밀번호"
          type="password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          hint="8자 이상"
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="닉네임 (선택)"
          autoComplete="nickname"
          maxLength={20}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />

        <label className={styles.terms}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span>서비스 이용 약관 및 개인정보 처리방침에 동의합니다.</span>
        </label>
        {errors.terms && <p className={styles.termsError}>{errors.terms}</p>}

        {serverError && (
          <p className={common.formError} role="alert">
            {serverError}
          </p>
        )}

        <Button type="submit" fullWidth loading={mutation.isPending} className={styles.submit}>
          회원가입
        </Button>
      </form>
    </MobileLayout>
  );
}
