import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { getErrorMessage } from '@/api/types';
import { Button, Card, Input } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useAuth } from '@/contexts/AuthContext';
import { paths, withQuery } from '@/routes/paths';
import { sanitizeReturnUrl } from '@/utils/returnUrl';
import common from './common.module.css';

/**
 * U-03 로그인 (/login?returnUrl=...)
 * 합의 3. returnUrl 이 있으면 원래 화면으로 복귀, 없으면 서비스 기본 화면("/")으로 이동.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'));
  const { login, isLoggedIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: () => navigate(returnUrl ?? paths.root, { replace: true }),
  });

  // 이미 로그인한 상태로 로그인 URL 에 들어온 경우
  if (isLoggedIn && !mutation.isPending && !mutation.isSuccess) {
    return <Navigate to={returnUrl ?? paths.root} replace />;
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setFieldError('이메일과 비밀번호를 입력해 주세요.');
      return;
    }
    setFieldError(null);
    mutation.mutate();
  };

  // 저장 취향 확인(U-06)으로 가던 흐름에서 회원가입하면 → 취향 파악(U-05)
  const signupReturnUrl = returnUrl?.replace(/\/taste\/saved$/, '/taste');
  const errorMessage = fieldError ?? (mutation.isError ? getErrorMessage(mutation.error) : null);

  return (
    <MobileLayout title="로그인" backFallback={paths.root}>
      <PageIntro
        title="다시 만나 반가워요"
        description="저장한 취향을 불러와 이번 관람에 활용합니다."
      />

      <form className={common.form} onSubmit={handleSubmit} noValidate>
        <Input
          label="이메일"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {errorMessage && (
          <p className={common.formError} role="alert">
            {errorMessage}
          </p>
        )}
        <Button type="submit" fullWidth loading={mutation.isPending}>
          로그인
        </Button>
      </form>

      <p className={common.linkRow}>
        <Link to={paths.forgotPassword}>비밀번호 찾기</Link>
        <span className={common.divider}>|</span>
        <Link to={withQuery(paths.signup, { returnUrl: signupReturnUrl })}>회원가입</Link>
      </p>

      <Card tone="info" padding="lg" style={{ marginTop: 48 }}>
        <p className={common.cardTitle}>로그인은 선택사항입니다.</p>
        <p className={common.cardText}>
          로그인 없이도 추천 · 지도 · 작품 감상을 사용할 수 있습니다.
        </p>
      </Card>
    </MobileLayout>
  );
}
