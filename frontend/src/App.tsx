/**
 * 라우팅 표 — 설계서 5.1.1 화면 목록 / 5.3 외부 URL 진입 설계를 그대로 경로로 옮겼다.
 *
 *  경로                         화면                      외부 URL 진입
 *  /                           U-01 서비스 시작
 *  /exhibitions/:exhibitionId  U-01 서비스 시작           전시 URL (입구 QR)
 *  /entry                      U-02 로그인 선택
 *  /login                      U-03 로그인                로그인 URL
 *  /signup                     U-04 회원가입              회원가입 URL
 *  /taste                      U-05 취향 파악
 *  /taste/saved                U-06 저장 취향 확인
 *  /time                       U-07 관람 시간 선택
 *  /recommend                  U-08 개인화 작품 추천
 *  /route                      U-09 추천 관람 경로(2D 지도)
 *  /artwork                    U-10 작품 감상
 *  /artwork/ask                U-11 AI 자유 질문
 *  /receipt                    U-12 아트 영수증
 *  /receipt/:visitId           U-12 아트 영수증(조회 모드)
 *  /history                    U-13 관람기록              관람기록 URL (미로그인 → U-03 → 복귀)
 *  /password/forgot            U-14 비밀번호 찾기
 *  /password/reset?token=      U-15 새 비밀번호 설정      비밀번호 재설정 링크 URL
 *  /admin/login                A-01 관리자 로그인
 *  /admin                      A-02 관리자 대시보드
 *  /admin/exhibitions          A-03 전시 관리
 *  /admin/artworks[/:id]       A-04 작품 등록·수정
 *  /admin/map                  A-05 위치·지도 관리
 *  /admin/members              A-06 회원 조회
 */
import { Link, Route, Routes } from 'react-router-dom';
import { VisitProvider } from './store/VisitContext';

import U01Start from './pages/user/U01Start';
import U02Entry from './pages/user/U02Entry';
import U03Login from './pages/user/U03Login';
import U04Signup from './pages/user/U04Signup';
import U05Taste from './pages/user/U05Taste';
import U06SavedTaste from './pages/user/U06SavedTaste';
import U07Time from './pages/user/U07Time';
import U08Recommend from './pages/user/U08Recommend';
import U09Route from './pages/user/U09Route';
import U10Artwork from './pages/user/U10Artwork';
import U11AskAI from './pages/user/U11AskAI';
import U12Receipt from './pages/user/U12Receipt';
import U13History from './pages/user/U13History';
import U14ForgotPassword from './pages/user/U14ForgotPassword';
import U15ResetPassword from './pages/user/U15ResetPassword';

import AdminLayout from './pages/admin/AdminLayout';
import A01Login from './pages/admin/A01Login';
import A02Dashboard from './pages/admin/A02Dashboard';
import A03Exhibitions from './pages/admin/A03Exhibitions';
import { ArtworkEdit, ArtworkList } from './pages/admin/A04Artworks';
import A05Map from './pages/admin/A05Map';
import A06Members from './pages/admin/A06Members';

export default function App() {
  return (
    <VisitProvider>
      <Routes>
        {/* 사용자 (모바일 웹) */}
        <Route path="/" element={<U01Start />} />
        <Route path="/exhibitions/:exhibitionId" element={<U01Start />} />
        <Route path="/entry" element={<U02Entry />} />
        <Route path="/login" element={<U03Login />} />
        <Route path="/signup" element={<U04Signup />} />
        <Route path="/taste" element={<U05Taste />} />
        <Route path="/taste/saved" element={<U06SavedTaste />} />
        <Route path="/time" element={<U07Time />} />
        <Route path="/recommend" element={<U08Recommend />} />
        <Route path="/route" element={<U09Route />} />
        <Route path="/artwork" element={<U10Artwork />} />
        <Route path="/artwork/ask" element={<U11AskAI />} />
        <Route path="/receipt" element={<U12Receipt />} />
        <Route path="/receipt/:visitId" element={<U12Receipt />} />
        <Route path="/history" element={<U13History />} />
        <Route path="/password/forgot" element={<U14ForgotPassword />} />
        <Route path="/password/reset" element={<U15ResetPassword />} />

        {/* 관리자 (데스크톱 웹) */}
        <Route path="/admin/login" element={<A01Login />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<A02Dashboard />} />
          <Route path="exhibitions" element={<A03Exhibitions />} />
          <Route path="artworks" element={<ArtworkList />} />
          <Route path="artworks/:id" element={<ArtworkEdit />} />
          <Route path="map" element={<A05Map />} />
          <Route path="members" element={<A06Members />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </VisitProvider>
  );
}

function NotFound() {
  return (
    <div className="m-shell">
      <main className="m-body center" style={{ paddingTop: 120 }}>
        <h2>페이지를 찾을 수 없어요</h2>
        <p className="muted mt-12">주소를 다시 확인하거나 처음 화면으로 돌아가 주세요.</p>
        <Link className="btn primary mt-24" to="/">
          처음으로
        </Link>
      </main>
    </div>
  );
}
