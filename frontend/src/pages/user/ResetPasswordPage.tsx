import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/api/services/auth.api';
import { getErrorMessage } from '@/api/types';
import { Button, ErrorState, Input, useToast } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { paths } from '@/routes/paths';
import common from './common.module.css';

/** U-15 새 비밀번호 설정 (/password/reset?token=...) */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  const mutation = useMutation({
    mutationFn: () => authApi.resetPassword(token ?? '', password),
    onSuccess: () => {
      toast.success('비밀번호가 변경되었어요. 다시 로그인해 주세요.');
      navigate(paths.login, { replace: true });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (password.length < 8) next.password = '비밀번호는 8자 이상 입력해 주세요.';
    if (password !== confirm) next.confirm = '비밀번호가 일치하지 않아요.';
    setErrors(next);
    if (Object.keys(next).length === 0) mutation.mutate();
  };

  return (
    <MobileLayout onBack={() => navigate(paths.login)} align="center">
      {!token ? (
        <ErrorState
          title="유효하지 않은 링크예요"
          message="이메일로 받은 재설정 링크를 다시 확인하거나 새 링크를 요청해 주세요."
          action={
            <Button fullWidth onClick={() => navigate(paths.forgotPassword)}>
              재설정 링크 다시 받기
            </Button>
          }
        />
      ) : (
        <>
          <PageIntro
            align="center"
            title="새 비밀번호를 입력해 주세요"
            description="새 비밀번호를 설정한 뒤 다시 로그인해 주세요."
          />
          <form className={common.form} onSubmit={handleSubmit} noValidate>
            <Input
              label="새 비밀번호"
              type="password"
              autoComplete="new-password"
              value={password}
              error={errors.password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label="새 비밀번호 확인"
              type="password"
              autoComplete="new-password"
              value={confirm}
              error={errors.confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mutation.isError && (
              <p className={common.formError} role="alert">
                {getErrorMessage(mutation.error)}
              </p>
            )}
            <Button type="submit" fullWidth loading={mutation.isPending}>
              비밀번호 설정
            </Button>
          </form>
          <p className={common.linkRow}>
            <Link to={paths.login}>취소하고 로그인으로 돌아가기</Link>
          </p>
        </>
      )}
    </MobileLayout>
  );
}
