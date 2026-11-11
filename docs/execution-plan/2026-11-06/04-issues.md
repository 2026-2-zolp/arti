# 통합·리팩토링 이슈 추적표

기존 F01~F21의 관측은 [조사 원문](../../project-baseline/2026-11-06/02-findings.md)으로 연결한다. F22~F33는 후속 AWS·CI/CD·모델/데이터 재점검에서 추가한 실행 이슈다. open은 작업 미종결이지 모두 재현된 결함이라는 뜻은 아니다.

증거: executed=과거 조사 실행, code=정적 코드, documented=자료/설계/카톡, unverified=검증 필요. 과거 실행은 새 작업 공간의 회귀 실행을 대신하지 않는다. P0/P1은 작업 우선순위이고 보안 심각도 등급이 아니다.

담당은 현재 **미지정, 준억 통합 조율 제안**이다. F별 수정 위치·구현 담당·검토자는 W02에서 정한다. 해결 시 execution.json과 증거 기록을 갱신한다. closed는 연결된 필수 AC의 통과 증거와 해당 수정 커밋이 있을 때만 사용한다. blocked/accepted_deferred는 해결로 세지 않는다.

| ID | 우선·증거 | 문제/결정 | 조치·확인 방법 | 작업 / AC | 상태 |
| --- | --- | --- | --- | --- | --- |
| F01 | P0 · executed | 빈도·선택 원본 소실 | 풍경2/따뜻함1과 반대 입력의 계산을 계약대로 검증 | W02,W05 / AC03,AC13 | open |
| F02 | P0 · executed | 변경 후 이전 추천 유지 | 입력 무효화·늦은 응답 경합을 API/화면으로 확인 | W03,W05 / AC06,AC13 | open |
| F03 | P0 · executed | 생성 가이드 저장 소실 | 생성→다른항목수정→저장→재조회 round-trip | W03,W05 / AC06,AC11 | open |
| F04 | P0 · executed | 미검수 작품·AI필드 공개 | 상태 조합별 공개/관리자 API 검사 | W03,W05 / AC06,AC12 | open |
| F05 | P0 · executed | 실제AI·fallback·실패 구분 부족 | 정상/키없음/오류/timeout 응답과 UI | W02,W07 / AC03,AC20 | open |
| F06 | P1 · code | 승인 근거·출처 버전·검증 미완성 | 승인 sourceIds 서버검증·자료밖 유보 | W06,W07 / AC18,AC20,AC21 | open |
| F07 | P0 · documented | 실제 스택과 설계 차이 | Django 권장/Express대안 결정을 기록 후 전환 | W02,W04 / AC04,AC08 | open |
| F08 | P1 · executed | 5쌍 선택풀·버전·부족 처리 | 전시앞10개 의존 제거/정당화 및 부족 안내 | W02,W06,W05 / AC03,AC18,AC16 | open |
| F09 | P0 · code | 유명작품 시드와 실제 전시 혼재 | demo/실제 출처manifest·시연 구별 | W06,W10 / AC18,AC29 | open |
| F10 | P1 · executed | 반응 이유 서버 저장 누락 | 저장→재조회→다른기기 관리자 확인 | W03,W05 / AC06,AC14 | open |
| F11 | P1 · code | 영수증 저장 손실·중복 위험 | AI와 저장분리·idempotency·실패재시도 | W05 / AC14,AC16 | open |
| F12 | P1 · code | 관람/계정 대화 혼입·history 부재 | 새관람/로그아웃/2계정·후속질문 | W05,W07 / AC15,AC20 | open |
| F13 | P1 · code | 401복구·404/오프라인 무한로딩 | 토큰만료와 React상태·오류UI 재현 | W05 / AC15,AC16 | open |
| F14 | P1 · code | 현 Bearer·scrypt와 목표 인증 차이 | JWT로 오기 금지·인증선택·해시이관정책 | W02,W05 / AC04,AC15,AC17 | open |
| F15 | P1 · code | 비밀번호 재설정 메일 미구현 | 필요시 실제발송, 불필요시 UI축소 결정 | W05 / AC15,AC16 | open |
| F16 | P1 · code | SQLiteJSON·수동스키마와 데이터모델 차이 | ID/관계/null/날짜·필요 세션/이력만 구현 | W04,W05 / AC09,AC17 | open |
| F17 | P1 · code | 직선순서·이동시간과 실제공간 차이 | 좌표0~100유지·실제도면 비교·설명범위 | W02,W06,W10 / AC03,AC18,AC30 | open |
| F18 | P1 · documented | 기존 태그평가 입력/전시검증 부족 | 40장이미지 인계·고정전시표본 평가 | W06,W07 / AC19,AC22 | open |
| F19 | P1 · documented | 160초 보고·운영지연 미측정 | 같은환경 반복·동시요청·p50/p95 표본수 | W07,W08 / AC22,AC26 | open |
| F20 | P1 · documented | 원문·요약·맞춤설명·가이드 혼용 | 콘텐츠4종·B안필드/상태 확정 | W02,W05 / AC03,AC11 | open |
| F21 | P2 · documented | 원설계 알고리즘과 현 기준선 차이 | 임베딩/최적보행 미구현 명시·변경기록 | W02,W10 / AC04,AC31 | open |
| F22 | P1 · unverified | AWS계정·RDS·네트워크·TLS 미검증 | 지역/예산/권한/버전·API연결 확인 | W02,W08 / AC04,AC23 | open |
| F23 | P1 · code | 로컬 업로드와 S3/모델 읽기 경로 차이 | 제한열람·파일보존·모델입력·URL만료 | W08 / AC24 | open |
| F24 | P1 · code | GitHub Actions CI 미구성 | PR빌드·계약·Postgres 검사/실제AI별도 | W03,W04 / AC07,AC09 | open |
| F25 | P1 · code | CD·마이그레이션·복귀 미구성 | OIDC범위·digest·직렬화·배포실패복귀 | W09 / AC27,AC28 | open |
| F26 | P1 · documented | 로컬 모델 메모리/로딩·운영위치 미결 | README9GB는 안내치·실측후상시/작업시 결정 | W02,W07,W08 / AC04,AC22,AC26 | open |
| F27 | P1 · code | 180/300초 요청과 배포 timeout 차이 | 레이어별예산·작업ID/상태조회 채택여부 | W02,W07,W08 / AC04,AC20,AC26 | open |
| F28 | P1 · code | 개발프록시·공개주소·OAuth·영수증CORS | SPA직접진입·HTTPS·callback·이미지저장 | W05,W08,W10 / AC25,AC30 | open |
| F29 | P1 · documented | 동명작품/연도치수 충돌·출처변경 | 작품ID고정·근거충돌관리·AI재검수 | W06,W07,W05 / AC18,AC21,AC11 | open |
| F30 | P1 · unverified | 모델내부접근·외부이미지URL·자료속지시 | 공개추론차단·URL/크기제한·권한불변 확인 | W05,W07,W08 / AC12,AC20,AC24 | open |
| F31 | P1 · unverified | readiness·관측·비용·백업복원 미검증 | 프로세스/모델준비 분리·비밀제거·복원연습 | W08 / AC26 | open |
| F32 | P1 · unverified | 코드복귀와 DB복구의 차이 | 호환schema·migration단일실행·백업복구범위 | W05,W09 / AC17,AC28 | open |
| F33 | P0 · code | 빈DB 자동시드의 알려진 데모/관리자 계정 | DEMO_MODE=false와 별개로 seed실행됨. 운영시드 차단·안전한 초기관리자·초기배포 접근제한 | W04,W08 / AC10,AC23,AC26 | open |

## 릴리스 필수 범위

execution.json의 releaseRequired가 기준이다. 현재 F21만 false이며 고급 알고리즘 미구현·설계변경 설명은 AC31에서 필수다. 나머지는 true로, 코드 수정 또는 명시적인 기능 축소 후 해당 계약/검증을 충족해야 closed가 된다. accepted_deferred는 해결이 아니다. 범위 변경에는 결정 기록·검증단 영향 검토가 필요하며 저장손실·권한/미검수 노출·AI 허위표시를 조용히 제외할 수 없다.

F33 근거: 기준 backend/src/db.ts의 openDb는 전시0건일 때 seed를 호출하고 seed에서 고정 데모/관리자 계정을 생성한다. DEMO_MODE 설정과 별개다. 재현된 침해가 아니라 코드상 운영 전환 차단 항목이다.

## 처리 순서

1. F02/F03/F04/F10의 재현과 F01/F20 계약을 먼저 고정한다.
2. F07/F14/F22/F26의 결정으로 수정 위치·전환 경로를 정한다.
3. F03/F04/F02 → F10/F11/F12/F13 → 실제 데이터/AI 순으로 신뢰성과 완주를 확보한다.
4. AWS·Docker·CI는 기반이 생기면 조기 확인한다. 최종 배포/CD는 검증된 결과를 사용한다.
5. F21의 고급 알고리즘은 먼저 추가하지 않는다. 현 수준을 정직하게 설명하고 근거가 있을 때만 확장한다.

같은 필드나 API를 두 번 고치지 않도록 변경 전 관련 F-ID를 함께 확인한다. 상태를 갱신할 때 해결 근거·부작용·새로운 회귀 범위를 기록한다. 기존 아카이브는 수정하지 않는다.

