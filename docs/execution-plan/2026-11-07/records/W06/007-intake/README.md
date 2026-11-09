# W06 007 단독 비공개 인수 —16점 도달

2026-11-09 / 기준3a20624. 사용자 요청에 따라 [신규 재단 근거](../../../../../../data/intake/2026-11-09-yoo-youngkuk/007-source-followup.md)를 [007 단독 manifest](../../../../../../data/intake/2026-11-09-yoo-youngkuk/007-manifest.json)로 매핑해 기존 시연 초안에 추가했다. 표시명 작품(Work),1968,블로그 산은 출처별 다른 표기/사람 확인 대기로 유지했다.

## 검증과 상태

기존15점의 DB/미디어를 API 정지 상태에서 보존→version2 dry-run 무변경→명시007 추가→version3 재기동 순으로 실행했다. 전시1·작품16,계정/세션/관람/반응0이다. 전체16점은 source_check·이미지 비노출·요약/가이드 suggested·태그/감정 none·좌표null이며 전시는draft다.007의 표시명/연도·재단 출처·Work/산 미확정 메모와 판화 후보4점의 year비움/도상 후보 표시도 확인했다.

기존15점의 모든 DB 필드 행 SHA와 파일 SHA가 같고 공개 목록0·작품/미디어404·관리자 읽기/이미지200·중복 인수 차단·API 재시작 후 전체 행/파일 SHA 일치가 통과했다. 관리자 검사는 메모리 principal로 실제 계정/로그인을 만들지 않았다. 논리 해시는6도메인 행 값에 한정하며 새 실제 사전 덤프를 별도 재복원한 것은 아니다. 기존 합성 복원 근거와 구분한다. [결과](result.json), [검증문](verify.py.txt), [스냅샷](snapshot.py.txt)에 추적한다.

## 발견과 보완

재단 HTTPS 주소가 인증서 검증에 실패했으므로 원래 확인한HTTP 출처를 임의 HTTPS로 바꾸지 않았다. importer에 --allow-http-reference를 명시할 때만 HTTP 근거URL을 저장하는 예외를 추가했다. 기본 HTTPS 제한은 유지하고 자격증명/공백/다른scheme은 거절한다. 출처URL은 서버가 호출하지 않으며 TLS 검증 해제·LLM/모델 HTTP 허용과 무관하다. 새2개 회귀는 HTTP 기본거절/명시허용·URL미호출과 허용 옵션에서도 위험 형식 거절을 확인한다. 전체 PostgreSQL85/85(32.114초), Django check 정상·migration 변경 없음. 추가 유료추론0.

```text
# 독립PG 프로젝트 arti-007-check, provider disabled/key 비움/test fixture 허용
python manage.py test arti.tests --noinput -v 1
# read-only /intake 단독007 bundle, 실제 추가 전에는 --dry-run을 붙여 실행
python manage.py import_exhibition_bundle /intake --append-to-draft --expected-version 2 --allow-http-reference
```

현재version3에 위 명령을 다시 적용하지 않는다. 기존ID 충돌로 중단되는 것이 정상이다.15점의 사전 dump/미디어와 원문·이미지·env는 private에 보존하고 Git에는 넣지 않았다. 시험 컨테이너만 종료하고 볼륨과 arti-dev는 유지한다.

## 자체 검토와 다음

동일 작업자가 팀/교수·평가위원/방문자·콘텐츠/기술·SENIOR 시각으로 기존15점 보존·표기 근거·조건부 승인 구분·HTTP 예외 범위·회귀를 검토했다. 독립/사람 승인으로 표시하지 않는다. 이번은 기술적 비공개16점 인수 완료이며 식별/권리/콘텐츠·공개 승인과 W06/G5 전체는 대기다. [다음 작업 순서](../../../../../operations/2026-11-09_16점인수후_다음작업.md)를 따른다.
