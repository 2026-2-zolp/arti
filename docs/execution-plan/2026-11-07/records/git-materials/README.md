# 구조 안내 정리·Git 자료 점검·legacy 자료 의존 분리

2026-11-08 KST / 기준858b629 / 로컬 dev/임준억. 사용자 요청에 따라 현재 구조 안내와 자료 대기 계획2의 기존 Git 자료 점검을 진행했다. 유영국 실제자료 인수와 W06 전체 완료는 아니다.

## 변경 전후

이전 exporter는 backend/scripts/capture-descriptions.json을 직접 읽었다. 이제 기준 ae0 Git blob의 byte-identical 참조 사본을 data/reference/git-captures에 두고 그 사본만 읽는다. provenance에는 원경로·전체commit·blobOID·파일SHA256/bytes·검증자산 목록을 구분했다. 기존 backend와 ai-service는 이동/삭제/수정하지 않았다.

README 폴더 구조·담당 안내를 backend-django 기준으로 고쳤고, 프론트 표시 상수/추천의 주석·scripts/data 안내를 현재 계약과 맞췄다. 검증단이 발견한 'Django는 후보', '앱이 만들어지면 안내 추가', '정책 문서만 준비'라는 오래된 현재형도 수정했다.

## 실제 점검 결과

| 항목 | 결과/한계 |
| --- | --- |
| 캡처 | metadata40·해설40 ID집합 일치. 태그키/대표태그·빈원문·URL형식 검사 |
| 이미지 | 캡처40·WikiArt파일79 보존. 캡처 선언png와 실제jpg 차이40건을 ID단일후보로 기록 |
| 기타 | 감정평가 예시11, 라벨CSV3 등 자산 총125개 해시 확인. 125작품/79정답을 뜻하지 않음 |
| 참조 원문 | Git blob7932017318824d31deddeb65b74e61dc486aac66, 16740bytes, SHA256416000f684bd66af6ccc694bf91242f07fae2bb7f53ee6cc042bb3f022c6b0b7 |
| 승인 | checkedAt=null, 승인0, DB쓰기없음. 작품 사실·이미지권리·유영국 출품 검증 아님 |
| 분리 전후 | 858b629의 이전 exporter와 40개작품 payload/이미지 해시 동일. descriptionsSha256만 기존workingtree CRLF와 기준Git 원바이트 차이로 다름(내용 동일) |
| legacy 없는 실행 | 임시 복사본에 backend 디렉터리 없이 audit/export 성공. Node/Express/DB/실모델 불필요 |

hashPolicy: 참조원문/이미지=raw, 기타JSON=정렬compact UTF-8 의미값, CSV=UTF-8/LF. 줄바꿈이 다른 Windows/Linux checkout을 변조로 잘못 판정하지 않으면서 참조원문 자체는 -text로 보존한다. 정해진 자산을 바꿀 때에는 provenance와 사람 검토가 필요하다.

## 검증 루프

Windows/Python과 Linux/Python3.12에서 자료7검사 통과. 원본Git일치, backend없는export/원본불변, 누락/변조, 중복/누락ID, 잘못된라벨/원문/URL, 이미지모호성/경로탈출, 새목적지/원본영역 거부를 검사했다. 기존 프론트17건도 통과했다. 프론트 동작은 바꾸지 않고 주석만 수정했다.

첫 Windows 검사는 sandbox 임시폴더 권한으로 실행되지 못해 정상 시험 환경에서 다시 실행했다. 이후1검사에서 declared png를 실제로 추가한 뒤 모호성을 기대하는 fixture가 잘못됐음을 발견했다. 선언파일이 있으면 우선한다는 규칙을 유지하고, 선언파일이 없는 상태의 jpg/jpeg 복수후보로 fixture를 고쳐7검사를 통과했다. 실패를 숨기거나 정상 복수파일을 모두 오류로 바꾸지 않았다.

기술 검증단: 경로/원본보존/provenance·hash/선언우선·의존분리 적정, 필수 코드 지적0. 범위·관람객 검토: 집합/사람검수·원본보존 경계 적정, 오래된 문서 상태를 수정해 보완. AI 역할 검토이며 실제팀/교수 승인 아님.

CI의 기존 Plan and contract checks에 자료 unittest와 audit 두 명령을 추가하고 actionlint 로컬exit0을 확인했다. 이번 요청은 로컬커밋만이므로 변경된 workflow의 실제 원격 실행은 아직 없다. 기존원격CI성공을 재사용하지 않는다. API/DB코드를 변경하지 않아 PG63을 이번에 재실행했다고 쓰지 않는다.

## 산출물/남은 일

audit.json·tests.log·linux.log·payload-comparison.json은 실제 검사 근거다. [현재 구조와 의존](../../../../operations/현재구조와legacy의존.md), [참조자료 정책](../../../../../data/reference/git-captures/README.md), [작업기록](../../../../작업기록/2026-11-08_구조안내와Git자료의존분리.md).

유영국 자료/출처/사람검수·실모델 평가·로컬고유DB 인수·Express 전체 제거는 남아 있다. 다음 독립 과업은 시험 DB/미디어 로컬 백업·복원 준비다. 원격push는하지않는다.
