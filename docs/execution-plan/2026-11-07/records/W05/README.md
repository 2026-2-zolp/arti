# W05 핵심 통합 구현·검증 기록

2026-11-08 KST / 브랜치 `dev/임준억` / 출발 커밋 `b1fa103`.

**상태: W05 완료 / G4 통과.** 새 관람의 복구·관리자·오류 재시험과 검증단 검토를 마쳤다. 통과 후 로컬 커밋하며 원격 푸시는 하지 않는다. 단일 상태 기준은 ../../execution.json이다.

## 변경한 기능과 경계

| 영역 | 변경 전 | 이번 구현 |
| --- | --- | --- |
| 관리자 쓰기 | W04 조회만, 쓰기는 405/501 | editing.py: 전시/작품 전체 편집·version 충돌·파일 If-Match·산출물별 확정·선택 목록 일괄확정 |
| 출처 검수 | 새 API 쓰기 미연결 | 사실/원문/출처/이미지/전시 이동 때 sourceVersion 증가·source_check·확정 AI 강등. 별도 요청에서 재승인 |
| AI 분석 | 새 API 미연결 | provider 경계·확정 항목 보호·명시 재생성·부분 오류·쓰기 전 버전 재검사·DB 분석 동시 1개. 실제 provider 기본은503 |
| 회원 | 새 API 501 | member.py: 가입·opaque 세션 로그인/로그아웃·me·본인 취향 snapshot/버전 저장. 비밀번호 재설정은501·UI 비활성 안내 |
| 취향·추천 | UI 앞10점/태그 배열만 전달 | 서버의 정확한5쌍/버전·원본 선택·빈도 전달, saved 서버 snapshot 재사용, 입력 변경 세대·늦은 응답 폐기·새 관람 식별자 |
| 기록 | UI AI해석을 기다린 뒤 저장 | records.py + U12: 고정 visitId/본문으로 먼저 저장, unique+actor lock 중복 1건, persisted 확인, 별도 AI 해석, snapshot 역사 조회 |
| 만료 복구 | 무효 토큰을 guest로 처리할 위험 | 원래 회원별 pendingReceipt 보존, me·원토큰·현재 화면/관람 검사 뒤 명시 복구. 다른 계정/명시 logout 격리 |
| 도슨트 | question 단독, 작품명만으로 캐시 | docent.py + U10/11: 승인 자료로 맥락 재구성, contentVersion/질문 index·성공4왕복, 계정/관람/전시/작품/버전 캐시, 탭/힌트/스크롤 복귀 |
| 관리자 평가 | 같은 브라우저 reactionLog | 서버에 저장된 회원 VisitReaction만 별도 관리자 API로 조회. guest 추적은 추가하지 않음 |
| Git 자료 | 예전 seed가 시험 편의상 approved·mock 좌표 부여 | 명시 export/import bundle: 40점 해시 검증·draft/source_check·좌표 미배정·덮어쓰기 거부 |

기존 Express/FastAPI 제품 코드는 변경하지 않았다. 실제 생성 모델·CLIP/mDeBERTa 연결/품질 평가는 W07이며 이 단계의 시험 응답은 unittest patch 안에만 존재한다. 서비스 기본 경로에 가짜 답변 성공을 넣지 않았다.

## 실제 실행한 검사

- [PostgreSQL 로그](postgres-tests.log): 별도 test_arti DB 생성·migration·전체51검사·시험 DB 제거. 기존24검사를 유지하고 W05의 입력/검수/회원/기록/대화/자료 가져오기/CORS27검사를 추가했다. 실제 동시 POST 두 개가201/200·DB1건이며, 별도 DB 연결의 분석 advisory lock도 확인했다.
- [프론트 검사](frontend-state-tests.log): 최종13건 통과. 실제 reducer/API helper/영수증 builder를 호출하는 시험. 이전 세대 추천 폐기·같은 시간 새 관람 UUID 변경·scope 격리·원본 빈도·늦은401/logout·원계정 복구·미완료 작품 입력 제외를 검사한다. 복사한 reducer로 대체하지 않았다.
- [타입 검사](frontend-typecheck.log), [빌드](frontend-build.log): 최종 파일 기준으로 재실행 결과를 보존했다. 로그의 실제 마지막 결과를 따른다.
- [브라우저 관측](browser-observations.md): 실제 React→Vite→Django→PostgreSQL. 가상 fixture/시험 계정이며 실제 작품/LLM/실기기 품질 시험이 아니다.
- [자료·DB 확인](data-and-browser-db.json): 실제 Git40 이미지 해시·비공개/미검수·좌표 비승계, 실제 회원 관람1건·사유/초 보존. 이 파일은 당시 관측으로 고정하며 후속 시험 건수를 덮어쓰지 않는다.
- [검증단 판정과 잔여](gate-review.md): 코드 지적 보완과 G4 전체 인수를 구분한다.

실행 예:

```powershell
docker compose --env-file .env.compose -p arti-w05 exec -T api python manage.py test arti.tests --noinput -v 2
backend/node_modules/.bin/tsx.cmd --test frontend/tests/*.test.mts
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Node 시험 실행기는 기존 backend 의존성의 tsx를 사용한다. 없는 PC에서는 먼저 해당 lock 기준 의존성을 설치한다. `arti-w05`는 이번 검증용 별도 Compose 프로젝트다. 일반 개발의 `arti-dev` 자료에 시험 명령을 섞지 않는다.

## 실패·수정·재검증 루프

1. 첫 PostgreSQL42검사 중5실패: W04 당시501 기대 두 경로가 새 구현의400/503으로 바뀌었고, 신규 시험의 확정 상태/질문/제목 fixture 사전조건도 잘못 지정했다. 실제 확정 자료를 준비하고 바뀐 계약 오류를 검사하도록 수정 후42통과.
2. 독립 기술 검토: 중첩 JSON이500으로 빠지는 경로, 관리자 역사 조회 누락, 회원 AI 제한 우회, 분석 동시 제약, 동일 재시도 정규화, guest 해석 검증, provider 잘못된 출력/timeout 코드 소실을 지적했다. 각 입력·권한·실패 회귀를 추가해47→50검사 통과.
3. 관람객 검토: 같은 시간 새 관람 ID, mode/history, CONTENT_CHANGED 안내, 실제 질문 표시, pending 입력, actor 경계, 일반 복귀 상태를 지적했다. 이어 해석의 늦은 응답·중복 호출도 보완했다.
4. 실제 브라우저 만료 복구에서 미완료 작품 dwell이 viewed 밖에 섞여400이 됨을 발견했다. builder가 완료 작품으로 dwell/반응/사유를 제한하도록 수정하고 실제 builder의0점/부분 관람 회귀를 추가했다. **이미 고정한 실패 payload를 조용히 고쳐 성공시킨 것은 아니다.** 이후 새 관람으로 복구 성공을 재확인했다(아래 최종 결과).
5. 재시험 중 IAB의 JS 확인창 이후 입력/제어가 응답하지 않았다. 기존 탭·새 탭·연결 재초기화에서도 실제 이동을 확인하지 못했다. 당시 성공으로 처리하지 않았으며 이후 페이지 확인창으로 교체해 새 시험을 완료했다.

## 자료 인수와 다음 한 작업

Git의 tag_eval_set.json은40개 imagePath를 .png로 가리켰으나 실제 ID 대응 파일은 .jpg였다. exporter는 임의 다른 그림을 선택하지 않고 같은 ID의 유일한 후보만 받아 원래 경로/수정 여부/해시를 남긴다. 40점 해설은 checkedAt=null이고 AI 작성 초안이다. importer는 기존 seed를 실행하지 않고 draft 전시/source_check 작품/미배정 좌표로 적재했다.

사용자의 후속 명시 결정으로 이번 인수는 Git 자료 기준이다. 로컬 고유 자료는 원본 보존 후 별도 인수하며, 자료 부재나 제공자 백업 완료를 주장하지 않는다. [AC17 결정과 후속 절차](data-intake-decision.md). 유영국 전시 구조는 있으나 선정/사람검수는 W06에 남는다.

최종 재시험에서 새 부분관람1점의 만료→동일회원 재인증→확인취소/재확인→복구성공→pending제거→역사reload를 연결했고 DB동일visit1건·사유/9초를 확인했다. 관리자 독립확정·원문변경 비공개·409·재승인·목록충돌 후 재검토 성공도 실제 화면으로 확인했다. 별도 catalog503→독립retry, 실제연결끊김·복구, 부족풀/후보0/404/재설정비활성도 검증했다. 자세한 재현과 원시 증거는 browser-observations.md와 g4-* 파일을 따른다.

아래 정리 문단/cleanup.json은 첫 시험 종료 당시 기록이며, 최종 재개·정리는 [cleanup-final.json](cleanup-final.json)을 따른다.

검증 종료 후 Vite와 arti-w05 컨테이너를 종료했고 DB/media 볼륨은 보존했다. 가상 시험회원 세션2개를 폐기하고 계정은 dormant로 비활성화했다. 재시험 때 실제 계정 대신 시험 계정과 별도 arti-w05 환경을 다시 준비한다. [정리 관측](cleanup.json), [최종 자동검사 요약](validation-summary.json), [이번 작업트리 소스 해시](source-state.json).

마지막 계약 대조에서 명시 origin의 If-Match/ETag CORS 처리를 보완했고 인증을 우회하지 않는1검사를 추가해 최종51건 통과했다. [구현 계약 구체화](contract-delta.md). 기술 검증단은 이 추가 변경도 읽기 전용 재검토해 필수 추가 지적이 없음을 확인했다. Compose의 선택적 환경변수 전달도 config --quiet으로 검증했다.

최종 변경에서 Confirmation.tsx/App/app.css 및 각 호출부의 async 확인, U08 목록 독립오류/retry, A04 확정catch·재검토·제안없는선택차단, A05 배정작품이있는방 삭제차단, records.py의 풍경 등 키워드 표시를 보완했다. 최종 PG51/프론트13/타입/빌드/migration/Compose가 통과했고 독립 검증단의 추가 필수 지적은 없다. W07 실모델 성공·AWS/CI/CD 실행을 이번 통과로 대체하지 않는다.

원시 AX와 명령 로그에는 브라우저가 반환한 공백/마지막 빈 줄이 포함된다. 증거 원형 보존을 위해 정리하지 않았다. 제품 코드의 whitespace 검사와 별도로 구분했다.
