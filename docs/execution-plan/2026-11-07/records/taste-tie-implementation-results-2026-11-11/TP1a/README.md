# TP1a — 모델/전달부의 선택적 점수 근거

2026-11-11 / 구현 출발 `d2975bf` / [상세계획](../../taste-tie-implementation-plan-2026-11-11/README.md)의 TP1a만 실행했다. 프론트 병합·DB필드·migration·점수 근거 저장·v2/동점 정렬·조사 선정/공개·원격push는 하지 않았다.

## 변경 전 → 변경 후

- FastAPI가 모델명/점수만 반환 → `tagEvidence` nullable 추가. 실제 base64 원본 바이트 SHA,점수 hash,동일 고정 CLIP model/processor artifact,실제 보정값·프롬프트/전처리/라이브러리 정의를 묶는다.
- 모델과 processor가 부동 revision으로 각자 로드될 수 있음 → 선택 설정 `ARTI_CLIP_REVISION`과 완전한 고정 cache snapshot일 때 둘 다 그 경로/local-only로 로드한다. 로딩 전후 파일 hash가 같고 전체모델 로딩이 성공해야 근거를 게시한다. 출처 미확정은 기존 점수 동작을 유지하고 null이다.
- Django가 새근거를 모르고 제거 → 실제 전송 이미지 바이트/점수/모델과 root/signature/envelope hash를 검사한다. 필드 부재/null은 허용,존재하는 잘못된 근거는502다.
- 검증된 새필드를 감정 결과가 그대로 저장할 위험 → providers.py의 기존 감정 반환에 tagEvidence를 넣지 않도록 한 줄 경계를 추가했다. 태그의 기존 `{'scores':...}`도 그대로다. 이 조정은 TP1b를 먼저 구현한 것이 아니라 기존 저장값/공개응답 호환을 지키기 위한 최소 보완이다.

## 변경 파일과 유지 범위

모델: `ai-service/app/provenance.py` 신규,`config.py/analyzer.py/image_fetch.py/main.py` 수정. Django: `model_service.py` 검증,`providers.py` 호환 경계. 시험: 모델 `test_provenance.py` 15case,Django `test_tag_evidence.py` 5method 신규. 루트 `.env.example`에는 빈 선택 설정/주석만 추가했고 실제 env는 수정하지 않았다. [모델 운영 안내](../../../../../operations/모델서비스_로컬운영.md)를 함께 갱신했다.

원래 점수 계산·태그8개·보정/가중치·추천3/5/7·모델 이름 기본값·기존 상태/로딩 정책은 유지한다. `runtime.py` 자체는 수정하지 않고 기존 단일 로드/추론·503/429 회귀를 재검증했다. 프론트·Django models/migrations·survey/recommendations·계정/방문 데이터는 변경하지 않았다. 일반 앱을 재기동/마이그레이션하거나 API로 분석/확정하지 않았다.

## 근거를 반환하는 조건과 JSON

확인한 HF repo ID·40자리 고정 commit과 완전한 snapshot cache가 필요하다. config/preprocessor/tokenizer_config/vocab/merges/special_tokens와 단일 weight형식/모든 shard를 확인한다. 샤드의 경로탈출/누락,여러 weight형식,캐시 부족,로딩 중 파일 변경,라이브러리 정보 부족,출처 없는 로컬 폴더/부동 revision은 추정하지 않는다. 새로운 cache 다운로드 자체를 근거로 소급 인정하지 않으며 null 상태는 명시 재기동/확인 전까지 유지한다.

tagEvidence의 필드는 version(1),tagSource(image),imageSha256,modelArtifactSha256,signature,signatureSha256,scoresSha256,evidenceSha256이다. signature는 이전 계약의6필드(modelId/modelRevision/promptPreprocessSha256/calibrationSha256/tagDefinitionVersion/scoreDefinitionVersion)를 유지한다. 점수 JSON은 유한 float로 정규화해0과0.0의 전송 차이를 흡수한다. envelope/signature는 UTF-8·키정렬·공백없는 JSON으로 hash한다.

태그 계산에 실제 쓴 보정값의 복사본과 같은 요청 점수를 묶는다. 해시 확인은 무결성 검사이며 모델 출처의 사람 승인이나 인증 서명은 아니다. 승인 signature 등록·원자 DB 저장·v2 비교 사용은 후속이다. 새근거에 cache 경로나 원본 바이트를 내보내지 않는다. 외부 URL/텍스트뿐인 분석은 원본 바이트의 확인 경계가 없으므로 근거 null이다.

근거 조회에 사용한 [Hugging Face cache-only API](https://huggingface.co/docs/huggingface_hub/main/package_reference/cache)는 다운로드를 하지 않는다. cache 불완전 시의 기존 로딩 경로는 원래 운영 설정에 따라 다운로드할 수 있다. 이번 시험은 offline/fake이며 가중치 다운로드/실모델 추론/GPT 호출을 하지 않았다.

## 통과 기준·검증 루프

| 기준 | 실제 확인 | 판정 범위 |
| --- | --- | --- |
| A1 입력/출처 결합 | 같은 픽셀/다른 PNG바이트의 SHA구분,실제threshold복사본·점수 hash·모델/processor 같은 cache/고정revision | fake scorer/작은 합성artifact로 계약·로더 전달 검사 |
| A2 구형/실패 호환 | absent/null허용·잘못된/외부이미지/낡은점수/다른모델/bool version/extra path/체크섬 변조502·유한0정규화 | 실제 로컬 HTTP + SimpleTestCase,DB금지 |
| A3 로딩/근거 보호 | 부분NLI실패시미게시·재시도·모델/processor 파일변경시null·getter사본·중복load1회·기존503/429복구 | 로딩 모킹/기존runtime 회귀;실제 가중치품질 아님 |
| A4 경계 유지 | 일반DB쓰기/모델다운로드/GPT0,기존provider 저장shape·schema/프론트/계약 보존 | cursor접근금지 HTTP시험+소스경계 검사 |

첫 제한환경 ASGI 시험이 1건 후 멈춰 중단했다. 로컬 비동기 소켓을 허용한 시험 프로세스에서 offline으로34건 통과 후,자체 검토로 tokenizer/cache 완전성·필수 runtime정보·4종파일변경·요청별threshold snapshot을 보강해 최종38건을 통과했다. 의존성 교체나 OS 보안 설정 변경은 하지 않았다.

모델 서비스 **38건(신규15)**,Django **23건(신규5,SimpleTestCase만)**,기존 스크립트 **53건** 통과. FastAPI에 임시 Uvicorn/fake scorer를 띄우고 Django model_service가 실제HTTP로 받은 [합성 wire](synthetic-http-wire.json)도 검사했다. DB cursor 호출0,태그/감정 제공자 저장shape 유지다. 시험서버는 종료했다. Starlette의 기존 TestClient/httpx 사용중단 경고1건은 기록하고 이 과업에서 의존성을 바꾸지 않았다.

기술/시니어·방문자·운영/데이터·팀/교수/외부 평가위원 관점의 같은 작성자 자체검토다. 원본 바이트/실제 로더·구형호환·부분 실패·우회 저장·출처 미확정·시험과 실제품질 구분을 확인했다. 독립 평가자 검수는 아니다. [명령/원수](tests.json),[검증 판정](validation.json),[기준 소스](baseline.json)를 보존한다.

## 재검증과 다음 단계

모델 시험은 `ARTI_PRELOAD=false`,writer=false,HF/TRANSFORMERS_OFFLINE=1과 workspace TEMP로 `ai-service/.venv/Scripts/python.exe -m pytest ai-service/tests -q`를 실행한다. Django는 synthetic secret/provider-disabled와 닿지 않는 DB포트로 `manage.py test arti.tests.test_tag_evidence.TagEvidenceTransportTests arti.tests.test_model_service.ModelServiceTests arti.tests.test_provider.ProviderTests --noinput`을 실행한다.모두 SimpleTestCase라 일반DB/시험DB 생성이 없다. Windows 로컬 HTTP/ASGI 소켓 권한이 제한된 실행 환경에서는 해당 시험 프로세스만 허용이 필요하다.

현재 소스경계 검사는 `python docs/execution-plan/2026-11-07/records/taste-tie-implementation-results-2026-11-11/TP1a/verify.py`다. 이전 상세계획 검사는 기본 Git기준 모드로만 실행한다. 제품이 바뀌었으므로 그 문서의 미적용 전용 `--planning-worktree` 통과를 요구하지 않는다.

**다음은 TP1b**: 기존행 null/0의 additive 필드·migration과 점수/근거/revision 원자 저장·실패/동시 수정/기존 확정 보호를 **격리 DB에서만** 구현·검증한다. 현재 일반 개발 DB 마이그레이션·공개·원격push는 자동으로 진행하지 않는다. 실제 cached 모델 근거1회·전체 PG/브라우저 인수는 TP4에 남아 있으며 프론트는 동섭 종합본 수령 후 재확인한다.
