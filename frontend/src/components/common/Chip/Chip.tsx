import type { ReactNode } from 'react';
import styles from './Chip.module.css';

interface ChipProps {
  children: ReactNode;
  tone?: 'outline' | 'accent' | 'neutral' | 'success' | 'warning';
  size?: 'sm' | 'md';
}

/** 취향 키워드·추천 이유·상태 배지 공통 */
export function Chip({ children, tone = 'outline', size = 'md' }: ChipProps) {
  return <span className={`${styles.chip} ${styles[tone]} ${styles[size]}`}>{children}</span>;
}
