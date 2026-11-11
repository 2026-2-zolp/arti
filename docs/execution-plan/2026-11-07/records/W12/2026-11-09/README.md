# W12 운영 결정안 준비·검증

2026-11-09 KST / 출발d43f812 / dev/임준억. [전체 결정안](../../../../../operations/W12_운영구성과예산결정안.md). 사용자 회신으로 크레딧 없음과 AWS/대응책·설정 추가 조사 요구를 반영했다. EC2/RDS의 A/B와 비용 우선 Lightsail C·교내 로컬 보조안을 비교했다. **준비 검토는 통과했지만 W12 완료/AC33/GOPS 통과는 아니다.**

## 산출물과 재현

- pricebook.json: AWS 공식 공개 가격의10개 선택 단가, catalog SKU/rateCode·조건·발행일/원본 해시/URL과 Lightsail 공식 번들 표. 계정별 quote가 아니다. 원본 대형 catalogues는 ignored private 자료에만 보관했다.
- decision.json: A/B/C 후보·C 비용 우선 조건부 추천·크레딧 없음 확인·계정/상한/주소/종료일 미정·실제 배포 불가 상태. 이 플래그는 문서 상태이며 AWS 권한/과금을 기술적으로 차단하는 도구가 아니다.
- calculation-check.json: `python docs/execution-plan/2026-11-07/records/W12/2026-11-09/verify_draft.py`의 실제 결과. 실행은 조회/계산/출력뿐이며 계정이나 서비스에 연결하지 않는다.
- [현재 코드 차이](../../../../../operations/W12_운영구성과예산결정안.md): 운영형 프론트/프록시, RDS CA/환경 전달, 영속 미디어, 모델 패키지, 총 시간 예산·관측, OIDC/CD/복구 준비를 구분한다.

EC2 Linux shared OnDemand CSV 발행2026-11-07, RDS JSON2026-10-29, S3 JSON2026-11-04 자료를2026-11-09에 확인했다. EC2의 정적 단가 endpoint는404였고 전체 regional JSON은80MiB 조사 상한을 넘겨 저장/사용하지 않았다. 공식 CSV를 스트리밍해176525행 중 필요한4행만 보존했다. RDS는 실제 InstanceUsage SKU를 고르고 같은 가격의 UnusedBox 예약 행을 제외했다. S3의 productFamily가 없는 행은 제외하고 Standard 첫 구간을 고른다. 가격 숫자는 카탈로그 값이며 신규 리소스의 지원 class/version/용량은 실제 계정에서 별도 확인한다.

검사기는9개 변이(배포 가능 오기·선택 확정 오기·비용 제외 누락·가짜 무료 크레딧·RDS5GiB·유지IP 부분시간만 과금·예약SKU 혼동·Lightsail IP 중복 계산·stop 무료 오인)를 거절한다. Decimal로 계산하고 원단가 합산 후 반올림한다.720/176시간의 A/B 비교와 유지IP 월과금·중단 후 남는 비용을 대조했다. 소계는 A44.81/B65.43달러,176시간 비교 A16.53/B23.55달러다. 일반 Lightsail C는 한 달 보유 시 stop에도 과금되어 양쪽24.13달러다. C의 컴퓨팅/IP/기본디스크는 번들에 포함하므로 이중 합산하지 않는다. 모두 총 청구액/상한이 아니며 제외/정지·복구 조건을 함께 읽는다.

## 검증단 보완 루프

| 관점 | 지적/질문 | 반영·최종 판정 |
| --- | --- | --- |
| 팀/인수 | 계정 답변 없이 무엇을 완료했다고 할 수 있나 | 결정안 준비와 AC33 운영 확정 분리, 사용자 회신 항목·작업 순서 명시 |
| 교수/평가위원 | AWS 구성이 주제·현재 구현과 연결되나 | 기존 React/Django/PG/FastAPI 재사용. 관리자 사전분석과 관람객 추천 구분, AI/배포 성공 과장 금지 |
| 시니어/기술 | RDS/S3 주소 변경으로 바로 동작하나 | libpq SSL 환경 지원과 Compose CA/환경 전달 검증의 차이 명시. Path/FileResponse/base64 유지1차안과 S3 직접 adapter 후속 분리 |
| 운영/비용 | 정지 비용·복원 새 인스턴스·CPU credit이 빠졌나 | 유지 IPv4/스토리지 전월 과금·복원 중복비·변수비/외부 LLM 별도, Budgets hard cap 아님을 반영 |
| 데이터/복구 | DB만 복원하면 파일/계정도 안전한가 | DB+미디어+digest 정합 세트·새 대상·과거 세션/CA/키 보존·실제 복원 인수 조건 명시 |
| 관람객/콘텐츠 | 모델 장애가 전시 전체를 막거나 자료를 공개하나 | 저장 점수로 추천, 모델/LLM 실패 명시·합성 시험·실제 검수/공개 대기 유지 |
| 시간/자원 재검토 | 모델 단독4스레드/RSS를 EC2 전체 성능으로 바꿔 썼나 |4GiB/2vCPU는 가정·실부하 검증.25+25+30과90초 경계/대기를 별도 위험으로 올림 |

동일 작성자의 관점별 자체 검토이며 사람 검수·AWS 운영자 승인이나 실제 교수 평가가 아니다. 가격 조회의 오류/용량 제한·SKU 분류 문제를 고친 후 계산/경계 검사를 통과했다. 제품 기능/DB/키/가중치/CI workflow는 변경하지 않아 이 작업에서 이전23/97개를 재실행한 것처럼 보고하지 않는다.

## 준비 완료 조건·대기 조건

1. 실제 코드/이전 실측에 연결된2개 구성과 조건부 추천·주제 범위가 있다.
2. 공식 출처·시점·조건이 있는 단가로 계산이 재현되고 제외/유휴/복원/무료 가정을 숨기지 않는다.
3. 현재 미구현·미검증 설정과 W08/W09/W10 인수 증거가 연결된다.
4. IAM/공개주소·백업복구·종료·담당/상한 미결정이 드러나고 자동 승인/리소스 생성이 없다.
5.9개 음성 변이·계획/guardrail/계약·원본 보존 검사를 통과한다.

위 준비 기준은 통과다. 계정/담당·월 총상한·선택·주소/TLS/시험망·종료/보존/복구 담당은 회신 대기다. W12 in_progress, AC33/GOPS not_run과 operations.postgresDeployment=undecided를 유지한다. W08 실제 자원 생성·W09 CD·W10 실환경 인수는 미착수다.

**다음 한 작업:** 계정 회신과 독립적으로 W07 선행/W05 유지보수 범위의 관리자 전체 시간 예산·client abort/늦은 완료·재시도 처리를 검증한다. 이후 운영형 정적 서빙/프록시와 TLS/모델 패키지 준비를 이어간다. 팀원 자료 검수는 W06/W07 정식 평가의 별도 대기로 유지한다.

## 주요 공식 근거

가격 근거는 pricebook의 공식 EC2/RDS/S3 catalog URL이다. 운영 근거는 [RDS VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html), [TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html), [gp3 최소20GiB](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html), [정지7일](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html), [복원 새 인스턴스](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RestoreFromSnapshot.html), [IPv4 과금](https://aws.amazon.com/vpc/pricing/), [DNS 비례계산 제외](https://aws.amazon.com/route53/pricing/), [예산 알림 한계](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html), [SSM](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html), [OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)에서 확인했다. 차후 가격/지원 조건은 다시 확인한다.
