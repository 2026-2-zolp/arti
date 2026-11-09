# W11 최신 코드의 로컬 CI 인수 준비

2026-11-09 / 출발7e8ec2e / dev/임준억. 최신 작업트리의 검사 명령을 Linux에서 재현한다. 실제 GitHub runner·PR 이벤트 실행·required-check 설정·main 병합·CD 인수와 구분한다. 원격 푸시/PR 생성은 하지 않는다.

## 이번 완료 기준

1. 프론트의 깨끗한 npm ci·회귀·타입·빌드가 통과한다.
2. Python3.12/실제 PG17의 check·migration drift·빈 DB migrate·전체 arti.tests가 통과한다. 새 모델 장애·저장 보호 검사가 발견/실행된다.
3. Torch/모델/유료 키 없는 Python3.12에서 전체 모델 검사가 통과한다. 로딩·동시성·실패 복구 검사가 발견/실행된다.
4. 계획·계약·guardrail·자료/독립라벨 스크립트 검사와 workflow 구문 검사가 통과한다.
5. 일반 개발 DB·키·콘텐츠 승인·정식 게이트를 변경하지 않고 격리 시험환경을 정리한다.

## 변경과 증거

workflow의 모델 job에 ARTI_WRITER_ENABLED=false를 명시해 현 CLIP/mDeBERTa 역할과 운영 설정을 일치시킨다. pytest는 tests 전체를, Django는 arti.tests 전체를 수집하므로 새 파일을 수동 목록에 추가하지 않는다. 테스트 수를 workflow에 하드코딩하지 않는다. 기존4job 이름·PR/브랜치 트리거·최소 권한·유료 키 제외 정책은 유지한다.

실행 명령·종료 코드·소요시간은 linux-results.json, 각 job 로그와 plan-checks.log, actionlint.log에 기록한다. 로컬 Docker는 GitHub Ubuntu VM과 동일 환경이라는 뜻이 아니다. 프론트는 Node22 Alpine, 모델/API는 Python3.12 Debian slim을 사용한다. 계획 job도 Python3.12 Linux에서 저장소 전체 이력으로 실행했다. 기존 Git 근거의 바이트 일치 검사를 생략하지 않았다. [재현 runner](executed-linux-runner.py.txt)는 프론트/모델/API 검사를 병렬 실행하며 계획·actionlint 명령은 아래 결과와 작업기록에 별도 명시한다.

| 검사 | 이번 결과 |
| --- | --- |
| Frontend | clean npm ci·20회귀·타입·빌드 통과 |
| Django/PG17 | check·migration drift0·빈 DB migrate·97회귀 통과(50.497초). test_model_operations의3검사 자동 수집/실행 |
| Model fake | Torch/모델/유료 키 없이24검사 통과(3.00초). 새 runtime6검사 포함 |
| Plan/contracts | errors0·보호38파일·guardrail32/32·W02 오류0·scripts27검사(9.256초)·125자산 감사 통과 |
| Workflow | actionlint exit0 |

처음 계획 보강 때 잘못된 resolvedCommit=None 음성 입력이 subprocess 예외를 유발해 수정했다. 기존 단계 가설은 최신 상태표와 독립시키고 현재 표의7개 양성/음성 검사를 추가했다. Windows sandbox에서는 임시폴더 권한으로 scripts27 중14건이 오류였으며 Linux 재실행은27건 전부 통과했다. 실패 로그는 reconciliation 기록에 보존한다. 동일 SHA 조상 확인은 검사1회 안에서 캐시해 중복 Git 호출을 줄였다.

Starlette/httpx deprecation warning1개와 pip root/update 안내가 남는다. 시험을 skip하거나 의존성을 임의로 바꿔 감추지 않았다. 이번에는 실제 GPT/분류모델 호출·승인·DB migration 변경이 없다. 일반 arti-dev 컨테이너는 재생성하지 않았다. 전용 PG 컨테이너/네트워크·새 시험 볼륨은 제거했고 기존 시험/개발 볼륨은 건드리지 않았다.

## 원격 PR 인수 절차 — 후속 실행

1. 푸시 승인을 받은 뒤 현재 브랜치의 대상 SHA를 push하고 해당 SHA의4job 결과를 확인한다. 과거 성공 run을 최신 코드 결과로 재사용하지 않는다.
2. 기준 브랜치와 diff를 검토해 draft PR을 생성할 때 대상 브랜치를 확인한다. PR 생성/병합은 이번 작업에 포함하지 않는다.
3. pull_request 이벤트의 head SHA·merge ref·run/job ID를 보존하고4job success를 확인한다. 실패/취소/skip은 통과로 취급하지 않는다.
4. 브랜치 보호의 required checks 적용 여부는 별도로 읽기 확인하고, 설정 변경이 필요하면 구체적인 안을 제시한다. 권한 없이 변경하지 않는다.
5. AC07/GCI 인수 근거를 연결해 판정한다. CI는 실모델 품질·콘텐츠 검수·CD 성공의 증거가 아니다.

다음: 격리 브라우저에서 새 모델 로딩/429/timeout/복구가 입력·재시도·중복 저장에 미치는 영향을 점검한다.
