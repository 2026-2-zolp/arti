import type { ReactNode } from 'react';
import { getErrorMessage } from '@/api/types';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import styles from '../EmptyState/EmptyState.module.css';

interface ErrorStateProps {
  title?: string;
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  action?: ReactNode;
}

/** 합의 7. Error → 오류 안내 + 다시 시도 버튼 */
export function ErrorState({
  title = '정보를 불러오지 못했어요',
  error,
  message,
  onRetry,
  retrying = false,
  action,
}: ErrorStateProps) {
  return (
    <div className={`${styles.wrap} ${styles.error}`} role="alert">
      <span className={styles.icon}>
        <Icon name="alert" size={28} />
      </span>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{message ?? getErrorMessage(error)}</p>
      {(onRetry || action) && (
        <div className={styles.action}>
          {onRetry && (
            <Button variant="secondary" size="md" fullWidth onClick={onRetry} loading={retrying}>
              다시 시도
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
