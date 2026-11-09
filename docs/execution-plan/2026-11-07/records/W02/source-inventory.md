# 실코드 경로·호출 인벤토리

기준 SHA: ae0e58ebc338c17da6d4d17616fd802f03ba3bb6

audit_source.py로 재생성. 정적 등록/직접 호출 목록이며 실제 HTTP·브라우저 통과 증거가 아니다.

| Method | 현재 경로 | 실제 소스:행 |
| --- | --- | --- |
| GET | /api/health | backend/src/app.ts:29 |
| POST | /api/admin/login | backend/src/routes/admin.ts:25 |
| POST | /api/admin/logout | backend/src/routes/admin.ts:37 |
| POST | /api/admin/exhibitions | backend/src/routes/admin.ts:45 |
| PUT | /api/admin/exhibitions/:id | backend/src/routes/admin.ts:50 |
| POST | /api/admin/artworks | backend/src/routes/admin.ts:67 |
| PUT | /api/admin/artworks/:id | backend/src/routes/admin.ts:73 |
| POST | /api/admin/artworks/:id/analyze | backend/src/routes/admin.ts:144 |
| POST | /api/admin/exhibitions/:id/analyze | backend/src/routes/admin.ts:152 |
| POST | /api/admin/exhibitions/:id/confirm-ai | backend/src/routes/admin.ts:176 |
| POST | /api/admin/artworks/:id/image | backend/src/routes/admin.ts:237 |
| DELETE | /api/admin/artworks/:id/image | backend/src/routes/admin.ts:245 |
| POST | /api/admin/exhibitions/:id/floor-plan | backend/src/routes/admin.ts:257 |
| DELETE | /api/admin/exhibitions/:id/floor-plan | backend/src/routes/admin.ts:267 |
| GET | /api/admin/members | backend/src/routes/admin.ts:275 |
| POST | /api/auth/signup | backend/src/routes/auth.ts:29 |
| POST | /api/auth/login | backend/src/routes/auth.ts:39 |
| POST | /api/auth/logout | backend/src/routes/auth.ts:47 |
| GET | /api/auth/me | backend/src/routes/auth.ts:53 |
| PUT | /api/users/:id/tastes | backend/src/routes/auth.ts:59 |
| POST | /api/auth/password-reset/request | backend/src/routes/auth.ts:71 |
| POST | /api/auth/password-reset/confirm | backend/src/routes/auth.ts:89 |
| GET | /api/exhibitions | backend/src/routes/catalog.ts:19 |
| GET | /api/exhibitions/:id | backend/src/routes/catalog.ts:23 |
| GET | /api/exhibitions/:id/tag-coverage | backend/src/routes/catalog.ts:28 |
| GET | /api/artworks | backend/src/routes/catalog.ts:33 |
| GET | /api/artworks/:id | backend/src/routes/catalog.ts:38 |
| POST | /api/recommendations | backend/src/routes/catalog.ts:43 |
| POST | /api/artworks/:id/explanation | backend/src/routes/catalog.ts:60 |
| POST | /api/artworks/:id/ask | backend/src/routes/catalog.ts:67 |
| POST | /api/visits | backend/src/routes/visits.ts:23 |
| POST | /api/visits/interpret | backend/src/routes/visits.ts:36 |
| GET | /api/users/:id/visits | backend/src/routes/visits.ts:61 |
| GET | /api/visits/:id | backend/src/routes/visits.ts:66 |

업로드 mount: /api/uploads. 기준 코드에서는 인증 미들웨어 밖의 static 제공이다.

| client 함수 | 호출 소스:행 |
| --- | --- |
| adminLogin | frontend/src/pages/admin/A01Login.tsx:22 |
| listExhibitions | frontend/src/pages/admin/A02Dashboard.tsx:8 |
| listArtworks | frontend/src/pages/admin/A02Dashboard.tsx:8 |
| listExhibitions | frontend/src/pages/admin/A03Exhibitions.tsx:27 |
| listArtworks | frontend/src/pages/admin/A03Exhibitions.tsx:27 |
| saveExhibition | frontend/src/pages/admin/A03Exhibitions.tsx:31 |
| listExhibitions | frontend/src/pages/admin/A04Artworks.tsx:23 |
| listArtworks | frontend/src/pages/admin/A04Artworks.tsx:23 |
| analyzeExhibition | frontend/src/pages/admin/A04Artworks.tsx:34 |
| confirmExhibitionAi | frontend/src/pages/admin/A04Artworks.tsx:52 |
| listExhibitions | frontend/src/pages/admin/A04Artworks.tsx:197 |
| getArtwork | frontend/src/pages/admin/A04Artworks.tsx:197 |
| saveArtwork | frontend/src/pages/admin/A04Artworks.tsx:218 |
| saveArtwork | frontend/src/pages/admin/A04Artworks.tsx:230 |
| uploadArtworkImage | frontend/src/pages/admin/A04Artworks.tsx:392 |
| deleteArtworkImage | frontend/src/pages/admin/A04Artworks.tsx:402 |
| analyzeArtwork | frontend/src/pages/admin/A04Artworks.tsx:477 |
| saveArtwork | frontend/src/pages/admin/A04Artworks.tsx:523 |
| listExhibitions | frontend/src/pages/admin/A05Map.tsx:24 |
| listArtworks | frontend/src/pages/admin/A05Map.tsx:27 |
| saveArtwork | frontend/src/pages/admin/A05Map.tsx:64 |
| saveArtwork | frontend/src/pages/admin/A05Map.tsx:75 |
| saveArtwork | frontend/src/pages/admin/A05Map.tsx:85 |
| saveExhibition | frontend/src/pages/admin/A05Map.tsx:93 |
| uploadFloorPlan | frontend/src/pages/admin/A05Map.tsx:279 |
| deleteFloorPlan | frontend/src/pages/admin/A05Map.tsx:291 |
| listMembers | frontend/src/pages/admin/A06Members.tsx:12 |
| listVisits | frontend/src/pages/admin/A06Members.tsx:14 |
| listArtworks | frontend/src/pages/admin/A07Reactions.tsx:20 |
| adminLogout | frontend/src/pages/admin/AdminLayout.tsx:25 |
| getExhibition | frontend/src/pages/user/U01Start.tsx:56 |
| listExhibitions | frontend/src/pages/user/U01Start.tsx:115 |
| login | frontend/src/pages/user/U03Login.tsx:28 |
| signup | frontend/src/pages/user/U04Signup.tsx:41 |
| listArtworks | frontend/src/pages/user/U05Taste.tsx:32 |
| listArtworks | frontend/src/pages/user/U08Recommend.tsx:20 |
| tagCoverage | frontend/src/pages/user/U08Recommend.tsx:22 |
| getExhibition | frontend/src/pages/user/U09Route.tsx:27 |
| listArtworks | frontend/src/pages/user/U09Route.tsx:27 |
| getArtwork | frontend/src/pages/user/U10Artwork.tsx:56 |
| getArtwork | frontend/src/pages/user/U11AskAI.tsx:31 |
| askAI | frontend/src/pages/user/U11AskAI.tsx:47 |
| getExhibition | frontend/src/pages/user/U12Receipt.tsx:68 |
| listArtworks | frontend/src/pages/user/U12Receipt.tsx:68 |
| getVisit | frontend/src/pages/user/U12Receipt.tsx:178 |
| listArtworks | frontend/src/pages/user/U12Receipt.tsx:178 |
| listVisits | frontend/src/pages/user/U13MyPage.tsx:29 |
| listArtworks | frontend/src/pages/user/U13MyPage.tsx:138 |
| requestPasswordReset | frontend/src/pages/user/U14ForgotPassword.tsx:21 |
| resetPassword | frontend/src/pages/user/U15ResetPassword.tsx:27 |
| logout | frontend/src/store/VisitContext.tsx:168 |
