import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { getErrorMessage } from '@/api/types';
import { Button, Input } from '@/components/common';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { paths } from '@/routes/paths';
import { sanitizeReturnUrl } from '@/utils/returnUrl';
import styles from './AdminLoginPage.module.css';

/** A-01 관리자 로그인 */
export function AdminLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'));
  const { login, status } = useAdminAuth();

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => login(loginId.trim(), password),
    onSuccess: () => navigate(returnUrl ?? paths.adminDashboard, { replace: true }),
  });

  if (status === 'authenticated' && !mutation.isSuccess) {
    return <Navigate to={returnUrl ?? paths.adminDashboard} replace />;
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password) {
      setFieldError('관리자 ID와 비밀번호를 입력해 주세요.');
      return;
    }
    setFieldError(null);
    mutation.mutate();
  };

  const error = fieldError ?? (mutation.isError ? getErrorMessage(mutation.error) : null);

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.title}>ARTI 관리자</h1>
        <p className={styles.description}>전시와 작품 데이터를 관리합니다.</p>
        <div className={styles.fields}>
          <Input
            tone="admin"
            label="관리자 ID"
            autoComplete="username"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
          />
          <Input
            tone="admin"
            label="비밀번호"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" fullWidth loading={mutation.isPending} className={styles.submit}>
          로그인
        </Button>
      </form>
    </div>
  );
}
