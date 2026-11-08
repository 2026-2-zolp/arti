# AI 설정과 모델 선택 — OpenAI 호환 텍스트 adapter

2026-11-08 KST / W07 연결 준비. 실제 유료 키·모델은 호출하지 않았다. 키 없는 기본 상태는503이며 가짜 답변이나 Kanana 자동 fallback을 넣지 않았다.

## 지금 권장하는 구성

우선 GPT의 단일 텍스트 모델로 요약·가이드·해설·대화 품질 기준을 잡고, 필요할 때 작업별 모델명을 바꾸는 구성을 권한다. 단순 요약에는 작은 모델, 질문 맥락을 이어가는 도슨트에는 더 좋은 모델을 쓰는 비교는 가능하다. 다만 지금부터 입력 난이도를 자동 판정해 고수준/저수준 모델로 라우팅하면 실패 원인·지연·비용·근거 추적이 복잡해진다. 먼저 동일 작품/질문 평가로 품질과 지연·비용 차이를 확인한 뒤 분리한다. 여기서 고수준/저수준은 모델 역할/용량 선택이지 내부 추론 내용을 저장·노출한다는 의미가 아니다.

이미지 취향8태그·감정6항목은 CLIP/mDeBERTa 분석의 별도 계약이다. 텍스트 GPT가 그 모델을 흉내 내게 바꾸지 않았다. 현재 새 Django의 tag/emotion 호출은 여전히503이며 실제 분석 연동은 남아 있다. 관리자 분석에서 텍스트 생성만 성공하면 summary/guide는 suggested로 저장되고 tag/emotion 실패는 항목별로 표시된다. 자동 확정하지 않는다.

## 키를 넣을 위치

실제 파일은 저장소 루트의 **ignored `.env.compose`**다. 기존 DB/서명키는 유지하고 누락된 AI 설정 칸만 비활성·빈 값으로 추가했다. 공유 템플릿은 [.env.compose.example](../../.env.compose.example)이며 키는 여기에 적지 않는다. 프론트의 VITE_*·브라우저 저장소·GitHub PR 로그에 키를 넣지 않는다. Django를 Compose 없이 실행하면 동일 이름의 서버 프로세스 환경변수로 전달한다(자동 dotenv 로딩 없음).

```dotenv
ARTI_LLM_PROVIDER=openai_compatible
OPENAI_API_KEY=여기는_ignored_파일에서만_실제값으로_교체
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=사용할_계정에서_지원되는_모델_ID
```

예시의 한글 placeholder는 실제 키/모델이 아니다. 실제 파일은 키와 모델을 비워두고 provider=disabled다. 설정 후 `docker compose --env-file .env.compose -p arti-dev up -d --build api`처럼 **사용할 프로젝트를 확인하고** API를 재생성한다. `arti-w05`는 시험 자료 전용이며 실제 개발 DB와 섞지 않는다. 확인 중 `docker compose config` 전체 출력은 키를 노출할 수 있으므로 `config --quiet`을 사용한다.

| 환경변수 | 의미/기본 |
| --- | --- |
| ARTI_LLM_PROVIDER | disabled / openai_compatible. 모델 변경/통신 실패 시 자동 대체 없음 |
| OPENAI_API_KEY | 서버 전용. 비어 있으면503 |
| OPENAI_BASE_URL | 기본 https://api.openai.com/v1, 뒤에 /chat/completions 추가. 외부는 HTTPS, loopback만 HTTP 허용 |
| OPENAI_MODEL | 공통 모델 ID. 기본 빈 값이라 계정에서 지원되는 모델을 명시해야 함 |
| ARTI_LLM_MODEL_ANSWER / EXPLANATION / SUMMARY / GUIDE / INTERPRET | 해당 작업만 다른 모델 ID. 빈 값은 공통 모델. 같은 endpoint/key 사용 |
| ARTI_LLM_JSON_MODE | 기본true: response_format=json_object. 호환 서버가 지원하지 않으면false 가능하나 응답 JSON 검증은 유지 |
| ARTI_LLM_TOKEN_PARAMETER | 기본 max_completion_tokens, 구형 호환 서버만 max_tokens 선택. 출력 예산2000(추론 토큰 포함 모델은 실제 평가 후 조정 필요) |

호환성은 Chat Completions의 model/messages/content·choices/message/content·finish_reason=stop 형식을 대상으로 한다. 모든 공급자의 완전한 호환을 보장하지 않는다. Responses API나 공급자 고유 API가 필요하면 providers 경계 뒤에 별도 adapter를 추가한다. 현재 모델 ID·temperature·reasoning_effort를 임의로 고정하지 않았다.

구현: [llm.py](../../backend-django/arti/llm.py), [providers.py](../../backend-django/arti/providers.py). 요청은 원문 사실만 선택하고, 진입 질문/해설과 최근 성공 대화는 기존 서버 재구성 경계를 유지한다. 관리자 DTO의 미검수 요약/가이드·내부 분석·계정정보·파일 경로를 함께 전송하지 않는다. 응답 JSON·필드 길이·형식 검사, 최대256KiB·통신 timeout25초·redirect 차단·자동 재시도 없음. upstream 401/403→503, 429→429+Retry-After30, timeout→504, 통신/형식 오류→502로 정제하며 upstream body/key/prompt를 로그에 남기지 않는다.

## Kanana는 빠졌는가?

**저장소에서는 남아 있고, 새 Django의 실행 경로에는 연결되지 않았다.**

- `ai-service/app/config.py`: 기본 writer 모델 kakaocorp/kanana-1.5-2.1b-instruct-2505와 on/off 설정.
- `ai-service/app/writer.py`, `app/main.py`: KananaWriter와 `/write`(요약·가이드) 및 관련 시험이 남아 있다.
- `backend/src/lib/ai.ts`: 기존 Express의 Claude/Kanana/규칙 기반 fallback 경로가 남아 있다. 기존 `/ask` 전체가 실제 Kanana 대화였다고 해석하면 안 된다.
- 현재 React의 Django 대상/새 Compose API는 이 Express 경로를 자동 호출하지 않는다. Kanana 제거가 아니라 전환 중 보존이다.

Kanana를 비교하려면 기존 `/write` 응답을 새 summary/guide 계약으로 바꾸는 adapter와 timeout/확정보호 검증이 필요하다. 또는 별도로 OpenAI 호환 서버에 Kanana를 서빙하면 같은 adapter에서 endpoint/model을 바꿔 시험할 수 있다. 기존 `/write` URL을 OPENAI_BASE_URL에 넣는 것만으로 동작하지 않는다. 현재 `provider=kanana` 옵션이나 모델 혼합·자동 fallback을 구현한 것으로 표시하지 않는다.

## 이후 실제 키를 넣고 확인할 것

1. 승인된 가상/허용된 작품 원문으로 명시적 API 시험. 키 오류/쿼터·모델 지원·JSON 옵션·지연 확인.
2. 관리자 summary/guide 생성→suggested→사람 검수/독립 확정→공개 노출. 확정 내용 보호/원문 변경 stale 유지.
3. U10 질문/해설→U11 실제 연속 대화와 실패 입력 보존. 작품근거·환각·응답 길이·태그로 이해수준 추정 금지 평가.
4. 같은 입력으로 단일 모델과 작업별 모델을 비교해 비용/지연/품질을 기록한 뒤 분리 여부 결정.

지금 통과한 것은 로컬 HTTP stub의 요청/오류/보안 경계다. 실제 GPT 품질·Kanana 비교·CLIP/mDeBERTa·W07/G6를 통과시킨 것이 아니다. 일반 CI는 disabled와 가상 키/로컬 endpoint만 사용한다.

참고: [공식 Chat Completions 형식](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [공식 서버 키 관리](https://developers.openai.com/api/docs/guides/api-keys). OpenAI는 신규 기능에 Responses도 권장하지만 이번에는 요청한 공급자 호환성을 위해 Chat Completions 경계를 사용했다.

## 사용자 후속 결정 — 키·확장·하네스는 추후 함께 논의

2026-11-08 사용자는 **API 키 삽입과 실제 호출 검증은 추후 필요할 때 진행**하기로 했다. 모델 확장 방향도 그때 재논의하며 **하네스도 함께 논의**한다. 위 단일 모델/작업별 분리는 제안이며 팀의 최종 모델 선정이나 당장 구현할 약속이 아니다.

그때 논의할 후보는 평가용 작품/질문과 근거, U10→도슨트 맥락·대화 재현, provider 교체·강제 실패/timeout/429, 응답 품질·지연·비용 판정과 관측/재실행 범위다. 구체적인 하네스 구조·도구·통과 수치는 아직 정하지 않았다. 이번 원격 CI 검증에서 키를 넣거나 유료 호출·추가 모델 라우팅·하네스 구현을 확대하지 않는다. 기존 로컬 HTTP 회귀와 실제 모델 평가 하네스를 구분한다.

2026-11-09 사용자 키 입력 준비: [로컬 키 설정 순서](GPT_API키_로컬설정가이드.md)를 추가했다. 주석과 가이드만 정리했으며 이번에 모델 선택·실호출·확장·하네스를 구현/검증하지 않았다.
