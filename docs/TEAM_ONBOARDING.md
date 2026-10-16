# 👋 팀원 시작 가이드 — 5분 만에 흐름 파악하기

[← 메인 안내로](../README.md)

초대받은 팀원이 처음 해야 할 일을 순서대로 정리했습니다.

## ① 초대 수락과 작업 브랜치 확인

1. GitHub 조직 `2026-2-zolp` 초대를 수락합니다.
2. [arti 저장소](https://github.com/2026-2-zolp/arti)에 접근되는지 확인합니다.
3. 개인 브랜치는 **미리 생성되어 있으니 새로 만들지 않아도 됩니다.**

| 팀원 | 이미 준비한 브랜치 |
| --- | --- |
| 임준억 | `dev/임준억` |
| 김광권 | `dev/김광권` |
| 지성현 | `dev/지성현` |
| 김동섭 | `dev/김동섭` |

**브랜치는 개인별 작업 공간이지 폴더가 아닙니다.** 한 저장소 안에서 각자 독립적으로 작업하고 PR로 통합합니다. 실제 담당 업무는 Notion 일정/WBS를 따릅니다.

## ② 저장소 내려받고 본인 브랜치 열기

```bash
git clone https://github.com/2026-2-zolp/arti.git
cd arti
git fetch origin
git switch --track origin/dev/본인이름
```

마지막 명령에서 `본인이름`을 위 표의 이름으로 바꿉니다. 예: `git switch --track origin/dev/김광권`.

이미 로컬에 브랜치가 있으면 `git switch dev/김광권`처럼 전환하면 됩니다.

## ③ 작업 시작 전 최신 main 반영

```bash
git switch dev/본인이름
git fetch origin
git merge origin/main
```

브랜치 내용을 최신 통합본에 맞추는 과정입니다. 변경 충돌이 나면 혼자 임의 삭제하지 말고 관련 팀원과 상의하세요.

## ④ 개발·커밋·PR

```bash
# 내 브랜치에서 코드 작업·테스트 후
git status
git add -A
git commit -m "feat: 작품 취향 선택 화면 구현"
git push -u origin dev/본인이름
```

`git add -A` 이전에 불필요한 파일·API 키가 포함되지 않았는지 `git status`로 확인합니다.

GitHub의 **Pull requests → New pull request**에서 아래처럼 선택합니다.

```text
base: main     ← 합쳐질 브랜치
compare: dev/본인이름   ← 내가 작업한 브랜치
```

PR 제목과 설명은 한국어로 적고, 변경 내용·검증 결과·관련 Issue를 남깁니다. 리뷰 후 `main`에 병합됩니다.

## ⑤ 병합 이후
1. 새 작업에 앞서 내 브랜치에서 `git fetch origin`, `git merge origin/main` 실행
2. 이전 PR의 변경이 다시 올라오지 않는지 확인
3. 필요시 새로운 기능 브랜치로 분리

**중요:** 지속 사용되는 개인 브랜치는 처음에는 `Create a merge commit` 방식으로 병합하는 것을 권장합니다. Squash merge는 [협업 규칙](CONTRIBUTING.md)의 주의사항을 확인하세요.

## 도움말
- [그림으로 보는 전체 흐름](WORKFLOW.md)
- [개발 협업 규칙](CONTRIBUTING.md)
- [API 미결정 목록](API_DECISIONS.md)
- [팀 Notion](https://app.notion.com/p/26-2-ARTI-a3534713f16782789905811787871032)

> 앱 실행 명령은 개발 스택이 확정되고 코드가 들어온 후 각 폴더 README에 추가됩니다.
