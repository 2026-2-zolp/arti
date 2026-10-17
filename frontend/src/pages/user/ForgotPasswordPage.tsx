import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/api/services/auth.api';
import { getErrorMessage } from '@/api/types';
import { Button, Card, Input } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { IS_MOCK } from '@/config';
import { paths, withQuery } from '@/routes/paths';
import common from './common.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** U-14 비밀번호 찾기 — 재설정 링크 요청 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({ mutationFn: () => authApi.requestPasswordReset(email.trim()) });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('올바른 이메일 형식으로 입력해 주세요.');
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <MobileLayout onBack={() => navigate(paths.login)} align="center">
      <PageIntro
        align="center"
        title="비밀번호를 잊으셨나요?"
        description="가입한 이메일로 비밀번호 재설정 링크를 보내드립니다."
      />

      {mutation.isSuccess ? (
        <div className={common.stack}>
          <Card tone="info" padding="lg">
            <p className={common.cardTitle}>메일을 확인해 주세요</p>
            <p className={common.cardText}>
              {email} 주소로 재설정 링크를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.
            </p>
          </Card>
          {IS_MOCK && mutation.data.devResetToken && (
            <Link
              className={common.caption}
              to={withQuery(paths.resetPassword, { token: mutation.data.devResetToken })}
            >
              (임시 데이터 모드) 이메일 속 재설정 링크 열기
            </Link>
          )}
          <Button variant="secondary" fullWidth onClick={() => mutation.reset()}>
            다른 이메일로 다시 보내기
          </Button>
        </div>
      ) : (
        <form className={common.form} onSubmit={handleSubmit} noValidate>
          <Input
            label="이메일"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="이메일 주소를 입력해 주세요"
            value={email}
            error={error ?? (mutation.isError ? getErrorMessage(mutation.error) : null)}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" fullWidth loading={mutation.isPending}>
            재설정 링크 보내기
          </Button>
        </form>
      )}

      <p className={common.linkRow}>
        <Link to={paths.login}>로그인으로 돌아가기</Link>
      </p>
    </MobileLayout>
  );
}
