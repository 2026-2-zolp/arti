import styles from './Spinner.module.css';

interface SpinnerProps {
  size?: number;
  tone?: 'dark' | 'light' | 'accent';
  label?: string;
}

export function Spinner({ size = 28, tone = 'dark', label = '불러오는 중' }: SpinnerProps) {
  return (
    <span
      className={`${styles.spinner} ${styles[tone]}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 10)) }}
      role="status"
      aria-label={label}
    />
  );
}

/** 화면 단위 로딩 */
export function PageSpinner({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div className={styles.page}>
      <Spinner size={32} tone="accent" label={label} />
      <p className={styles.text}>{label}</p>
    </div>
  );
}
