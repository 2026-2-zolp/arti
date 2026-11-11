# 출처와 기준점

조사 기준일: 2026-11-06(KST). 파일·커밋·페이지 상태가 바뀌면 이 기준선과 차이를 먼저 확인한다. 최신 날짜의 개인 준비안이 과거 실제 합의를 자동 폐기하는 것으로 해석하지 않는다.

## 원본과 조사 사본

| 자료 | 기준 | 조사 경로·용도 |
| --- | --- | --- |
| 최신 프론트 | 사용자 제공 frontend-share-1106.zip, SHA256 9621F7686F39F0C6AFA03733B92D572EAEEDBFFB47573D79D912673D0B8F7776 | [압축 해제 소스](../../../research/frontend-share-1106/frontend/package.json). 의존성 설치/빌드만 시행, 원본 소스 수정 없음 |
| 광권 브랜치 | [dev/김광권](https://github.com/2026-2-zolp/arti/tree/dev/%EA%B9%80%EA%B4%91%EA%B6%8C), 고정 SHA bb83a86cfb1553e89ec48e698e41f845d8ddf043 | [고정 커밋](https://github.com/2026-2-zolp/arti/tree/bb83a86cfb1553e89ec48e698e41f845d8ddf043), [백엔드 사본](../../../research/kwangkwon-bb83a86/backend/package.json). AI 사본은 일부 파일만 확보 |
| 팀 전체 카톡 | SHA256 FA68B831141C856F85FCE674AB9F4FA56E6FD87D4B83370351A779676E4982C8 | [사용자 원본](<C:/Users/임준억/Documents/카카오톡 받은 파일/KakaoTalk_20261106_1153_06_986_group_26-2졸프.txt>). 필요한 후속 통합·모델 지연·인계 대화만 확인 |
| 개인톡 묶음 | SHA256 977FB0720203D1B6514F6AEAFDF39EDE00F5225D00FF967B053D9356B8EDA0C8 | [사용자 원본](<C:/Users/임준억/Documents/카카오톡 받은 파일/KakaoTalk_20261106_0908_57_580_김동섭님_김광권님(26-2졸프).txt>). 11/4 UI 의미·11/5 23:41 요청 근거 |
| 제안 자료 | Notion 자료실의 1차발표 PDF | [원본 PDF](../../../research/ARTI_proposal.pdf), [추출문](../../../research/ARTI_proposal.txt). 9·13쪽 시각 대조 완료. 최종 제출본 동일성 미확인 |
| 화면설계 | Notion UI 설계 첨부 docx | [원본](../../../research/ARTI_UI_design.docx), [추출문](../../../research/ARTI_UI_design.txt). 과거 사용자15/관리자6 화면 시안이며 최신 ZIP보다 우선하지 않음 |
| AI 평가 | 고정 커밋 ai-service/ai_validation.ipynb의 저장 셀·출력 | [읽기용 추출](../../../research/ai-validation-extract.md). 모델 재실행 아님. 이미지 입력 미확보 |
| 최신 사용자 정정 | 이번 대화 | 준억님 최초 GitHub 이후 실제 개발 없음. 과거 계획 표현보다 우선 |

프로젝트 루트 [Notion](https://app.notion.com/p/a3534713f16782789905811787871032). 관련 원문 스냅샷은 아래 링크에 보존한다. 페이지의 signed download URL은 보존하지 않는다. 원본 채팅 전체를 보고서에 복제하지 않는다.

## 주요 Notion 원문

- [🧭 9/23 후속회의 · 핵심 경험·설명 범위·차별화 정리](https://app.notion.com/p/3e234713f16781029d0cf249818c8196) — [로컬 원문](sources/3e234713f16781029d0cf249818c8196.md) / 편집시각 2026-11-05T23:48:33.039Z
- [📝 10/12 정기회의 · 유영국 전시 선정 및 개발 착수 (회의 결과)](https://app.notion.com/p/3fb34713f1678122bbf9f2c856b50ce8) — [로컬 원문](sources/3fb34713f1678122bbf9f2c856b50ce8.md) / 편집시각 2026-11-05T23:48:35.220Z
- [🎤 10/20 중간발표 · ARTI 발표 및 교수님 피드백 (복원 기록)](https://app.notion.com/p/40134713f16781128c42daa31409c45b) — [로컬 원문](sources/40134713f16781128c42daa31409c45b.md) / 편집시각 2026-11-05T23:48:37.295Z
- [📝 10/26 회의 · 취향 조사·AI 추천·개발 연동 논의](https://app.notion.com/p/40534713f167815ca209e7cb69599407) — [로컬 원문](sources/40534713f167815ca209e7cb69599407.md) / 편집시각 2026-11-05T23:48:40.971Z
- [📝 11/3 회의 · 프론트·AI 설계 조율 및 통합 후속](https://app.notion.com/p/40f34713f16781b7bae8e16a53b63845) — [로컬 원문](sources/40f34713f16781b7bae8e16a53b63845.md) / 편집시각 2026-11-06T00:33:13.114Z
- [🔄 11/3 이후 개발·통합 현황 | 11/4~11/6 후속 기록](https://app.notion.com/p/41034713f16781818024c2b48f372311) — [로컬 원문](sources/41034713f16781818024c2b48f372311.md) / 편집시각 2026-11-06T00:32:47.385Z
- [김광권](https://app.notion.com/p/3f034713f16780d39decdc6996c7994c) — [로컬 원문](sources/3f034713f16780d39decdc6996c7994c.md) / 편집시각 2026-10-15T14:16:08.934Z
- [🎤 10/18 중간발표 PPT 제작 기록 · 장표별 구성·검증·발표 스크립트](https://app.notion.com/p/3fd34713f16781dfa73cd32ee360112d) — [로컬 원문](sources/3fd34713f16781dfa73cd32ee360112d.md) / 편집시각 2026-10-18T11:30:41.132Z
- [10/15 궁금점](https://app.notion.com/p/3fa34713f16780beb95ec4e5879ba25b) — [로컬 원문](sources/3fa34713f16780beb95ec4e5879ba25b.md) / 편집시각 2026-10-16T14:25:49.139Z
- [🧩 임준억 | 11/3 회의 준비 · OAuth·AI·개발 연동 방향](https://app.notion.com/p/40d34713f16781feb71ed930090ac9b6) — [로컬 원문](sources/40d34713f16781feb71ed930090ac9b6.md) / 편집시각 2026-11-03T03:18:11.088Z
- [1차발표](https://app.notion.com/p/3e434713f16780cfa5e9d0b280b3e760) — [로컬 원문](sources/3e434713f16780cfa5e9d0b280b3e760.md) / 편집시각 2026-09-23T04:38:05.401Z

## 재실행 조건

조사 환경은 Windows PowerShell, Node 22.23.1, 현재 스냅샷의 package-lock과 의존성을 사용했다. 네이티브 SQLite 등 환경 의존성이 있으므로 다른 Node 버전에서 결과가 같다고 가정하지 않는다. 실제 키를 출력·커밋하지 않는다.

프론트 디렉터리에서 npm run build, 백엔드 디렉터리에서 npm run typecheck 및 npm test로 현재 검증을 반복할 수 있다. 조사 audit은 백엔드 디렉터리에서 .\node_modules\.bin\tsx.cmd integration-audit.mts 로 실행한다(인메모리 DB, 외부 실제 AI 호출 없음). audit은 본문에 Node/PowerShell 경로를 복사하기보다 파일에서 직접 확인할 것.

대용량 fetch 과정에서 생긴 빈 노트북 placeholder는 제거했다. 유효한 분석 근거는 고정 커밋의 ai-service/evaluation/ai_validation.ipynb 원본에서 읽어 생성한 ai-validation-extract.md다. 조사 사본을 정식 소스 저장소로 간주하지 않는다.

