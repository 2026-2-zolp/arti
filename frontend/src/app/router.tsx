import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { DEFAULT_EXHIBITION_ID } from '@/config';
import { ArtworkFormPage } from '@/pages/admin/ArtworkFormPage';
import { ArtworksPage } from '@/pages/admin/ArtworksPage';
import { AdminLoginPage } from '@/pages/admin/AdminLoginPage';
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { ExhibitionsPage } from '@/pages/admin/ExhibitionsPage';
import { MapManagementPage } from '@/pages/admin/MapManagementPage';
import { MembersPage } from '@/pages/admin/MembersPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ArtworkPage } from '@/pages/user/ArtworkPage';
import { AskAiPage } from '@/pages/user/AskAiPage';
import { ExhibitionStartPage } from '@/pages/user/ExhibitionStartPage';
import { ForgotPasswordPage } from '@/pages/user/ForgotPasswordPage';
import { HistoryDetailPage } from '@/pages/user/HistoryDetailPage';
import { HistoryPage } from '@/pages/user/HistoryPage';
import { LoginChoicePage } from '@/pages/user/LoginChoicePage';
import { LoginPage } from '@/pages/user/LoginPage';
import { ReceiptPage } from '@/pages/user/ReceiptPage';
import { RecommendationPage } from '@/pages/user/RecommendationPage';
import { ResetPasswordPage } from '@/pages/user/ResetPasswordPage';
import { RoutePage } from '@/pages/user/RoutePage';
import { SavedTastePage } from '@/pages/user/SavedTastePage';
import { SignupPage } from '@/pages/user/SignupPage';
import { TastePage } from '@/pages/user/TastePage';
import { VisitTimePage } from '@/pages/user/VisitTimePage';
import { RequireAdmin, RequireAuth } from '@/routes/guards';
import { RootLayout } from './RootLayout';
import { paths } from '@/routes/paths';

/** 라우팅 표는 AGENTS.md "라우팅 표" 참고 */
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Navigate to={paths.exhibition(DEFAULT_EXHIBITION_ID)} replace /> },

      // ---- 사용자: 전시 단위 관람 흐름 ----
      {
        path: '/exhibition/:exhibitionId',
        children: [
          { index: true, element: <ExhibitionStartPage /> }, // U-01
          { path: 'start', element: <LoginChoicePage /> }, // U-02
          { path: 'taste', element: <TastePage /> }, // U-05
          {
            path: 'taste/saved', // U-06
            element: (
              <RequireAuth>
                <SavedTastePage />
              </RequireAuth>
            ),
          },
          { path: 'time', element: <VisitTimePage /> }, // U-07
          { path: 'recommendations', element: <RecommendationPage /> }, // U-08
          { path: 'route', element: <RoutePage /> }, // U-09
          { path: 'artworks/:artworkId', element: <ArtworkPage /> }, // U-10
          { path: 'artworks/:artworkId/ask', element: <AskAiPage /> }, // U-11
          { path: 'receipt', element: <ReceiptPage /> }, // U-12
        ],
      },

      // ---- 사용자: 계정 / 기록 (외부 URL 직접 진입) ----
      { path: '/login', element: <LoginPage /> }, // U-03
      { path: '/signup', element: <SignupPage /> }, // U-04
      {
        path: '/history', // U-13
        element: (
          <RequireAuth>
            <HistoryPage />
          </RequireAuth>
        ),
      },
      {
        path: '/history/:visitId', // U-12 조회 모드
        element: (
          <RequireAuth>
            <HistoryDetailPage />
          </RequireAuth>
        ),
      },
      { path: '/password/forgot', element: <ForgotPasswordPage /> }, // U-14
      { path: '/password/reset', element: <ResetPasswordPage /> }, // U-15

      // ---- 관리자 ----
      { path: '/admin/login', element: <AdminLoginPage /> }, // A-01
      {
        path: '/admin',
        element: (
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        ),
        children: [
          { index: true, element: <DashboardPage /> }, // A-02
          { path: 'exhibitions', element: <ExhibitionsPage /> }, // A-03
          { path: 'artworks', element: <ArtworksPage /> }, // A-04 목록
          { path: 'artworks/new', element: <ArtworkFormPage /> }, // A-04 등록
          { path: 'artworks/:artworkId/edit', element: <ArtworkFormPage /> }, // A-04 수정
          { path: 'map', element: <MapManagementPage /> }, // A-05
          { path: 'members', element: <MembersPage /> }, // A-06
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
