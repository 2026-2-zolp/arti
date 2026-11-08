# W07 텍스트 provider 연결 준비

2026-11-08 KST. 사용자 요청의 GPT키 삽입·OpenAI 호환 확장 준비를 구현했다. **W07/G6 실제 모델 인수는 미통과**이며 데이터 준비·품질 평가를 건너뛰지 않았다.

이전 providers.generate는 항상503이었다. 현재 llm.py + providers.py/config/settings.py + compose.yaml/.env.compose.example을 통해 명시 openai_compatible 설정일 때만 Chat Completions로 summary/guide/explanation/answer/interpret를 호출한다. 공통/작업별 모델명을 분리했고, 키·모델 미설정/disabled는503이다. 실제 ignored .env.compose에는 기존 비밀값을 유지하고 빠진 비활성·빈 설정 칸만 추가했다. 이 파일은 커밋하지 않는다.

OpenAI SDK 추가 없이 작은 표준 HTTP adapter를 사용해 프로젝트의 Python API 경계를 유지했다. 응답 JSON/길이·원문필드 선택·redirect 금지·단일 호출/timeout·오류 정제·429 Retry-After를 구현했다. 모델의 이미지 태그/감정 역할을 바꾸지 않았고, Kanana 자동 fallback도 넣지 않았다. [설정·모델 선택·Kanana 경로](../../../../operations/AI_설정과모델선택.md).

## 검증과 보완

- test_provider.py의11검사: 실제 로컬HTTP body/auth/JSON·진입질문/이력, 작업별모델·호환옵션,5종텍스트형식,disabled/키/모델누락,분류기미대체,URL정책,redirect,상태별오류,timeout/network,잘못된/거절/잘린/대용량응답,긴입력차단. 외부 키·유료 호출 없음.
- test_integration.py에 실제 로컬 endpoint429→ask/analyze 모두429+Retry-After30·DBversion불변1검사 추가. 기존51을 유지해 최종63통과. Linux Python3.12/실제 PG17, 별도 test_arti 생성/제거.
- 기술 검토에서 미검수 summary/guide가 관리자 DTO에서 모델근거로 섞이는 문제와429소실을 지적했다. 원문7개필드만 보내도록 제한하고 unreviewed sentinel의 실제HTTP불포함을 검사했다. entry는 기존 서버가 확정해설/질문에서 재구성하는 경계를 유지한다. 분석 전체실패 집계도429를 보존한다.
- 추가 통합 검사 삽입 위치가 다음 클래스 decorator와 섞여 IndentationError가 났다. 올바른 클래스 안으로 옮기고 전체63검사를 재실행해 통과했다. 실패를 통과 결과로 둔갑시키지 않았다.
- 독립 기술 재검토: 두 필수 지적 해결, 추가 필수 결함/범위과잉 없음. 실제키/모델 검증과 CI 원격 run은 여전히 미실행.

원문 근거·상태 정책·공개/확정 보호의 기존 계약을 변경하지 않았다. 실제 유료 모델 응답, 비용/지연, 원문충실성·관찰유도, Kanana비교·CLIP/mDeBERTa연동은 다음 실제 자료/모델 검증에서 다룬다. [전체 PG 로그](postgres-tests.log).

검증 종료 후 arti-w05 API/DB 컨테이너와 네트워크를 종료하고 기존 시험 DB/media 볼륨을 보존했다. 키는 끝까지 비활성/빈 값이며 외부 유료 호출은 없었다.

사용자 후속 결정(2026-11-08): 키 삽입/실모델 검증은 추후 필요 시 진행하고, 확장 방향과 하네스도 그때 함께 논의한다. 현재 준비 코드는 유지하되 이번 CI 원격 검증에 실제 키·유료 호출·새 라우팅/하네스 구현을 포함하지 않는다. [결정과 논의 후보](../../../../operations/AI_설정과모델선택.md).

2026-11-09 후속: [40점 실제 기준선·평가자 민감도](tag-baseline-2026-11-09/README.md)와 [피드백 포함 편향 완화 계획](tag-baseline-2026-11-09/feedback-plan.md)을 추가했다. 실제모델 기동은 확인했으나 정식G5/실제전시 품질/사람승인과 구분한다.
