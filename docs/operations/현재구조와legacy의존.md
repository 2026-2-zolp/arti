# 현재 구조와 legacy 의존

2026-11-08 KST. 현재 실행은 Django·PostgreSQL·React이며, 이전 형상은 ae0e58ebc338c17da6d4d17616fd802f03ba3bb6 Git 기준점과 legacy 코드에 보존한다.

| 경로 | 현재 역할 | legacy 의존 판단 |
| --- | --- | --- |
| backend-django | 기본 서비스 API·추천·검수·회원·기록·텍스트 provider 경계 | Express 실행/설치 불필요 |
| frontend | 기본 Django, 명시 Express 비교 | 비교 모드는 유지하며 이전 기능 전체의 호환을 보장하지 않음 |
| ai-service | 모델 서비스·평가 코드·이미지·라벨·Kanana 실험 보존 | Express가 아니며 이미지/평가 입력은 계속 사용. 현재 Django의 실모델 연동 완료는 아님 |
| backend | 보존된 Express/SQLite·시드·기존 AI/규칙 경로 | 현재 기본 실행과 CI의 의존성에서 제외. 삭제/이동하지 않음 |
| data/reference/git-captures | 기준 Git 원문과 동일한 해설 참조 사본·provenance | 새 점검/export는 이 경로를 사용. 기존 backend 데이터 파일을 직접 읽지 않음 |
| scripts/git_materials.py / export_git_captures.py | 읽기 전용 자료 점검 / 새 디렉터리 bundle 생성 | Python 표준 라이브러리만 사용. backend 폴더·Node·DB·모델·네트워크 불필요 |
| docs/execution-plan의 W02/W03 등 | 고정 Git 계약·이전 결함 재현/작업 증거 | 역사적 backend 경로/실행기를 그대로 보존. 현재 제품 실행 경로와 구분 |

분리한 것은 **현재 자료 복원 도구의 Express 폴더 의존**이다. 기존 소스를 없애거나 모든 과거 검사에서 backend 경로를 없앤 것이 아니다. 새 해설 사본은 원본의 이동이 아닌 추적 가능한 중립 참조 사본이며, 새 서비스 데이터의 자동 승인 근거가 아니다.

원본 backend/ai-service 트리는 이번 변경에서 diff0이다. 보호 아카이브38개와 기준 Git 형상을 보존한다. 이미지119개를 다시 복사하거나 새 DB를 초기화하지 않았다. 미확인 로컬 arti.db/uploads는 원본 보존 후 별도 인수 정책을 유지한다.

확인 명령: `python scripts/git_materials.py`, `python -m unittest discover -s scripts/tests -v`. 출력의125는 검증한 자산 파일 수이며 작품125점이 아니다. 40캡처와79WikiArt 이미지,11감정 예시는 서로 다른 집합이다. URL 형식·해시는 확인하지만 링크 내용·출품·권리·사람검수는 확인하지 않는다.

이후 실제 유영국 자료가 오면 별도 manifest/출처/사람 검수를 진행한다. GPT 키·실모델·확장·하네스 논의는 사용자 결정대로 추후에 한다. Express 코드 제거는 남은 자료/역사적 검사 의존을 검토한 후 별도 범위로 결정한다.
