import { Outlet, ScrollRestoration } from 'react-router-dom';

/** 모든 라우트 공통 루트 — 화면 전환 시 스크롤을 맨 위로 (뒤로가기 시에는 이전 위치 복원) */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
