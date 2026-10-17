import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

export type CardTone = 'default' | 'accent' | 'muted' | 'info' | 'warm';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  selected?: boolean;
  children: ReactNode;
}

export function Card({
  tone = 'default',
  padding = 'md',
  selected = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        styles.card,
        styles[tone],
        styles[`pad-${padding}`],
        selected && styles.selected,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children'> {
  tone?: CardTone;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  selected?: boolean;
  children: ReactNode;
  disabled?: boolean;
}

/** 클릭 가능한 카드 (선택형 카드·목록 카드) */
export function CardButton({
  tone = 'default',
  padding = 'md',
  selected = false,
  className,
  children,
  ...rest
}: CardButtonProps) {
  return (
    <button
      type="button"
      className={[
        styles.card,
        styles.clickable,
        styles[tone],
        styles[`pad-${padding}`],
        selected && styles.selected,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
