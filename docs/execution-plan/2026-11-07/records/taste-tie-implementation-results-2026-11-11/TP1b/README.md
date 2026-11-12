# TP1b — 점수·출처·revision 원자 저장

2026-11-11 / 착수 `41f8fb8` / [TP1a](../TP1a/README.md) 다음 실행 단위. 일반 DB 변경·공개 활성화·원격 푸시 없이 격리 PostgreSQL에서 구조와 저장 보호를 검증한다. 최종 판정과 실제 시험 원수는 [validation.json](validation.json)과 [tests.json](tests.json)을 따른다.

## 변경 전 → 변경 후

- 태그 제공자가 점수만 반환 → 유효한 모델 근거가 있으면 태그에만 전달한다. 감정 analysis JSON에는 계속 제외한다. 구형 absent/null 응답은 scores 형식을 유지한다.
- Artwork의 점수에 저장 근거/revision 없음 → `0003_tag_score_evidence`에서 nullable JSON과 기본 0 revision만 추가한다. data migration·재분석·기존 승인/풀 변경은 없다.
- 분석 성공 시 점수만 쓰기 → 같은 행 잠금/트랜잭션에서 점수·서버 입력에 묶은 근거·revision 증가를 저장하고 suggested로 둔다. 근거 없는 새 점수는 기존 근거를 지우고 null로 저장한다. 같은 점수의 정상 재분석도 새 revision이다.
- 원문/이미지 변경 후 과거 점수의 출처 구분 불가 → 원래 근거를 보존하되 `current_evidence`가 태그 확정·현재 sourceVersion·현재 파일 token을 확인한다. 하나라도 다르면 반환하지 않는다. 사람 승인/서버 승인 signature·공개 자격은 이 helper의 판정 범위가 아니다.
- 저장 잠금 대기 무제한/저장 직전만 전체 예산 확인 → 분석 저장 transaction의 lock_timeout 2초와 commit 전 예산 재확인. 잠금 대기는 rollback 후 retryable 503, 낡은 version은 409다. 전역 DB 설정·자동 재시도는 추가하지 않는다.

## 저장 형식과 책임

`tag_score_evidence`는 TP1a 모델 envelope 8필드에 서버가 `sourceVersion`과 `inputImageFile`을 붙인 내부 JSON이다. 원래 evidenceSha256은 모델 envelope만 검사한다. 두 binding 필드는 모델 checksum 대상이 아니며 저장 시 DB version을 재확인한 서버가 정한다. 모델 서비스가 실제 전송 바이트 SHA를 먼저 확인하고, 제공자/모델 검증에서도 점수 8개와 envelope를 재확인한다.

`tag_score_revision`은 근거가 없는 구형 분석도 성공하면 증가한다. 근거가 null이라고 기존 기능을 실패시키거나 revision을 꾸며 채우지 않는다. 실패한 tag는 점수/근거/revision/태그상태를 모두 보존한다. 기존 요약 등 다른 종류의 독립 부분 성공 정책은 유지하고, 전체 예산이 소진되면 모든 부분 결과를 버린다. 생성 결과는 suggested이며 명시적 confirm이 있어야 confirmed다. confirm 자체는 분석 revision을 증가시키지 않는다.

분석/GPT 네트워크 호출 중 행 잠금을 잡지 않는다. 실제 파일 token은 기존 업로드의 새 이름 발급 구조를 따른다. 같은 경로 수동 덮어쓰기는 지원하지 않고 명시 재인수한다. 공개 GET에 모델 호출·파일 해싱을 추가하지 않았다. 원문 수정 후 과거 근거는 보존되지만 현재 근거로 쓰이지 않는다. 새 helper는 아직 추천/동점 정렬에 연결하지 않았다.

## 통과 기준과 실제 검증

| 기준 | 확인 내용 | 증거 |
| --- | --- | --- |
| B1 구조 호환 | 빈 DB와 기존 v1 전시/작품/계정/관람/풀의 0002→0003. 기존 모든 열 동일, 추가값 null/0 | MigrationExecutor의 실제 PostgreSQL 시험 |
| B2 원자성 | HTTP 성공과 동일 점수 재분석, 다른 연결은 commit 전 기존 묶음만 관측, save 직후 예외는 전체 rollback | 새 저장 시험 |
| B3 실패 보호 | 변조 근거·429/503/상류504·timeout·늦은 응답·전체 예산, tag 실패/다른 종류 부분 성공 | 실제 로컬 HTTP + 결정적 예산 시험 |
| B4 경합 | 분석 중 원문 수정/confirm이 먼저 저장되면409. 두 완료 분석의 같은 version은200/409로1건 저장. 잠금2초초과503과복구 | 독립 연결·Event/Barrier·실제 행/advisory 잠금 |
| B5 확정/입력 | 재생성 대상 아닌 확정값 유지·성공한 명시 tag 재생성만suggested. source/file 불일치는 과거 근거 미사용 | API/모델 검사 |
| B6 공개/운영 경계 | 클라이언트가 점수/근거/revision을 주입할 수 없음. 공개/관리자 DTO에 새 내부 근거 없음. 모델/프론트/일반환경 유지 | 전체 회귀·소스/격리 범위 검사 |

부하량 추정이나 모델 정확도 평가는 아니다. synthetic 이미지·model envelope·로컬 HTTP만 사용하며 실제 가중치/GPT/외부 모델 호출은 없다. 전체 Django 시험에는 기존 모델 장애/복구·시간 예산·조사/추천·도슨트·회원/기록 회귀가 포함된다. 신규 시험은 기본 CI의 `manage.py test arti.tests`에 자동 포함된다. 원격 CI는 실행하지 않았다.

1차 신규 15건 통과 후 검증단 관점으로 잠금 대기·commit 직전 예산·완전한8점수 요구·실제 HTTP timeout 사례를 보강했다. 전체 회귀 1회차의 기존 이미지 시험2건은 Windows 임시 파일 정리 시 열린 다운로드 스트림 때문에 실패했다. 처음의 직접 close 보완은 TestCase DB 연결을 닫아 다음12건에 영향을 줬다. 설치된 Django의 종료 wrapper를 확인하고 streaming_content를 정상 소비하도록 수정했다. 해당2건과 최종 전체 **138건(신규18)**이 통과했고 기존 스크립트 **53건**도 통과했다. check/이관 drift 검사는 이상 없다. 제품 이미지 반환 코드는 바꾸지 않았다. 시험 실행기 출력 인코딩 문제는 비공개 helper에서 UTF-8로 바로잡았다. 로컬 timeout/늦은 응답 handler의 예상 ConnectionAbortedError 진단 출력은 있으나 시험 실패는 아니다.

기술/시니어·방문자·운영/데이터·팀·교수/제3자 평가위원의 역할별 **같은 작성자 자체 검토**다. 독립 인적 검수로 표시하지 않는다. 실패한 데이터의 보존, 설명 가능한 revision, 시연 범위와 실제 모델 품질의 구분을 확인한다.

## 격리·재현·되돌리기

전용 `arti-tp1b-20261111-db` / PostgreSQL17-alpine / 512MiB / tmpfs `/var/lib/postgresql/data` / 전용 loopback 포트. 일반 `arti-dev` 네트워크/볼륨은 연결하지 않는다. Django process env는 전용 DB명/사용자/포트·synthetic secret·disabled LLM·빈 키다. `SimpleTestCase` 외 DB 시험은 Django가 이 서버에 만든 `test_arti_tp1b`에서 수행하고 폐기한다. 일반 DB migrate/API 재생성·승인·풀 활성화는 하지 않는다.

전용 환경에서 `manage.py check`, `makemigrations --check --dry-run`, `test arti.tests --noinput -v1`을 실행한다. 후속의 근거 파일은 [baseline.json](baseline.json), [현재 소스·기록 검사](verify.py)다. 과거 계획/TP1a 기록은 시점별로 보존하며 현재 소스와 같다고 주장하지 않는다.

이관 시험의 역이관/초기화는 폐기 가능한 시험 DB에서만 한다. 실제 환경의 rollback에서는 추가 열을 남기며 구형 읽기 호환을 확인한다. 일반 환경 배포·이관은 이번 작업과 별도다.

## 다음: TP2 서버 사전검증·저장 충돌 보호

1. 기존30개 반례에 맞춘 공통 resolver와 읽기 전용 preview. 승인 signature·풀10점·정수 점수·그룹 전체 fallback을 서버 한곳에서 계산한다.
2. 회원 CAS/마지막 mutation receipt·구형/v2 저장 호환·동일 요청 재시도와 관람증거를 구현한다. Account→Pool→Artwork ID순과 transaction 한정 잠금 대기를 검증한다.
3. 격리 PG에서 쓰기0 preview·풀/점수 교체·동시 저장·응답 유실·기능 disable 회귀를 통과한 후 로컬 커밋한다. 일반 DB/공개 활성화는 자동 진행하지 않는다.

TP1a/TP1b의 기술 통과가 실제 cached 모델 인수·모델 품질/사람 검수나 전체 TP4 통과는 아니다. 실제 cached 가중치/서명1회 확인과 전체 브라우저는 TP4에 남긴다. 프론트는 동섭님 종합본 수령 후 재확인한다.
