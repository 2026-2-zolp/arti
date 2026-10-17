import type { ReactNode } from 'react';
import { Icon } from '@/components/common';
import { useGoBack } from '@/hooks/useGoBack';
import styles from './MobileLayout.module.css';

interface MobileLayoutProps {
  title?: ReactNode;
  /** 뒤로가기 동작. 지정하지 않으면 history back (없으면 backFallback) */
  onBack?: () => void;
  backFallback?: string;
  showBack?: boolean;
  headerRight?: ReactNode;
  /** 하단 고정 CTA 영역 */
  footer?: ReactNode;
  children: ReactNode;
  /** 본문 정렬 (비밀번호 찾기 화면처럼 세로 중앙 정렬) */
  align?: 'top' | 'center';
}

/** 사용자 모바일 웹 공통 레이아웃 (최소 360px, 최대 480px 중앙 정렬) */
export function MobileLayout({
  title,
  onBack,
  backFallback = '/',
  showBack = true,
  headerRight,
  footer,
  children,
  align = 'top',
}: MobileLayoutProps) {
  const goBack = useGoBack(backFallback);

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.side}>
            {showBack && (
              <button
                type="button"
                className={styles.back}
                onClick={onBack ?? goBack}
                aria-label="뒤로가기"
              >
                <Icon name="chevronLeft" size={28} strokeWidth={1.6} />
              </button>
            )}
          </div>
          <h1 className={styles.title}>{title}</h1>
          <div className={`${styles.side} ${styles.right}`}>{headerRight}</div>
        </header>

        <main className={`${styles.main} ${align === 'center' ? styles.center : ''}`}>
          {children}
        </main>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  );
}

/** 화면 상단 큰 제목 + 설명 */
export function PageIntro({
  title,
  description,
  align = 'left',
}: {
  title: ReactNode;
  description?: ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <div className={`${styles.intro} ${align === 'center' ? styles.introCenter : ''}`}>
      <h2 className={styles.introTitle}>{title}</h2>
      {description && <p className={styles.introDescription}>{description}</p>}
    </div>
  );
}
