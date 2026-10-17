/** 관리자 공통 레이아웃 (데스크톱): 상단 바 + 좌측 메뉴 + 본문(Outlet) */
import type { ReactNode } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { load, remove } from '../../lib/storage';

export const ADMIN_KEY = 'arti.admin';
export const isAdminLoggedIn = () => !!load<{ name: string } | null>(ADMIN_KEY, null);

const MENU = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/exhibitions', label: '전시 관리' },
  { to: '/admin/artworks', label: '작품 관리' },
  { to: '/admin/map', label: '위치·지도 관리' },
  { to: '/admin/members', label: '회원 조회' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  // 로그인하지 않았으면 A-01로 보낸다 (라우트 가드)
  if (!isAdminLoggedIn()) return <Navigate to="/admin/login" replace />;

  const logout = () => {
    api.adminLogout();
    remove(ADMIN_KEY);
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-brand">
          <strong>ARTI</strong>
          <span>관리자</span>
        </div>
        <div className="admin-account">
          <span>관리자 계정</span>
          <button className="text-btn" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>
      <nav className="admin-side" aria-label="관리자 메뉴">
        {MENU.map((m) => (
          <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {m.label}
          </NavLink>
        ))}
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHead({ title, desc, actions }: { title: string; desc: string; actions?: ReactNode }) {
  return (
    <div className="a-head">
      <div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {actions && <div className="a-head-actions">{actions}</div>}
    </div>
  );
}

export const REVIEW_LABEL = { pending: '검수 대기', source_check: '출처 확인', approved: '검수 완료' } as const;
export const EX_STATUS_LABEL = { draft: '준비 중', running: '운영 중', closed: '종료' } as const;
