import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState } from '../EmptyState/EmptyState';
import { ErrorState } from '../ErrorState/ErrorState';
import { PageSpinner } from '../Spinner/Spinner';

/**
 * 합의 7. 화면 상태 공통 기준 — Loading / Success / Empty / Error / Retry 를 한 곳에서 처리한다.
 * 모든 API 연동 화면은 이 컴포넌트로 감싸서 화면마다 제각각 처리하지 않는다.
 */
interface QueryStateProps<T> {
  query: Pick<
    UseQueryResult<T>,
    'data' | 'isPending' | 'isError' | 'error' | 'refetch' | 'isRefetching'
  >;
  /** Loading 시 표시 (기본: Spinner). 목록 화면은 Skeleton 권장 */
  loading?: ReactNode;
  /** Empty 판정 (기본: 배열이면 length === 0, 그 외 null/undefined) */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  errorTitle?: string;
  errorAction?: ReactNode;
  children: (data: T) => ReactNode;
}

function defaultIsEmpty(data: unknown) {
  if (Array.isArray(data)) return data.length === 0;
  return data === null || data === undefined;
}

export function QueryState<T>({
  query,
  loading,
  isEmpty = defaultIsEmpty,
  empty,
  errorTitle,
  errorAction,
  children,
}: QueryStateProps<T>) {
  if (query.isPending) return <>{loading ?? <PageSpinner />}</>;

  if (query.isError) {
    return (
      <ErrorState
        title={errorTitle}
        error={query.error}
        onRetry={() => query.refetch()}
        retrying={query.isRefetching}
        action={errorAction}
      />
    );
  }

  const data = query.data as T;
  if (isEmpty(data)) return <>{empty ?? <EmptyState title="표시할 데이터가 없어요" />}</>;

  return <>{children(data)}</>;
}
