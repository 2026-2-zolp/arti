import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: CSSProperties['borderRadius'];
  className?: string;
}

export function Skeleton({ width = '100%', height = 16, radius = 8, className }: SkeletonProps) {
  return (
    <span
      className={`${styles.skeleton} ${className ?? ''}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** 목록형 화면 기본 스켈레톤 */
export function SkeletonList({
  count = 3,
  itemHeight = 120,
}: {
  count?: number;
  itemHeight?: number;
}) {
  return (
    <div className={styles.list} role="status" aria-label="불러오는 중">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={itemHeight} radius={16} />
      ))}
    </div>
  );
}
