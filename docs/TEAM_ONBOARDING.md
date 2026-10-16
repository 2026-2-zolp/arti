# 새 팀원 시작 가이드

1. GitHub 조직 `2026-2-zolp` 초대 수락 및 [arti 저장소](https://github.com/2026-2-zolp/arti) 접근 확인
2. [ARTI Notion](https://app.notion.com/p/26-2-ARTI-a3534713f16782789905811787871032)에서 프로젝트 방향·일정 확인
3. [개발 범위](PROJECT_SCOPE.md)·[협업 규칙](CONTRIBUTING.md) 먼저 확인
4. 로컬에서 저장소 내려받고 **자신의 개발 브랜치** 생성

```bash
git clone https://github.com/2026-2-zolp/arti.git
cd arti
git switch -c dev/<본인-GitHub아이디>
git push -u origin dev/<본인-GitHub아이디>
```

`<본인-GitHub아이디>`를 자신의 실제 GitHub 아이디로 변경하세요. 다른 사람의 브랜치는 직접 수정하지 않습니다.

5. 기능 작업 전 `git fetch origin` → 개인 브랜치에서 `git merge origin/main`으로 최신 통합본 반영
6. GitHub Issue 또는 팀에서 정한 범위에 맞춰 작업 후 로컬 검증
7. **영어 유형 + 한국어 설명**으로 커밋 (예: `feat: 작품 감상 화면 구현`), 본문도 한국어
8. 개인 브랜치 push 후 **PR (base: main, compare: 내 dev 브랜치)** 작성
9. 검토·병합 후에는 개인 브랜치를 다시 최신 main과 동기화

> 현재 저장소는 초기 구성 단계입니다. 앱 실행 명령은 각 프론트·백엔드 개발이 시작된 뒤 관련 README에 정리합니다.

## 작업 위치
- 기능/버그/코드 변경: GitHub Issues + PR
- 전체 일정·방향 및 회의 결정: Notion
- 개인 브랜치 병합 시 주의사항: [협업 규칙](CONTRIBUTING.md)의 '장기 개인 브랜치와 병합 방식' 참고
- GitHub 접근 문제: 조직 관리자에게 문의
