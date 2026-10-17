import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { paths } from '@/routes/paths';
import styles from './AdminLayout.module.css';

const MENUS = [
  { to: paths.adminDashboard, label: '대시보드', end: true },
  { to: paths.adminExhibitions, label: '전시 관리' },
  { to: paths.adminArtworks, label: '작품 관리' },
  { to: paths.adminMap, label: '위치·지도 관리' },
  { to: paths.adminMembers, label: '회원 조회' },
];

/** 관리자 데스크톱 웹 공통 레이아웃 (1280px 이상 기준) */
export function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>ARTI</span>
          <span className={styles.brandSub}>관리자</span>
        </div>
        <div className={styles.account}>
          <button
            type="button"
            className={styles.accountButton}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
          >
            관리자 계정{admin ? ` · ${admin.name}` : ''}
          </button>
          {menuOpen && (
            <div className={styles.accountMenu}>
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate(paths.adminLogin, { replace: true });
                }}
              >
                로그아웃
              </button>
            </div>
          )}
        </div>
      </header>
      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="관리자 메뉴">
          {MENUS.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) => `${styles.menu} ${isActive ? styles.active : ''}`}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {description && <p className={styles.pageDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </div>
  );
}

/** 관리자 화면 흰색 패널 */
export function AdminPanel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      {title && <h2 className={styles.panelTitle}>{title}</h2>}
      {children}
    </section>
  );
}
